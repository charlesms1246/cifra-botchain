import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Score ONE already-registered invoice and attest the signed grade on chain.
//
//   INVOICE_ID=0x… SCORER_URL=<url> SCORER_AUTH_TOKEN=$(gcloud auth print-identity-token) \
//     npx hardhat run scripts/scoreAndAttest.ts --network botchain
//
// This is the step the UI deliberately does not have. `/onboard` registers an invoice and
// `/invoice/[id]` reads the grade back, but nothing in the browser scores one — the buyer's
// payment history goes to the scoring service and nowhere else, and the service signs with a
// key that exists only inside it. So a registered invoice sits UNSCORED, and
// `Fund this invoice` stays disabled, until a keeper runs this.
//
// `e2eLifecycle.ts` does the same two calls inside a full register → … → settle run, which is
// the wrong shape for a live demo: it drives the whole loop headlessly and leaves nothing for
// the browser to do. This does exactly the keeper's part and stops.
//
// Env:
//   INVOICE_ID         required — the bytes32 id, from /onboard or the registry event
//   SCORER_URL         required — the scoring service for THIS chain
//   SCORER_AUTH_TOKEN  required for a private Cloud Run service (403 without it)
//   TENOR_DAYS         optional — defaults to the invoice's own due date, which is what you want

/** Treats "" as unset. `??` does not: an empty string from .env.example flows straight through
 *  and fails deep inside ethers as an ENS lookup. See ERRORS.md T15. */
const env = (key: string): string | undefined => {
    const v = process.env[key];
    return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
};

const SCORER_URL = (env("SCORER_URL") ?? "").replace(/\/$/, "");
const authHeaders: Record<string, string> = env("SCORER_AUTH_TOKEN")
    ? { Authorization: `Bearer ${env("SCORER_AUTH_TOKEN")}` }
    : {};

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

const ZERO = "0x0000000000000000000000000000000000000000";

