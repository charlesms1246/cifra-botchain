import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Deploy CifraJurisdictionOracle and prove it live: fetch a country's region from a real public
// API via FDC Web2Json, verify on-chain, and read the mapped jurisdiction risk.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/deployJurisdictionOracle.ts --network coston2
const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const FDC_PROTOCOL_ID = 200;
const COUNTRY = "US";
const utf8Hex = (s: string) => ("0x" + Buffer.from(s, "utf8").toString("hex")).padEnd(66, "0");

// IWeb2Json.Response tuple for decoding the DA-layer response_hex.
const RESPONSE_TYPE =
    "tuple(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
    "tuple(string url,string httpMethod,string headers,string queryParams,string body,string postProcessJq,string abiSignature) requestBody," +
    "tuple(bytes abiEncodedData) responseBody)";

const ABI_SIGNATURE = JSON.stringify({
    components: [
        { internalType: "string", name: "countryCode", type: "string" },
        { internalType: "string", name: "region", type: "string" },
    ],
    name: "data",
    type: "tuple",
});

async function byName(name: string): Promise<string> {
    const reg = new ethers.Contract(CONTRACT_REGISTRY, ["function getContractAddressByName(string) view returns (address)"], ethers.provider);
    return reg.getContractAddressByName(name);
}

async function main() {
    const depPath = path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`);
    const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
    const [me] = await ethers.getSigners();
    const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

    // --- deploy + transparent region-risk table (bps: lower = safer jurisdiction) ---
    const oracle = await (await ethers.getContractFactory("CifraJurisdictionOracle")).deploy(dep.external.fdcVerification);
    await oracle.waitForDeployment();
    const addr = await oracle.getAddress();
    for (const [region, bps] of [["Europe", 1000], ["Americas", 2000], ["Asia", 3000], ["Oceania", 1500], ["Africa", 5000]] as [string, number][]) {
        await (await oracle.setRegionRisk(region, bps)).wait();
    }
    console.log(`CifraJurisdictionOracle ${addr} (verifier ${dep.external.fdcVerification}); region table set`);

    // --- Web2Json request: a real public country-info API (nager.date) ---
    const reqBody = {
        attestationType: utf8Hex("Web2Json"),
        sourceId: utf8Hex("PublicWeb2"),
        requestBody: {
            url: `https://date.nager.at/api/v3/CountryInfo/${COUNTRY}`,
            httpMethod: "GET", headers: "{}", queryParams: "{}", body: "{}",
            postProcessJq: "{countryCode: .countryCode, region: .region}",
            abiSignature: ABI_SIGNATURE,
        },
    };
    const prep = await (await fetch(`${VERIFIER_URL_TESTNET}/verifier/web2/Web2Json/prepareRequest`, {
        method: "POST", headers: { "X-API-KEY": VERIFIER_API_KEY_TESTNET as string, "Content-Type": "application/json" }, body: JSON.stringify(reqBody),
    })).json();
    if (!prep.abiEncodedRequest) throw new Error("Web2Json prepareRequest failed: " + JSON.stringify(prep).slice(0, 300));
    console.log(`Web2Json prepareRequest ${prep.status}`);

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
    const dto = ethers.AbiCoder.defaultAbiCoder().decode(["tuple(string countryCode, string region)"], decoded.responseBody.abiEncodedData)[0];
    console.log(`attested: ${dto.countryCode} -> region ${dto.region}`);

    // --- verify + store on-chain, then read ---
    const proofArg = { merkleProof: da.proof, data: decoded.toArray(true) };
    await (await oracle.updateFromProof(proofArg, { gasLimit: 2_000_000 })).wait();
    const region = await oracle.regionOf(ethers.keccak256(ethers.toUtf8Bytes(COUNTRY)));
    const risk = await oracle.jurisdictionRiskBps(COUNTRY);
    console.log(`\n✅ Web2Json on-chain: ${COUNTRY} region "${region}" -> jurisdiction risk ${risk} bps (verified vs live FdcVerification)`);

    dep.contracts.CifraJurisdictionOracle = addr;
    fs.writeFileSync(depPath, JSON.stringify(dep, null, 2));
    try { await run("verify:verify", { address: addr, constructorArguments: [dep.external.fdcVerification] }); } catch (e: any) { console.log(`verify: ${e.message?.split("\n")[0] ?? e}`); }
    console.log(`Explorer: https://coston2-explorer.flare.network/address/${addr}#code`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
