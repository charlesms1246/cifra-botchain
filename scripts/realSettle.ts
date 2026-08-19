import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Real-FDC settle, final step: attest the XRPL payment via FDC (real round + DA proof),
// deploy a CifraSettlement bound to the LIVE FdcVerification + real receiver hash, and
// settle() — verifying a genuine Payment proof on-chain. Nothing simulated.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/realSettle.ts --network coston2

const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const FDC_PROTOCOL_ID = 200;
const utf8Hex = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex")).padEnd(66, "0");

// IPayment.Response tuple type for decoding the DA-layer response_hex.
const RESPONSE_TYPE =
    "tuple(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
    "tuple(bytes32 transactionId,uint256 inUtxo,uint256 utxo) requestBody," +
    "tuple(uint64 blockNumber,uint64 blockTimestamp,bytes32 sourceAddressHash,bytes32 sourceAddressesRoot," +
    "bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount,int256 intendedSpentAmount," +
    "int256 receivedAmount,int256 intendedReceivedAmount,bytes32 standardPaymentReference,bool oneToOne,uint8 status) responseBody)";

async function byName(name: string): Promise<string> {
    const reg = new ethers.Contract(REGISTRY, ["function getContractAddressByName(string) view returns (address)"], ethers.provider);
    return reg.getContractAddressByName(name);
}

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const rs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "real-settle.json"), "utf8"));
    const [me] = await ethers.getSigners();
    const faceAmount = BigInt(rs.faceAmount);

    const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

    // --- 1. FDC prepareRequest (verifier) ---
    const reqBody = { attestationType: utf8Hex("Payment"), sourceId: utf8Hex("testXRP"), requestBody: { transactionId: rs.xrplTxHash, inUtxo: "0", utxo: "0" } };
    const prep = await (await fetch(`${VERIFIER_URL_TESTNET}/verifier/xrp/Payment/prepareRequest`, {
        method: "POST", headers: { "X-API-KEY": VERIFIER_API_KEY_TESTNET as string, "Content-Type": "application/json" }, body: JSON.stringify(reqBody),
    })).json();
    const abiEncodedRequest = prep.abiEncodedRequest;
    console.log(`prepareRequest ok (abiEncodedRequest ${abiEncodedRequest.length} chars)`);

    // --- 2. Submit to FdcHub, compute roundId ---
    const fdcHub = new ethers.Contract(await byName("FdcHub"), ["function requestAttestation(bytes) payable"], me);
    const feeCfg = new ethers.Contract(await byName("FdcRequestFeeConfigurations"), ["function getRequestFee(bytes) view returns (uint256)"], ethers.provider);
    const fsm = new ethers.Contract(await byName("FlareSystemsManager"), ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], ethers.provider);
    const relay = new ethers.Contract(await byName("Relay"), ["function isFinalized(uint256,uint256) view returns (bool)"], ethers.provider);

    const fee: bigint = await feeCfg.getRequestFee(abiEncodedRequest);
    const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
    const rcpt = await tx.wait();
    const blk = await ethers.provider.getBlock(rcpt!.blockNumber);
    const [start, dur] = [await fsm.firstVotingRoundStartTs(), await fsm.votingEpochDurationSeconds()];
    const roundId = Number((BigInt(blk!.timestamp) - BigInt(start)) / BigInt(dur));
    console.log(`requestAttestation ${rcpt!.hash} (fee ${ethers.formatEther(fee)}) — roundId ${roundId}`);

    // --- 3. Wait for finalization ---
    process.stdout.write("waiting for round finalization");
    for (let i = 0; i < 40; i++) {
        if (await relay.isFinalized(FDC_PROTOCOL_ID, roundId)) { console.log(" ✓ finalized"); break; }
        process.stdout.write(".");
        await new Promise((r) => setTimeout(r, 10000));
    }
    if (!(await relay.isFinalized(FDC_PROTOCOL_ID, roundId))) throw new Error("round not finalized in time");

    // --- 4. Fetch proof from the DA layer ---
    let da: any;
    for (let i = 0; i < 15; i++) {
        da = await (await fetch(`${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`, {
            method: "POST", headers: { "X-API-KEY": (VERIFIER_API_KEY_TESTNET as string) || "", "Content-Type": "application/json" },
            body: JSON.stringify({ votingRoundId: roundId, requestBytes: abiEncodedRequest }),
        })).json();
        if (da && da.response_hex) break;
        await new Promise((r) => setTimeout(r, 8000));
    }
    if (!da || !da.response_hex) throw new Error("no proof from DA layer: " + JSON.stringify(da).slice(0, 200));
    console.log(`proof retrieved (merkle nodes: ${da.proof.length})`);

    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([RESPONSE_TYPE], da.response_hex)[0];
    const receiverHash = decoded.responseBody.receivingAddressHash;
    console.log(`receiverHash from proof: ${receiverHash}`);

    // --- 5. Use the canonical CifraSettlement (already wired, LIVE FdcVerification, real receiver
    //        hash). It's owned by the governance Safe now, so we no longer redeploy + setSettlement
    //        (that would need a 2-of-3 exec) — we just fund its FXRP reserve and settle. ---
    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    const senior = dep.contracts.CifraTrancheVaultSenior;
    const junior = dep.contracts.CifraTrancheVaultJunior;
    const settlement = await ethers.getContractAt("CifraSettlement", dep.contracts.CifraSettlement);
    const cfgHash: string = await settlement.protocolReceiverHash();
    if (cfgHash.toLowerCase() !== receiverHash.toLowerCase())
        throw new Error(`proof receiverHash ${receiverHash} != canonical settlement's ${cfgHash} — buyer paid the wrong XRPL receiver`);
    const fxrp = await ethers.getContractAt("IERC20", dep.external.fxrp);
    await (await (fxrp as any).transfer(await settlement.getAddress(), faceAmount)).wait();
    console.log(`using canonical settlement ${dep.contracts.CifraSettlement} (real FdcVerification ${dep.external.fdcVerification}), funded ${ethers.formatUnits(faceAmount, 6)} FXRP reserve`);

    // --- 6. Settle with the REAL proof ---
    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
    const proofArg = { merkleProof: da.proof, data: decoded.toArray(true) };

    // Decode the exact revert before spending gas.
    try {
        await settlement.settle.staticCall(rs.invoiceId, proofArg);
    } catch (e: any) {
        const d = e?.data ?? e?.info?.error?.data ?? e?.revert?.data;
        let name = d ?? e?.shortMessage ?? "unknown";
        try { name = settlement.interface.parseError(d)?.name ?? name; } catch {}
        // Is the FDC proof itself valid on the live verifier?
        const fdc = new ethers.Contract(dep.external.fdcVerification, ["function verifyPayment((bytes32[] merkleProof, " + RESPONSE_TYPE.slice(6) + " data)) view returns (bool)"], ethers.provider);
        let proved = "n/a";
        try { proved = String(await fdc.verifyPayment(proofArg)); } catch (ve: any) { proved = "verify-threw:" + (ve.shortMessage || ve.message); }
        throw new Error(`settle reverts: ${name}   | FdcVerification.verifyPayment = ${proved}`);
    }

    const navBefore: bigint = await controller.nav();
    const sBefore: bigint = await controller.claimOf(senior);
    const jBefore: bigint = await controller.claimOf(junior);
    // Explicit gas limit: the FAsset (FXRP) transferFrom path is gas-heavy and ethers'
    // estimate can under-provision, OOG-ing the FDC-verify + repayment in one tx.
    const st = await settlement.settle(rs.invoiceId, proofArg, { gasLimit: 2_000_000 });
    const sr = await st.wait();
    const navAfter: bigint = await controller.nav();
    const sAfter: bigint = await controller.claimOf(senior);
    const jAfter: bigint = await controller.claimOf(junior);

    console.log(`\n✅ REAL-FDC settle on-chain (tx ${sr!.hash}):`);
    console.log(`  invoice status: ${(await registry.getInvoice(rs.invoiceId)).status} (3=Settled)`);
    console.log(`  vault NAV: ${ethers.formatUnits(navBefore, 6)} → ${ethers.formatUnits(navAfter, 6)} FXRP (+${ethers.formatUnits(navAfter - navBefore, 6)} yield)`);
    console.log(`  senior claim: ${ethers.formatUnits(sBefore, 6)} → ${ethers.formatUnits(sAfter, 6)} (+${ethers.formatUnits(sAfter - sBefore, 6)})`);
    console.log(`  junior claim: ${ethers.formatUnits(jBefore, 6)} → ${ethers.formatUnits(jAfter, 6)} (+${ethers.formatUnits(jAfter - jBefore, 6)})  ← 50/50 yield split`);
    console.log(`  verified against LIVE FdcVerification — no mock. XRPL tx ${rs.xrplTxHash}`);
    console.log(`Explorer: https://coston2-explorer.flare.network/tx/${sr!.hash}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
