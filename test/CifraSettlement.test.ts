import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
    CifraSettlement,
    CifraTrancheController,
    CifraTrancheVault,
    CifraInvoiceRegistry,
    CifraAttestationNFT,
    MockFXRP,
    MockFdcVerifier,
} from "../typechain-types";

const abi = ethers.AbiCoder.defaultAbiCoder();
const TEE_ACTION_RESULT = ethers.encodeBytes32String("TEE_ACTION_RESULT");
const BPS = 10000n;
const GRACE = 3 * 24 * 3600;
const RECEIVER_HASH = ethers.keccak256(ethers.toUtf8Bytes("rCifraProtocolXRPL"));

async function signResult(wallet: any, resultData: string, actionId: string, tag: string, status: number, chainId: bigint) {
    const resultHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [ethers.keccak256(resultData), actionId, ethers.keccak256(ethers.toUtf8Bytes(tag)), status]
    );
    const payload = ethers.keccak256(abi.encode(["bytes32", "uint256", "bytes32"], [TEE_ACTION_RESULT, chainId, resultHash]));
    return wallet.signMessage(ethers.getBytes(payload));
}

// Build an IPayment.Proof with the fields the settlement contract checks.
function paymentProof(opts: {
    reference: string;
    receiver: string;
    receivedAmount: bigint;
    status: number;
}) {
    return {
        merkleProof: [] as string[],
        data: {
            attestationType: ethers.ZeroHash,
            sourceId: ethers.ZeroHash,
            votingRound: 0,
            lowestUsedTimestamp: 0,
            requestBody: { transactionId: ethers.ZeroHash, inUtxo: 0, utxo: 0 },
            responseBody: {
                blockNumber: 0,
                blockTimestamp: 0,
                sourceAddressHash: ethers.ZeroHash,
                sourceAddressesRoot: ethers.ZeroHash,
                receivingAddressHash: opts.receiver,
                intendedReceivingAddressHash: ethers.ZeroHash,
                spentAmount: 0,
                intendedSpentAmount: 0,
                receivedAmount: opts.receivedAmount,
                intendedReceivedAmount: 0,
                standardPaymentReference: opts.reference,
                oneToOne: true,
                status: opts.status,
            },
        },
    };
}

// Build an IReferencedPaymentNonexistence.Proof with the fields the settlement contract checks.
function nonexistenceProof(opts: { reference: string; destination: string; amount: bigint; deadlineTs: number }) {
    return {
        merkleProof: [] as string[],
        data: {
            attestationType: ethers.ZeroHash,
            sourceId: ethers.ZeroHash,
            votingRound: 0,
            lowestUsedTimestamp: 0,
            requestBody: {
                minimalBlockNumber: 0,
                deadlineBlockNumber: 0,
                deadlineTimestamp: opts.deadlineTs,
                destinationAddressHash: opts.destination,
                amount: opts.amount,
                standardPaymentReference: opts.reference,
                checkSourceAddresses: false,
                sourceAddressesRoot: ethers.ZeroHash,
            },
            responseBody: { minimalBlockTimestamp: 0, firstOverflowBlockNumber: 0, firstOverflowBlockTimestamp: 0 },
        },
    };
}

