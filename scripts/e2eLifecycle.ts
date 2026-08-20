import "dotenv/config";
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Live end-to-end exercise of the full invoice lifecycle against a deployed book:
//
//   register -> score -> attest -> fund -> PAY      (settled, yield realized)
//   register -> score -> attest -> fund -> DEFAULT  (junior absorbs the loss first)
//
// The grade comes from the REAL scoring service over HTTP — nothing is signed inline here.
// That is the point: it proves the Go service's signature scheme and the Solidity verifier
// agree byte for byte across languages.
//
//   cd scorer && go build -o /tmp/scorer . && \
//     SCORER_SIGNING_KEY=<deployer key> CHAIN_ID=968 PORT=8099 /tmp/scorer &
//   SCORER_URL=http://localhost:8099 npx hardhat run scripts/e2eLifecycle.ts --network botchainTestnet
//
// Sizing and book are env-driven, so the same script proves the loop with 1 USDT or 1000:
//   DEMO_BOOK=usdt DEMO_FACE=1 DEMO_DEPOSIT=0.5 npx hardhat run scripts/e2eLifecycle.ts --network botchain
//
//   DEMO_BOOK     bot (default) | usdt
//   DEMO_FACE     invoice face value, in whole units of the book asset (default 0.5)
//   DEMO_DEPOSIT  per-tranche deposit (default 0.6). Senior + junior must cover the advance,
//                 which is face x (1 - discount) — so 2 x DEPOSIT >= ~0.94 x FACE.
//
// DISCLOSED SHORTCUTS (this is a smoke test, not a demo of separation of duties):
//   * One key plays every role — supplier, funder, keeper, scorer and buyer. In production
//     these are distinct parties and the scorer key lives only in the Cloud Run service.
//   * The default leg temporarily repoints the controller at a throwaway CifraSettlement with
//     GRACE_PERIOD = 0, because the real one is 3 days and a live chain cannot time-travel.
//     The contract logic under test is identical; only the constant differs. The controller is
//     pointed back at the real settlement afterwards.

const BPS = 10000n;

const fmt = (v: bigint, d: number) => ethers.formatUnits(v, d);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCORER_URL = process.env.SCORER_URL ?? "http://localhost:8099";

type ScoreResponse = {
    resultData: string;
    actionId: string;
    submissionTag: string;
    status: number;
    signature: string;
    scorer: string;
    modelVersion: string;
    imageDigest: string;
    score: { grade: string; riskScoreBps: number; discountRateBps: number };
};

