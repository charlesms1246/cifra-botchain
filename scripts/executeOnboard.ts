import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Operator executor for a BROWSER-originated Smart Accounts onboarding (frontend /onboard).
// The supplier submitted the XRPL payment (0xFE memo) themselves in the browser; this proves it
// via FDC XRPPayment and runs the exact userOp on their PersonalAccount — the operator-managed-gas
// half of the flow. Inputs come from the UI (which prints them after the payment):
//   XRPL_HASH=<xrpl tx hash>  USER_OP_DATA=<0x… abi-encoded PackedUserOperation>
//   FLARE_RPC_API_KEY="" XRPL_HASH=.. USER_OP_DATA=.. npx hardhat run scripts/executeOnboard.ts --network coston2
//   env also: VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL
// (Same FDC + executeDirectMintingWithData path as registerViaSmartAccount.ts, but driven by the
//  browser's XRPL payment + userOp instead of building its own.)

const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const ASSET_MANAGER_FXRP = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const FDC_PROTOCOL_ID = 200;
const utf8Hex = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex")).padEnd(66, "0");

async function byName(name: string): Promise<string> {
    const reg = new ethers.Contract(CONTRACT_REGISTRY, ["function getContractAddressByName(string) view returns (address)"], ethers.provider);
    return reg.getContractAddressByName(name);
}

async function main() {
    const xrplHash = process.env.XRPL_HASH;
    const userOpData = process.env.USER_OP_DATA;
    if (!xrplHash || !userOpData) throw new Error("set XRPL_HASH and USER_OP_DATA (from the /onboard UI)");
    const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

    const [executor] = await ethers.getSigners(); // pays FLR gas (operator model)
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "cifra-coston2.json"), "utf8"));
    const amAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "IAssetManager.json"), "utf8"));
    const respType = fs.readFileSync(path.join(__dirname, "abi", "XRPPaymentResponseType.txt"), "utf8").trim();
    const am = new ethers.Contract(ASSET_MANAGER_FXRP, amAbi, executor);
    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);

    // --- 1. FDC XRPPayment attestation of the supplier's browser-submitted payment ---
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
    console.log(`proof retrieved (attested memo ${(decoded.responseBody.firstMemoData.length - 2) / 2} bytes)`);

    // --- 2. Execute the browser's exact userOp on the PersonalAccount (registerInvoice runs) ---
    const proofArg = { merkleProof: da.proof, data: decoded.toArray(true) };
    const mr = await (await am.executeDirectMintingWithData(proofArg, userOpData)).wait();

    const ifaces = [am.interface, registry.interface];
    const seen: string[] = [];
    for (const log of mr!.logs) for (const iface of ifaces) { try { const p = iface.parseLog(log); if (p) { seen.push(p.name); break; } } catch { /* not ours */ } }

    console.log(`\n✅ executeDirectMintingWithData tx ${mr!.hash}`);
    console.log(`  events: ${seen.join(", ")}`);
    console.log(`  the invoice is now registered on-chain, owned by the supplier's PersonalAccount.`);
    console.log(`  Explorer https://coston2-explorer.flare.network/tx/${mr!.hash}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
