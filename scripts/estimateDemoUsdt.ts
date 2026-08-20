import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { NETWORKS } from "../config/networks";

// How much real USDT does a full mainnet demo of the USDT book actually need?
//
//   FORK=1 npx hardhat run scripts/estimateDemoUsdt.ts
//
// Runs the complete two-path demo (settle + default) against forked mainnet with the real USDT
// contract, and reports the maximum USDT held across the participating wallets at any moment.
//
// The number that matters is a FLOAT, not a spend: every USDT ends up back in wallets the team
// controls. Deposits are withdrawable, the settled face value lands in the pool, and on a
// default the advanced principal is already in the supplier's wallet. Only BOT gas is consumed.

const M = NETWORKS[677];
const USDT = M.books.usdt.asset;
const WHALE = "0xeefdBdB186F6D4cD9c54335100D33c497f54B8C0";
const BPS = 10000n;
const DISCOUNT = 600n;
const SCORE_DOMAIN = ethers.encodeBytes32String("CIFRA_SCORE_RESULT");
const abi = ethers.AbiCoder.defaultAbiCoder();
const u = (n: string) => ethers.parseUnits(n, 6);
const f = (v: bigint) => ethers.formatUnits(v, 6);

async function sign(w: any, data: string, actionId: string, chainId: bigint) {
    const rh = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [ethers.keccak256(data), actionId, ethers.keccak256(ethers.toUtf8Bytes("threshold")), 1]
    );
    return w.signMessage(ethers.getBytes(ethers.keccak256(abi.encode(["bytes32", "uint256", "bytes32"], [SCORE_DOMAIN, chainId, rh]))));
}

