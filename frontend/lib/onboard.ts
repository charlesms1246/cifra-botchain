// Client-side construction of the Smart Accounts custom-instruction (0xFE) that turns one XRPL
// payment into a Cifra invoice registration owned by the supplier's PersonalAccount — the exact
// mechanism proven in scripts/registerViaSmartAccount.ts, rebuilt with viem so an XRPL-native
// supplier can do it in the browser with zero EVM wallet. viem-only (no xrpl) → SSR-safe.
import { encodeFunctionData, encodeAbiParameters, parseAbiParameters, parseUnits, keccak256, stringToBytes, type Hex } from "viem";

const USER_OP_COMPONENTS = [
  { name: "sender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "initCode", type: "bytes" },
  { name: "callData", type: "bytes" },
  { name: "accountGasLimits", type: "bytes32" },
  { name: "preVerificationGas", type: "uint256" },
  { name: "gasFees", type: "bytes32" },
  { name: "paymasterAndData", type: "bytes" },
  { name: "signature", type: "bytes" },
] as const;

const registerAbi = [{
  type: "function", name: "registerInvoice", stateMutability: "nonpayable",
  inputs: [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }], outputs: [{ type: "bytes32" }],
}] as const;

const executeUserOpAbi = [{
  type: "function", name: "executeUserOp", stateMutability: "payable",
  inputs: [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }],
  outputs: [],
}] as const;

const ZERO32 = ("0x" + "00".repeat(32)) as Hex;

// ── Invoice document + commitment ───────────────────────────────────────────
// The full invoice (buyer + line items + terms) lives ONLY in the browser and, later, as private
// TEE input. On-chain we store nothing but its keccak256 — the `buyerCommitment`. This binds the
// exact invoice that was factored (you can't swap what was financed) while revealing nothing:
// "commit to everything, disclose nothing." Face value is derived from the line items, so the
// on-chain amount is provably the sum of what's committed.

export type LineItem = { description: string; quantity: number; unitPrice: string }; // unitPrice = FXRP decimal string

export type InvoiceDoc = {
  buyer: string; // debtor name — private, never leaves the browser
  lineItems: LineItem[];
  terms: string; // e.g. "Net 30"
  issueDate: string; // ISO yyyy-mm-dd
  dueDate: number; // unix seconds (matches the on-chain dueDate)
  currency: "FXRP";
};

/** Face value (FXRP 6dp minor units) = Σ quantity × unitPrice, computed in integer units. */
export function invoiceFaceUnits(items: Pick<LineItem, "quantity" | "unitPrice">[]): bigint {
  return items.reduce((sum, it) => {
    const price = it.unitPrice.trim() === "" ? 0n : parseUnits(it.unitPrice.trim(), 6);
    const qty = BigInt(Math.max(0, Math.floor(Number(it.quantity) || 0)));
    return sum + price * qty;
  }, 0n);
}

/** Deterministic serialization of the committed fields — fixed key order, trimmed. Versioned so
 *  the commitment scheme can evolve without ambiguity. Never sent on-chain (only its hash is). */
export function canonicalInvoice(doc: InvoiceDoc): string {
  return JSON.stringify({
    v: 1,
    buyer: doc.buyer.trim(),
    lineItems: doc.lineItems.map((li) => ({ description: li.description.trim(), quantity: Math.floor(Number(li.quantity) || 0), unitPrice: li.unitPrice.trim() })),
    terms: doc.terms.trim(),
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    currency: doc.currency,
  });
}

/** The on-chain `buyerCommitment` — keccak256 of the canonical full invoice document. */
export const invoiceCommitment = (doc: InvoiceDoc): Hex => keccak256(stringToBytes(canonicalInvoice(doc)));

/** A supplier-chosen ref/salt that distinguishes otherwise-identical invoices. */
export const refOf = (s: string): Hex => keccak256(stringToBytes(s));

export type OnboardParams = {
  personalAccount: Hex;
  nonce: bigint;
  registry: Hex;
  buyerCommitment: Hex;
  faceAmount: bigint; // FXRP smallest units (6dp)
  dueDate: bigint; // unix seconds
  ref: Hex;
};

export type OnboardInstruction = {
  memoHex: string; // 42-byte 0xFE memo, uppercase hex (no 0x) — goes in the XRPL Memo.MemoData
  userOpData: Hex; // abi-encoded PackedUserOperation — the executor passes this to executeDirectMintingWithData
  invoiceId: Hex; // deterministic id the PersonalAccount will register
};

/** Build the 0xFE memo + userOp bytes + predicted invoiceId for an onboarding payment. */
export function buildOnboardInstruction(p: OnboardParams): OnboardInstruction {
  const registerData = encodeFunctionData({ abi: registerAbi, functionName: "registerInvoice", args: [p.buyerCommitment, p.faceAmount, p.dueDate, p.ref] });
  const callData = encodeFunctionData({ abi: executeUserOpAbi, functionName: "executeUserOp", args: [[{ target: p.registry, value: 0n, data: registerData }]] });

  const userOpData = encodeAbiParameters(
    [{ type: "tuple", components: USER_OP_COMPONENTS }],
    [{ sender: p.personalAccount, nonce: p.nonce, initCode: "0x", callData, accountGasLimits: ZERO32, preVerificationGas: 0n, gasFees: ZERO32, paymasterAndData: "0x", signature: "0x" }]
  );
  const userOpHash = keccak256(userOpData);

  // memo = [0xFE][walletId=00][executorFeeUBA:uint64=0][userOpHash:32] = 42 bytes
  const memoHex = ("FE" + "00" + (0n).toString(16).padStart(16, "0") + userOpHash.slice(2)).toUpperCase();
  if (memoHex.length !== 84) throw new Error(`memo not 42 bytes: ${memoHex.length / 2}`);

  // invoiceId = keccak256(abi.encode(supplier, buyerCommitment, faceAmount, dueDate, ref)) — matches the registry.
  const invoiceId = keccak256(encodeAbiParameters(
    parseAbiParameters("address, bytes32, uint256, uint64, bytes32"),
    [p.personalAccount, p.buyerCommitment, p.faceAmount, p.dueDate, p.ref]
  ));

  return { memoHex, userOpData, invoiceId };
}