/** Ask the scoring service to grade a buyer and sign the result. */
async function requestScore(invoiceId: string, tenorDays: number): Promise<ScoreResponse> {
    const res = await fetch(`${SCORER_URL}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            invoiceId,
            input: {
                invoiceId,
                invoicesPaidOnTime: 47,
                invoicesTotal: 48,
                invoiceAmount: 500_000,
                historicalAvgVolume: 900_000,
                tenorDays,
                jurisdictionCode: "DE",
            },
        }),
    });
    if (!res.ok) throw new Error(`scorer ${res.status}: ${await res.text()}`);
    return (await res.json()) as ScoreResponse;
}

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const [me] = await ethers.getSigners();
    const bookKey = (process.env.DEMO_BOOK ?? "bot").trim();
    const book = dep.books[bookKey];
    if (!book) throw new Error(`Unknown DEMO_BOOK "${bookKey}". Available: ${Object.keys(dep.books).join(", ")}`);

    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.shared.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.shared.CifraAttestationNFT);
    const controller = await ethers.getContractAt("CifraTrancheController", book.controller);
    const senior = await ethers.getContractAt("CifraTrancheVault", book.seniorVault);
    const junior = await ethers.getContractAt("CifraTrancheVault", book.juniorVault);
    const settlement = await ethers.getContractAt("CifraSettlement", book.settlement);
    // The native helper only exists on the wrapped-native book; a USDT demo approves directly.
    const isNative = Boolean(book.nativeDepositHelper);
    const helper = isNative ? await ethers.getContractAt("CifraNativeDepositHelper", book.nativeDepositHelper) : null;
    const token = new ethers.Contract(
        book.asset,
        [
            "function deposit() payable",
            "function approve(address,uint256) returns (bool)",
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
            "function symbol() view returns (string)",
        ],
        me
    );
    const dec = Number(await token.decimals());
    const sym = await token.symbol();

    const DEPOSIT = ethers.parseUnits((process.env.DEMO_DEPOSIT ?? "0.6").trim(), dec); // per tranche
    const FACE = ethers.parseUnits((process.env.DEMO_FACE ?? "0.5").trim(), dec);

    // Fail before spending anything if the pool could never cover the advance.
    if (DEPOSIT * 2n < (FACE * 9400n) / 10000n)
        throw new Error(
            `2 x DEMO_DEPOSIT (${fmt(DEPOSIT * 2n, dec)}) cannot cover the advance on a ` +
                `${fmt(FACE, dec)} invoice (~${fmt((FACE * 9400n) / 10000n, dec)}). Raise DEMO_DEPOSIT.`
        );

    const nav = async () => fmt(await controller.nav(), dec);
    const claims = async () =>
        `senior ${fmt(await controller.claimOf(book.seniorVault), dec)} / junior ${fmt(await controller.claimOf(book.juniorVault), dec)}`;

    console.log(`network ${network.name}  book ${bookKey.toUpperCase()} — ${sym} (${book.asset})`);
    console.log(`sizing  ${fmt(DEPOSIT, dec)} per tranche, ${fmt(FACE, dec)} invoice face`);
    console.log(`actor   ${me.address} (supplier = funder = keeper = buyer)`);

    const ver = await (await fetch(`${SCORER_URL}/version`)).json();
    console.log(`scorer  ${SCORER_URL}  model ${ver.modelVersion}  signer ${ver.scorerAddress}`);
    const onChainScorer = await attestation.scorerAddress();
    if (onChainScorer.toLowerCase() !== String(ver.scorerAddress).toLowerCase())
        throw new Error(`scorer mismatch: service signs as ${ver.scorerAddress}, contract expects ${onChainScorer}`);
    console.log(`        matches CifraAttestationNFT.scorerAddress() ✓\n`);

    // ── 0. Capitalize both tranches ──────────────────────────────────────────
    console.log(`0. FUND THE BOOK`);
    if (isNative) {
        await (await helper!.depositNative(book.seniorVault, me.address, { value: DEPOSIT })).wait();
        await (await helper!.depositNative(book.juniorVault, me.address, { value: DEPOSIT })).wait();
        console.log(`   deposited ${fmt(DEPOSIT, dec)} ${sym} into each tranche via the native helper`);
        // Wrap what the "buyer" will later need to repay invoice A.
        await (await token.deposit({ value: FACE })).wait();
    } else {
        for (const vault of [book.seniorVault, book.juniorVault]) {
            await (await token.approve(vault, DEPOSIT)).wait();
            const v = await ethers.getContractAt("CifraTrancheVault", vault);
            await (await v.deposit(DEPOSIT, me.address)).wait();
        }
        console.log(`   deposited ${fmt(DEPOSIT, dec)} ${sym} into each tranche`);
        const bal = await token.balanceOf(me.address);
        if (bal < FACE)
            throw new Error(`Need ${fmt(FACE, dec)} ${sym} left to pay the invoice; wallet holds ${fmt(bal, dec)}.`);
    }
    console.log(`   NAV ${await nav()}   claims: ${await claims()}\n`);

    // ── helper: register + attest + fund one invoice ──────────────────────────
    async function originate(label: string, dueDate: number) {
        const ref = ethers.keccak256(ethers.toUtf8Bytes(`${label}-${Date.now()}`));
        const commitment = ethers.keccak256(ethers.toUtf8Bytes(`buyer:${label}`));
        await (await registry.registerInvoice(commitment, FACE, dueDate, ref)).wait();
        const id = await registry.computeInvoiceId(me.address, commitment, FACE, dueDate, ref);
        console.log(`   registered ${label}  id ${id.slice(0, 18)}…  face ${fmt(FACE, dec)}  due ${new Date(dueDate * 1000).toISOString()}`);

        // Scored OFF-CHAIN by the service. The buyer's payment history goes to the scorer and
        // nowhere else — only the signed grade reaches the chain.
        const s = await requestScore(id, Math.max(1, Math.round((dueDate - Math.floor(Date.now() / 1000)) / 86400)));
        console.log(`   scored     grade ${s.score.grade}  risk ${s.score.riskScoreBps}bps  discount ${s.score.discountRateBps}bps  by ${s.scorer.slice(0, 10)}…`);
        console.log(`              model ${s.modelVersion}  image ${s.imageDigest.slice(0, 24)}…`);

        await (await attestation.attest(id, s.resultData, s.actionId, s.submissionTag, s.status, s.signature)).wait();
        const g = await attestation.gradeForInvoice(id);
        console.log(`   attested   ON-CHAIN VERIFY OK — Go signature accepted by Solidity ecrecover`);
        console.log(`              grade ${ethers.decodeBytes32String(g.grade)}  model ${ethers.decodeBytes32String(g.modelVersion)}  digest ${g.imageDigest.slice(0, 20)}…`);

        const principal = (FACE * (BPS - BigInt(g.discountRateBps))) / BPS;
        await (await controller.fundInvoice(id)).wait();
        console.log(`   funded     principal ${fmt(principal, dec)} advanced to supplier`);
        return { id, principal };
    }

    // ── 1. SETTLE PATH ────────────────────────────────────────────────────────
    console.log(`1. SETTLE PATH`);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const { id: idA, principal: principalA } = await originate("INV-PAY", now + 365 * 24 * 3600);
    console.log(`   NAV ${await nav()} (flat — funding moves capital, it does not create or destroy it)`);
    console.log(`   amountDue ${fmt(await settlement.amountDue(idA), dec)}  isDefaultable ${await settlement.isDefaultable(idA)}`);

    await (await token.approve(book.settlement, FACE)).wait();
    const payTx = await (await settlement.payInvoice(idA)).wait();
    console.log(`   payInvoice tx ${payTx!.hash}  gas ${payTx!.gasUsed}`);
    console.log(`   status ${(await registry.getInvoice(idA)).status} (3 = Settled)`);
    console.log(`   NAV ${await nav()}  (+${fmt(FACE - principalA, dec)} yield)   claims: ${await claims()}`);
    console.log(`   settlement resting balance ${fmt(await token.balanceOf(book.settlement), dec)} (atomic — nothing held)\n`);

    // ── 2. DEFAULT PATH ───────────────────────────────────────────────────────
    console.log(`2. DEFAULT PATH  (throwaway settlement with GRACE_PERIOD = 0 — see header)`);
    const tmp = await (await ethers.getContractFactory("CifraSettlement")).deploy(book.controller, 0);
    await tmp.waitForDeployment();
    const tmpAddr = await tmp.getAddress();
    await (await controller.setSettlement(tmpAddr)).wait();
    console.log(`   deployed ${tmpAddr} and repointed the controller at it`);

    const now2 = (await ethers.provider.getBlock("latest"))!.timestamp;
    const dueSoon = now2 + 30;
    const { id: idB, principal: principalB } = await originate("INV-DEF", dueSoon);
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
            ? `   SUBORDINATION HOLDS: junior absorbed the entire ${fmt(principalB, dec)} loss, senior untouched.`
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
