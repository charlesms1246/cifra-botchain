import { expect } from "chai";
import { ethers } from "hardhat";
import {
    CifraNativeDepositHelper,
    CifraTrancheController,
    CifraTrancheVault,
    CifraInvoiceRegistry,
    CifraAttestationNFT,
    MockWrappedNative,
    MockAsset,
} from "../typechain-types";

// The BOT book is denominated in WBOT, not native BOT, because the controller holds an IERC20.
// This helper is what makes "native token takes preference" true at the UX layer: one call in,
// one call out. It is unprivileged — everything it does, a user could do by hand.
describe("CifraNativeDepositHelper", () => {
    let wbot: MockWrappedNative;
    let controller: CifraTrancheController;
    let senior: CifraTrancheVault;
    let helper: CifraNativeDepositHelper;
    let funder: any, other: any;

    const ONE = ethers.parseEther("1");

    beforeEach(async () => {
        [, funder, other] = await ethers.getSigners();

        wbot = (await (await ethers.getContractFactory("MockWrappedNative")).deploy()) as unknown as MockWrappedNative;
        const registry = (await (
            await ethers.getContractFactory("CifraInvoiceRegistry")
        ).deploy()) as unknown as CifraInvoiceRegistry;
        const attestation = (await (
            await ethers.getContractFactory("CifraAttestationNFT")
        ).deploy(
            "Cifra Attestation",
            "CIFRA-ATT",
            (await ethers.getSigners())[0].address,
            await registry.getAddress()
        )) as unknown as CifraAttestationNFT;

        controller = (await (
            await ethers.getContractFactory("CifraTrancheController")
        ).deploy(
            await wbot.getAddress(),
            await registry.getAddress(),
            await attestation.getAddress()
        )) as unknown as CifraTrancheController;

        senior = (await (
            await ethers.getContractFactory("CifraTrancheVault")
        ).deploy(
            await wbot.getAddress(),
            await controller.getAddress(),
            "Cifra Senior BOT",
            "cBOT-S"
        )) as unknown as CifraTrancheVault;
        const junior = (await (
            await ethers.getContractFactory("CifraTrancheVault")
        ).deploy(
            await wbot.getAddress(),
            await controller.getAddress(),
            "Cifra Junior BOT",
            "cBOT-J"
        )) as unknown as CifraTrancheVault;
        await controller.setTrancheVaults(await senior.getAddress(), await junior.getAddress());

        helper = (await (
            await ethers.getContractFactory("CifraNativeDepositHelper")
        ).deploy(await wbot.getAddress())) as unknown as CifraNativeDepositHelper;
    });

    describe("depositNative", () => {
        it("wraps native BOT and deposits into the tranche in one transaction", async () => {
            await helper.connect(funder).depositNative(await senior.getAddress(), funder.address, { value: ONE });

            // Shares to the funder, and the underlying sits in the controller pool — not the
            // vault and not the helper.
            expect(await senior.balanceOf(funder.address)).to.be.greaterThan(0n);
            expect(await wbot.balanceOf(await controller.getAddress())).to.equal(ONE);
            expect(await wbot.balanceOf(await senior.getAddress())).to.equal(0n);
            expect(await controller.claimOf(await senior.getAddress())).to.equal(ONE);
        });

        it("credits shares to `receiver`, not the caller", async () => {
            await helper.connect(funder).depositNative(await senior.getAddress(), other.address, { value: ONE });
            expect(await senior.balanceOf(other.address)).to.be.greaterThan(0n);
            expect(await senior.balanceOf(funder.address)).to.equal(0n);
        });

        it("holds nothing itself", async () => {
            await helper.connect(funder).depositNative(await senior.getAddress(), funder.address, { value: ONE });
            expect(await ethers.provider.getBalance(await helper.getAddress())).to.equal(0n);
            expect(await wbot.balanceOf(await helper.getAddress())).to.equal(0n);
        });

        it("rejects a zero-value deposit and a zero receiver", async () => {
            await expect(
                helper.connect(funder).depositNative(await senior.getAddress(), funder.address, { value: 0 })
            ).to.be.revertedWithCustomError(helper, "ZeroAmount");
            await expect(
                helper.connect(funder).depositNative(await senior.getAddress(), ethers.ZeroAddress, { value: ONE })
            ).to.be.revertedWithCustomError(helper, "ZeroAddress");
        });

        it("refuses a vault denominated in something else, before wrapping anything", async () => {
            const usdt = (await (
                await ethers.getContractFactory("MockAsset")
            ).deploy("Mock USDT", "USDT", 6)) as unknown as MockAsset;
            const usdtController = (await (
                await ethers.getContractFactory("CifraTrancheController")
            ).deploy(
                await usdt.getAddress(),
                await controller.REGISTRY(),
                await controller.ATTESTATION()
            )) as unknown as CifraTrancheController;
            const usdtVault = (await (
                await ethers.getContractFactory("CifraTrancheVault")
            ).deploy(
                await usdt.getAddress(),
                await usdtController.getAddress(),
                "Cifra Senior USDT",
                "cUSDT-S"
            )) as unknown as CifraTrancheVault;

            await expect(
                helper.connect(funder).depositNative(await usdtVault.getAddress(), funder.address, { value: ONE })
            ).to.be.revertedWithCustomError(helper, "VaultAssetMismatch");
            // The caller's BOT is untouched — the guard fires before the wrap.
            expect(await wbot.balanceOf(await helper.getAddress())).to.equal(0n);
        });
    });

    describe("redeemToNative", () => {
        beforeEach(async () => {
            await helper.connect(funder).depositNative(await senior.getAddress(), funder.address, { value: ONE });
        });

        it("redeems shares, unwraps, and returns native BOT", async () => {
            const shares = await senior.balanceOf(funder.address);
            await senior.connect(funder).approve(await helper.getAddress(), shares);

            const before = await ethers.provider.getBalance(other.address);
            await helper.connect(funder).redeemToNative(await senior.getAddress(), shares, other.address);

            // Paid to `receiver` in native BOT, so gas costs don't muddy the assertion.
            expect((await ethers.provider.getBalance(other.address)) - before).to.equal(ONE);
            expect(await senior.balanceOf(funder.address)).to.equal(0n);
            expect(await controller.claimOf(await senior.getAddress())).to.equal(0n);
        });

        it("requires the caller to have approved the helper for the shares", async () => {
            const shares = await senior.balanceOf(funder.address);
            await expect(helper.connect(funder).redeemToNative(await senior.getAddress(), shares, funder.address)).to.be
                .reverted;
        });

        it("cannot redeem someone else's shares", async () => {
            const shares = await senior.balanceOf(funder.address);
            await expect(helper.connect(other).redeemToNative(await senior.getAddress(), shares, other.address)).to.be
                .reverted;
        });

        it("rejects zero shares and a zero receiver", async () => {
            await expect(
                helper.connect(funder).redeemToNative(await senior.getAddress(), 0, funder.address)
            ).to.be.revertedWithCustomError(helper, "ZeroAmount");
            await expect(
                helper.connect(funder).redeemToNative(await senior.getAddress(), 1, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(helper, "ZeroAddress");
        });

        it("leaves nothing behind", async () => {
            const shares = await senior.balanceOf(funder.address);
            await senior.connect(funder).approve(await helper.getAddress(), shares);
            await helper.connect(funder).redeemToNative(await senior.getAddress(), shares, funder.address);
            expect(await ethers.provider.getBalance(await helper.getAddress())).to.equal(0n);
            expect(await wbot.balanceOf(await helper.getAddress())).to.equal(0n);
        });
    });

    describe("safety", () => {
        it("rejects native BOT from anyone but the wrapper", async () => {
            await expect(
                funder.sendTransaction({ to: await helper.getAddress(), value: ONE })
            ).to.be.revertedWithCustomError(helper, "UnexpectedNative");
        });

        it("sweeps stranded tokens to anyone who asks — there is nothing to gate", async () => {
            const stray = (await (
                await ethers.getContractFactory("MockAsset")
            ).deploy("Stray", "STR", 18)) as unknown as MockAsset;
            await stray.mint(await helper.getAddress(), ONE);

            await helper.connect(other).sweep(await stray.getAddress(), other.address);
            expect(await stray.balanceOf(other.address)).to.equal(ONE);
        });

        it("sweep reverts when there is nothing to recover", async () => {
            await expect(
                helper.connect(other).sweep(ethers.ZeroAddress, other.address)
            ).to.be.revertedWithCustomError(helper, "ZeroAmount");
        });
    });
});
