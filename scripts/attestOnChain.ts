import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Wires the LIVE TEE scorer to the deployed contracts: sets the attestation's TEE
// identity, registers an invoice, and attests a REAL TEE-signed grade on-chain.
//
//   1. Run the scorer round-trip to produce a signed result + attest-inputs.json:
//        cd tee-extension && ... run-test -mode score   (writes go/tools/attest-inputs.json)
//   2. npx hardhat run scripts/attestOnChain.ts --network coston2
//
// Uses the EIP-191 signer recovered from the real ActionResult (== the PRODUCTION TEE id).

// Normalize a 65-byte signature's recovery id to 27/28 (from 0/1) for on-chain ecrecover.
function normalizeV(sig: string): string {
    const b = ethers.getBytes(sig);
    if (b.length === 65 && b[64] < 27) b[64] += 27;
    return ethers.hexlify(b);
}

async function main() {
    const dep = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8")
    );
    const inputs = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "..", "tee-extension", "go", "tools", "attest-inputs.json"),
            "utf8"
        )
    );

    const [signer] = await ethers.getSigners();
    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.contracts.CifraAttestationNFT);

    const teeSigner = ethers.getAddress(inputs.signerEip191);
    console.log(`TEE signer (EIP-191, == machine id): ${teeSigner}`);
    console.log(`Enclave grade: ${inputs.grade} / risk ${inputs.riskBps} / discount ${inputs.discountBps}\n`);

    // 1. Point the attestation at the live TEE identity (owner-only; idempotent).
    if ((await attestation.teeAddress()) !== teeSigner) {
        await (await attestation.setTeeAddress(teeSigner)).wait();
        console.log(`setTeeAddress(${teeSigner}) ✓`);
    } else {
        console.log(`teeAddress already set ✓`);
    }

    // 2. Register the invoice this grade is for.
    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:live-demo"));
    const faceAmount = ethers.parseUnits("10000", 6);
    const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const ref = ethers.keccak256(ethers.toUtf8Bytes(`live-${Date.now()}`));
    const invoiceId = await registry.computeInvoiceId(signer.address, buyerCommitment, faceAmount, dueDate, ref);
    await (await registry.registerInvoice(buyerCommitment, faceAmount, dueDate, ref)).wait();
    console.log(`registerInvoice ✓  invoiceId=${invoiceId}`);

    // H1 binding: the signed result must be bound to THIS invoice. The score has to be
    // generated for the registered invoiceId — `INVOICE_ID=<id> run-test -mode score`.
    if (inputs.boundInvoiceId && inputs.boundInvoiceId.toLowerCase() !== invoiceId.toLowerCase())
        throw new Error(`attest-inputs.json is bound to ${inputs.boundInvoiceId}, not ${invoiceId}. Regenerate: INVOICE_ID=${invoiceId} run-test -mode score`);

    // 3. Attest the REAL TEE-signed result on-chain. The tee-node signs with v=0/1
    //    (go-ethereum recovery id); OpenZeppelin ECDSA.recover needs v=27/28 — normalize.
    const signature = normalizeV(inputs.signature);
    const tx = await attestation.attest(
        invoiceId,
        inputs.resultData,
        inputs.actionId,
        inputs.submissionTag,
        inputs.status,
        signature
    );
    const receipt = await tx.wait();
    console.log(`\nattest() ✓  tx=${receipt?.hash}`);

    // 4. Verify what got recorded on-chain.
    const g = await attestation.gradeForInvoice(invoiceId);
    const tokenId = BigInt(invoiceId);
    console.log(`  NFT tokenId owner: ${await attestation.ownerOf(tokenId)} (== supplier ${signer.address})`);
    console.log(`  recorded grade:    ${ethers.decodeBytes32String(g.grade)} / risk ${g.riskScoreBps} / discount ${g.discountRateBps}`);
    console.log(`  teeSigner on NFT:  ${g.teeSigner}`);

    const gradeStr = ethers.decodeBytes32String(g.grade);
    if (gradeStr !== inputs.grade || Number(g.riskScoreBps) !== inputs.riskBps || Number(g.discountRateBps) !== inputs.discountBps) {
        throw new Error("on-chain grade does not match the enclave result");
    }
    console.log(`\n✅ Real TEE-signed grade verified and recorded on-chain. Full chain: register → attest(TEE) → [fund → settle].`);
    console.log(`Explorer: https://coston2-explorer.flare.network/tx/${receipt?.hash}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
