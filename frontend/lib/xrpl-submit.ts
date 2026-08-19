// Client-only XRPL testnet helpers: fund a fresh supplier wallet and submit the onboarding
// Payment (carrying the 0xFE memo) to the FAssets Core Vault. Imports xrpl — only ever
// dynamically imported from a client component so it never hits SSR/build server code.
import { Client, Wallet, xrpToDrops } from "xrpl";

const TESTNET_WSS = "wss://s.altnet.rippletest.net:51233";

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(TESTNET_WSS);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.disconnect();
  }
}

/** Fund a brand-new XRPL testnet wallet (a zero-prior-state, XRPL-native supplier). */
export async function fundTestnetWallet(): Promise<{ address: string; seed: string }> {
  return withClient(async (c) => {
    const { wallet } = await c.fundWallet();
    return { address: wallet.address, seed: wallet.seed! };
  });
}

/** Current XRP balance of an address (0 if unfunded). */
export async function xrpBalance(address: string): Promise<number> {
  return withClient(async (c) => Number(await c.getXrpBalance(address).catch(() => 0)));
}

/**
 * Submit the onboarding Payment: supplier -> Core Vault, carrying the 42-byte 0xFE memo.
 * No DestinationTag (that would misroute the FAssets mint). Returns the XRPL tx hash.
 */
export async function submitOnboardPayment(opts: {
  seed: string;
  coreVault: string;
  amountXrp: string;
  memoHex: string; // uppercase hex, no 0x
}): Promise<{ hash: string; result: string }> {
  const wallet = Wallet.fromSeed(opts.seed);
  return withClient(async (c) => {
    const prepared = await c.autofill({
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: opts.coreVault,
      Amount: xrpToDrops(opts.amountXrp),
      Memos: [{ Memo: { MemoData: opts.memoHex } }],
    } as Parameters<Client["autofill"]>[0]);
    const res = await c.submitAndWait(prepared, { wallet });
    const meta = res.result.meta as { TransactionResult?: string } | undefined;
    return { hash: res.result.hash as string, result: meta?.TransactionResult ?? "unknown" };
  });
}
