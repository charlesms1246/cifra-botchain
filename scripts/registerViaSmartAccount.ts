import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as xrpl from "xrpl";

// ---------------------------------------------------------------------------
// Smart Accounts onboarding (CLAUDE.md build-order step 3).
//
// An XRPL-native supplier — no EVM wallet, no FLR — registers a Cifra invoice
// by sending a single XRPL Payment. The instruction rides in as a Flare Smart
// Accounts *custom instruction* (memo opcode 0xFE) transported over FAssets
// direct minting:
//
//   supplier (XRPL) --Payment--> FAssets Core Vault (memo = 0xFE custom instr)
//        |                              |
//        |  FDC XRPPayment proof        v
//        |                        AssetManager routes to smartAccountManager
//        v                              |
//   executor calls executeDirectMintingWithData(proof, userOpBytes)
//        |                              v
//        |             MasterAccountController runs the PackedUserOperation on
//        |             the supplier's PersonalAccount:
//        v                    PersonalAccount.executeUserOp([registerInvoice(...)])
//   CifraInvoiceRegistry.registerInvoice  (msg.sender == PersonalAccount)
//
// The invoice's `supplier` is therefore the supplier's *deterministic*
// PersonalAccount address — the XRPL identity, on-chain, with no EVM key ever
// created by the supplier. Downstream funding pays the advance to that same
// PersonalAccount (redeemable to XRP), closing the XRPL-native loop.
//
// The executor (our deployer) is the only party that needs FLR — the standard
// Smart Accounts operator-managed-gas model. Disclosed, by design.
//
// Run:  FLARE_RPC_API_KEY="" npx hardhat run scripts/registerViaSmartAccount.ts --network coston2
//   env: VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL
//   optional: RESUME_XRPL_HASH=<hash> to resume after a submitted XRPL payment
//             SUPPLIER_SEED=<seed>     to reuse a funded XRPL supplier wallet
// ---------------------------------------------------------------------------

const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const ASSET_MANAGER_FXRP = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const MASTER_ACCOUNT_CONTROLLER = "0x434936d47503353f06750Db1A444DBDC5F0AD37c";
const FDC_PROTOCOL_ID = 200;
const XRPL_WSS = "wss://s.altnet.rippletest.net:51233";

// Payment must exceed the FAssets minting fee, or a 0xFE (has-data) mint reverts
// as "payment too small" (DirectMintingFacet). We send a small positive amount;
// the surplus over fees is minted as FXRP into the supplier's own PersonalAccount.
const PAY_XRP = "5";

const SCRATCH = "/private/tmp/claude-501/-Users-charlesms-Hacks-flare-Cifra/0486cf9c-0330-47d6-a00e-8d68b12dce74/scratchpad";
const utf8Hex = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex")).padEnd(66, "0");

// OZ draft-IERC4337 PackedUserOperation, in struct order (only sender/nonce/callData are validated).
const USER_OP_TUPLE =
    "tuple(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)";

const PERSONAL_ACCOUNT_ABI = ["function executeUserOp((address target,uint256 value,bytes data)[] _calls) payable"];
const MAC_ABI = [
    "function getPersonalAccount(string) view returns (address)",
    "function getNonce(address) view returns (uint256)",
    "event UserOperationExecuted(address indexed personalAccount, uint256 nonce)",
];
const REGISTRY_ABI = [
    "function registerInvoice(bytes32 buyerCommitment,uint256 faceAmount,uint64 dueDate,bytes32 ref) returns (bytes32)",
    "function computeInvoiceId(address supplier,bytes32 buyerCommitment,uint256 faceAmount,uint64 dueDate,bytes32 ref) pure returns (bytes32)",
    "function getInvoice(bytes32) view returns (tuple(address supplier,bytes32 buyerCommitment,uint256 faceAmount,uint64 dueDate,uint8 status))",
    "event InvoiceRegistered(bytes32 indexed invoiceId,address indexed supplier,bytes32 indexed buyerCommitment,uint256 faceAmount,uint64 dueDate)",
];

async function byName(name: string): Promise<string> {
    const reg = new ethers.Contract(CONTRACT_REGISTRY, ["function getContractAddressByName(string) view returns (address)"], ethers.provider);
    return reg.getContractAddressByName(name);
}

async function getSupplierWallet(): Promise<xrpl.Wallet> {
    if (process.env.SUPPLIER_SEED) return xrpl.Wallet.fromSeed(process.env.SUPPLIER_SEED);
    const p = path.join(SCRATCH, "supplier-xrpl.json");
    const c = new xrpl.Client(XRPL_WSS);
    await c.connect();
    let wallet: xrpl.Wallet;
    if (fs.existsSync(p)) {
        wallet = xrpl.Wallet.fromSeed(JSON.parse(fs.readFileSync(p, "utf8")).seed);
        const bal = await c.getXrpBalance(wallet.address).catch(() => 0);
        if (Number(bal) < Number(PAY_XRP) + 1) await c.fundWallet(wallet); // top up on testnet
    } else {
        const f = await c.fundWallet(); // fresh XRPL-native supplier, zero prior state
        wallet = f.wallet;
        fs.writeFileSync(p, JSON.stringify({ address: wallet.address, seed: wallet.seed }, null, 2));
    }
    await c.disconnect();
    return wallet;
}

