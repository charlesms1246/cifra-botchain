import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { CifraAttestationNFT, CifraInvoiceRegistry } from "../typechain-types";

const abi = ethers.AbiCoder.defaultAbiCoder();
const SCORE_RESULT_DOMAIN = ethers.encodeBytes32String("CIFRA_SCORE_RESULT");
const MODEL_VERSION = ethers.encodeBytes32String("cifra-score-v1");
const IMAGE_DIGEST = ethers.keccak256(ethers.toUtf8Bytes("sha256:test-image"));

// Build the ABI-encoded result the scoring service produces:
// (bytes32 invoiceId, bytes32 grade, uint256 riskBps, uint256 discountBps,
//  bytes32 modelVersion, bytes32 imageDigest).
// The leading invoiceId binds the grade to one invoice; the trailing two bind it to the code
// that produced it, so a reviewer can pull that image and recompute the result.
function encodeResult(
    invoiceId: string,
    grade: string,
    riskBps: number,
    discountBps: number,
    modelVersion: string = MODEL_VERSION,
    imageDigest: string = IMAGE_DIGEST
): string {
    return abi.encode(
        ["bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
        [invoiceId, ethers.encodeBytes32String(grade), riskBps, discountBps, modelVersion, imageDigest]
    );
}

// Reproduce the scoring service's signing scheme and sign with `wallet`.
async function signResult(
    wallet: any,
    resultData: string,
    actionId: string,
    submissionTag: string,
    status: number,
    chainId: bigint
): Promise<string> {
    const resultHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [ethers.keccak256(resultData), actionId, ethers.keccak256(ethers.toUtf8Bytes(submissionTag)), status]
    );
    const payload = ethers.keccak256(abi.encode(["bytes32", "uint256", "bytes32"], [SCORE_RESULT_DOMAIN, chainId, resultHash]));
    return wallet.signMessage(ethers.getBytes(payload));
}

