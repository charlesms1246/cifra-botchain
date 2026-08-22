/* The numbers on S6's proof plate.
   ─────────────────────────────────────────────────────────────────────────
   THIS IS THE FILE TO EDIT WHEN MAINNET LANDS. Nothing else in the deck
   carries a deployment fact.

   The CONTRACT SET is imported live from frontend/lib/deployment.json, so
   the plate follows the deployment record automatically — including the
   network label, which is derived from chainId rather than typed. When
   MAINNET_RUNBOOK.md has run and that file is re-synced to chain 677, the
   plate says mainnet by itself and cannot say it before. PLAN.md §5 S6 and
   §7 both turn on that not being a thing a person has to remember.

   The VERIFICATION RESULTS below are not in any machine-readable file — they
   are the outcomes of suites and live rehearsals — so they are typed here,
   once, with their source named. Re-run each against mainnet and update the
   value AND the `ran` label when you do.

   The caveat list names what is NOT true. It does not name features the
   product never shipped: BOT Chain devrel asked that the deck stop
   referencing things that were not carried over, so the line that used to
   read "no hardware attestation" now states the positive fact it was there
   to qualify — we operate the scorer — and leaves the absent thing unnamed.
   Nothing was softened: "we operate the scorer" is the whole disclosure,
   and it is what a reader has to know. */

import deployment from "../../frontend/lib/deployment.json";

const CHAIN_LABEL: Record<number, string> = {
  677: "BOT CHAIN MAINNET",
  968: "BOT CHAIN TESTNET",
};

export const chainId: number = deployment.chainId;
export const networkLabel = CHAIN_LABEL[chainId] ?? `CHAIN ${chainId}`;
export const isMainnet = chainId === 677;

/** 0x1234…abcd — enough to check against an explorer, short enough to read. */
export const shortAddr = (a: string): string =>
  a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

export interface Row { label: string; value: string }

const b = deployment.books as Record<string, Record<string, string>>;

export const contracts: Row[] = [
  { label: "REGISTRY", value: shortAddr(deployment.shared.CifraInvoiceRegistry) },
  { label: "ATTESTATION", value: shortAddr(deployment.shared.CifraAttestationNFT) },
  { label: "FUNDER REGISTRY", value: shortAddr(deployment.shared.CifraFunderRegistry) },
  { label: "BOT CONTROLLER", value: shortAddr(b.bot.controller) },
  { label: "BOT SENIOR", value: shortAddr(b.bot.seniorVault) },
  { label: "BOT JUNIOR", value: shortAddr(b.bot.juniorVault) },
  { label: "BOT SETTLEMENT", value: shortAddr(b.bot.settlement) },
  { label: "USDT CONTROLLER", value: shortAddr(b.usdt.controller) },
];

export const contractCount =
  Object.keys(deployment.shared).length +
  Object.values(b).reduce((n, book) => n + Object.keys(book).length - 1, 0);

export const graceDays = Math.round((deployment.config.gracePeriodSeconds ?? 0) / 86400);

/* ── verification results ───────────────────────────────────────────────
   Each line names where it came from. `ran` is the network it was measured
   on — NOT necessarily `networkLabel` above, and the plate says so. Do not
   silently promote a testnet figure by editing the label. */

export interface Result { label: string; value: string; ran: string }

/* Re-measured against mainnet 677 on 2026-08-22 — SESSION_CLOSURE.md
   "Proven live on mainnet". Six rows is the panel's capacity; the local
   suite and the fork suite share a line so the de-listed-redemption proof
   keeps its own, because S5 spends eight seconds on that beat and evidence
   for a beat the deck dramatises is worth more than a second test count.
   That row is still TESTNET and still says so. */
export const results: Result[] = [
  { label: "CHECKDEPLOY", value: "49 PASS / 0 FAIL", ran: "MAINNET 677, LIVE" },
  { label: "UNIT + FORK", value: "117 + 11 PASSING", ran: "LOCAL + MAINNET FORK" },
  { label: "SETTLE", value: "GRADE B · NAV 0.04 → 0.0416", ran: "MAINNET 677, BOT + USDT" },
  { label: "DEFAULT", value: "GRADE A · SENIOR UNTOUCHED", ran: "MAINNET 677, BOT + USDT" },
  { label: "GOVERNANCE", value: "REAL 2-OF-3 SAFE TX", ran: "MAINNET 677, LIVE" },
  { label: "ALLOWLIST", value: "DE-LISTED, STILL REDEEMED", ran: "TESTNET 968" },
];

/* What the mainnet default actually did to the junior tranche, as a fraction
   of where it started: BOT 0.0208 → 0.002, USDT 0.52 → 0.05. Both 9.6%.
   S5 drains its junior basin to exactly this and no further — the waterfall
   has to match the measurement (§7 rule 5), and "wiped to zero" is the
   nicer picture rather than the true one. */
export const juniorLeftAfterDefault = 0.096;

/* ── what is not true yet ───────────────────────────────────────────────
   PLAN.md §7 rule 6. These go on screen at the SAME size and weight as the
   results, because a reviewer who finds one of them themselves discounts
   every figure on the other panel. Sourced from SESSION_CLOSURE.md's
   "Known-open, deliberately" list — if that list changes, change this. */

export const caveats: string[] = [
  "INVOICES ARE SYNTHETIC",
  "WE OPERATE THE SCORER",
  "UNAUDITED · NO TIMELOCK ON THE SAFE",
  "THE FUNDER ALLOWLIST SHIPS OPEN",
  "THE MAINNET DEFAULT RUN USED A GRACE=0 SETTLEMENT",
];

/* ── governance ─────────────────────────────────────────────────────────
   The Safe is not in deployment.json, so it is typed here from
   DEPLOYMENT_MAINNET.md. Everything else on this line was read back off
   chain 677 on 2026-08-22: threshold 2, three owners, and six of the seven
   owner-bearing contracts holding the Safe as `owner`. */
export const govSafe = "0x73DFfa09B08458F924bc26fd786fC6FDf481B4b8";
export const govThreshold = 2;
export const govOwners = 3;
/** Contracts whose `owner()` is the Safe, verified on chain. */
export const govHeld: string[] = [
  "INVOICE REGISTRY",
  "ATTESTATION NFT",
  "BOT CONTROLLER",
  "BOT SETTLEMENT",
  "USDT CONTROLLER",
  "USDT SETTLEMENT",
];
/** And the one that is not. Reads its owner as the deployer key. */
export const govPending = "FUNDER REGISTRY";