describe("CifraSettlement", () => {
    let fxrp: MockFXRP, registry: CifraInvoiceRegistry, attestation: CifraAttestationNFT;
    let controller: CifraTrancheController, senior: CifraTrancheVault, junior: CifraTrancheVault;
    let verifier: MockFdcVerifier, settlement: CifraSettlement;
    let owner: any, keeper: any, funder: any, supplier: any;
    let tee: any, chainId: bigint;
    let invoiceId: string, dueDate: number;

    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:acme"));
    const faceAmount = ethers.parseUnits("10000", 6);
    const deposit = ethers.parseUnits("100000", 6);
    const discountBps = 600;
    const principal = (faceAmount * (BPS - BigInt(discountBps))) / BPS;
    const actionId = ethers.hexlify(ethers.randomBytes(32));
    const tag = "threshold";

    beforeEach(async () => {
        [owner, keeper, funder, supplier] = await ethers.getSigners();
        tee = ethers.Wallet.createRandom();
        chainId = (await ethers.provider.getNetwork()).chainId;

        fxrp = (await (await ethers.getContractFactory("MockFXRP")).deploy()) as unknown as MockFXRP;
        registry = (await (await ethers.getContractFactory("CifraInvoiceRegistry")).deploy()) as unknown as CifraInvoiceRegistry;
        attestation = (await (await ethers.getContractFactory("CifraAttestationNFT")).deploy(
            "Cifra Attestation", "CIFRA-ATT", tee.address, await registry.getAddress()
        )) as unknown as CifraAttestationNFT;
        controller = (await (await ethers.getContractFactory("CifraTrancheController")).deploy(
            await fxrp.getAddress(), await registry.getAddress(), await attestation.getAddress()
        )) as unknown as CifraTrancheController;
        senior = (await (await ethers.getContractFactory("CifraTrancheVault")).deploy(
            await fxrp.getAddress(), await controller.getAddress(), "Cifra Senior", "cFXRP-S"
        )) as unknown as CifraTrancheVault;
        junior = (await (await ethers.getContractFactory("CifraTrancheVault")).deploy(
            await fxrp.getAddress(), await controller.getAddress(), "Cifra Junior", "cFXRP-J"
        )) as unknown as CifraTrancheVault;
        verifier = (await (await ethers.getContractFactory("MockFdcVerifier")).deploy()) as unknown as MockFdcVerifier;
        settlement = (await (await ethers.getContractFactory("CifraSettlement")).deploy(
            await registry.getAddress(), await controller.getAddress(), await fxrp.getAddress(),
            await verifier.getAddress(), RECEIVER_HASH, GRACE
        )) as unknown as CifraSettlement;

        await registry.connect(owner).setStatusUpdater(await controller.getAddress(), true);
        await controller.connect(owner).setTrancheVaults(await senior.getAddress(), await junior.getAddress());
        await controller.connect(owner).setOperator(keeper.address);
        await controller.connect(owner).setSettlement(await settlement.getAddress());

        // Funder capitalizes the senior tranche (junior left empty; these tests exercise
        // settlement mechanics, not the waterfall split — asserted in the controller tests).
        await fxrp.mint(funder.address, deposit);
        await fxrp.connect(funder).approve(await senior.getAddress(), deposit);
        await senior.connect(funder).deposit(deposit, funder.address);

        // Register, attest, and fund an invoice.
        dueDate = (await time.latest()) + 30 * 24 * 3600;
        const ref = ethers.keccak256(ethers.toUtf8Bytes("INV-SET-1"));
        await registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, dueDate, ref);
        invoiceId = await registry.computeInvoiceId(supplier.address, buyerCommitment, faceAmount, dueDate, ref);
        const resultData = abi.encode(["bytes32", "bytes32", "uint256", "uint256"], [invoiceId, ethers.encodeBytes32String("A"), 9900, discountBps]);
        const sig = await signResult(tee, resultData, actionId, tag, 1, chainId);
        await attestation.attest(invoiceId, resultData, actionId, tag, 1, sig);
        await controller.connect(keeper).fundInvoice(invoiceId);

        // The settlement contract holds FXRP representing the buyer's converted payment.
        await fxrp.mint(await settlement.getAddress(), faceAmount);
    });

    describe("settle", () => {
        it("settles a funded invoice from a verified payment and repays the vault", async () => {
            const proof = paymentProof({ reference: invoiceId, receiver: RECEIVER_HASH, receivedAmount: faceAmount, status: 0 });
            await expect(settlement.settle(invoiceId, proof))
                .to.emit(settlement, "Settled")
                .withArgs(invoiceId, faceAmount, invoiceId);

            expect((await registry.getInvoice(invoiceId)).status).to.equal(3 /* Settled */);
            expect(await controller.nav()).to.equal(deposit + (faceAmount - principal)); // yield realized
            expect(await fxrp.balanceOf(await settlement.getAddress())).to.equal(0);
        });

        it("rejects an invalid proof", async () => {
            await verifier.setPaymentValid(false);
            const proof = paymentProof({ reference: invoiceId, receiver: RECEIVER_HASH, receivedAmount: faceAmount, status: 0 });
            await expect(settlement.settle(invoiceId, proof)).to.be.revertedWithCustomError(settlement, "InvalidProof");
        });

        it("rejects wrong reference, wrong receiver, underpayment, and failed status", async () => {
            await expect(
                settlement.settle(invoiceId, paymentProof({ reference: ethers.ZeroHash, receiver: RECEIVER_HASH, receivedAmount: faceAmount, status: 0 }))
            ).to.be.revertedWithCustomError(settlement, "WrongPaymentReference");
            await expect(
                settlement.settle(invoiceId, paymentProof({ reference: invoiceId, receiver: ethers.ZeroHash, receivedAmount: faceAmount, status: 0 }))
            ).to.be.revertedWithCustomError(settlement, "WrongReceiver");
            await expect(
                settlement.settle(invoiceId, paymentProof({ reference: invoiceId, receiver: RECEIVER_HASH, receivedAmount: faceAmount - 1n, status: 0 }))
            ).to.be.revertedWithCustomError(settlement, "Underpaid");
            await expect(
                settlement.settle(invoiceId, paymentProof({ reference: invoiceId, receiver: RECEIVER_HASH, receivedAmount: faceAmount, status: 1 }))
            ).to.be.revertedWithCustomError(settlement, "PaymentNotSuccessful");
        });
    });

    describe("markDefault", () => {
        it("defaults a funded invoice from a verified non-payment past due + grace", async () => {
            await time.increaseTo(dueDate + 1);
            const proof = nonexistenceProof({ reference: invoiceId, destination: RECEIVER_HASH, amount: faceAmount, deadlineTs: dueDate + GRACE });
            await expect(settlement.markDefault(invoiceId, proof))
                .to.emit(settlement, "Defaulted")
                .withArgs(invoiceId, dueDate + GRACE);

            expect((await registry.getInvoice(invoiceId)).status).to.equal(4 /* Defaulted */);
            expect(await controller.nav()).to.equal(deposit - principal); // loss (junior empty → senior absorbs)
        });

        it("rejects a non-payment window that ends before due + grace", async () => {
            await time.increaseTo(dueDate + 1);
            const proof = nonexistenceProof({ reference: invoiceId, destination: RECEIVER_HASH, amount: faceAmount, deadlineTs: dueDate + GRACE - 10 });
            await expect(settlement.markDefault(invoiceId, proof)).to.be.revertedWithCustomError(settlement, "DeadlineBeforeGrace");
        });

        it("rejects an invalid non-payment proof and a wrong amount", async () => {
            await time.increaseTo(dueDate + 1);
            await verifier.setNonexistenceValid(false);
            await expect(
                settlement.markDefault(invoiceId, nonexistenceProof({ reference: invoiceId, destination: RECEIVER_HASH, amount: faceAmount, deadlineTs: dueDate + GRACE }))
            ).to.be.revertedWithCustomError(settlement, "InvalidProof");

            await verifier.setNonexistenceValid(true);
            await expect(
                settlement.markDefault(invoiceId, nonexistenceProof({ reference: invoiceId, destination: RECEIVER_HASH, amount: faceAmount - 1n, deadlineTs: dueDate + GRACE }))
            ).to.be.revertedWithCustomError(settlement, "WrongAmount");
        });
    });

    describe("reserve (M3)", () => {
        it("reserveBalance reflects held FXRP; fundReserve tops up + emits", async () => {
            expect(await settlement.reserveBalance()).to.equal(faceAmount);
            await fxrp.mint(owner.address, faceAmount);
            await fxrp.connect(owner).approve(await settlement.getAddress(), faceAmount);
            await expect(settlement.connect(owner).fundReserve(faceAmount))
                .to.emit(settlement, "ReserveFunded")
                .withArgs(owner.address, faceAmount, faceAmount * 2n);
            expect(await settlement.reserveBalance()).to.equal(faceAmount * 2n);
        });

        it("settle reverts InsufficientReserve (with the shortfall) when the reserve is short", async () => {
            await settlement.connect(owner).withdrawReserve(faceAmount, owner.address); // empty the reserve
            const proof = paymentProof({ reference: invoiceId, receiver: RECEIVER_HASH, receivedAmount: faceAmount, status: 0 });
            await expect(settlement.settle(invoiceId, proof))
                .to.be.revertedWithCustomError(settlement, "InsufficientReserve")
                .withArgs(0, faceAmount);
        });

        it("withdrawReserve is owner-only and moves FXRP out", async () => {
            await expect(settlement.connect(keeper).withdrawReserve(faceAmount, keeper.address))
                .to.be.revertedWithCustomError(settlement, "NotOwner");
            await expect(settlement.connect(owner).withdrawReserve(faceAmount, owner.address))
                .to.emit(settlement, "ReserveWithdrawn")
                .withArgs(owner.address, faceAmount, 0);
            expect(await settlement.reserveBalance()).to.equal(0);
        });
    });

    it("rejects settling an invoice that is not funded", async () => {
        const ref = ethers.keccak256(ethers.toUtf8Bytes("INV-unfunded"));
        await registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, dueDate, ref);
        const unfunded = await registry.computeInvoiceId(supplier.address, buyerCommitment, faceAmount, dueDate, ref);
        const proof = paymentProof({ reference: unfunded, receiver: RECEIVER_HASH, receivedAmount: faceAmount, status: 0 });
        await expect(settlement.settle(unfunded, proof)).to.be.revertedWithCustomError(settlement, "InvoiceNotFunded");
    });

    it("owner can rotate the protocol receiver hash (L2)", async () => {
        const newReceiver = ethers.keccak256(ethers.toUtf8Bytes("rCifraProtocolXRPL-v2"));
        await expect(settlement.connect(keeper).setProtocolReceiverHash(newReceiver)).to.be.revertedWithCustomError(settlement, "NotOwner");

        await expect(settlement.connect(owner).setProtocolReceiverHash(newReceiver))
            .to.emit(settlement, "ProtocolReceiverHashUpdated")
            .withArgs(RECEIVER_HASH, newReceiver);
        expect(await settlement.protocolReceiverHash()).to.equal(newReceiver);

        // A payment to the OLD receiver now fails; to the NEW receiver it settles.
        await expect(
            settlement.settle(invoiceId, paymentProof({ reference: invoiceId, receiver: RECEIVER_HASH, receivedAmount: faceAmount, status: 0 }))
        ).to.be.revertedWithCustomError(settlement, "WrongReceiver");
        await expect(
            settlement.settle(invoiceId, paymentProof({ reference: invoiceId, receiver: newReceiver, receivedAmount: faceAmount, status: 0 }))
        ).to.emit(settlement, "Settled");
    });
});
