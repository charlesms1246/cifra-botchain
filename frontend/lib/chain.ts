import { defineChain } from "viem";
import deployment from "./deployment.json";

// BOT Chain is absent from ethereum-lists/chains, so viem has no built-in definition and these
// are hand-written. Verified against the live RPCs on 2026-08-20.

/** BOT Chain mainnet. */
export const botchain = defineChain({
  id: 677,
  name: "BOT Chain",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.botchain.ai"] } },
  blockExplorers: { default: { name: "BOT Scan", url: "https://scan.botchain.ai" } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

/** BOT Chain testnet. Note the `bohr.life` domain — there is no `*.botchain.ai` testnet host. */
export const botchainTestnet = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.bohr.life"] } },
  blockExplorers: { default: { name: "BOHR Scan", url: "https://scan.bohr.life" } },
  // Multicall3 is genuinely NOT deployed on 968. Declaring it would make wagmi batch every
  // read into a call to an empty address and fail the whole page.
  testnet: true,
});

export const CHAINS = { 677: botchain, 968: botchainTestnet } as const;

/** The chain this build talks to, taken from the synced deployment record.
 *
 *  Deliberately throws on an unrecognised chainId rather than defaulting. A record from another
 *  chain — a local dry run, say — would otherwise leave the app quietly reading addresses that
 *  do not exist on the chain it is talking to: every call succeeds, every value is zero, and
 *  nothing anywhere says why. A failed build is much easier to diagnose. */
function resolveChain() {
  const c = CHAINS[deployment.chainId as 677 | 968];
  if (!c) {
    throw new Error(
      `frontend/lib/deployment.json has chainId ${deployment.chainId}, which is not a BOT Chain ` +
        `network (677 mainnet / 968 testnet). Re-sync it: ` +
        `NETWORK=botchainTestnet npx ts-node scripts/syncFrontendDeployment.ts`
    );
  }
  return c;
}

export const activeChain = resolveChain();

export const EXPLORER = activeChain.blockExplorers!.default.url;
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
export const tokenUrl = (addr: string) => `${EXPLORER}/token/${addr}`;