async function main() {
    const [executor] = await ethers.getSigners(); // pays FLR gas (operator model)
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "cifra-coston2.json"), "utf8"));
    const amAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "IAssetManager.json"), "utf8"));
    const respType = fs.readFileSync(path.join(__dirname, "abi", "XRPPaymentResponseType.txt"), "utf8").trim();
    const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

    const am = new ethers.Contract(ASSET_MANAGER_FXRP, amAbi, executor);
    const mac = new ethers.Contract(MASTER_ACCOUNT_CONTROLLER, MAC_ABI, ethers.provider);
    const registry = new ethers.Contract(dep.contracts.CifraInvoiceRegistry, REGISTRY_ABI, ethers.provider);
    const paIface = new ethers.Interface(PERSONAL_ACCOUNT_ABI);
    const fxrp = await ethers.getContractAt("IERC20", dep.external.fxrp);

    // --- 0. supplier's XRPL identity -> deterministic PersonalAccount on Flare ---
    const supplier = await getSupplierWallet();
    const personalAccount: string = await mac.getPersonalAccount(supplier.address);
    const nonce: bigint = await mac.getNonce(personalAccount);
    console.log(`Supplier XRPL: ${supplier.address}`);
    console.log(`  -> PersonalAccount (Flare): ${personalAccount}  (nonce ${nonce})`);

    // --- 1. the invoice + the on-chain call the PersonalAccount will make ---
    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("cifra-buyer:ACME-Corp")); // opaque, no PII
    const faceAmount = ethers.parseUnits("5", 6); // 5 FXRP (6dp), smallest units
    const dueDate = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600); // +30d
    const ref = ethers.keccak256(ethers.toUtf8Bytes("INV-" + Date.now())); // supplier's invoice ref/salt

    const registerData = registry.interface.encodeFunctionData("registerInvoice", [buyerCommitment, faceAmount, dueDate, ref]);
    const calls = [{ target: dep.contracts.CifraInvoiceRegistry, value: 0n, data: registerData }];
    const callData = paIface.encodeFunctionData("executeUserOp", [calls]);

    // --- 2. wrap as PackedUserOperation + build the 0xFE custom-instruction memo ---
    const userOp = [personalAccount, nonce, "0x", callData, ethers.ZeroHash, 0n, ethers.ZeroHash, "0x", "0x"];
    const userOpData = ethers.AbiCoder.defaultAbiCoder().encode([USER_OP_TUPLE], [userOp]);
    const userOpHash = ethers.keccak256(userOpData);

    // memo = [0xFE][walletId=00][executorFeeUBA:uint64=0][userOpHash:32] = 42 bytes
    const executorFeeUBA = 0n; // we run our own executor; no FXRP fee taken from the mint
    const memoHex = (
        "FE" + "00" + executorFeeUBA.toString(16).padStart(16, "0") + userOpHash.slice(2)
    ).toUpperCase();
    if (memoHex.length !== 84) throw new Error(`memo not 42 bytes: ${memoHex.length / 2}`);

    const predictedId: string = await registry.computeInvoiceId(personalAccount, buyerCommitment, faceAmount, dueDate, ref);
    console.log(`Invoice: face 5 FXRP, due +30d, buyerCommitment ${buyerCommitment.slice(0, 12)}…`);
    console.log(`  predicted invoiceId: ${predictedId}`);

    // --- 3. XRPL payment: supplier -> Core Vault, carrying the custom instruction ---
    const coreVault: string = await am.directMintingPaymentAddress();
    let xrplHash = process.env.RESUME_XRPL_HASH;
    if (!xrplHash) {
        const c = new xrpl.Client(XRPL_WSS);
        await c.connect();
        const res = await c.submitAndWait(
            (await c.autofill({
                TransactionType: "Payment",
                Account: supplier.address,
                Destination: coreVault, // NO DestinationTag (would misroute the mint)
                Amount: xrpl.xrpToDrops(PAY_XRP),
                Memos: [{ Memo: { MemoData: memoHex } }],
            })) as any,
            { wallet: supplier } as any
        );
        await c.disconnect();
        xrplHash = (res.result as any).hash;
        console.log(`\nXRPL payment ${(res.result.meta as any).TransactionResult}: ${PAY_XRP} XRP -> Core Vault ${coreVault}`);
        console.log(`  tx ${xrplHash}`);
    } else {
        console.log(`\nresuming existing XRPL payment ${xrplHash}`);
    }

    // --- 4. FDC XRPPayment attestation of that XRPL payment ---
    const reqBody = { attestationType: utf8Hex("XRPPayment"), sourceId: utf8Hex("testXRP"), requestBody: { transactionId: xrplHash, proofOwner: executor.address } };
    let prep: any;
    for (let i = 0; i < 25; i++) {
        prep = await (await fetch(`${VERIFIER_URL_TESTNET}/verifier/xrp/XRPPayment/prepareRequest`, {
            method: "POST", headers: { "X-API-KEY": VERIFIER_API_KEY_TESTNET as string, "Content-Type": "application/json" }, body: JSON.stringify(reqBody),
        })).json();
        if (prep.abiEncodedRequest) break;
        process.stdout.write(prep.status === "INVALID: TRANSACTION DOES NOT EXIST" ? "~" : "?");
        await new Promise((r) => setTimeout(r, 8000));
    }
    if (!prep.abiEncodedRequest) throw new Error("prepareRequest failed: " + JSON.stringify(prep).slice(0, 200));
    console.log("\nprepareRequest ok");

    const fdcHub = new ethers.Contract(await byName("FdcHub"), ["function requestAttestation(bytes) payable"], executor);
    const feeCfg = new ethers.Contract(await byName("FdcRequestFeeConfigurations"), ["function getRequestFee(bytes) view returns (uint256)"], ethers.provider);
    const fsm = new ethers.Contract(await byName("FlareSystemsManager"), ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], ethers.provider);
    const relay = new ethers.Contract(await byName("Relay"), ["function isFinalized(uint256,uint256) view returns (bool)"], ethers.provider);

    const fee: bigint = await feeCfg.getRequestFee(prep.abiEncodedRequest);
    const rc = await (await fdcHub.requestAttestation(prep.abiEncodedRequest, { value: fee })).wait();
    const blk = await ethers.provider.getBlock(rc!.blockNumber);
    const roundId = Number((BigInt(blk!.timestamp) - BigInt(await fsm.firstVotingRoundStartTs())) / BigInt(await fsm.votingEpochDurationSeconds()));
    console.log(`FDC XRPPayment request roundId ${roundId} — waiting`);
    for (let i = 0; i < 40 && !(await relay.isFinalized(FDC_PROTOCOL_ID, roundId)); i++) { process.stdout.write("."); await new Promise((r) => setTimeout(r, 10000)); }
    if (!(await relay.isFinalized(FDC_PROTOCOL_ID, roundId))) throw new Error("round not finalized");
    console.log(" finalized");

    let da: any;
    for (let i = 0; i < 15; i++) {
        da = await (await fetch(`${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`, { method: "POST", headers: { "X-API-KEY": (VERIFIER_API_KEY_TESTNET as string) || "", "Content-Type": "application/json" }, body: JSON.stringify({ votingRoundId: roundId, requestBytes: prep.abiEncodedRequest }) })).json();
        if (da && da.response_hex) break;
        await new Promise((r) => setTimeout(r, 8000));
    }
    if (!da?.response_hex) throw new Error("no XRPPayment proof from DA layer");
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([respType], da.response_hex)[0];
    console.log(`proof retrieved (attested memo: ${decoded.responseBody.firstMemoData?.slice(0, 10)}…, ${(decoded.responseBody.firstMemoData.length - 2) / 2} bytes)`);

    // --- 5. executor dispatches the custom instruction -> registerInvoice runs on the PA ---
    const proofArg = { merkleProof: da.proof, data: decoded.toArray(true) };
    const mr = await (await am.executeDirectMintingWithData(proofArg, userOpData)).wait();

    // parse events across AssetManager + MAC + registry
    const ifaces = [am.interface, new ethers.Interface(MAC_ABI), registry.interface];
    const seen: string[] = [];
    for (const log of mr!.logs) {
        for (const iface of ifaces) {
            try { const p = iface.parseLog(log); if (p) { seen.push(p.name); break; } } catch { /* not ours */ }
        }
    }

    // --- 6. verify: invoice registered, owned by the PersonalAccount ---
    const inv = await registry.getInvoice(predictedId);
    const ok = inv.supplier.toLowerCase() === personalAccount.toLowerCase() && inv.status === 1n;
    const fxrpPA: bigint = await (fxrp as any).balanceOf(personalAccount);

    console.log(`\n✅ executeDirectMintingWithData tx ${mr!.hash}`);
    console.log(`  events: ${seen.join(", ")}`);
    console.log(`  invoice ${predictedId}`);
    console.log(`    supplier   = ${inv.supplier}  ${ok ? "== PersonalAccount ✓" : "!! MISMATCH"}`);
    console.log(`    faceAmount = ${ethers.formatUnits(inv.faceAmount, 6)} FXRP · status = ${inv.status} (1=Registered)`);
    console.log(`  PersonalAccount FXRP balance (surplus over fees): ${ethers.formatUnits(fxrpPA, 6)}`);
    console.log(`  XRPL tx ${xrplHash} · Explorer https://coston2-explorer.flare.network/tx/${mr!.hash}`);

    fs.writeFileSync(path.join(__dirname, "..", "deployments", "cifra-smartaccount-onboard.json"), JSON.stringify({
        supplierXrpl: supplier.address, personalAccount, invoiceId: predictedId,
        buyerCommitment, faceAmount: faceAmount.toString(), dueDate: dueDate.toString(), ref,
        xrplHash, flareTx: mr!.hash, events: seen,
    }, null, 2));

    if (!ok) throw new Error("invoice not owned by PersonalAccount — onboarding FAILED");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
