import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// v2 Stage B — the on-chain provenance anchor. Attests, via FDC Web2Json, the COMMITMENT that a
// (mock, disclosed) accounting API publishes over a buyer's payment history — WITHOUT the raw
// history ever going on-chain. The enclave separately verifies its private input hashes to this
// same commitment (score_handler.verifyProvenance), so a funder can confirm the grade was computed
// on data that provably came from the source, while the data stays sealed in the TEE.
//
//   Host the mock API (deployments/mock-accounting-api.json) at a public, verifier-reachable URL,
//   then:  FLARE_RPC_API_KEY="" WEB2JSON_API_URL=<url> npx hardhat run scripts/attestPaymentProvenance.ts --network coston2
//   env also: VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL

const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const FDC_PROTOCOL_ID = 200;
const utf8Hex = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex")).padEnd(66, "0");

const RESPONSE_TYPE =
    "tuple(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
    "tuple(string url,string httpMethod,string headers,string queryParams,string body,string postProcessJq,string abiSignature) requestBody," +
    "tuple(bytes abiEncodedData) responseBody)";
const ABI_SIGNATURE = JSON.stringify({ components: [{ internalType: "bytes32", name: "commitment", type: "bytes32" }], name: "data", type: "tuple" });

async function byName(name: string): Promise<string> {
    const reg = new ethers.Contract(CONTRACT_REGISTRY, ["function getContractAddressByName(string) view returns (address)"], ethers.provider);
    return reg.getContractAddressByName(name);
}

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const mock = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "mock-accounting-api.json"), "utf8"));
    const [me] = await ethers.getSigners();
    const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

    const url = process.env.WEB2JSON_API_URL;
    if (!url) {
        console.log("WEB2JSON_API_URL unset. Host deployments/mock-accounting-api.json at a public, verifier-reachable URL");
        console.log("(the FDC Web2Json verifier fetches arbitrary public URLs — e.g. a static JSON host), then re-run with WEB2JSON_API_URL=<url>.");
        console.log(`Expected commitment (must match run-test's demo salt + the enclave): ${mock.commitment}`);
        return;
    }

    // --- Web2Json request over the accounting API; JQ extracts ONLY the commitment (no raw data) ---
    const reqBody = {
        attestationType: utf8Hex("Web2Json"),
        sourceId: utf8Hex("PublicWeb2"),
        requestBody: { url, httpMethod: "GET", headers: "{}", queryParams: process.env.WEB2JSON_QUERY ?? "{}", body: "{}", postProcessJq: process.env.WEB2JSON_JQ ?? "{commitment: .commitment}", abiSignature: ABI_SIGNATURE },
    };
    const prep = await (await fetch(`${VERIFIER_URL_TESTNET}/verifier/web2/Web2Json/prepareRequest`, {
        method: "POST", headers: { "X-API-KEY": VERIFIER_API_KEY_TESTNET as string, "Content-Type": "application/json" }, body: JSON.stringify(reqBody),
    })).json();
    if (!prep.abiEncodedRequest) throw new Error("Web2Json prepareRequest failed: " + JSON.stringify(prep).slice(0, 300));
    console.log(`Web2Json prepareRequest ${prep.status} (url ${url})`);

    // --- FDC round ---
    const fdcHub = new ethers.Contract(await byName("FdcHub"), ["function requestAttestation(bytes) payable"], me);
    const feeCfg = new ethers.Contract(await byName("FdcRequestFeeConfigurations"), ["function getRequestFee(bytes) view returns (uint256)"], ethers.provider);
    const fsm = new ethers.Contract(await byName("FlareSystemsManager"), ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], ethers.provider);
    const relay = new ethers.Contract(await byName("Relay"), ["function isFinalized(uint256,uint256) view returns (bool)"], ethers.provider);

    const fee: bigint = await feeCfg.getRequestFee(prep.abiEncodedRequest);
    const rc = await (await fdcHub.requestAttestation(prep.abiEncodedRequest, { value: fee })).wait();
    const blk = await ethers.provider.getBlock(rc!.blockNumber);
    const roundId = Number((BigInt(blk!.timestamp) - BigInt(await fsm.firstVotingRoundStartTs())) / BigInt(await fsm.votingEpochDurationSeconds()));
    console.log(`FDC Web2Json request roundId ${roundId} — waiting`);
    for (let i = 0; i < 40 && !(await relay.isFinalized(FDC_PROTOCOL_ID, roundId)); i++) { process.stdout.write("."); await new Promise((r) => setTimeout(r, 10000)); }
    if (!(await relay.isFinalized(FDC_PROTOCOL_ID, roundId))) throw new Error("round not finalized");
    console.log(" finalized");

    let da: any;
    for (let i = 0; i < 15; i++) {
        da = await (await fetch(`${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`, { method: "POST", headers: { "X-API-KEY": (VERIFIER_API_KEY_TESTNET as string) || "", "Content-Type": "application/json" }, body: JSON.stringify({ votingRoundId: roundId, requestBytes: prep.abiEncodedRequest }) })).json();
        if (da && da.response_hex) break;
        await new Promise((r) => setTimeout(r, 8000));
    }
    if (!da?.response_hex) throw new Error("no Web2Json proof from DA layer");
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([RESPONSE_TYPE], da.response_hex)[0];
    const dto = ethers.AbiCoder.defaultAbiCoder().decode(["tuple(bytes32 commitment)"], decoded.responseBody.abiEncodedData)[0];
    const attested: string = dto.commitment;

    // --- verify on-chain vs the LIVE FdcVerification ---
    const PROOF_TYPE = `tuple(bytes32[] merkleProof, ${RESPONSE_TYPE} data)`;
    const fdc = new ethers.Contract(dep.external.fdcVerification, [`function verifyWeb2Json(${PROOF_TYPE} _proof) view returns (bool)`], ethers.provider);
    const proofArg = { merkleProof: da.proof, data: decoded.toArray(true) };
    const ok = await fdc.verifyWeb2Json(proofArg);

    console.log(`\n✅ Web2Json provenance anchored on-chain (verifyWeb2Json vs live FdcVerification = ${ok}):`);
    console.log(`  attested commitment: ${attested}`);
    console.log(`  enclave/run-test commitment (mock-accounting-api.json): ${mock.commitment}`);
    console.log(`  match: ${attested.toLowerCase() === mock.commitment.toLowerCase()} — the graded data provably came from the source; the raw history never went on-chain.`);
    if (!ok) throw new Error("verifyJsonApi returned false");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
