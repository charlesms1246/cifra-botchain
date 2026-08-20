import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
    CifraSettlement,
    CifraTrancheController,
    CifraTrancheVault,
    CifraInvoiceRegistry,
    CifraAttestationNFT,
    MockAsset,
} from "../typechain-types";

const abi = ethers.AbiCoder.defaultAbiCoder();
const MODEL_VERSION = ethers.encodeBytes32String("cifra-score-v1");
const IMAGE_DIGEST = ethers.keccak256(ethers.toUtf8Bytes("sha256:test-image"));
const SCORE_RESULT_DOMAIN = ethers.encodeBytes32String("CIFRA_SCORE_RESULT");
const BPS = 10000n;
const GRACE = 3 * 24 * 3600;

const Settled = 2;
const Defaulted = 3;

async function signResult(wallet: any, resultData: string, actionId: string, tag: string, status: number, chainId: bigint) {
    const resultHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [ethers.keccak256(resultData), actionId, ethers.keccak256(ethers.toUtf8Bytes(tag)), status]
    );
    const payload = ethers.keccak256(abi.encode(["bytes32", "uint256", "bytes32"], [SCORE_RESULT_DOMAIN, chainId, resultHash]));
    return wallet.signMessage(ethers.getBytes(payload));
}

// Settlement is now oracle-free: the buyer pays the book's own ERC-20 and the contract observes
// the payment directly. There is no proof, no reserve, and default is a timestamp comparison.
// See claude-docs/DECISIONS.md D5.
describe("CifraSettlement", () => {
    let asset: MockAsset, registry: CifraInvoiceRegistry, attestation: CifraAttestationNFT;
    let controller: CifraTrancheController, senior: CifraTrancheVault, junior: CifraTrancheVault;
    let settlement: CifraSettlement;
    let owner: any, keeper: any, funder: any, supplier: any, buyer: any, stranger: any;
    let scorer: any, chainId: bigint;
    let invoiceId: string, dueDate: number;

    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:acme"));
    const faceAmount = ethers.parseUnits("10000", 6);
    const deposit = ethers.parseUnits("100000", 6);
    const discountBps = 600;
    const principal = (faceAmount * (BPS - BigInt(discountBps))) / BPS;
    const actionId = ethers.hexlify(ethers.randomBytes(32));
    const tag = "threshold";

    beforeEach(async () => {
        [owner, keeper, funder, supplier, buyer, stranger] = await ethers.getSigners();
        scorer = ethers.Wallet.createRandom();
        chainId = (await ethers.provider.getNetwork()).chainId;

        asset = (await (await ethers.getContractFactory("MockAsset")).deploy("Mock USDT", "USDT", 6)) as unknown as MockAsset;
        registry = (await (await ethers.getContractFactory("CifraInvoiceRegistry")).deploy()) as unknown as CifraInvoiceRegistry;
        attestation = (await (await ethers.getContractFactory("CifraAttestationNFT")).deploy(
            "Cifra Attestation", "CIFRA-ATT", scorer.address, await registry.getAddress()
        )) as unknown as CifraAttestationNFT;
        controller = (await (await ethers.getContractFactory("CifraTrancheController")).deploy(
            await asset.getAddress(), await registry.getAddress(), await attestation.getAddress()
        )) as unknown as CifraTrancheController;
        senior = (await (await ethers.getContractFactory("CifraTrancheVault")).deploy(
            await asset.getAddress(), await controller.getAddress(), "Cifra Senior USDT", "cUSDT-S", ethers.ZeroAddress
        )) as unknown as CifraTrancheVault;
        junior = (await (await ethers.getContractFactory("CifraTrancheVault")).deploy(
            await asset.getAddress(), await controller.getAddress(), "Cifra Junior USDT", "cUSDT-J", ethers.ZeroAddress
        )) as unknown as CifraTrancheVault;
        settlement = (await (await ethers.getContractFactory("CifraSettlement")).deploy(
            await controller.getAddress(), GRACE
        )) as unknown as CifraSettlement;

        await registry.connect(owner).setStatusUpdater(await controller.getAddress(), true);
        await controller.connect(owner).setTrancheVaults(await senior.getAddress(), await junior.getAddress());
        await controller.connect(owner).setOperator(keeper.address);
        await controller.connect(owner).setSettlement(await settlement.getAddress());

        // Funder capitalizes the senior tranche (junior left empty; these tests exercise
        // settlement mechanics, not the waterfall split — asserted in the controller tests).
        await asset.mint(funder.address, deposit);
        await asset.connect(funder).approve(await senior.getAddress(), deposit);
        await senior.connect(funder).deposit(deposit, funder.address);

        // Register, attest, and fund an invoice.
        dueDate = (await time.latest()) + 30 * 24 * 3600;
        const ref = ethers.keccak256(ethers.toUtf8Bytes("INV-SET-1"));
        await registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, dueDate, ref);
        invoiceId = await registry.computeInvoiceId(supplier.address, buyerCommitment, faceAmount, dueDate, ref);
        const resultData = abi.encode(
            ["bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
            [invoiceId, ethers.encodeBytes32String("A"), 9900, discountBps, MODEL_VERSION, IMAGE_DIGEST]
        );
        await attestation.attest(invoiceId, resultData, actionId, tag, 1, await signResult(scorer, resultData, actionId, tag, 1, chainId));
        await controller.connect(keeper).fundInvoice(invoiceId);

        // The buyer holds the face amount they owe. No reserve is pre-funded anywhere — that
        // whole mechanism is gone.
        await asset.mint(buyer.address, faceAmount);
    });

    describe("deployment", () => {
        it("reads the settlement asset from the controller so they cannot disagree", async () => {
            expect(await settlement.ASSET()).to.equal(await asset.getAddress());
            expect(await settlement.CONTROLLER()).to.equal(await controller.getAddress());
            expect(await settlement.GRACE_PERIOD()).to.equal(GRACE);
        });

        it("rejects a controller with no code", async () => {
            const factory = await ethers.getContractFactory("CifraSettlement");
            await expect(factory.deploy(ethers.ZeroAddress, GRACE)).to.be.revertedWithCustomError(settlement, "ZeroAddress");
            await expect(factory.deploy(stranger.address, GRACE)).to.be.reverted;
        });
    });

    describe("payInvoice", () => {
        it("settles a funded invoice from a real on-chain payment and repays the pool", async () => {
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);

            await expect(settlement.connect(buyer).payInvoice(invoiceId))
                .to.emit(settlement, "Settled")
                .withArgs(invoiceId, buyer.address, faceAmount);

            expect((await registry.getInvoice(invoiceId)).status).to.equal(3 /* Settled */);
            expect((await controller.fundingOf(invoiceId)).status).to.equal(Settled);
            // Yield = face - principal is realized into the pool.
            expect(await controller.nav()).to.equal(deposit + (faceAmount - principal));
            expect(await controller.totalDeployed()).to.equal(0);
            expect(await asset.balanceOf(buyer.address)).to.equal(0);
        });

        it("holds no balance at rest — the payment passes straight through", async () => {
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await settlement.connect(buyer).payInvoice(invoiceId);
            expect(await asset.balanceOf(await settlement.getAddress())).to.equal(0);
        });

        it("needs no pre-funded reserve — the buyer's own money repays the vault", async () => {
            // The Flare version required this contract to be pre-funded with the face amount.
            expect(await asset.balanceOf(await settlement.getAddress())).to.equal(0);
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await settlement.connect(buyer).payInvoice(invoiceId);
            expect((await controller.fundingOf(invoiceId)).status).to.equal(Settled);
        });

        it("is permissionless — anyone may settle on the buyer's behalf", async () => {
            await asset.mint(stranger.address, faceAmount);
            await asset.connect(stranger).approve(await settlement.getAddress(), faceAmount);
            await expect(settlement.connect(stranger).payInvoice(invoiceId))
                .to.emit(settlement, "Settled")
                .withArgs(invoiceId, stranger.address, faceAmount);
        });

        it("reverts without an allowance", async () => {
            await expect(settlement.connect(buyer).payInvoice(invoiceId)).to.be.reverted;
        });

        it("reverts on a short balance — payment is all-or-nothing", async () => {
            const poor = stranger;
            await asset.mint(poor.address, faceAmount - 1n);
            await asset.connect(poor).approve(await settlement.getAddress(), faceAmount);
            await expect(settlement.connect(poor).payInvoice(invoiceId)).to.be.reverted;
        });

        it("rejects an invoice that was never funded", async () => {
            const unknown = ethers.hexlify(ethers.randomBytes(32));
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await expect(settlement.connect(buyer).payInvoice(unknown)).to.be.revertedWithCustomError(
                settlement,
                "NotOutstanding"
            );
        });

        it("cannot be paid twice", async () => {
            await asset.mint(buyer.address, faceAmount);
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount * 2n);
            await settlement.connect(buyer).payInvoice(invoiceId);
            await expect(settlement.connect(buyer).payInvoice(invoiceId)).to.be.revertedWithCustomError(
                settlement,
                "NotOutstanding"
            );
        });

        it("can still be paid after the due date, right up until someone defaults it", async () => {
            await time.increaseTo(dueDate + GRACE + 10);
            expect(await settlement.isDefaultable(invoiceId)).to.equal(true);

            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await settlement.connect(buyer).payInvoice(invoiceId);
            expect((await controller.fundingOf(invoiceId)).status).to.equal(Settled);
        });
    });

    describe("markDefault", () => {
        it("writes off an unpaid invoice past due + grace, permissionlessly", async () => {
            await time.increaseTo(dueDate + GRACE + 1);

            await expect(settlement.connect(stranger).markDefault(invoiceId))
                .to.emit(settlement, "Defaulted")
                .withArgs(invoiceId, stranger.address, dueDate, GRACE);

            expect((await registry.getInvoice(invoiceId)).status).to.equal(4 /* Defaulted */);
            expect((await controller.fundingOf(invoiceId)).status).to.equal(Defaulted);
            expect(await controller.totalDeployed()).to.equal(0);
            // Junior is empty here, so the whole principal comes off senior.
            expect(await controller.nav()).to.equal(deposit - principal);
        });

        it("refuses before due date + grace has elapsed", async () => {
            await expect(settlement.markDefault(invoiceId))
                .to.be.revertedWithCustomError(settlement, "NotYetDefaultable")
                .withArgs(dueDate + GRACE);
        });

        it("refuses inside the grace period, after the due date", async () => {
            await time.increaseTo(dueDate + 1);
            await expect(settlement.markDefault(invoiceId)).to.be.revertedWithCustomError(
                settlement,
                "NotYetDefaultable"
            );
        });

        it("refuses at exactly due + grace, and succeeds one second later", async () => {
            // `setNextBlockTimestamp` (not `increaseTo`) so the transaction itself executes AT
            // the boundary — `increaseTo` mines a block, leaving the call one second past it.
            await time.setNextBlockTimestamp(dueDate + GRACE);
            await expect(settlement.markDefault(invoiceId)).to.be.revertedWithCustomError(
                settlement,
                "NotYetDefaultable"
            );
            await time.setNextBlockTimestamp(dueDate + GRACE + 1);
            await expect(settlement.markDefault(invoiceId)).to.emit(settlement, "Defaulted");
        });

        it("cannot default an already-settled invoice", async () => {
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await settlement.connect(buyer).payInvoice(invoiceId);
            await time.increaseTo(dueDate + GRACE + 10);
            await expect(settlement.markDefault(invoiceId)).to.be.revertedWithCustomError(settlement, "NotOutstanding");
        });

        it("cannot be defaulted twice", async () => {
            await time.increaseTo(dueDate + GRACE + 1);
            await settlement.markDefault(invoiceId);
            await expect(settlement.markDefault(invoiceId)).to.be.revertedWithCustomError(settlement, "NotOutstanding");
        });

        it("cannot settle after default — payment and default are mutually exclusive", async () => {
            await time.increaseTo(dueDate + GRACE + 1);
            await settlement.markDefault(invoiceId);
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await expect(settlement.connect(buyer).payInvoice(invoiceId)).to.be.revertedWithCustomError(
                settlement,
                "NotOutstanding"
            );
            // And the buyer keeps their money — nothing was pulled.
            expect(await asset.balanceOf(buyer.address)).to.equal(faceAmount);
        });

        it("junior absorbs the loss first when it has capital", async () => {
            // Re-run with a funded junior tranche to prove the waterfall still routes through.
            const juniorDeposit = ethers.parseUnits("50000", 6);
            await asset.mint(funder.address, juniorDeposit);
            await asset.connect(funder).approve(await junior.getAddress(), juniorDeposit);
            await junior.connect(funder).deposit(juniorDeposit, funder.address);

            const seniorBefore = await controller.claimOf(await senior.getAddress());
            await time.increaseTo(dueDate + GRACE + 1);
            await settlement.markDefault(invoiceId);

            expect(await controller.claimOf(await junior.getAddress())).to.equal(juniorDeposit - principal);
            expect(await controller.claimOf(await senior.getAddress())).to.equal(seniorBefore);
        });
    });

    describe("views", () => {
        it("amountDue reports the face amount while outstanding, zero afterwards", async () => {
            expect(await settlement.amountDue(invoiceId)).to.equal(faceAmount);
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await settlement.connect(buyer).payInvoice(invoiceId);
            expect(await settlement.amountDue(invoiceId)).to.equal(0);
        });

        it("defaultableAt reports the deadline, zero once not outstanding", async () => {
            expect(await settlement.defaultableAt(invoiceId)).to.equal(dueDate + GRACE);
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await settlement.connect(buyer).payInvoice(invoiceId);
            expect(await settlement.defaultableAt(invoiceId)).to.equal(0);
        });

        it("isDefaultable flips exactly when markDefault starts succeeding", async () => {
            expect(await settlement.isDefaultable(invoiceId)).to.equal(false);
            await time.increaseTo(dueDate + GRACE);
            expect(await settlement.isDefaultable(invoiceId)).to.equal(false);
            await time.increaseTo(dueDate + GRACE + 1);
            expect(await settlement.isDefaultable(invoiceId)).to.equal(true);
        });

        it("views are zero/false for an unknown invoice", async () => {
            const unknown = ethers.hexlify(ethers.randomBytes(32));
            expect(await settlement.amountDue(unknown)).to.equal(0);
            expect(await settlement.defaultableAt(unknown)).to.equal(0);
            expect(await settlement.isDefaultable(unknown)).to.equal(false);
        });
    });

    describe("sweep", () => {
        it("recovers tokens a buyer transferred directly instead of calling payInvoice", async () => {
            await asset.connect(buyer).transfer(await settlement.getAddress(), faceAmount);
            expect(await asset.balanceOf(await settlement.getAddress())).to.equal(faceAmount);

            await settlement.connect(owner).sweep(await asset.getAddress(), owner.address);
            expect(await asset.balanceOf(owner.address)).to.equal(faceAmount);
            expect(await asset.balanceOf(await settlement.getAddress())).to.equal(0);
        });

        it("is owner-only and rejects a zero recipient / empty balance", async () => {
            await asset.connect(buyer).transfer(await settlement.getAddress(), faceAmount);
            await expect(
                settlement.connect(stranger).sweep(await asset.getAddress(), stranger.address)
            ).to.be.revertedWithCustomError(settlement, "NotOwner");
            await expect(
                settlement.connect(owner).sweep(await asset.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(settlement, "ZeroAddress");

            await settlement.connect(owner).sweep(await asset.getAddress(), owner.address);
            await expect(
                settlement.connect(owner).sweep(await asset.getAddress(), owner.address)
            ).to.be.revertedWithCustomError(settlement, "NothingToSweep");
        });

        it("cannot touch capital in flight — settlement is atomic, so there is none to touch", async () => {
            await asset.connect(buyer).approve(await settlement.getAddress(), faceAmount);
            await settlement.connect(buyer).payInvoice(invoiceId);
            await expect(
                settlement.connect(owner).sweep(await asset.getAddress(), owner.address)
            ).to.be.revertedWithCustomError(settlement, "NothingToSweep");
        });
    });

    describe("ownership", () => {
        it("transfers to a new owner and revokes the old one", async () => {
            await expect(settlement.connect(owner).transferOwnership(stranger.address))
                .to.emit(settlement, "OwnershipTransferred")
                .withArgs(owner.address, stranger.address);
            await asset.connect(buyer).transfer(await settlement.getAddress(), faceAmount);
            await expect(
                settlement.connect(owner).sweep(await asset.getAddress(), owner.address)
            ).to.be.revertedWithCustomError(settlement, "NotOwner");
            await settlement.connect(stranger).sweep(await asset.getAddress(), stranger.address);
        });
    });
});
