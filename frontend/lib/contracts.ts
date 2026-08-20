// Minimal ABIs for exactly what the UI reads and writes. Addresses live in lib/books.ts, which
// is generated from the deployment record — never hardcode one here, and never share an address
// across networks (the mainnet USDT address is a different token on testnet).

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export const vaultAbi = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "convertToAssets", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "previewDeposit", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "assets" }, { type: "address", name: "receiver" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "shares" }, { type: "address", name: "receiver" }, { type: "address", name: "owner" }], outputs: [{ type: "uint256" }] },
] as const;

export const controllerAbi = [
  { type: "function", name: "nav", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDeployed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "seniorYieldShareBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "ASSET", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fundInvoice", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  {
    type: "function",
    name: "fundingOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { type: "address", name: "supplier" },
      { type: "uint256", name: "faceAmount" },
      { type: "uint256", name: "principal" },
      { type: "uint64", name: "dueDate" },
      { type: "uint8", name: "status" },
    ],
  },
] as const;

// One-transaction native BOT in/out. Deposit is payable; redeem needs a prior share approval.
export const nativeHelperAbi = [
  { type: "function", name: "depositNative", stateMutability: "payable", inputs: [{ type: "address", name: "vault" }, { type: "address", name: "receiver" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "redeemToNative", stateMutability: "nonpayable", inputs: [{ type: "address", name: "vault" }, { type: "uint256", name: "shares" }, { type: "address", name: "receiver" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "WRAPPED", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const registryAbi = [
  {
    type: "function",
    name: "getInvoice",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "address", name: "supplier" },
          { type: "bytes32", name: "buyerCommitment" },
          { type: "uint256", name: "faceAmount" },
          { type: "uint64", name: "dueDate" },
          { type: "uint8", name: "status" },
        ],
      },
    ],
  },
  { type: "function", name: "exists", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "registerInvoice", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "computeInvoiceId", stateMutability: "pure", inputs: [{ type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }], outputs: [{ type: "bytes32" }] },
] as const;

// Grade carries modelVersion + imageDigest: the scorer signs which code produced the number, so
// a reviewer can pull that image and recompute it. Keep this tuple in sync with the contract.
export const attestationAbi = [
  {
    type: "function",
    name: "gradeForInvoice",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "bytes32", name: "grade" },
          { type: "uint32", name: "riskScoreBps" },
          { type: "uint32", name: "discountRateBps" },
          { type: "address", name: "scorerSigner" },
          { type: "bytes32", name: "modelVersion" },
          { type: "bytes32", name: "imageDigest" },
        ],
      },
    ],
  },
  { type: "function", name: "isAttested", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "scorerAddress", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const settlementAbi = [
  { type: "function", name: "payInvoice", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "markDefault", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "amountDue", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "defaultableAt", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "isDefaultable", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "GRACE_PERIOD", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const;

// Display-only. Returns the raw TWAP tick; the price conversion happens in TS because Uniswap's
// TickMath is GPL and would infect this MIT codebase.
export const navOracleAbi = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint256", name: "nav" },
      { type: "uint256", name: "sharePrice" },
      { type: "int24", name: "tick" },
      { type: "bool", name: "tickOk" },
      { type: "bool", name: "baseIsToken0" },
      { type: "uint8", name: "baseDecimals" },
      { type: "uint8", name: "quoteDecimals" },
    ],
  },
] as const;

/** Registry lifecycle states, indexed by the on-chain enum. */
export const REGISTRY_STATUS = ["None", "Registered", "Funded", "Settled", "Defaulted"] as const;
export type InvoiceStatus = (typeof REGISTRY_STATUS)[number];

/** Controller funding states, indexed by the on-chain enum. */
export const FUNDING_STATUS = ["None", "Outstanding", "Settled", "Defaulted"] as const;
