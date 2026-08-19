import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
    CifraTrancheController,
    CifraTrancheVault,
    CifraInvoiceRegistry,
    CifraAttestationNFT,
    MockAsset,
} from "../typechain-types";

const abi = ethers.AbiCoder.defaultAbiCoder();
const SCORE_RESULT_DOMAIN = ethers.encodeBytes32String("CIFRA_SCORE_RESULT");
const BPS = 10000n;

async function signResult(wallet: any, resultData: string, actionId: string, tag: string, status: number, chainId: bigint) {
    const resultHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [ethers.keccak256(resultData), actionId, ethers.keccak256(ethers.toUtf8Bytes(tag)), status]
    );
    const payload = ethers.keccak256(abi.encode(["bytes32", "uint256", "bytes32"], [SCORE_RESULT_DOMAIN, chainId, resultHash]));
    return wallet.signMessage(ethers.getBytes(payload));
}

describe("CifraTrancheController", () => {
    let asset: MockAsset;
    let registry: CifraInvoiceRegistry;
    let attestation: CifraAttestationNFT;
    let controller: CifraTrancheController;
    let senior: CifraTrancheVault;
    let junior: CifraTrancheVault;
    let owner: any, operator: any, sFunder: any, jFunder: any, supplier: any, other: any;
    let tee: any;
    let chainId: bigint;

    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:acme"));
    const faceAmount = ethers.parseUnits("10000", 6);
    const seniorDep = ethers.parseUnits("50000", 6);
    const juniorDep = ethers.parseUnits("50000", 6);
    const actionId = ethers.hexlify(ethers.randomBytes(32));
    const tag = "threshold";
    let dueDate: number;

    // Deploy + wire a fresh stack; deposits are done per-test so the loss cases can vary the
    // junior buffer.
    async function deployStack() {
        const f = (await (await ethers.getContractFactory("MockAsset")).deploy("Mock USDT", "USDT", 6)) as unknown as MockAsset;
        const r = (await (await ethers.getContractFactory("CifraInvoiceRegistry")).deploy()) as unknown as CifraInvoiceRegistry;
        const a = (await (await ethers.getContractFactory("CifraAttestationNFT")).deploy(
            "Cifra Attestation", "CIFRA-ATT", tee.address, await r.getAddress()
        )) as unknown as CifraAttestationNFT;
        const c = (await (await ethers.getContractFactory("CifraTrancheController")).deploy(
            await f.getAddress(), await r.getAddress(), await a.getAddress()
        )) as unknown as CifraTrancheController;
        const s = (await (await ethers.getContractFactory("CifraTrancheVault")).deploy(
            await f.getAddress(), await c.getAddress(), "Cifra Senior", "cFXRP-S"
        )) as unknown as CifraTrancheVault;
        const j = (await (await ethers.getContractFactory("CifraTrancheVault")).deploy(
            await f.getAddress(), await c.getAddress(), "Cifra Junior", "cFXRP-J"
        )) as unknown as CifraTrancheVault;

        await r.connect(owner).setStatusUpdater(await c.getAddress(), true);
        await c.connect(owner).setTrancheVaults(await s.getAddress(), await j.getAddress());
        await c.connect(owner).setOperator(operator.address);
        return { f, r, a, c, s, j };
    }

    async function depositInto(vault: CifraTrancheVault, funder: any, amount: bigint) {
        await asset.mint(funder.address, amount);
        await asset.connect(funder).approve(await vault.getAddress(), amount);
        await vault.connect(funder).deposit(amount, funder.address);
    }

    async function registerAndAttest(ref: string, discountBps: number): Promise<string> {
        const refHash = ethers.keccak256(ethers.toUtf8Bytes(ref));
        await registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, dueDate, refHash);
        const invoiceId = await registry.computeInvoiceId(supplier.address, buyerCommitment, faceAmount, dueDate, refHash);
        const resultData = abi.encode(["bytes32", "bytes32", "uint256", "uint256"], [invoiceId, ethers.encodeBytes32String("A"), 9900, discountBps]);
        const sig = await signResult(tee, resultData, actionId, tag, 1, chainId);
        await attestation.attest(invoiceId, resultData, actionId, tag, 1, sig);
        return invoiceId;
    }

    beforeEach(async () => {
        [owner, operator, sFunder, jFunder, supplier, other] = await ethers.getSigners();
        tee = ethers.Wallet.createRandom();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const s = await deployStack();
        asset = s.f;
        registry = s.r;
        attestation = s.a;
        controller = s.c;
        senior = s.s;
        junior = s.j;

        await depositInto(senior, sFunder, seniorDep);
        await depositInto(junior, jFunder, juniorDep);

        dueDate = (await time.latest()) + 30 * 24 * 3600;
    });

    it("deposits credit per-tranche claims; NAV = senior + junior", async () => {
        expect(await controller.claimOf(await senior.getAddress())).to.equal(seniorDep);
        expect(await controller.claimOf(await junior.getAddress())).to.equal(juniorDep);
        expect(await controller.nav()).to.equal(seniorDep + juniorDep);
        expect(await senior.totalAssets()).to.equal(seniorDep);
        expect(await junior.totalAssets()).to.equal(juniorDep);
        // Pool holds all the ASSET; nothing deployed yet.
        expect(await asset.balanceOf(await controller.getAddress())).to.equal(seniorDep + juniorDep);
        expect(await controller.totalDeployed()).to.equal(0);
    });

    it("funds an attested invoice: advances from the pool, NAV flat", async () => {
        const invoiceId = await registerAndAttest("INV-1", 600);
        const principal = (faceAmount * (BPS - 600n)) / BPS;

        await expect(controller.connect(operator).fundInvoice(invoiceId))
            .to.emit(controller, "Funded")
            .withArgs(invoiceId, supplier.address, principal, faceAmount);

        expect(await asset.balanceOf(supplier.address)).to.equal(principal);
        expect(await controller.totalDeployed()).to.equal(principal);
        // NAV and each tranche claim unchanged — pool down, deployed up.
        expect(await controller.nav()).to.equal(seniorDep + juniorDep);
        expect(await controller.claimOf(await senior.getAddress())).to.equal(seniorDep);
        expect(await controller.claimOf(await junior.getAddress())).to.equal(juniorDep);
        expect((await registry.getInvoice(invoiceId)).status).to.equal(2 /* Funded */);
    });

    it("repayment splits yield 50/50 across senior and junior", async () => {
        const invoiceId = await registerAndAttest("INV-2", 600);
        const principal = (faceAmount * (BPS - 600n)) / BPS;
        await controller.connect(operator).fundInvoice(invoiceId);

        // Operator (standing in for settlement) repays face value.
        await asset.mint(operator.address, faceAmount);
        await asset.connect(operator).approve(await controller.getAddress(), faceAmount);

        const yieldAmt = faceAmount - principal; // 600 ASSET
        const seniorCut = (yieldAmt * 5000n) / BPS; // 300
        const juniorCut = yieldAmt - seniorCut; // 300
        await expect(controller.connect(operator).recordRepayment(invoiceId))
            .to.emit(controller, "Repaid")
            .withArgs(invoiceId, faceAmount, seniorCut, juniorCut);

        expect(await controller.totalDeployed()).to.equal(0);
        expect(await controller.claimOf(await senior.getAddress())).to.equal(seniorDep + seniorCut);
        expect(await controller.claimOf(await junior.getAddress())).to.equal(juniorDep + juniorCut);
        expect(await controller.nav()).to.equal(seniorDep + juniorDep + yieldAmt);
        // Each tranche's shares appreciated by its cut (modulo <=1 wei virtual-offset rounding).
        const sVal = await senior.convertToAssets(await senior.balanceOf(sFunder.address));
        expect(seniorDep + seniorCut - sVal).to.be.lessThanOrEqual(2n);
        expect((await registry.getInvoice(invoiceId)).status).to.equal(3 /* Settled */);
    });

    it("honors a non-default 30/70 split when the senior share is changed", async () => {
        await controller.connect(owner).setSeniorYieldShareBps(3000);
        const invoiceId = await registerAndAttest("INV-3070", 600);
        const principal = (faceAmount * (BPS - 600n)) / BPS;
        await controller.connect(operator).fundInvoice(invoiceId);
        await asset.mint(operator.address, faceAmount);
        await asset.connect(operator).approve(await controller.getAddress(), faceAmount);

        const yieldAmt = faceAmount - principal; // 600
        const seniorCut = (yieldAmt * 3000n) / BPS; // 180
        const juniorCut = yieldAmt - seniorCut; // 420
        await expect(controller.connect(operator).recordRepayment(invoiceId))
            .to.emit(controller, "Repaid")
            .withArgs(invoiceId, faceAmount, seniorCut, juniorCut);
        expect(await controller.claimOf(await junior.getAddress())).to.equal(juniorDep + juniorCut);
    });

    it("default: junior absorbs the loss first, senior untouched while the junior buffer covers it", async () => {
        const invoiceId = await registerAndAttest("INV-3", 600);
        const principal = (faceAmount * (BPS - 600n)) / BPS; // 9,400 << juniorDep
        await controller.connect(operator).fundInvoice(invoiceId);

        await expect(controller.connect(operator).recordDefault(invoiceId)).to.be.revertedWithCustomError(controller, "NotYetDue");
        await time.increaseTo(dueDate + 1);

        await expect(controller.connect(operator).recordDefault(invoiceId))
            .to.emit(controller, "Defaulted")
            .withArgs(invoiceId, principal, 0); // juniorLoss = principal, seniorLoss = 0

        expect(await controller.totalDeployed()).to.equal(0);
        expect(await controller.claimOf(await senior.getAddress())).to.equal(seniorDep); // protected
        expect(await controller.claimOf(await junior.getAddress())).to.equal(juniorDep - principal);
        expect(await controller.nav()).to.equal(seniorDep + juniorDep - principal);
    });

    it("default: loss overflows a thin junior buffer into senior (subordination)", async () => {
        // Fresh stack with a junior buffer smaller than the principal.
        const s = await deployStack();
        asset = s.f;
        registry = s.r;
        attestation = s.a;
        controller = s.c;
        senior = s.s;
        junior = s.j;

        const smallJunior = ethers.parseUnits("5000", 6);
        await depositInto(senior, sFunder, seniorDep);
        await depositInto(junior, jFunder, smallJunior);
        dueDate = (await time.latest()) + 30 * 24 * 3600;

        const invoiceId = await registerAndAttest("INV-OVF", 600);
        const principal = (faceAmount * (BPS - 600n)) / BPS; // 9,400 > 5,000
        await controller.connect(operator).fundInvoice(invoiceId);
        await time.increaseTo(dueDate + 1);

        const seniorLoss = principal - smallJunior; // 4,400
        await expect(controller.connect(operator).recordDefault(invoiceId))
            .to.emit(controller, "Defaulted")
            .withArgs(invoiceId, smallJunior, seniorLoss);

        expect(await controller.claimOf(await junior.getAddress())).to.equal(0); // wiped
        expect(await controller.claimOf(await senior.getAddress())).to.equal(seniorDep - seniorLoss);
        expect(await controller.nav()).to.equal(seniorDep + smallJunior - principal);
    });

    it("guards: fundInvoice operator-only + registered + attested + not already funded", async () => {
        const invoiceId = await registerAndAttest("INV-4", 600);

        await expect(controller.connect(other).fundInvoice(invoiceId)).to.be.revertedWithCustomError(controller, "NotOperator");
        await expect(controller.connect(operator).fundInvoice(ethers.ZeroHash)).to.be.revertedWithCustomError(controller, "NotRegistered");

        const refHash = ethers.keccak256(ethers.toUtf8Bytes("INV-unattested"));
        await registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, dueDate, refHash);
        const unattested = await registry.computeInvoiceId(supplier.address, buyerCommitment, faceAmount, dueDate, refHash);
        await expect(controller.connect(operator).fundInvoice(unattested)).to.be.revertedWithCustomError(controller, "NotAttested");

        await controller.connect(operator).fundInvoice(invoiceId);
        await expect(controller.connect(operator).fundInvoice(invoiceId)).to.be.revertedWithCustomError(controller, "AlreadyFunded");
    });

    it("guards: record* is settler-only; tranche hooks are vault-only", async () => {
        const invoiceId = await registerAndAttest("INV-5", 600);
        await controller.connect(operator).fundInvoice(invoiceId);

        await expect(controller.connect(other).recordRepayment(invoiceId)).to.be.revertedWithCustomError(controller, "NotSettler");
        await expect(controller.connect(other).recordDefault(invoiceId)).to.be.revertedWithCustomError(controller, "NotSettler");
        // creditDeposit / debitWithdraw are only callable by a registered tranche vault.
        await expect(controller.connect(other).creditDeposit(1)).to.be.revertedWithCustomError(controller, "NotTranche");
        await expect(controller.connect(other).debitWithdraw(other.address, 1)).to.be.revertedWithCustomError(controller, "NotTranche");
    });

    it("withdrawals are bounded by idle pool liquidity", async () => {
        // Fresh stack with a thin senior deposit so that after funding, idle pool liquidity is
        // LESS than the junior tranche's own claim — otherwise ERC-4626's max-withdraw check
        // fires before the controller's liquidity guard is reached.
        const s = await deployStack();
        asset = s.f;
        registry = s.r;
        attestation = s.a;
        controller = s.c;
        senior = s.s;
        junior = s.j;
        const thinSenior = ethers.parseUnits("5000", 6);
        await depositInto(senior, sFunder, thinSenior);
        await depositInto(junior, jFunder, juniorDep); // 50,000
        dueDate = (await time.latest()) + 30 * 24 * 3600;

        const invoiceId = await registerAndAttest("INV-6", 600);
        const principal = (faceAmount * (BPS - 600n)) / BPS; // 9,400
        await controller.connect(operator).fundInvoice(invoiceId);

        const idle = thinSenior + juniorDep - principal; // 45,600 < junior claim (50,000)
        // Junior can request up to its claim, but a withdrawal above idle liquidity reverts.
        await expect(
            junior.connect(jFunder).withdraw(idle + 1n, jFunder.address, jFunder.address)
        ).to.be.revertedWithCustomError(controller, "InsufficientLiquidity");
        // A withdrawal within idle liquidity succeeds.
        await expect(junior.connect(jFunder).withdraw(idle, jFunder.address, jFunder.address)).to.not.be.reverted;
    });

    it("reverts funding when pool liquidity is insufficient", async () => {
        const s = await deployStack();
        controller = s.c;
        senior = s.s;
        junior = s.j;
        registry = s.r;
        attestation = s.a;
        asset = s.f;
        await depositInto(senior, sFunder, ethers.parseUnits("100", 6)); // tiny pool
        dueDate = (await time.latest()) + 30 * 24 * 3600;

        const invoiceId = await registerAndAttest("INV-7", 600); // needs 9,400
        await expect(controller.connect(operator).fundInvoice(invoiceId)).to.be.revertedWithCustomError(controller, "InsufficientLiquidity");
    });

    it("pause stops deposits + funding but not withdrawals", async () => {
        const invoiceId = await registerAndAttest("INV-P", 600);

        await expect(controller.connect(other).pause()).to.be.revertedWithCustomError(controller, "NotOwner");
        await controller.connect(owner).pause();

        await asset.mint(sFunder.address, seniorDep);
        await asset.connect(sFunder).approve(await senior.getAddress(), seniorDep);
        await expect(senior.connect(sFunder).deposit(seniorDep, sFunder.address)).to.be.revertedWithCustomError(controller, "EnforcedPause");
        await expect(controller.connect(operator).fundInvoice(invoiceId)).to.be.revertedWithCustomError(controller, "EnforcedPause");

        // Withdrawals stay open.
        await expect(senior.connect(sFunder).withdraw(ethers.parseUnits("100", 6), sFunder.address, sFunder.address)).to.not.be.reverted;

        await controller.connect(owner).unpause();
        await expect(controller.connect(operator).fundInvoice(invoiceId)).to.emit(controller, "Funded");
    });

    it("admin: tranche vaults set once; senior share bounded; owner-gated", async () => {
        await expect(controller.connect(owner).setTrancheVaults(other.address, other.address)).to.be.revertedWithCustomError(controller, "AlreadySet");
        await expect(controller.connect(other).setSeniorYieldShareBps(4000)).to.be.revertedWithCustomError(controller, "NotOwner");
        await expect(controller.connect(owner).setSeniorYieldShareBps(10001)).to.be.revertedWithCustomError(controller, "ShareOutOfRange");
        await expect(controller.connect(owner).setSeniorYieldShareBps(4000))
            .to.emit(controller, "SeniorYieldShareUpdated")
            .withArgs(5000, 4000);
        expect(await controller.seniorYieldShareBps()).to.equal(4000);
    });
});
