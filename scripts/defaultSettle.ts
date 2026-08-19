import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as xrpl from "xrpl";

// ---------------------------------------------------------------------------
// Live default path, step 2: prove non-payment with a real FDC
// ReferencedPaymentNonexistence attestation and default the invoice.
//
// After the due date + grace with no buyer payment, requests an RPN proof that no XRPL
// payment referencing this invoiceId (>= faceAmount, to the protocol receiver) exists in
// the window, verifies it against the LIVE FdcVerification, and writes off the principal.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/defaultSettle.ts --network coston2
// ---------------------------------------------------------------------------

const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const FDC_PROTOCOL_ID = 200;
const XRPL_WSS = "wss://s.altnet.rippletest.net:51233";
const utf8Hex = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex")).padEnd(66, "0");

// IReferencedPaymentNonexistence.Response tuple for decoding the DA-layer response_hex.
const RESPONSE_TYPE =
    "tuple(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
    "tuple(uint64 minimalBlockNumber,uint64 deadlineBlockNumber,uint64 deadlineTimestamp,bytes32 destinationAddressHash," +
    "uint256 amount,bytes32 standardPaymentReference,bool checkSourceAddresses,bytes32 sourceAddressesRoot) requestBody," +
    "tuple(uint64 minimalBlockTimestamp,uint64 firstOverflowBlockNumber,uint64 firstOverflowBlockTimestamp) responseBody)";

