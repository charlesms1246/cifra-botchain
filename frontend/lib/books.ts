import deployment from "./deployment.json";

// Cifra runs the whole stack once per settlement asset — "a book". An invoice is faced, funded
// and repaid in the same token and nothing converts between them, which is what keeps FX risk
// out of the loan book. The UI mirrors that: you are always looking at exactly one book.

export type BookKey = "bot" | "usdt";

export type Book = {
  key: BookKey;
  label: string;
  /** Symbol shown to users. For the native book this is BOT, even though the asset is WBOT. */
  symbol: string;
  decimals: number;
  asset: `0x${string}`;
  controller: `0x${string}`;
  seniorVault: `0x${string}`;
  juniorVault: `0x${string}`;
  settlement: `0x${string}`;
  navOracle?: `0x${string}`;
  /** Present only on the wrapped-native book: enables one-transaction BOT in/out. */
  nativeDepositHelper?: `0x${string}`;
  /** True when deposits/withdrawals can use native currency via the helper. */
  isNative: boolean;
  blurb: string;
};

const META: Record<BookKey, { label: string; symbol: string; decimals: number; blurb: string }> = {
  // Native first — BOT takes precedence throughout the UI.
  bot: {
    label: "BOT",
    symbol: "BOT",
    decimals: 18,
    blurb: "Native BOT. Invoices are faced, funded and repaid in BOT, so you hold BOT-denominated exposure.",
  },
  usdt: {
    label: "USDT",
    symbol: "USDT",
    decimals: 6,
    blurb: "Dollar-denominated. Invoices are faced, funded and repaid in USDT — no currency exposure.",
  },
};

export const SHARED = {
  registry: deployment.shared.CifraInvoiceRegistry as `0x${string}`,
  attestation: deployment.shared.CifraAttestationNFT as `0x${string}`,
};

export const DEPLOYMENT = {
  chainId: deployment.chainId as number,
  network: deployment.network as string,
  scorer: deployment.config.scorerAddress as `0x${string}`,
  operator: deployment.config.operator as `0x${string}`,
  gracePeriodDays: Math.round((deployment.config.gracePeriodSeconds ?? 0) / 86400),
  wrappedNative: deployment.external.wrappedNative as `0x${string}`,
};

type DeployedBook = {
  asset: string;
  controller: string;
  seniorVault: string;
  juniorVault: string;
  settlement: string;
  navOracle?: string;
  nativeDepositHelper?: string;
};

export const BOOKS: Book[] = (Object.keys(META) as BookKey[])
  .filter((k) => (deployment.books as Record<string, unknown>)[k])
  .map((key) => {
    const b = (deployment.books as unknown as Record<string, DeployedBook>)[key];
    return {
      key,
      ...META[key],
      asset: b.asset as `0x${string}`,
      controller: b.controller as `0x${string}`,
      seniorVault: b.seniorVault as `0x${string}`,
      juniorVault: b.juniorVault as `0x${string}`,
      settlement: b.settlement as `0x${string}`,
      navOracle: b.navOracle as `0x${string}` | undefined,
      nativeDepositHelper: b.nativeDepositHelper as `0x${string}` | undefined,
      isNative: Boolean(b.nativeDepositHelper),
      blurb: META[key].blurb,
    };
  });

export const defaultBook = BOOKS[0];
export const bookByKey = (k: string): Book => BOOKS.find((b) => b.key === k) ?? defaultBook;

/** The two tranche share classes within a book. */
export const tranches = (book: Book) =>
  [
    {
      key: "senior" as const,
      label: "Senior",
      vault: book.seniorVault,
      accent: false,
      blurb: "Protected — junior absorbs losses first. Takes 50% of each invoice's yield.",
    },
    {
      key: "junior" as const,
      label: "Junior",
      vault: book.juniorVault,
      accent: true,
      blurb: "First-loss — absorbs defaults before senior. Keeps the residual 50% of yield.",
    },
  ];
