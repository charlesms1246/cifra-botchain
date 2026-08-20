import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { NETWORKS, TWAP_WINDOW_SECONDS } from "../../config/networks";

// Exercises the full stack against a FORK OF BOT CHAIN MAINNET, using the real WBOT wrapper,
// the real USDT contract and the real BDEX WBOT/USDT pool.
//
//   FORK=1 npx hardhat test test/fork/MainnetFork.test.ts
//
// WHY THIS EXISTS. Two things have never run anywhere before mainnet:
//   1. CifraNavOracle — testnet has no pool with liquidity, so `navPool` is unset there and the
//      oracle has simply never been deployed. Mainnet would be its first execution ever.
//   2. Real token behaviour — testnet USDT is a different contract at a different address, and
//      the real WBOT wrapper is not the mock.
// Discovering a problem with either of those after paying for a mainnet deploy is the expensive
// way to find out.
//
// Skipped unless FORK=1 so the normal unit suite stays offline and fast.

const MAINNET = NETWORKS[677];
const POOL = MAINNET.books.bot.navPool!;
const WBOT = MAINNET.wrappedNative;
const USDT = MAINNET.books.usdt.asset;
// Largest USDT holder on mainnet, an EOA. Impersonated purely as a source of real USDT.
const USDT_WHALE = "0xeefdBdB186F6D4cD9c54335100D33c497f54B8C0";

const BPS = 10000n;
const SCORE_RESULT_DOMAIN = ethers.encodeBytes32String("CIFRA_SCORE_RESULT");
const MODEL_VERSION = ethers.encodeBytes32String("cifra-score-v1");
const IMAGE_DIGEST = ethers.keccak256(ethers.toUtf8Bytes("sha256:fork-test"));
const abi = ethers.AbiCoder.defaultAbiCoder();

const forkEnabled = process.env.FORK === "1";

async function signResult(wallet: any, resultData: string, actionId: string, tag: string, chainId: bigint) {
    const resultHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [ethers.keccak256(resultData), actionId, ethers.keccak256(ethers.toUtf8Bytes(tag)), 1]
    );
    const payload = ethers.keccak256(
        abi.encode(["bytes32", "uint256", "bytes32"], [SCORE_RESULT_DOMAIN, chainId, resultHash])
    );
    return wallet.signMessage(ethers.getBytes(payload));
}