async function byName(name: string): Promise<string> {
    const reg = new ethers.Contract(REGISTRY, ["function getContractAddressByName(string) view returns (address)"], ethers.provider);
    return reg.getContractAddressByName(name);
}

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-default-${network.name}.json`), "utf8"));
    const [me] = await ethers.getSigners();
    const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    const senior = dep.contracts.CifraTrancheVaultSenior;
    const junior = dep.contracts.CifraTrancheVaultJunior;
    const settlement = await ethers.getContractAt("CifraSettlement", st.settlement);
    const invoiceId: string = st.invoiceId;
    const faceAmount = BigInt(st.faceAmount);
    const deadlineTs = Number(st.dueDate) + Number(st.grace);

    // --- 0. wait until on-chain time is past due + grace (recordDefault requires it) ---
    let now = (await ethers.provider.getBlock("latest"))!.timestamp;
    while (now <= deadlineTs) {
        process.stdout.write(`waiting for due+grace (${deadlineTs - now}s left)...\n`);
        await new Promise((r) => setTimeout(r, 15000));
        now = (await ethers.provider.getBlock("latest"))!.timestamp;
    }
    console.log(`past due+grace (${deadlineTs}); building RPN request for invoice ${invoiceId}`);

    // --- 1. RPN request over a finalized XRPL window; no payment ref=invoiceId exists ---
    const c = new xrpl.Client(XRPL_WSS);
    await c.connect();
    const validated = await c.request({ command: "ledger", ledger_index: "validated" } as any);
    const idx: number = (validated.result as any).ledger.ledger_index;
    await c.disconnect();

    const reqBody = {
        attestationType: utf8Hex("ReferencedPaymentNonexistence"),
        sourceId: utf8Hex("testXRP"),
        requestBody: {
            minimalBlockNumber: String(idx - 400),
            deadlineBlockNumber: String(idx - 10), // finalized; overflow block certainly exists
            deadlineTimestamp: String(deadlineTs), // >= dueDate + grace (contract check)
            destinationAddressHash: dep.config.protocolReceiverHash,
            amount: faceAmount.toString(),
            standardPaymentReference: invoiceId,
            checkSourceAddresses: false,
            sourceAddressesRoot: "0x" + "00".repeat(32),
        },
    };
    const prep = await (await fetch(`${VERIFIER_URL_TESTNET}/verifier/xrp/ReferencedPaymentNonexistence/prepareRequest`, {
        method: "POST", headers: { "X-API-KEY": VERIFIER_API_KEY_TESTNET as string, "Content-Type": "application/json" }, body: JSON.stringify(reqBody),
    })).json();
    if (!prep.abiEncodedRequest) throw new Error("RPN prepareRequest failed: " + JSON.stringify(prep).slice(0, 300));
    console.log(`RPN prepareRequest ${prep.status}`);

    // --- 2. FdcHub request + roundId ---
    const fdcHub = new ethers.Contract(await byName("FdcHub"), ["function requestAttestation(bytes) payable"], me);
    const feeCfg = new ethers.Contract(await byName("FdcRequestFeeConfigurations"), ["function getRequestFee(bytes) view returns (uint256)"], ethers.provider);
    const fsm = new ethers.Contract(await byName("FlareSystemsManager"), ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], ethers.provider);
    const relay = new ethers.Contract(await byName("Relay"), ["function isFinalized(uint256,uint256) view returns (bool)"], ethers.provider);

    const fee: bigint = await feeCfg.getRequestFee(prep.abiEncodedRequest);
    const rc = await (await fdcHub.requestAttestation(prep.abiEncodedRequest, { value: fee })).wait();
    const blk = await ethers.provider.getBlock(rc!.blockNumber);
    const roundId = Number((BigInt(blk!.timestamp) - BigInt(await fsm.firstVotingRoundStartTs())) / BigInt(await fsm.votingEpochDurationSeconds()));
    console.log(`RPN request roundId ${roundId} — waiting`);
    for (let i = 0; i < 40 && !(await relay.isFinalized(FDC_PROTOCOL_ID, roundId)); i++) { process.stdout.write("."); await new Promise((r) => setTimeout(r, 10000)); }
    if (!(await relay.isFinalized(FDC_PROTOCOL_ID, roundId))) throw new Error("round not finalized");
    console.log(" finalized");

    // --- 3. DA-layer proof ---
    let da: any;
    for (let i = 0; i < 15; i++) {
        da = await (await fetch(`${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`, { method: "POST", headers: { "X-API-KEY": (VERIFIER_API_KEY_TESTNET as string) || "", "Content-Type": "application/json" }, body: JSON.stringify({ votingRoundId: roundId, requestBytes: prep.abiEncodedRequest }) })).json();
        if (da && da.response_hex) break;
        await new Promise((r) => setTimeout(r, 8000));
    }
    if (!da?.response_hex) throw new Error("no RPN proof from DA layer");
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([RESPONSE_TYPE], da.response_hex)[0];
    console.log(`RPN proof retrieved (firstOverflowBlock ${decoded.responseBody.firstOverflowBlockNumber})`);

    // --- 4. markDefault with the real proof ---
    const proofArg = { merkleProof: da.proof, data: decoded.toArray(true) };
    try { await settlement.markDefault.staticCall(invoiceId, proofArg); }
    catch (e: any) {
        let name = e?.shortMessage ?? "unknown";
        try { name = settlement.interface.parseError(e?.data ?? e?.info?.error?.data)?.name ?? name; } catch {}
        throw new Error(`markDefault reverts: ${name}`);
    }
    const navBefore: bigint = await controller.nav();
    const sBefore: bigint = await controller.claimOf(senior);
    const jBefore: bigint = await controller.claimOf(junior);
    const dr = await (await settlement.markDefault(invoiceId, proofArg, { gasLimit: 2_000_000 })).wait();
    const navAfter: bigint = await controller.nav();
    const sAfter: bigint = await controller.claimOf(senior);
    const jAfter: bigint = await controller.claimOf(junior);

    console.log(`\n✅ REAL-FDC default on-chain (tx ${dr!.hash}):`);
    console.log(`  invoice status: ${(await registry.getInvoice(invoiceId)).status} (4=Defaulted)`);
    console.log(`  vault NAV: ${ethers.formatUnits(navBefore, 6)} → ${ethers.formatUnits(navAfter, 6)} FXRP (principal written off)`);
    console.log(`  junior claim: ${ethers.formatUnits(jBefore, 6)} → ${ethers.formatUnits(jAfter, 6)} (−${ethers.formatUnits(jBefore - jAfter, 6)})  ← first-loss absorbed here`);
    console.log(`  senior claim: ${ethers.formatUnits(sBefore, 6)} → ${ethers.formatUnits(sAfter, 6)} (−${ethers.formatUnits(sBefore - sAfter, 6)})  ← protected unless junior wiped`);
    console.log(`  verified against LIVE FdcVerification — no mock.`);
    console.log(`Explorer: https://coston2-explorer.flare.network/tx/${dr!.hash}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