async function main(): Promise<void> {
    const invoiceId = env("INVOICE_ID");
    if (!invoiceId) throw new Error("Set INVOICE_ID to the bytes32 id of a registered invoice.");
    if (!/^0x[0-9a-fA-F]{64}$/.test(invoiceId))
        throw new Error(`INVOICE_ID must be a 32-byte hex string; got ${JSON.stringify(invoiceId)}`);
    if (!SCORER_URL) throw new Error("Set SCORER_URL to the scoring service for this chain.");

    const depFile = path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`);
    if (!fs.existsSync(depFile)) throw new Error(`No deployment record at ${depFile}`);
    const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));

    const [me] = await ethers.getSigners();
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.shared.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.shared.CifraAttestationNFT);

    console.log(`network ${network.name} (chainId ${chainId})`);
    console.log(`keeper  ${me.address}`);
    console.log(`invoice ${invoiceId}\n`);

    // ── the invoice must exist, and must not already carry a grade ───────────
    if (!(await registry.exists(invoiceId)))
        throw new Error(`Invoice ${invoiceId} is not in the registry on ${network.name}.`);
    const inv = await registry.getInvoice(invoiceId);
    const dueDate = Number(inv.dueDate);
    console.log(`  supplier   ${inv.supplier}`);
    console.log(`  face       ${inv.faceAmount}`);
    console.log(`  due        ${new Date(dueDate * 1000).toISOString()}`);
    console.log(`  status     ${inv.status}`);

    const existing = await attestation.gradeForInvoice(invoiceId);
    if (existing.scorerSigner !== ZERO) {
        console.log(
            `\nAlready attested — grade ${ethers.decodeBytes32String(existing.grade)}, ` +
                `discount ${existing.discountRateBps}bps, signed by ${existing.scorerSigner}.`
        );
        console.log("Nothing to do. A grade cannot be replaced; register a new invoice instead.");
        return;
    }

    // attest() is attester-gated. Failing here with a clear message beats an opaque revert.
    const attester = await attestation.attester();
    if (attester.toLowerCase() !== me.address.toLowerCase())
        throw new Error(
            `attest() is attester-only. The contract's attester is ${attester}, ` +
                `this signer is ${me.address}.`
        );

    // ── the service must be the one this contract trusts, on THIS chain ──────
    // CHAIN_ID is signed into every grade, so a scorer deployed for another network produces
    // signatures that revert with BadScorerSignature — a failure that looks like a key
    // mismatch and is not one. Both checks are cheap; the confusion is not.
    const verRes = await fetch(`${SCORER_URL}/version`, { headers: authHeaders });
    if (!verRes.ok)
        throw new Error(
            `scorer /version returned ${verRes.status}. If it is a private Cloud Run service, set ` +
                `SCORER_AUTH_TOKEN=$(gcloud auth print-identity-token).`
        );
    const ver = await verRes.json();
    console.log(`\nscorer  ${SCORER_URL}`);
    console.log(`        model ${ver.modelVersion}  chainId ${ver.chainId}  image ${String(ver.imageDigest || "(unpinned)").slice(0, 26)}…`);
    console.log(`        signer ${ver.scorerAddress}`);
    if (Number(ver.chainId) !== chainId)
        throw new Error(`scorer signs for chainId ${ver.chainId}, but this network is ${chainId}`);
    const onChainScorer = await attestation.scorerAddress();
    if (onChainScorer.toLowerCase() !== String(ver.scorerAddress).toLowerCase())
        throw new Error(`scorer mismatch: service signs as ${ver.scorerAddress}, contract expects ${onChainScorer}`);
    console.log(`        matches CifraAttestationNFT.scorerAddress() ✓`);

    // ── score ────────────────────────────────────────────────────────────────
    // Tenor comes from the invoice's own due date rather than a flag, so the grade reflects the
    // receivable that was actually registered. The rest of the input is the same synthetic
    // buyer history e2eLifecycle uses — see HONEST_DISCLOSURES.md: invoices are synthetic.
    const tenorDays = env("TENOR_DAYS")
        ? Number(env("TENOR_DAYS"))
        : Math.max(1, Math.round((dueDate - Math.floor(Date.now() / 1000)) / 86400));
    if (!Number.isFinite(tenorDays) || tenorDays < 1)
        throw new Error(`TENOR_DAYS must be a positive integer; got ${JSON.stringify(env("TENOR_DAYS"))}`);

    console.log(`\nscoring (tenor ${tenorDays} days)…`);
    const res = await fetch(`${SCORER_URL}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
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
    const s = (await res.json()) as ScoreResponse;
    console.log(`  grade ${s.score.grade}  risk ${s.score.riskScoreBps}bps  discount ${s.score.discountRateBps}bps`);
    console.log(`  signed by ${s.scorer}`);

    // ── attest ───────────────────────────────────────────────────────────────
    console.log(`\nattesting…`);
    const tx = await attestation.attest(invoiceId, s.resultData, s.actionId, s.submissionTag, s.status, s.signature);
    const rcpt = await tx.wait();
    if (rcpt?.status !== 1) throw new Error(`attest() reverted (tx ${tx.hash})`);

    // Read the grade back rather than inferring success from the receipt — the same reason
    // transferOwnershipToGov.ts reads ownership back instead of trusting its own transaction.
    const g = await attestation.gradeForInvoice(invoiceId);
    if (g.scorerSigner === ZERO) throw new Error("attest() mined but no grade is recorded — refusing to report success.");

    console.log(`  tx ${tx.hash}  gas ${rcpt.gasUsed}`);
    console.log(`  ON-CHAIN VERIFY OK — Go signature accepted by Solidity ecrecover`);
    console.log(`  grade ${ethers.decodeBytes32String(g.grade)}  risk ${g.riskScoreBps}bps  discount ${g.discountRateBps}bps`);
    console.log(`  model ${ethers.decodeBytes32String(g.modelVersion)}  digest ${g.imageDigest}`);
    console.log(`\nThis invoice is now scored and attested — the operator's Fund button is live.`);
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
