import { expect } from "chai";
import { ethers } from "hardhat";
import { CifraNavOracle, MockVault4626, MockFXRP, MockFtsoV2 } from "../typechain-types";

describe("CifraNavOracle", () => {
    let fxrp: MockFXRP;
    let vault: MockVault4626, ftso: MockFtsoV2, oracle: CifraNavOracle;
    let owner: any, funder: any;

    const deposit = ethers.parseUnits("100", 6); // 100 FXRP
    const priceHalfUsd = ethers.parseUnits("0.5", 18); // XRP/USD = $0.50 (18-dp wei)

    beforeEach(async () => {
        [owner, funder] = await ethers.getSigners();

        fxrp = (await (await ethers.getContractFactory("MockFXRP")).deploy()) as unknown as MockFXRP;
        vault = (await (await ethers.getContractFactory("MockVault4626")).deploy(
            await fxrp.getAddress()
        )) as unknown as MockVault4626;
        ftso = (await (await ethers.getContractFactory("MockFtsoV2")).deploy()) as unknown as MockFtsoV2;
        oracle = (await (await ethers.getContractFactory("CifraNavOracle")).deploy(
            await vault.getAddress(), await ftso.getAddress()
        )) as unknown as CifraNavOracle;

        await ftso.set(priceHalfUsd, 1_800_000_000);

        // Funder deposits 100 FXRP.
        await fxrp.mint(funder.address, deposit);
        await fxrp.connect(funder).approve(await vault.getAddress(), deposit);
        await vault.connect(funder).deposit(deposit, funder.address);
    });

    it("prices total NAV in USD from the XRP/USD feed", async () => {
        // 100 FXRP × $0.50 = $50, scaled to 1e18.
        const [usd, ts] = await oracle.navUsd();
        expect(usd).to.equal(ethers.parseUnits("50", 18));
        expect(ts).to.equal(1_800_000_000);
    });

    it("prices a share balance in USD (funder owns the whole vault)", async () => {
        const shares = await vault.balanceOf(funder.address);
        const [usd] = await oracle.sharesToUsd(shares);
        // Funder owns ~all NAV → ~$50 (allow <=1 wei-scaled ERC-4626 rounding).
        const nav = ethers.parseUnits("50", 18);
        expect(nav - usd).to.be.lessThanOrEqual(ethers.parseUnits("0.000001", 18));
    });

    it("prices one whole share in USD", async () => {
        // Initially 1 share ≈ 1 FXRP → $0.50 (18-dp).
        const [usd] = await oracle.pricePerShareUsd();
        const half = ethers.parseUnits("0.5", 18);
        const diff = usd > half ? usd - half : half - usd;
        expect(diff).to.be.lessThanOrEqual(ethers.parseUnits("0.000001", 18));
    });

    it("tracks realized yield: NAV rises when the vault's FXRP grows", async () => {
        const [before] = await oracle.navUsd();
        // Simulate yield: extra FXRP lands in the vault (idle balance up).
        await fxrp.mint(await vault.getAddress(), ethers.parseUnits("10", 6)); // +10 FXRP
        const [after] = await oracle.navUsd();
        expect(after - before).to.equal(ethers.parseUnits("5", 18)); // +10 FXRP × $0.50 = +$5
    });

    it("reverts on a stale/zero price", async () => {
        await ftso.set(0, 0);
        await expect(oracle.navUsd()).to.be.revertedWithCustomError(oracle, "StalePrice");
    });
});
