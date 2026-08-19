import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Live end-to-end exercise of the full invoice lifecycle against a deployed book:
//
//   register -> attest -> fund -> PAY      (settled, yield realized)
//   register -> attest -> fund -> DEFAULT  (junior absorbs the loss first)
//
//   npx hardhat run scripts/e2eLifecycle.ts --network botchainTestnet
//
// DISCLOSED SHORTCUTS (this is a smoke test, not a demo of separation of duties):
//   * One key plays every role — supplier, funder, keeper, scorer and buyer. In production
//     these are distinct parties and the scorer key lives in the Cloud Run service.
//   * The default leg temporarily repoints the controller at a throwaway CifraSettlement with
//     GRACE_PERIOD = 0, because the real one is 3 days and a live chain cannot time-travel.
//     The contract logic under test is identical; only the constant differs. The controller is
//     pointed back at the real settlement afterwards.

const BPS = 10000n;
const DISCOUNT_BPS = 600n; // grade A
const SCORE_RESULT_DOMAIN = ethers.encodeBytes32String("CIFRA_SCORE_RESULT");
const abi = ethers.AbiCoder.defaultAbiCoder();

const fmt = (v: bigint, d: number) => ethers.formatUnits(v, d);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signScore(signer: any, resultData: string, actionId: string, tag: string, chainId: bigint) {
    const resultHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [ethers.keccak256(resultData), actionId, ethers.keccak256(ethers.toUtf8Bytes(tag)), 1]
    );
    const payload = ethers.keccak256(abi.encode(["bytes32", "uint256", "bytes32"], [SCORE_RESULT_DOMAIN, chainId, resultHash]));
    return signer.signMessage(ethers.getBytes(payload));
}

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const [me] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const book = dep.books.bot;

    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.shared.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.shared.CifraAttestationNFT);
    const controller = await ethers.getContractAt("CifraTrancheController", book.controller);
    const senior = await ethers.getContractAt("CifraTrancheVault", book.seniorVault);
    const junior = await ethers.getContractAt("CifraTrancheVault", book.juniorVault);
    const settlement = await ethers.getContractAt("CifraSettlement", book.settlement);
    const helper = await ethers.getContractAt("CifraNativeDepositHelper", book.nativeDepositHelper);
    const wbot = new ethers.Contract(
        book.asset,
        [
            "function deposit() payable",
            "function approve(address,uint256) returns (bool)",
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
        ],
        me
    );
    const dec = Number(await wbot.decimals());

    const DEPOSIT = ethers.parseUnits("0.6", dec); // per tranche
    const FACE = ethers.parseUnits("0.5", dec);
    const PRINCIPAL = (FACE * (BPS - DISCOUNT_BPS)) / BPS;

    const nav = async () => fmt(await controller.nav(), dec);
    const claims = async () =>
        `senior ${fmt(await controller.claimOf(book.seniorVault), dec)} / junior ${fmt(await controller.claimOf(book.juniorVault), dec)}`;

    console.log(`network ${network.name}  book BOT (${book.asset})`);
    console.log(`actor   ${me.address} (supplier = funder = keeper = scorer = buyer)\n`);

    // ── 0. Capitalize both tranches ──────────────────────────────────────────
    console.log(`0. FUND THE BOOK`);
    await (await helper.depositNative(book.seniorVault, me.address, { value: DEPOSIT })).wait();
    await (await helper.depositNative(book.juniorVault, me.address, { value: DEPOSIT })).wait();
    console.log(`   deposited ${fmt(DEPOSIT, dec)} BOT into each tranche via the native helper`);
    console.log(`   NAV ${await nav()}   claims: ${await claims()}\n`);

    // Wrap what the "buyer" will later need to repay invoice A.
    await (await wbot.deposit({ value: FACE })).wait();

    // ── helper: register + attest + fund one invoice ──────────────────────────
    async function originate(label: string, dueDate: number) {
        const ref = ethers.keccak256(ethers.toUtf8Bytes(`${label}-${Date.now()}`));
        const commitment = ethers.keccak256(ethers.toUtf8Bytes(`buyer:${label}`));
        await (await registry.registerInvoice(commitment, FACE, dueDate, ref)).wait();
        const id = await registry.computeInvoiceId(me.address, commitment, FACE, dueDate, ref);
        console.log(`   registered ${label}  id ${id.slice(0, 18)}…  face ${fmt(FACE, dec)}  due ${new Date(dueDate * 1000).toISOString()}`);

        const actionId = ethers.hexlify(ethers.randomBytes(32));
        const resultData = abi.encode(
            ["bytes32", "bytes32", "uint256", "uint256"],
            [id, ethers.encodeBytes32String("A"), 9900, DISCOUNT_BPS]
        );
        const sig = await signScore(me, resultData, actionId, "threshold", chainId);
        await (await attestation.attest(id, resultData, actionId, "threshold", 1, sig)).wait();
        const g = await attestation.gradeForInvoice(id);
        console.log(`   attested   grade ${ethers.decodeBytes32String(g.grade)}  risk ${g.riskScoreBps}bps  discount ${g.discountRateBps}bps  signer ${g.scorerSigner.slice(0, 10)}…`);

        await (await controller.fundInvoice(id)).wait();
        console.log(`   funded     principal ${fmt(PRINCIPAL, dec)} advanced to supplier`);
        return id;
    }

    // ── 1. SETTLE PATH ────────────────────────────────────────────────────────
    console.log(`1. SETTLE PATH`);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const idA = await originate("INV-PAY", now + 365 * 24 * 3600);
    console.log(`   NAV ${await nav()} (flat — funding moves capital, it does not create or destroy it)`);
    console.log(`   amountDue ${fmt(await settlement.amountDue(idA), dec)}  isDefaultable ${await settlement.isDefaultable(idA)}`);

    await (await wbot.approve(book.settlement, FACE)).wait();
    const payTx = await (await settlement.payInvoice(idA)).wait();
    console.log(`   payInvoice tx ${payTx!.hash}  gas ${payTx!.gasUsed}`);
    console.log(`   status ${(await registry.getInvoice(idA)).status} (3 = Settled)`);
    console.log(`   NAV ${await nav()}  (+${fmt(FACE - PRINCIPAL, dec)} yield)   claims: ${await claims()}`);
    console.log(`   settlement resting balance ${fmt(await wbot.balanceOf(book.settlement), dec)} (atomic — nothing held)\n`);

    // ── 2. DEFAULT PATH ───────────────────────────────────────────────────────
    console.log(`2. DEFAULT PATH  (throwaway settlement with GRACE_PERIOD = 0 — see header)`);
    const tmp = await (await ethers.getContractFactory("CifraSettlement")).deploy(book.controller, 0);
    await tmp.waitForDeployment();
    const tmpAddr = await tmp.getAddress();
    await (await controller.setSettlement(tmpAddr)).wait();
    console.log(`   deployed ${tmpAddr} and repointed the controller at it`);

    const now2 = (await ethers.provider.getBlock("latest"))!.timestamp;
    const dueSoon = now2 + 30;
    const idB = await originate("INV-DEF", dueSoon);
    const seniorBefore = await controller.claimOf(book.seniorVault);
    const juniorBefore = await controller.claimOf(book.juniorVault);

    console.log(`   defaultableAt ${await tmp.defaultableAt(idB)} (due ${dueSoon}); waiting for the due date to pass…`);
    while (true) {
        const t = (await ethers.provider.getBlock("latest"))!.timestamp;
        if (t > dueSoon) break;
        await sleep(3000);
    }
    console.log(`   isDefaultable ${await tmp.isDefaultable(idB)}`);

    const defTx = await (await tmp.markDefault(idB)).wait();
    console.log(`   markDefault tx ${defTx!.hash}  gas ${defTx!.gasUsed}`);
    console.log(`   status ${(await registry.getInvoice(idB)).status} (4 = Defaulted)`);

    const seniorAfter = await controller.claimOf(book.seniorVault);
    const juniorAfter = await controller.claimOf(book.juniorVault);
    console.log(`   senior ${fmt(seniorBefore, dec)} -> ${fmt(seniorAfter, dec)}   (loss ${fmt(seniorBefore - seniorAfter, dec)})`);
    console.log(`   junior ${fmt(juniorBefore, dec)} -> ${fmt(juniorAfter, dec)}   (loss ${fmt(juniorBefore - juniorAfter, dec)})`);
    console.log(
        seniorAfter === seniorBefore
            ? `   SUBORDINATION HOLDS: junior absorbed the entire ${fmt(PRINCIPAL, dec)} loss, senior untouched.`
            : `   junior was wiped out; ${fmt(seniorBefore - seniorAfter, dec)} overflowed into senior.`
    );

    // Restore the real settlement so the deployment is left as the record describes.
    await (await controller.setSettlement(book.settlement)).wait();
    console.log(`\n   restored controller.settlement -> ${book.settlement}`);
    console.log(`\nfinal NAV ${await nav()}   claims: ${await claims()}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
