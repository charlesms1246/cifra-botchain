// Cifra's live Coston2 deployment (senior/junior tranche set) + minimal ABIs the UI reads.
export const CONTRACTS = {
  registry: "0xa74Ac3023c0cB1D61b120353961ab9cf992C1cb8",
  attestation: "0xFC021Cf0B582bc408da1bB85a4b033C0f41bc064",
  controller: "0xC06e9546313c17dCf1a183789024159b4a7Dae18",
  seniorVault: "0x0AdED451731753a440A72D74DEa6CBb4fd30c3Cb",
  juniorVault: "0x33B9BC6Dc4ff1C6bC0C2fC700E183592BcA89832",
  settlement: "0x55BaD904B39A1A1f276085B24547277088a6856B",
  seniorNavOracle: "0xf0dc254BF37E4876DEceA3a529356d7C0f14B207",
  juniorNavOracle: "0xE558F2834862f15d5fA4c2418A3dA79c428180B2",
  jurisdictionOracle: "0x5BEA2143d4D515b12bacE4dc3f70B364240D029C",
  fxrp: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  masterAccountController: "0x434936d47503353f06750Db1A444DBDC5F0AD37c",
  assetManagerFXRP: "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA",
} as const;

// FAssets AssetManager — the Core Vault XRPL address suppliers pay for direct minting / onboarding.
export const assetManagerAbi = [
  { type: "function", name: "directMintingPaymentAddress", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

// The two tranche share classes, priced by their own NAV oracle. Senior = protected,
// lower-yield; junior = first-loss, higher-yield (keeps the residual after senior's cut).
export const TRANCHES = [
  { key: "senior", label: "Senior", vault: CONTRACTS.seniorVault, navOracle: CONTRACTS.seniorNavOracle, blurb: "Protected — junior absorbs losses first. Takes 50% of each invoice's yield.", accent: false },
  { key: "junior", label: "Junior", vault: CONTRACTS.juniorVault, navOracle: CONTRACTS.juniorNavOracle, blurb: "First-loss — absorbs defaults before senior. Keeps the residual 50% of yield.", accent: true },
] as const;

export const FXRP_DECIMALS = 6;

export const navOracleAbi = [
  { type: "function", name: "xrpUsdPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint64" }] },
  { type: "function", name: "navUsd", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint64" }] },
  { type: "function", name: "pricePerShareUsd", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint64" }] },
  { type: "function", name: "sharesToUsd", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint64" }] },
] as const;

export const vaultAbi = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDeployed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "convertToAssets", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "previewDeposit", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "assets" }, { type: "address", name: "receiver" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
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
] as const;

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
          { type: "address", name: "teeSigner" },
        ],
      },
    ],
  },
  { type: "function", name: "isAttested", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

// The controller holds the shared FXRP pool + runs funding/waterfall across both tranches.
export const controllerAbi = [
  { type: "function", name: "nav", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDeployed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "seniorYieldShareBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fundInvoice", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
] as const;

export const REGISTRY_STATUS = ["None", "Registered", "Funded", "Settled", "Defaulted"] as const;

export const macAbi = [
  { type: "function", name: "getPersonalAccount", stateMutability: "view", inputs: [{ type: "string" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getNonce", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const jurisdictionOracleAbi = [
  { type: "function", name: "jurisdictionRiskBps", stateMutability: "view", inputs: [{ type: "string" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "regionOf", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "string" }] },
] as const;
