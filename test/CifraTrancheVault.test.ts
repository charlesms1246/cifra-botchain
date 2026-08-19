import { expect } from "chai";
import { ethers } from "hardhat";
import { CifraTrancheController, CifraTrancheVault, CifraInvoiceRegistry, CifraAttestationNFT, MockAsset } from "../typechain-types";

// The tranche vault is a thin ERC-4626 whose NAV is the controller's waterfall claim, so it holds
// no ASSET itself. These tests pin the properties that differ from a plain vault.
describe("CifraTrancheVault", () => {
    let asset: MockAsset, controller: CifraTrancheController, senior: CifraTrancheVault, junior: CifraTrancheVault;
    let owner: any, funder: any;
    const dep = ethers.parseUnits("1000", 6);

    beforeEach(async () => {
        [owner, funder] = await ethers.getSigners();
        const tee = ethers.Wallet.createRandom();
        asset = (await (await ethers.getContractFactory("MockAsset")).deploy("Mock USDT", "USDT", 6)) as unknown as MockAsset;
        const registry = (await (await ethers.getContractFactory("CifraInvoiceRegistry")).deploy()) as unknown as CifraInvoiceRegistry;
        const attestation = (await (await ethers.getContractFactory("CifraAttestationNFT")).deploy(
            "Cifra Attestation", "CIFRA-ATT", tee.address, await registry.getAddress()
        )) as unknown as CifraAttestationNFT;
        controller = (await (await ethers.getContractFactory("CifraTrancheController")).deploy(
            await asset.getAddress(), await registry.getAddress(), await attestation.getAddress()
        )) as unknown as CifraTrancheController;
        senior = (await (await ethers.getContractFactory("CifraTrancheVault")).deploy(
            await asset.getAddress(), await controller.getAddress(), "Cifra Senior", "cFXRP-S"
        )) as unknown as CifraTrancheVault;
        junior = (await (await ethers.getContractFactory("CifraTrancheVault")).deploy(
            await asset.getAddress(), await controller.getAddress(), "Cifra Junior", "cFXRP-J"
        )) as unknown as CifraTrancheVault;
        await controller.connect(owner).setTrancheVaults(await senior.getAddress(), await junior.getAddress());
    });

    it("share decimals = asset decimals (6) + offset (3) = 9", async () => {
        expect(await senior.decimals()).to.equal(9);
        expect(await senior.asset()).to.equal(await asset.getAddress());
    });

    it("holds no ASSET itself; the pool lives in the controller", async () => {
        await asset.mint(funder.address, dep);
        await asset.connect(funder).approve(await senior.getAddress(), dep);
        await senior.connect(funder).deposit(dep, funder.address);

        expect(await asset.balanceOf(await senior.getAddress())).to.equal(0);
        expect(await asset.balanceOf(await controller.getAddress())).to.equal(dep);
        expect(await senior.totalAssets()).to.equal(dep); // == controller claim
    });

    it("round-trips deposit → withdraw against the controller pool", async () => {
        await asset.mint(funder.address, dep);
        await asset.connect(funder).approve(await senior.getAddress(), dep);
        await senior.connect(funder).deposit(dep, funder.address);

        const shares = await senior.balanceOf(funder.address);
        await senior.connect(funder).redeem(shares, funder.address, funder.address);
        expect(await senior.balanceOf(funder.address)).to.equal(0);
        expect(await asset.balanceOf(funder.address)).to.equal(dep); // fully recovered (no yield/loss)
        expect(await controller.claimOf(await senior.getAddress())).to.equal(0);
    });
});
