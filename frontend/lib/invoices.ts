import { EXPLORER } from "./chain";
import { SHARED } from "./books";

// InvoiceRegistered(bytes32 indexed invoiceId, address indexed supplier,
//                   bytes32 indexed buyerCommitment, uint256 faceAmount, uint64 dueDate)
const TOPIC0 = "0x79f69813c93babeab2d967dcc97aadba9faebeae3eeab2c15c11ddf13873a1c9";

export type ChainInvoice = {
  id: `0x${string}`;
  supplier: `0x${string}`;
  buyerCommitment: `0x${string}`;
  faceAmount: bigint;
  dueDate: number;
};

/**
 * Enumerate registered invoices through the Blockscout explorer rather than eth_getLogs.
 *
 * BOT Chain's docs state that eth_getLogs is disabled on the public mainnet RPC. It does in fact
 * work today, but building on undocumented behaviour that the operator has said is off would be
 * asking for an outage. Blockscout indexes the same logs and is the supported path.
 */
export async function fetchRegisteredInvoices(fromBlock = 0): Promise<ChainInvoice[]> {
  const url =
    `${EXPLORER}/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=latest` +
    `&address=${SHARED.registry}&topic0=${TOPIC0}`;

  const res = await fetch(url);
  if (!res.ok) return [];
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