describe("CifraAttestationNFT", () => {
    let registry: CifraInvoiceRegistry;
    let nft: CifraAttestationNFT;
    let owner: any, supplier: any, other: any;
    let tee: any; // mock scorer identity
    let chainId: bigint;
    let invoiceId: string;

    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:acme"));
    const ref = ethers.keccak256(ethers.toUtf8Bytes("INV-ATT-1"));
    const faceAmount = ethers.parseUnits("5000", 6);
    const actionId = ethers.hexlify(ethers.randomBytes(32));
    const submissionTag = "threshold";

    beforeEach(async () => {
        [owner, supplier, other] = await ethers.getSigners();
        tee = ethers.Wallet.createRandom();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const Reg = await ethers.getContractFactory("CifraInvoiceRegistry");
        registry = (await Reg.deploy()) as unknown as CifraInvoiceRegistry;
        await registry.waitForDeployment();

        const dueDate = (await time.latest()) + 30 * 24 * 3600;
        await registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, dueDate, ref);
        invoiceId = await registry.computeInvoiceId(supplier.address, buyerCommitment, faceAmount, dueDate, ref);

        const NFT = await ethers.getContractFactory("CifraAttestationNFT");
        nft = (await NFT.deploy("Cifra Attestation", "CIFRA-ATT", tee.address, await registry.getAddress())) as unknown as CifraAttestationNFT;
        await nft.waitForDeployment();
    });

    it("verifies a real signed result, mints to supplier, records the grade", async () => {
        const resultData = encodeResult(invoiceId, "A", 9900, 600);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        const tokenId = BigInt(invoiceId);

        // Called by the keeper (owner is the default attester); the NFT still mints to the
        // invoice's supplier, not the caller.
        await expect(nft.connect(owner).attest(invoiceId, resultData, actionId, submissionTag, 1, sig))
            .to.emit(nft, "Attested")
            .withArgs(invoiceId, tokenId, supplier.address, ethers.encodeBytes32String("A"), 9900, 600, MODEL_VERSION, IMAGE_DIGEST);

        expect(await nft.ownerOf(tokenId)).to.equal(supplier.address);
        expect(await nft.isAttested(invoiceId)).to.equal(true);

        const g = await nft.gradeForInvoice(invoiceId);
        expect(g.grade).to.equal(ethers.encodeBytes32String("A"));
        expect(g.riskScoreBps).to.equal(9900);
        expect(g.discountRateBps).to.equal(600);
        expect(g.scorerSigner).to.equal(tee.address);
        // Provenance of the computation itself is recorded, not just the number.
        expect(g.modelVersion).to.equal(MODEL_VERSION);
        expect(g.imageDigest).to.equal(IMAGE_DIGEST);
    });

    it("records the model version and image digest the scorer signed", async () => {
        const otherModel = ethers.encodeBytes32String("cifra-score-v2");
        const otherDigest = ethers.keccak256(ethers.toUtf8Bytes("sha256:other-image"));
        const resultData = encodeResult(invoiceId, "B", 6500, 800, otherModel, otherDigest);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        await nft.attest(invoiceId, resultData, actionId, submissionTag, 1, sig);

        const g = await nft.gradeForInvoice(invoiceId);
        expect(g.modelVersion).to.equal(otherModel);
        expect(g.imageDigest).to.equal(otherDigest);
    });

    it("covers modelVersion and imageDigest under the signature — they cannot be swapped", async () => {
        // Sign one payload, then submit a payload claiming a different image. The signature no
        // longer matches, so the provenance fields are as tamper-evident as the grade itself.
        const signed = encodeResult(invoiceId, "A", 9900, 600);
        const sig = await signResult(tee, signed, actionId, submissionTag, 1, chainId);
        const tampered = encodeResult(
            invoiceId,
            "A",
            9900,
            600,
            MODEL_VERSION,
            ethers.keccak256(ethers.toUtf8Bytes("sha256:attacker-image"))
        );
        await expect(
            nft.attest(invoiceId, tampered, actionId, submissionTag, 1, sig)
        ).to.be.revertedWithCustomError(nft, "BadScorerSignature");
    });

    it("rejects a signature from the wrong key", async () => {
        const resultData = encodeResult(invoiceId, "B", 6750, 800);
        const badSig = await signResult(other, resultData, actionId, submissionTag, 1, chainId);
        await expect(
            nft.attest(invoiceId, resultData, actionId, submissionTag, 1, badSig)
        ).to.be.revertedWithCustomError(nft, "BadScorerSignature");
    });

    it("rejects tampered result data (signature no longer matches)", async () => {
        const resultData = encodeResult(invoiceId, "A", 9900, 600);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        const tampered = encodeResult(invoiceId, "A", 100, 600); // downgrade risk without re-signing
        await expect(
            nft.attest(invoiceId, tampered, actionId, submissionTag, 1, sig)
        ).to.be.revertedWithCustomError(nft, "BadScorerSignature");
    });

    it("rejects non-success status", async () => {
        const resultData = encodeResult(invoiceId, "C", 5000, 1100);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 0, chainId);
        await expect(
            nft.attest(invoiceId, resultData, actionId, submissionTag, 0, sig)
        ).to.be.revertedWithCustomError(nft, "ResultNotSuccessful");
    });

    it("rejects an unknown invoice", async () => {
        const resultData = encodeResult(invoiceId, "A", 9900, 600);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        await expect(
            nft.attest(ethers.ZeroHash, resultData, actionId, submissionTag, 1, sig)
        ).to.be.revertedWithCustomError(nft, "UnknownInvoice");
    });

    it("rejects double attestation", async () => {
        const resultData = encodeResult(invoiceId, "A", 9900, 600);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        await nft.attest(invoiceId, resultData, actionId, submissionTag, 1, sig);
        await expect(
            nft.attest(invoiceId, resultData, actionId, submissionTag, 1, sig)
        ).to.be.revertedWithCustomError(nft, "AlreadyAttested");
    });

    it("rejects an out-of-range risk score", async () => {
        const resultData = encodeResult(invoiceId, "A", 10001, 600);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        await expect(
            nft.attest(invoiceId, resultData, actionId, submissionTag, 1, sig)
        ).to.be.revertedWithCustomError(nft, "ScoreOutOfRange");
    });

    it("rejects an out-of-range discount", async () => {
        const resultData = encodeResult(invoiceId, "A", 9900, 10001);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        await expect(
            nft.attest(invoiceId, resultData, actionId, submissionTag, 1, sig)
        ).to.be.revertedWithCustomError(nft, "DiscountOutOfRange");
    });

    it("rejects a grade bound to a different invoice (H1 InvoiceMismatch)", async () => {
        // A validly-signed grade whose bound invoiceId is NOT the one being attested.
        const otherInvoice = ethers.keccak256(ethers.toUtf8Bytes("some-other-invoice"));
        const resultData = encodeResult(otherInvoice, "A", 9900, 600);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        await expect(
            nft.attest(invoiceId, resultData, actionId, submissionTag, 1, sig)
        ).to.be.revertedWithCustomError(nft, "InvoiceMismatch");
    });

    it("keeper-gates attest: a non-attester is rejected (H1)", async () => {
        const resultData = encodeResult(invoiceId, "A", 9900, 600);
        const sig = await signResult(tee, resultData, actionId, submissionTag, 1, chainId);
        // `other` is not the attester (owner is, by default).
        await expect(
            nft.connect(other).attest(invoiceId, resultData, actionId, submissionTag, 1, sig)
        ).to.be.revertedWithCustomError(nft, "NotAttester");

        // Owner can appoint a new keeper, who can then attest.
        await expect(nft.connect(other).setAttester(other.address)).to.be.revertedWithCustomError(nft, "NotOwner");
        await nft.connect(owner).setAttester(other.address);
        await expect(nft.connect(other).attest(invoiceId, resultData, actionId, submissionTag, 1, sig)).to.emit(nft, "Attested");
    });

    it("only owner can update the scorer address", async () => {
        await expect(nft.connect(other).setScorerAddress(other.address)).to.be.revertedWithCustomError(nft, "NotOwner");
        const newTee = ethers.Wallet.createRandom();
        await nft.connect(owner).setScorerAddress(newTee.address);
        expect(await nft.scorerAddress()).to.equal(newTee.address);

        // A result signed by the new TEE now verifies.
        const resultData = encodeResult(invoiceId, "A", 9900, 600);
        const sig = await signResult(newTee, resultData, actionId, submissionTag, 1, chainId);
        await expect(nft.attest(invoiceId, resultData, actionId, submissionTag, 1, sig)).to.emit(nft, "Attested");
    });
});
