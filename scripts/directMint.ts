import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as xrpl from "xrpl";

// REAL XRP -> FXRP via FAssets direct minting. Buyer sends XRP to the Core Vault with a
// 48-byte direct-minting memo (recipient + executor = deployer), then we attest that XRPL
// payment via FDC (XRPPayment) and call executeDirectMinting — minting real FXRP from real XRP.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/directMint.ts --network coston2

const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const ASSET_MANAGER_FXRP = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const FDC_PROTOCOL_ID = 200;
const MINT_XRP = "10";
const utf8Hex = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex")).padEnd(66, "0");

async function byName(name: string): Promise<string> {
    const reg = new ethers.Contract(CONTRACT_REGISTRY, ["function getContractAddressByName(string) view returns (address)"], ethers.provider);
    return reg.getContractAddressByName(name);
}

async function main() {
    const [me] = await ethers.getSigners();
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "cifra-coston2.json"), "utf8"));
    const acc = JSON.parse(fs.readFileSync("/private/tmp/claude-501/-Users-charlesms-Hacks-flare-Cifra/100e9f39-63a1-480f-99d5-587e6edc96aa/scratchpad/xrpl.json", "utf8"));
    const amAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "IAssetManager.json"), "utf8"));
    const respType = fs.readFileSync(path.join(__dirname, "abi", "XRPPaymentResponseType.txt"), "utf8").trim();
    const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

    const am = new ethers.Contract(ASSET_MANAGER_FXRP, amAbi, me);
    const fxrp = await ethers.getContractAt("IERC20", dep.external.fxrp);
    const coreVault: string = await am.directMintingPaymentAddress();
    const fxrpBefore: bigint = await (fxrp as any).balanceOf(me.address);
    console.log(`Core Vault XRPL: ${coreVault} | recipient/executor: ${me.address} | FXRP before: ${ethers.formatUnits(fxrpBefore, 6)}\n`);

    // 48-byte direct-minting memo: prefix(8) + recipient(20) + executor(20).
    const rec = me.address.slice(2).toLowerCase();
    const memoHex = ("4642505266410021" + rec + rec).toUpperCase();
    if (memoHex.length !== 96) throw new Error("memo not 48 bytes");

    // --- 1. XRPL payment: buyer -> Core Vault (skip if resuming an existing payment) ---
    let xrplHash = process.env.RESUME_XRPL_HASH;
    if (!xrplHash) {
        const c = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
        await c.connect();
        const buyer = xrpl.Wallet.fromSeed(acc.buyer.seed);
        const res = await c.submitAndWait(
            (await c.autofill({ TransactionType: "Payment", Account: buyer.address, Destination: coreVault, Amount: xrpl.xrpToDrops(MINT_XRP), Memos: [{ Memo: { MemoData: memoHex } }] })) as any,
            { wallet: buyer } as any
        );
        await c.disconnect();
        xrplHash = (res.result as any).hash;
        console.log(`XRPL payment ${(res.result.meta as any).TransactionResult}: ${MINT_XRP} XRP -> Core Vault, tx ${xrplHash}`);
    } else {
        console.log(`resuming existing XRPL payment ${xrplHash}`);
    }

    // --- 2. FDC XRPPayment attestation (retry prepareRequest until the tx is indexed) ---
    const reqBody = { attestationType: utf8Hex("XRPPayment"), sourceId: utf8Hex("testXRP"), requestBody: { transactionId: xrplHash, proofOwner: me.address } };
    let prep: any;
    for (let i = 0; i < 20; i++) {
        prep = await (await fetch(`${VERIFIER_URL_TESTNET}/verifier/xrp/XRPPayment/prepareRequest`, {
            method: "POST", headers: { "X-API-KEY": VERIFIER_API_KEY_TESTNET as string, "Content-Type": "application/json" }, body: JSON.stringify(reqBody),
        })).json();
        if (prep.abiEncodedRequest) break;
        process.stdout.write(prep.status === "INVALID: TRANSACTION DOES NOT EXIST" ? "~" : "?");
        await new Promise((r) => setTimeout(r, 8000));
    }
    if (!prep.abiEncodedRequest) throw new Error("prepareRequest failed: " + JSON.stringify(prep).slice(0, 200));
    console.log("\nprepareRequest ok");

    const fdcHub = new ethers.Contract(await byName("FdcHub"), ["function requestAttestation(bytes) payable"], me);
    const feeCfg = new ethers.Contract(await byName("FdcRequestFeeConfigurations"), ["function getRequestFee(bytes) view returns (uint256)"], ethers.provider);
    const fsm = new ethers.Contract(await byName("FlareSystemsManager"), ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], ethers.provider);
    const relay = new ethers.Contract(await byName("Relay"), ["function isFinalized(uint256,uint256) view returns (bool)"], ethers.provider);

    const fee: bigint = await feeCfg.getRequestFee(prep.abiEncodedRequest);
    const tx = await fdcHub.requestAttestation(prep.abiEncodedRequest, { value: fee });
    const rc = await tx.wait();
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
    console.log(`proof retrieved (memo attested: ${decoded.responseBody.firstMemoData?.slice(0, 20)}…)`);

    // --- 3. executeDirectMinting ---
    const proofArg = { merkleProof: da.proof, data: decoded.toArray(true) };
    const mt = await am.executeDirectMinting(proofArg);
    const mr = await mt.wait();
    const events = mr!.logs.map((l: any) => { try { return am.interface.parseLog(l)?.name; } catch { return null; } }).filter(Boolean);
    const fxrpAfter: bigint = await (fxrp as any).balanceOf(me.address);

    console.log(`\n✅ executeDirectMinting tx ${mr!.hash}`);
    console.log(`  events: ${events.join(", ")}`);
    console.log(`  FXRP minted to deployer: ${ethers.formatUnits(fxrpAfter - fxrpBefore, 6)} (real, from ${MINT_XRP} XRP via FAssets Core Vault)`);
    console.log(`  XRPL tx ${xrplHash} · Explorer ${`https://coston2-explorer.flare.network/tx/${mr!.hash}`}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
