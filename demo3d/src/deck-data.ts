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

/* ── addresses, for the scenes that name a mechanism ────────────────────
   Editorial rule: an address goes on a plate that says WHICH CONTRACT DOES
   THIS. It never goes on a plate asserting an operational status — an
   address under "RESTRICTED" would imply that address is currently
   restricted, which is a claim about state rather than about mechanism.

   All of these are derived from the deployment record, so a redeploy moves
   them and no scene needs editing. `shortAddr` is the display form; the full
   value stays available for the S7 index. */

export const addr = {
  registry: deployment.shared.CifraInvoiceRegistry,
  attestation: deployment.shared.CifraAttestationNFT,
  funderRegistry: deployment.shared.CifraFunderRegistry,
  botController: b.bot.controller,
  botSenior: b.bot.seniorVault,
  botJunior: b.bot.juniorVault,
  botSettlement: b.bot.settlement,
  navOracle: b.bot.navOracle,
  helper: b.bot.nativeDepositHelper,
  usdtController: b.usdt.controller,
  usdtSenior: b.usdt.seniorVault,
  usdtJunior: b.usdt.juniorVault,
  usdtSettlement: b.usdt.settlement,
} as const;

/** The scoring key the attestation contract checks signatures against. */
export const scorerAddr: string = deployment.config.scorerAddress;

/* The container that signed the mainnet grades. NOT in any machine-readable
   file — read from the mainnet scorer's /version on 2026-08-22 and confirmed
   against the Cloud Run revision. S2 and S3 both display it, so it lives here
   once: a digest typed into two scenes is a digest that drifts between them.
   Re-read /version and update this if the service is redeployed. */
export const imageDigest =
  "sha256:6c25f142c0e0837213cfbb9d6e0bf45b9498aa7a07e0b98e357fb4828e79cbff";

/** SHA256:6C25…CBFF — enough to check against the published image. */
export const shortDigest = (d: string = imageDigest): string => {
  const hex = d.includes(":") ? d.slice(d.indexOf(":") + 1) : d;
  return `SHA256:${hex.slice(0, 4).toUpperCase()}…${hex.slice(-4).toUpperCase()}`;
};

export const contractCount =
  Object.keys(deployment.shared).length +
  Object.values(b).reduce((n, book) => n + Object.keys(book).length - 1, 0);

/* The NAV oracle's reading, for S4's display-only panel. NOT derived — it is
   a live TWAP and there is no build-time way to read one. Taken from the
   mainnet oracle on 2026-08-22: `checkDeploy` printed mean tick 253588,
   which through frontend/lib/price.ts is $9.71/BOT — within 1% of
   CoinGecko's $9.61 and the explorer's own 9.7102 the same day.

   It goes stale, and that is the point the panel makes: nothing economic
   reads this number, so a stale or manipulated one is a wrong figure on a
   dashboard rather than an exploit. Do not wire it to anything. */
export const navPriceUsd = "9.71";

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
   The caveat list used to live here and render as S7's third panel. It now
   lives in docs/HONEST_DISCLOSURES.md, linked from the README, and that file
   is the single source — a second copy here would be a copy that drifts, and
   the disclosure is the one thing that must not.
   S2's caveat plate ("WE OPERATE THIS ROOM") is unaffected and stays: it is
   bolted to the scoring room and it is the disclosure the thesis scene
   depends on. */

/* ── governance ─────────────────────────────────────────────────────────
   The Safe is not in deployment.json, so it is typed here from
   DEPLOYMENT_MAINNET.md. Everything else on this line was read back off
   chain 677 on 2026-08-22: threshold 2, three owners, and six of the seven
   owner-bearing contracts holding the Safe as `owner`. */
export const govSafe = "0x73DFfa09B08458F924bc26fd786fC6FDf481B4b8";
export const govThreshold = 2;
export const govOwners = 3;
/* The 2-of-3 execute path, proven on mainnet BEFORE ownership transferred:
   two signatures gathered, status 1, at block 20,532,427. The transfers ran
   at 20,532,460-470, so "executed before the handover" is checkable rather
   than asserted. The parameter S6 shows changing is illustrative — this hash
   is the real transaction the scene's caption refers to. */
export const govSafeTx =
  "0x541cbcd5bb8f8bdab65ce9dc621324168168c949f88cf74434626da6d6d7e1e7";

/** 0x541cbcd5…d7e1e7 — a tx hash is longer than an address; trim harder. */
export const shortTx = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Contracts whose `owner()` is the Safe, read back off chain 2026-08-22. */
export const govHeld: Row[] = [
  { label: "INVOICE REGISTRY", value: shortAddr(addr.registry) },
  { label: "ATTESTATION NFT", value: shortAddr(addr.attestation) },
  { label: "BOT CONTROLLER", value: shortAddr(addr.botController) },
  { label: "BOT SETTLEMENT", value: shortAddr(addr.botSettlement) },
  { label: "USDT CONTROLLER", value: shortAddr(addr.usdtController) },
  { label: "USDT SETTLEMENT", value: shortAddr(addr.usdtSettlement) },
];
/** And the one that is not. Reads its owner as the deployer key. */
export const govPending: Row = {
  label: "FUNDER REGISTRY",
  value: shortAddr(addr.funderRegistry),
};

/** Every deployed contract, for S7's index panel. Order follows the deck. */
export const contractIndex: Row[] = [
  { label: "INVOICE REGISTRY", value: shortAddr(addr.registry) },
  { label: "FUNDER REGISTRY", value: shortAddr(addr.funderRegistry) },
  { label: "ATTESTATION NFT", value: shortAddr(addr.attestation) },
  { label: "BOT CONTROLLER", value: shortAddr(addr.botController) },
  { label: "BOT SENIOR", value: shortAddr(addr.botSenior) },
  { label: "BOT JUNIOR", value: shortAddr(addr.botJunior) },
  { label: "BOT SETTLEMENT", value: shortAddr(addr.botSettlement) },
  { label: "NAV ORACLE", value: shortAddr(addr.navOracle) },
  { label: "DEPOSIT HELPER", value: shortAddr(addr.helper) },
  { label: "USDT CONTROLLER", value: shortAddr(addr.usdtController) },
  { label: "USDT SENIOR", value: shortAddr(addr.usdtSenior) },
  { label: "USDT JUNIOR", value: shortAddr(addr.usdtJunior) },
  { label: "USDT SETTLEMENT", value: shortAddr(addr.usdtSettlement) },
  { label: "GOVERNANCE SAFE", value: shortAddr(govSafe) },
];
