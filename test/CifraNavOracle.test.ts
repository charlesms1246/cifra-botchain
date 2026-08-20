import { expect } from "chai";
import { ethers } from "hardhat";
import { CifraNavOracle, MockVault4626, MockAsset, MockV3Pool } from "../typechain-types";
// The SHIPPED conversion, not a copy — a re-implementation here could not catch a regression
// in the code the frontend actually runs.
import { priceFromTick } from "../frontend/lib/price";

// CifraNavOracle is a DISPLAY-ONLY valuation helper: it reports a book's NAV in its own asset
// units and hands back the raw TWAP mean tick so the frontend can express that NAV in a quote
// asset. Nothing economic reads it (see claude-docs/DECISIONS.md D3.3), so these tests cover the
// NAV arithmetic, the TWAP tick maths (including Uniswap's round-toward-negative-infinity rule)
// and the too-young-pool fallback — not price correctness, which is the pool's business.
describe("CifraNavOracle", () => {
    let wbot: MockAsset, usdt: MockAsset;
    let vault: MockVault4626, pool: MockV3Pool, oracle: CifraNavOracle;
    let funder: any;

    const WINDOW = 1800; // 30 min, matches TWAP_WINDOW_SECONDS
    const deposit = ethers.parseUnits("100", 18); // 100 WBOT

    beforeEach(async () => {
        [, funder] = await ethers.getSigners();

        // The BOT book: an 18-decimal wrapped-native asset quoted against 6-decimal USDT.
        wbot = (await (await ethers.getContractFactory("MockAsset")).deploy(
            "Mock Wrapped BOT",
            "WBOT",
            18
        )) as unknown as MockAsset;
        usdt = (await (await ethers.getContractFactory("MockAsset")).deploy(
            "Mock USDT",
            "USDT",
            6
        )) as unknown as MockAsset;

        vault = (await (await ethers.getContractFactory("MockVault4626")).deploy(
            await wbot.getAddress()
        )) as unknown as MockVault4626;

        pool = (await (await ethers.getContractFactory("MockV3Pool")).deploy(
            await wbot.getAddress(),
            await usdt.getAddress()
        )) as unknown as MockV3Pool;
        await pool.setTicks(253661, 253700); // mean tick vs a slightly drifted spot

        oracle = (await (await ethers.getContractFactory("CifraNavOracle")).deploy(
            await vault.getAddress(),
            await pool.getAddress(),
            WINDOW
        )) as unknown as CifraNavOracle;

        await wbot.mint(funder.address, deposit);
        await wbot.connect(funder).approve(await vault.getAddress(), deposit);
        await vault.connect(funder).deposit(deposit, funder.address);
    });

    describe("deployment wiring", () => {
        it("resolves the base/quote sides and their decimals from the pool", async () => {
            expect(await oracle.BASE_TOKEN()).to.equal(await wbot.getAddress());
            expect(await oracle.QUOTE_TOKEN()).to.equal(await usdt.getAddress());
            expect(await oracle.BASE_IS_TOKEN0()).to.equal(true);
            expect(await oracle.BASE_DECIMALS()).to.equal(18);
            expect(await oracle.QUOTE_DECIMALS()).to.equal(6);
        });

        it("flags base-is-token1 so the caller knows to invert the tick", async () => {
            const flipped = (await (await ethers.getContractFactory("MockV3Pool")).deploy(
                await usdt.getAddress(),
                await wbot.getAddress()
            )) as unknown as MockV3Pool;
            const o = (await (await ethers.getContractFactory("CifraNavOracle")).deploy(
                await vault.getAddress(),
                await flipped.getAddress(),
                WINDOW
            )) as unknown as CifraNavOracle;
            expect(await o.BASE_IS_TOKEN0()).to.equal(false);
            expect(await o.QUOTE_TOKEN()).to.equal(await usdt.getAddress());
        });

        it("refuses a pool that does not contain the vault asset", async () => {
            const other = (await (await ethers.getContractFactory("MockAsset")).deploy("Other", "OTH", 18)) as unknown as MockAsset;
            const wrongPool = (await (await ethers.getContractFactory("MockV3Pool")).deploy(
                await other.getAddress(),
                await usdt.getAddress()
            )) as unknown as MockV3Pool;
            const factory = await ethers.getContractFactory("CifraNavOracle");
            await expect(
                factory.deploy(await vault.getAddress(), await wrongPool.getAddress(), WINDOW)
            ).to.be.revertedWithCustomError(oracle, "AssetNotInPool");
        });

        it("rejects a zero TWAP window", async () => {
            const factory = await ethers.getContractFactory("CifraNavOracle");
            await expect(
                factory.deploy(await vault.getAddress(), await pool.getAddress(), 0)
            ).to.be.revertedWithCustomError(oracle, "ZeroWindow");
        });
    });

    describe("NAV in asset units (no oracle involved)", () => {
        it("reports the vault's NAV", async () => {
            expect(await oracle.navAssets()).to.equal(deposit);
        });

        it("tracks realized yield as the vault's assets grow", async () => {
            const before = await oracle.navAssets();
            await wbot.mint(await vault.getAddress(), ethers.parseUnits("10", 18));
            expect((await oracle.navAssets()) - before).to.equal(ethers.parseUnits("10", 18));
        });

        it("prices one whole share", async () => {
            // Fresh vault: 1 share ≈ 1 asset.
            const pps = await oracle.pricePerShareAssets();
            const one = ethers.parseUnits("1", 18);
            const diff = pps > one ? pps - one : one - pps;
            expect(diff).to.be.lessThanOrEqual(ethers.parseUnits("0.0001", 18));
        });
    });

    describe("TWAP tick", () => {
        it("returns the pool's arithmetic-mean tick over the window", async () => {
            expect(await oracle.meanTick(WINDOW)).to.equal(253661);
        });

        it("handles a negative mean tick", async () => {
            await pool.setTicks(-100, -100);
            expect(await oracle.meanTick(WINDOW)).to.equal(-100);
        });

        it("rounds a negative, non-exact mean toward negative infinity, as Uniswap does", async () => {
            // Solidity division truncates toward ZERO, so -100.5 would come out as -100 without
            // the correction. Uniswap's TWAP definition rounds DOWN, i.e. -101. Force a delta
            // that leaves a remainder to reach that branch at all.
            //   delta = -(100 * WINDOW) - 1  →  exact mean = -100.000555…  →  must floor to -101.
            await pool.setForcedCumulativeDelta(-(100n * BigInt(WINDOW)) - 1n);
            expect(await oracle.meanTick(WINDOW)).to.equal(-101);
        });

        it("does not over-round a positive, non-exact mean (truncation is already floor)", async () => {
            //   delta = 100 * WINDOW + 1  →  exact mean = 100.000555…  →  floor is 100.
            await pool.setForcedCumulativeDelta(100n * BigInt(WINDOW) + 1n);
            expect(await oracle.meanTick(WINDOW)).to.equal(100);
        });

        it("rounds an exact negative mean without an off-by-one", async () => {
            await pool.setForcedCumulativeDelta(-(100n * BigInt(WINDOW)));
            expect(await oracle.meanTick(WINDOW)).to.equal(-100);
        });

        it("exposes spot separately so a UI can show drift from the TWAP", async () => {
            expect(await oracle.spotTick()).to.equal(253700);
        });

        it("meanTickSafe reports ok=false instead of reverting on a too-young pool", async () => {
            await pool.setHistorySeconds(60); // pool only has 60s of observations
            await expect(oracle.meanTick(WINDOW)).to.be.reverted;

            const [tick, ok] = await oracle.meanTickSafe();
            expect(ok).to.equal(false);
            expect(tick).to.equal(0);
        });
    });

    // The oracle deliberately returns a raw tick and lets the caller convert (Uniswap's TickMath
    // is GPL). That makes the conversion OUR bug surface, so it is pinned here as well as in the
    // mainnet-fork suite — a fork run needs the network, this does not.
    describe("tick → price conversion (config/price.ts, the function the frontend ships)", () => {
        it("prices an 18dp base against a 6dp quote when the base is token1", async () => {
            // The real BDEX WBOT/USDT pool: token0 = USDT (6dp), token1 = WBOT (18dp), tick ≈ 253671.
            // Correct answer is ≈ $9.6 per BOT.
            const price = priceFromTick(253671, false, 18, 6);
            expect(price).to.be.greaterThan(5);
            expect(price).to.be.lessThan(20);
        });

        it("does NOT flip the decimal exponent with the tick sign", async () => {
            // The bug the fork test caught: flipping the exponent too rescales by
            // 10^(2·(18−6)) = 10^24. Assert the wrong formula and the right one differ by exactly
            // that, so a regression is unmistakable rather than merely 'a weird number'.
            const correct = priceFromTick(253671, false, 18, 6);
            const buggy = Math.pow(1.0001, -253671) * Math.pow(10, 6 - 18);
            expect(correct / buggy).to.be.closeTo(1e24, 1e22);
        });

        it("is symmetric: swapping orientation inverts the price", async () => {
            const asToken1 = priceFromTick(253671, false, 18, 6);
            const asToken0 = priceFromTick(253671, true, 6, 18);
            expect(asToken0 * asToken1).to.be.closeTo(1, 1e-6);
        });
    });

    describe("quote()", () => {
        it("returns everything the frontend needs in one call", async () => {
            const [nav, sharePrice, tick, tickOk, baseIsToken0, baseDecimals, quoteDecimals] = await oracle.quote();
            expect(nav).to.equal(deposit);
            expect(sharePrice).to.be.greaterThan(0n);
            expect(tick).to.equal(253661);
            expect(tickOk).to.equal(true);
            expect(baseIsToken0).to.equal(true);
            expect(baseDecimals).to.equal(18);
            expect(quoteDecimals).to.equal(6);
        });

        it("still returns NAV when the pool cannot serve the window", async () => {
            // The whole point of the display-only design: a dead price feed must never stop the
            // honest, oracle-free NAV figure from rendering.
            await pool.setHistorySeconds(60);
            const [nav, , , tickOk] = await oracle.quote();
            expect(nav).to.equal(deposit);
            expect(tickOk).to.equal(false);
        });
    });
});