(forkEnabled ? describe : describe.skip)("BOT Chain mainnet fork", () => {
    let deployer: any, funder: any, supplier: any, buyer: any;
    let scorer: any, chainId: bigint;
    let registry: any, attestation: any;

    before(async () => {
        // EDR treats the fork block itself as historical and refuses to execute against it
        // without a hardfork history it recognises for chain 677. Mining one local block moves
        // the head onto a block the local node owns, which sidesteps the lookup entirely.
        await network.provider.send("evm_mine", []);
    });

    beforeEach(async () => {
        [deployer, funder, supplier, buyer] = await ethers.getSigners();
        scorer = ethers.Wallet.createRandom();
        chainId = (await ethers.provider.getNetwork()).chainId;

        registry = await (await ethers.getContractFactory("CifraInvoiceRegistry")).deploy();
        attestation = await (
            await ethers.getContractFactory("CifraAttestationNFT")
        ).deploy("Cifra Attestation", "CIFRA-ATT", scorer.address, await registry.getAddress());
    });

    it("is actually forked from mainnet, not a fresh chain", async () => {
        expect(chainId).to.equal(677n);
        expect(await ethers.provider.getCode(USDT)).to.not.equal("0x");
        expect(await ethers.provider.getCode(WBOT)).to.not.equal("0x");
        expect(await ethers.provider.getCode(POOL)).to.not.equal("0x");
    });

    describe("real token metadata matches config/networks.ts", () => {
        it("USDT is 6 decimals at the configured mainnet address", async () => {
            const t = new ethers.Contract(USDT, ["function symbol() view returns (string)", "function decimals() view returns (uint8)"], ethers.provider);
            expect(await t.symbol()).to.equal("USDT");
            expect(await t.decimals()).to.equal(6);
        });

        it("WBOT is 18 decimals and wraps native BOT", async () => {
            const w = new ethers.Contract(
                WBOT,
                ["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function deposit() payable", "function balanceOf(address) view returns (uint256)"],
                deployer
            );
            expect(await w.symbol()).to.equal("WBOT");
            expect(await w.decimals()).to.equal(18);

            const before = await w.balanceOf(deployer.address);
            await (await w.deposit({ value: ethers.parseEther("1") })).wait();
            expect((await w.balanceOf(deployer.address)) - before).to.equal(ethers.parseEther("1"));
        });
    });

    describe("CifraNavOracle against the real BDEX pool", () => {
        // This is the whole reason the fork suite exists.
        let vault: any, controller: any, oracle: any;

        beforeEach(async () => {
            controller = await (
                await ethers.getContractFactory("CifraTrancheController")
            ).deploy(WBOT, await registry.getAddress(), await attestation.getAddress());
            vault = await (
                await ethers.getContractFactory("CifraTrancheVault")
            ).deploy(WBOT, await controller.getAddress(), "Cifra Senior BOT", "cBOT-S");
            const junior = await (
                await ethers.getContractFactory("CifraTrancheVault")
            ).deploy(WBOT, await controller.getAddress(), "Cifra Junior BOT", "cBOT-J");
            await controller.setTrancheVaults(await vault.getAddress(), await junior.getAddress());

            oracle = await (
                await ethers.getContractFactory("CifraNavOracle")
            ).deploy(await vault.getAddress(), POOL, TWAP_WINDOW_SECONDS);
        });

        it("resolves the base/quote sides from the live pool", async () => {
            expect(await oracle.BASE_TOKEN()).to.equal(WBOT);
            expect(await oracle.QUOTE_TOKEN()).to.equal(USDT);
            expect(await oracle.BASE_DECIMALS()).to.equal(18);
            expect(await oracle.QUOTE_DECIMALS()).to.equal(6);
        });

        it("takes the inverted-tick path — on the real pool WBOT is token1, not token0", async () => {
            // Worth pinning: the mock pool in the unit tests has the base as token0, so without
            // this the inversion branch would only ever be exercised synthetically.
            expect(await oracle.BASE_IS_TOKEN0()).to.equal(false);
        });

        it("serves a 30-minute TWAP from the pool's real observation history", async () => {
            const [tick, ok] = await oracle.meanTickSafe();
            expect(ok).to.equal(true);
            expect(tick).to.not.equal(0);
        });

        it("produces a BOT/USD price in a sane range", async () => {
            const [, , tick, tickOk, baseIsToken0, baseDecimals, quoteDecimals] = await oracle.quote();
            expect(tickOk).to.equal(true);

            // The same conversion the frontend does (lib/format.ts priceFromTick).
            const raw = Math.pow(1.0001, baseIsToken0 ? Number(tick) : -Number(tick));
            // Exponent is baseDecimals - quoteDecimals REGARDLESS of orientation; only the tick
            // sign flips. Getting this wrong rescales by 10^24 on this pool.
            const price = raw * Math.pow(10, Number(baseDecimals) - Number(quoteDecimals));

            // A wide band on purpose — this asserts the decimal/inversion maths is not off by
            // orders of magnitude, not that BOT is worth any particular amount.
            expect(price).to.be.greaterThan(0.5);
            expect(price).to.be.lessThan(500);
        });

        it("reports NAV in asset units even when the pool cannot serve the window", async () => {
            const deposit = ethers.parseEther("2");
            const w = new ethers.Contract(WBOT, ["function deposit() payable", "function approve(address,uint256) returns (bool)"], funder);
            await (await w.deposit({ value: deposit })).wait();
            await (await w.approve(await vault.getAddress(), deposit)).wait();
            await vault.connect(funder).deposit(deposit, funder.address);

            const [nav] = await oracle.quote();
            expect(nav).to.equal(deposit);
        });
    });

    describe("full lifecycle on the real USDT contract", () => {
        let controller: any, senior: any, junior: any, settlement: any, usdt: any;
        const face = ethers.parseUnits("1000", 6);
        const deposit = ethers.parseUnits("5000", 6);
        const discountBps = 600n;
        const principal = (face * (BPS - discountBps)) / BPS;
        const GRACE = 3 * 24 * 3600;

        beforeEach(async () => {
            controller = await (
                await ethers.getContractFactory("CifraTrancheController")
            ).deploy(USDT, await registry.getAddress(), await attestation.getAddress());
            senior = await (
                await ethers.getContractFactory("CifraTrancheVault")
            ).deploy(USDT, await controller.getAddress(), "Cifra Senior USDT", "cUSDT-S");
            junior = await (
                await ethers.getContractFactory("CifraTrancheVault")
            ).deploy(USDT, await controller.getAddress(), "Cifra Junior USDT", "cUSDT-J");
            settlement = await (await ethers.getContractFactory("CifraSettlement")).deploy(await controller.getAddress(), GRACE);

            await registry.setStatusUpdater(await controller.getAddress(), true);
            await controller.setTrancheVaults(await senior.getAddress(), await junior.getAddress());
            await controller.setSettlement(await settlement.getAddress());

            // Real USDT, taken from the largest holder rather than minted.
            await network.provider.send("hardhat_impersonateAccount", [USDT_WHALE]);
            await network.provider.send("hardhat_setBalance", [USDT_WHALE, "0x56BC75E2D63100000"]);
            const whale = await ethers.getSigner(USDT_WHALE);
            usdt = new ethers.Contract(
                USDT,
                ["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
                whale
            );
            await (await usdt.transfer(funder.address, deposit)).wait();
            await (await usdt.transfer(buyer.address, face)).wait();
            await network.provider.send("hardhat_stopImpersonatingAccount", [USDT_WHALE]);
        });

        it("runs register → score → fund → pay against real USDT", async () => {
            await (await usdt.connect(funder).approve(await senior.getAddress(), deposit)).wait();
            await senior.connect(funder).deposit(deposit, funder.address);
            expect(await controller.nav()).to.equal(deposit);

            const dueDate = (await time.latest()) + 30 * 24 * 3600;
            const ref = ethers.keccak256(ethers.toUtf8Bytes("FORK-PAY"));
            const commitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:fork"));
            await registry.connect(supplier).registerInvoice(commitment, face, dueDate, ref);
            const id = await registry.computeInvoiceId(supplier.address, commitment, face, dueDate, ref);

            const actionId = ethers.hexlify(ethers.randomBytes(32));
            const resultData = abi.encode(
                ["bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
                [id, ethers.encodeBytes32String("A"), 9900, discountBps, MODEL_VERSION, IMAGE_DIGEST]
            );
            await attestation.attest(id, resultData, actionId, "threshold", 1, await signResult(scorer, resultData, actionId, "threshold", chainId));
            await controller.fundInvoice(id);
            expect(await usdt.balanceOf(supplier.address)).to.equal(principal);

            await (await usdt.connect(buyer).approve(await settlement.getAddress(), face)).wait();
            await settlement.connect(buyer).payInvoice(id);

            expect(await controller.nav()).to.equal(deposit + (face - principal));
            expect(await usdt.balanceOf(await settlement.getAddress())).to.equal(0);
        });

        it("defaults past due + grace, with junior absorbing the loss", async () => {
            await (await usdt.connect(funder).approve(await senior.getAddress(), deposit / 2n)).wait();
            await senior.connect(funder).deposit(deposit / 2n, funder.address);
            await (await usdt.connect(funder).approve(await junior.getAddress(), deposit / 2n)).wait();
            await junior.connect(funder).deposit(deposit / 2n, funder.address);

            const dueDate = (await time.latest()) + 10;
            const ref = ethers.keccak256(ethers.toUtf8Bytes("FORK-DEF"));
            const commitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:forkdef"));
            await registry.connect(supplier).registerInvoice(commitment, face, dueDate, ref);
            const id = await registry.computeInvoiceId(supplier.address, commitment, face, dueDate, ref);

            const actionId = ethers.hexlify(ethers.randomBytes(32));
            const resultData = abi.encode(
                ["bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
                [id, ethers.encodeBytes32String("A"), 9900, discountBps, MODEL_VERSION, IMAGE_DIGEST]
            );
            await attestation.attest(id, resultData, actionId, "threshold", 1, await signResult(scorer, resultData, actionId, "threshold", chainId));
            await controller.fundInvoice(id);

            const seniorBefore = await controller.claimOf(await senior.getAddress());
            await time.increaseTo(dueDate + GRACE + 1);
            await settlement.markDefault(id);

            expect(await controller.claimOf(await senior.getAddress())).to.equal(seniorBefore);
            expect(await controller.claimOf(await junior.getAddress())).to.equal(deposit / 2n - principal);
        });
    });

    describe("CifraNativeDepositHelper against the real WBOT wrapper", () => {
        it("round-trips native BOT in and out", async () => {
            const controller = await (
                await ethers.getContractFactory("CifraTrancheController")
            ).deploy(WBOT, await registry.getAddress(), await attestation.getAddress());
            const senior = await (
                await ethers.getContractFactory("CifraTrancheVault")
            ).deploy(WBOT, await controller.getAddress(), "Cifra Senior BOT", "cBOT-S");
            const junior = await (
                await ethers.getContractFactory("CifraTrancheVault")
            ).deploy(WBOT, await controller.getAddress(), "Cifra Junior BOT", "cBOT-J");
            await controller.setTrancheVaults(await senior.getAddress(), await junior.getAddress());
            const helper = await (await ethers.getContractFactory("CifraNativeDepositHelper")).deploy(WBOT);

            const amount = ethers.parseEther("3");
            await helper.connect(funder).depositNative(await senior.getAddress(), funder.address, { value: amount });
            expect(await controller.claimOf(await senior.getAddress())).to.equal(amount);

            const shares = await senior.balanceOf(funder.address);
            await senior.connect(funder).approve(await helper.getAddress(), shares);

            const before = await ethers.provider.getBalance(supplier.address);
            await helper.connect(funder).redeemToNative(await senior.getAddress(), shares, supplier.address);
            expect((await ethers.provider.getBalance(supplier.address)) - before).to.equal(amount);
            expect(await ethers.provider.getBalance(await helper.getAddress())).to.equal(0);
        });
    });
});
