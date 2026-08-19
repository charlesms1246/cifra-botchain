import { EXPLORER } from "./chain";
import { CONTRACTS } from "./contracts";

// InvoiceRegistered(bytes32 indexed invoiceId, address indexed supplier,
//                   bytes32 indexed buyerCommitment, uint256 faceAmount, uint64 dueDate)
const TOPIC0 = "0x79f69813c93babeab2d967dcc97aadba9faebeae3eeab2c15c11ddf13873a1c9";
const FROM_BLOCK = 33_610_000; // ~ tranche registry deploy (0xa74Ac3…)

export type ChainInvoice = {
  id: `0x${string}`;
  supplier: `0x${string}`;
  buyerCommitment: `0x${string}`;
  faceAmount: bigint;
  dueDate: number;
};

/**
 * Enumerate real registered invoices via the Coston2 Blockscout explorer API (the indexer) —
 * the public RPC caps eth_getLogs at ~30 blocks, so we read the indexed logs instead.
 */
export async function fetchRegisteredInvoices(): Promise<ChainInvoice[]> {
  const url =
    `${EXPLORER}/api?module=logs&action=getLogs&fromBlock=${FROM_BLOCK}&toBlock=latest` +
    `&address=${CONTRACTS.registry}&topic0=${TOPIC0}`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.status !== "1" || !Array.isArray(j.result)) return [];
  return (j.result as { topics: string[]; data: string }[])
    .map((r) => {
      const data = r.data.slice(2);
      return {
        id: r.topics[1] as `0x${string}`,
        supplier: ("0x" + r.topics[2].slice(-40)) as `0x${string}`,
        buyerCommitment: r.topics[3] as `0x${string}`,
        faceAmount: BigInt("0x" + data.slice(0, 64)),
        dueDate: Number(BigInt("0x" + data.slice(64, 128))),
      };
    })
    .reverse(); // newest first
}