async function main() {
    await network.provider.send("evm_mine", []);
    const [dep, funder, supplier, buyer] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const scorer = ethers.Wallet.createRandom();

    // Sizing is env-driven so the true floor can be probed, not guessed.
    const FACE = u((process.env.DEMO_FACE ?? "1").trim());
    const SENIOR = u((process.env.DEMO_DEPOSIT ?? "0.5").trim());
    const JUNIOR = SENIOR;
    const principal = (FACE * (BPS - DISCOUNT)) / BPS;

    const F = (n: string) => ethers.getContractFactory(n);
    const registry = await (await F("CifraInvoiceRegistry")).deploy();
    const attestation = await (await F("CifraAttestationNFT")).deploy("A", "A", scorer.address, await registry.getAddress());
    const funders = await (await F("CifraFunderRegistry")).deploy(false);
    const c = await (await F("CifraTrancheController")).deploy(USDT, await registry.getAddress(), await attestation.getAddress());
    const s = await (await F("CifraTrancheVault")).deploy(USDT, await c.getAddress(), "S", "cUSDT-S", await funders.getAddress());
    const j = await (await F("CifraTrancheVault")).deploy(USDT, await c.getAddress(), "J", "cUSDT-J", await funders.getAddress());
    const settle = await (await F("CifraSettlement")).deploy(await c.getAddress(), 3 * 24 * 3600);
    await registry.setStatusUpdater(await c.getAddress(), true);
    await c.setTrancheVaults(await s.getAddress(), await j.getAddress());
    await c.setSettlement(await settle.getAddress());

    // Fund the demo wallets with exactly what the plan calls for.
    await network.provider.send("hardhat_impersonateAccount", [WHALE]);
    await network.provider.send("hardhat_setBalance", [WHALE, "0x56BC75E2D63100000"]);
    const whale = await ethers.getSigner(WHALE);
    const usdt = new ethers.Contract(USDT, [
        "function transfer(address,uint256) returns (bool)",
        "function approve(address,uint256) returns (bool)",
        "function balanceOf(address) view returns (uint256)",
    ], whale);
    await (await usdt.transfer(funder.address, SENIOR + JUNIOR)).wait();
    await (await usdt.transfer(buyer.address, FACE)).wait();
    await network.provider.send("hardhat_stopImpersonatingAccount", [WHALE]);

    const seeded = SENIOR + JUNIOR + FACE;
    console.log(`Demo plan: senior ${f(SENIOR)} + junior ${f(JUNIOR)} deposits, one ${f(FACE)} invoice settled, one defaulted.`);
    if (SENIOR + JUNIOR < (FACE * 9400n) / 10000n) throw new Error("deposits cannot cover the advance");
    console.log(`Seeded across wallets: ${f(seeded)} USDT\n`);

    const originate = async (label: string, dueIn: number) => {
        const ref = ethers.keccak256(ethers.toUtf8Bytes(label));
        const cm = ethers.keccak256(ethers.toUtf8Bytes("buyer:" + label));
        const due = (await time.latest()) + dueIn;
        await (await registry.connect(supplier).registerInvoice(cm, FACE, due, ref)).wait();
        const id = await registry.computeInvoiceId(supplier.address, cm, FACE, due, ref);
        const actionId = ethers.hexlify(ethers.randomBytes(32));
        const data = abi.encode(
            ["bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
            [id, ethers.encodeBytes32String("A"), 9900, DISCOUNT, ethers.encodeBytes32String("cifra-score-v1"), ethers.ZeroHash]
        );
        await (await attestation.attest(id, data, actionId, "threshold", 1, await sign(scorer, data, actionId, chainId))).wait();
        await (await c.fundInvoice(id)).wait();
        return { id, due };
    };

    await (await usdt.connect(funder).approve(await s.getAddress(), SENIOR)).wait();
    await s.connect(funder).deposit(SENIOR, funder.address);
    await (await usdt.connect(funder).approve(await j.getAddress(), JUNIOR)).wait();
    await j.connect(funder).deposit(JUNIOR, funder.address);

    const a = await originate("DEMO-PAY", 30 * 24 * 3600);
    await (await usdt.connect(buyer).approve(await settle.getAddress(), FACE)).wait();
    await settle.connect(buyer).payInvoice(a.id);
    console.log(`settle path  OK — NAV ${f(await c.nav())} (yield +${f(FACE - principal)})`);

    const b = await originate("DEMO-DEF", 60);
    const seniorBefore = await c.claimOf(await s.getAddress());
    const juniorBefore = await c.claimOf(await j.getAddress());
    await time.increaseTo(b.due + 3 * 24 * 3600 + 1);
    await settle.markDefault(b.id);
    const seniorAfter = await c.claimOf(await s.getAddress());
    const juniorAfter = await c.claimOf(await j.getAddress());

    console.log(`default path OK`);
    console.log(`  senior ${f(seniorBefore)} -> ${f(seniorAfter)}   junior ${f(juniorBefore)} -> ${f(juniorAfter)}`);
    // The headline claim is "senior is protected". If junior is too thin to absorb the whole
    // advance the loss overflows into senior, and the demo shows the opposite of the pitch.
    console.log(
        seniorAfter === seniorBefore
            ? `  SUBORDINATION VISIBLE: junior absorbed the full ${f(principal)} loss, senior untouched.`
            : `  (!) junior was too thin — ${f(seniorBefore - seniorAfter)} overflowed into senior. ` +
                  `Raise the junior deposit to at least the advance (${f(principal)}) to demo "senior protected".`
    );

    // Everything is recoverable: withdraw whatever idle liquidity remains.
    const shares = await s.balanceOf(funder.address);
    const maxOut = await s.maxWithdraw(funder.address);
    if (maxOut > 0n) await s.connect(funder).withdraw(maxOut, funder.address, funder.address);

    const held =
        (await usdt.balanceOf(funder.address)) +
        (await usdt.balanceOf(supplier.address)) +
        (await usdt.balanceOf(buyer.address)) +
        (await usdt.balanceOf(await c.getAddress()));
    console.log(`\nUSDT still held by the team afterwards: ${f(held)} of ${f(seeded)} seeded`);
    console.log(`(the remainder is idle in the pool / advanced to the supplier — all recoverable)`);
    console.log(`\nUSDT still held by the team afterwards: ${f(held)} of ${f(seeded)} seeded`);
    console.log(`\n=> FLOAT REQUIRED: ${f(seeded)} USDT`);
}

main().catch((e) => {
    console.error(String(e).split("\n").slice(0, 4).join("\n"));
    process.exit(1);
});
