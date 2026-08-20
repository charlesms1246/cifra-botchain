import { expect } from "chai";
import { ethers } from "hardhat";
import {
    CifraFunderRegistry,
    CifraTrancheController,
    CifraTrancheVault,
    CifraInvoiceRegistry,
    CifraAttestationNFT,
    MockAsset,
} from "../typechain-types";

// Tranche shares are plausibly securities (docs/REGULATORY_POSTURE.md §3), so participation has
// to be restrictable in the contract rather than in a policy document. The property that matters
// most here is the ASYMMETRY: getting in is gated, getting out never is. A compliance control
// that can trap a funder's capital is a worse problem than the one it solves.
describe("CifraFunderRegistry", () => {
    let registry: CifraFunderRegistry;
    let asset: MockAsset, controller: CifraTrancheController, senior: CifraTrancheVault, junior: CifraTrancheVault;
    let owner: any, manager: any, alice: any, bob: any, stranger: any;

    const deposit = ethers.parseUnits("1000", 6);

    const deployStack = (funderRegistry: string) => deployStackWithAsset(undefined, funderRegistry);

    async function deployStackWithAsset(assetAddr: string | undefined, funderRegistry: string) {
        const a = assetAddr ?? (await asset.getAddress());
        const invoiceRegistry = (await (
            await ethers.getContractFactory("CifraInvoiceRegistry")
        ).deploy()) as unknown as CifraInvoiceRegistry;
        const attestation = (await (
            await ethers.getContractFactory("CifraAttestationNFT")
        ).deploy("Cifra Attestation", "CIFRA-ATT", owner.address, await invoiceRegistry.getAddress())) as unknown as CifraAttestationNFT;
        const c = (await (
            await ethers.getContractFactory("CifraTrancheController")
        ).deploy(a, await invoiceRegistry.getAddress(), await attestation.getAddress())) as unknown as CifraTrancheController;
        const s = (await (
            await ethers.getContractFactory("CifraTrancheVault")
        ).deploy(a, await c.getAddress(), "Cifra Senior USDT", "cUSDT-S", funderRegistry)) as unknown as CifraTrancheVault;
        const j = (await (
            await ethers.getContractFactory("CifraTrancheVault")
        ).deploy(a, await c.getAddress(), "Cifra Junior USDT", "cUSDT-J", funderRegistry)) as unknown as CifraTrancheVault;
        await c.setTrancheVaults(await s.getAddress(), await j.getAddress());
        return { c, s, j };
    }

    beforeEach(async () => {
        [owner, manager, alice, bob, stranger] = await ethers.getSigners();
        asset = (await (await ethers.getContractFactory("MockAsset")).deploy("Mock USDT", "USDT", 6)) as unknown as MockAsset;
        registry = (await (await ethers.getContractFactory("CifraFunderRegistry")).deploy(true)) as unknown as CifraFunderRegistry;

        const st = await deployStack(await registry.getAddress());
        controller = st.c;
        senior = st.s;
        junior = st.j;

        for (const who of [alice, bob, stranger]) await asset.mint(who.address, deposit * 2n);
    });

    describe("the list itself", () => {
        it("starts restricted with nobody allowed", async () => {
            expect(await registry.restricted()).to.equal(true);
            expect(await registry.canHold(alice.address)).to.equal(false);
        });

        it("allows everyone when unrestricted, regardless of the list", async () => {
            await registry.setRestricted(false);
            expect(await registry.canHold(stranger.address)).to.equal(true);
        });

        it("adds and removes funders, singly and in batch", async () => {
            await expect(registry.setFunder(alice.address, true)).to.emit(registry, "FunderSet").withArgs(alice.address, true);
            expect(await registry.canHold(alice.address)).to.equal(true);

            await registry.setFunders([bob.address, stranger.address], true);
            expect(await registry.canHold(bob.address)).to.equal(true);
            expect(await registry.canHold(stranger.address)).to.equal(true);

            await registry.setFunders([bob.address, stranger.address], false);
            expect(await registry.canHold(bob.address)).to.equal(false);
        });

        it("lets a manager maintain the list but NOT change the policy", async () => {
            await registry.setManager(manager.address);

            await registry.connect(manager).setFunder(alice.address, true);
            expect(await registry.canHold(alice.address)).to.equal(true);

            // The policy switch stays with governance — a KYC provider's automation key must not
            // be able to open the gate for everyone.
            await expect(registry.connect(manager).setRestricted(false)).to.be.revertedWithCustomError(registry, "NotOwner");
            await expect(registry.connect(manager).setManager(stranger.address)).to.be.revertedWithCustomError(registry, "NotOwner");
        });

        it("rejects non-managers and a zero funder", async () => {
            await expect(registry.connect(stranger).setFunder(alice.address, true)).to.be.revertedWithCustomError(registry, "NotManager");
            await expect(registry.setFunder(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });
    });

    describe("deposits", () => {
        it("blocks a non-allowlisted depositor", async () => {
            await asset.connect(alice).approve(await senior.getAddress(), deposit);
            await expect(senior.connect(alice).deposit(deposit, alice.address))
                .to.be.revertedWithCustomError(senior, "NotAllowedToHold")
                .withArgs(alice.address);
        });

        it("allows an allowlisted depositor", async () => {
            await registry.setFunder(alice.address, true);
            await asset.connect(alice).approve(await senior.getAddress(), deposit);
            await senior.connect(alice).deposit(deposit, alice.address);
            expect(await senior.balanceOf(alice.address)).to.be.greaterThan(0n);
        });

        it("blocks an allowlisted payer depositing FOR a non-allowlisted receiver", async () => {
            // Otherwise one cleared address becomes a pass-through for everyone else.
            await registry.setFunder(alice.address, true);
            await asset.connect(alice).approve(await senior.getAddress(), deposit);
            await expect(senior.connect(alice).deposit(deposit, bob.address))
                .to.be.revertedWithCustomError(senior, "NotAllowedToHold")
                .withArgs(bob.address);
        });

        it("permits a non-allowlisted payer to fund an allowlisted receiver — deliberately", async () => {
            // The gate follows the HOLDER, not the payer. Gating the payer would buy nothing —
            // anyone can transfer the asset to an allowlisted address who then deposits it — and
            // would break every contract that deposits on a user's behalf, starting with the
            // native-BOT helper. Source-of-funds is an off-chain AML control.
            await registry.setFunder(bob.address, true);
            await asset.connect(alice).approve(await senior.getAddress(), deposit);
            await senior.connect(alice).deposit(deposit, bob.address);
            expect(await senior.balanceOf(bob.address)).to.be.greaterThan(0n);
            expect(await senior.balanceOf(alice.address)).to.equal(0n);
        });

        it("lets the native-BOT helper deposit for an allowlisted funder without being listed itself", async () => {
            // Regression guard: caller-gating would have made native deposits impossible unless
            // the helper were allowlisted, which would then have reopened the pass-through anyway.
            const wbot = await (await ethers.getContractFactory("MockWrappedNative")).deploy();
            const st = await deployStackWithAsset(await wbot.getAddress(), await registry.getAddress());
            const helper = await (await ethers.getContractFactory("CifraNativeDepositHelper")).deploy(await wbot.getAddress());

            await registry.setFunder(alice.address, true);
            expect(await registry.canHold(await helper.getAddress())).to.equal(false);

            await helper.connect(alice).depositNative(await st.s.getAddress(), alice.address, { value: ethers.parseEther("1") });
            expect(await st.s.balanceOf(alice.address)).to.be.greaterThan(0n);
        });

        it("gates both tranches", async () => {
            await asset.connect(alice).approve(await junior.getAddress(), deposit);
            await expect(junior.connect(alice).deposit(deposit, alice.address)).to.be.revertedWithCustomError(
                junior,
                "NotAllowedToHold"
            );
        });
    });

    describe("share transfers", () => {
        beforeEach(async () => {
            await registry.setFunder(alice.address, true);
            await asset.connect(alice).approve(await senior.getAddress(), deposit);
            await senior.connect(alice).deposit(deposit, alice.address);
        });

        it("blocks transferring shares to a non-allowlisted holder", async () => {
            // Without this the deposit gate is decorative: deposit, then send the position on.
            const shares = await senior.balanceOf(alice.address);
            await expect(senior.connect(alice).transfer(bob.address, shares))
                .to.be.revertedWithCustomError(senior, "NotAllowedToHold")
                .withArgs(bob.address);
        });

        it("allows transferring between allowlisted holders", async () => {
            await registry.setFunder(bob.address, true);
            const shares = await senior.balanceOf(alice.address);
            await senior.connect(alice).transfer(bob.address, shares);
            expect(await senior.balanceOf(bob.address)).to.equal(shares);
        });
    });

    describe("exit is never gated — the property that matters", () => {
        beforeEach(async () => {
            await registry.setFunder(alice.address, true);
            await asset.connect(alice).approve(await senior.getAddress(), deposit);
            await senior.connect(alice).deposit(deposit, alice.address);
        });

        it("a de-listed funder can still redeem in full", async () => {
            // Sanctions hit, failed re-screen — whatever the reason, their capital is theirs.
            await registry.setFunder(alice.address, false);
            expect(await registry.canHold(alice.address)).to.equal(false);

            const shares = await senior.balanceOf(alice.address);
            await senior.connect(alice).redeem(shares, alice.address, alice.address);

            expect(await senior.balanceOf(alice.address)).to.equal(0n);
            expect(await asset.balanceOf(alice.address)).to.be.greaterThanOrEqual(deposit);
        });

        it("a de-listed funder can still withdraw by assets", async () => {
            await registry.setFunder(alice.address, false);
            await senior.connect(alice).withdraw(deposit / 2n, alice.address, alice.address);
            expect(await asset.balanceOf(alice.address)).to.be.greaterThan(0n);
        });

        it("but a de-listed funder cannot pass the position to someone else", async () => {
            await registry.setFunder(bob.address, true);
            await registry.setFunder(alice.address, false);
            // `to` is checked, `from` is not — bob is allowed, so this one succeeds. The point is
            // that the check follows the RECEIVER, so a de-listed holder cannot seed a new
            // non-allowlisted one.
            await senior.connect(alice).transfer(bob.address, await senior.balanceOf(alice.address));
            expect(await senior.balanceOf(bob.address)).to.be.greaterThan(0n);

            await registry.setFunder(stranger.address, false);
            await expect(senior.connect(bob).transfer(stranger.address, 1n)).to.be.revertedWithCustomError(
                senior,
                "NotAllowedToHold"
            );
        });
    });

    describe("unrestricted mode", () => {
        it("behaves exactly like a plain ERC-4626", async () => {
            await registry.setRestricted(false);
            await asset.connect(stranger).approve(await senior.getAddress(), deposit);
            await senior.connect(stranger).deposit(deposit, stranger.address);
            const shares = await senior.balanceOf(stranger.address);
            await senior.connect(stranger).transfer(bob.address, shares);
            expect(await senior.balanceOf(bob.address)).to.equal(shares);
        });
    });

    describe("no registry at all", () => {
        it("a vault deployed with address(0) is permissionless", async () => {
            const open = await deployStack(ethers.ZeroAddress);
            expect(await open.s.canHold(stranger.address)).to.equal(true);
            await asset.connect(stranger).approve(await open.s.getAddress(), deposit);
            await open.s.connect(stranger).deposit(deposit, stranger.address);
            expect(await open.s.balanceOf(stranger.address)).to.be.greaterThan(0n);
        });
    });
});
