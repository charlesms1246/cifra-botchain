import { expect } from "chai";
import { ethers } from "hardhat";
import { CifraJurisdictionOracle, MockWeb2JsonVerifier } from "../typechain-types";

const abi = ethers.AbiCoder.defaultAbiCoder();

// Build an IWeb2Json.Proof carrying only what the oracle reads: responseBody.abiEncodedData
// = abi.encode((string countryCode, string region)). The rest is zero/empty.
function web2Proof(countryCode: string, region: string) {
    const dto = abi.encode(["tuple(string countryCode, string region)"], [{ countryCode, region }]);
    return {
        merkleProof: [] as string[],
        data: {
            attestationType: ethers.ZeroHash,
            sourceId: ethers.ZeroHash,
            votingRound: 0,
            lowestUsedTimestamp: 0,
            requestBody: { url: "", httpMethod: "", headers: "", queryParams: "", body: "", postProcessJq: "", abiSignature: "" },
            responseBody: { abiEncodedData: dto },
        },
    };
}

describe("CifraJurisdictionOracle", () => {
    let oracle: CifraJurisdictionOracle, verifier: MockWeb2JsonVerifier;
    let owner: any, other: any;

    beforeEach(async () => {
        [owner, other] = await ethers.getSigners();
        verifier = (await (await ethers.getContractFactory("MockWeb2JsonVerifier")).deploy()) as unknown as MockWeb2JsonVerifier;
        oracle = (await (await ethers.getContractFactory("CifraJurisdictionOracle")).deploy(
            await verifier.getAddress()
        )) as unknown as CifraJurisdictionOracle;
        // Transparent region-risk table (bps): Europe safest, Africa riskiest.
        await oracle.setRegionRisk("Europe", 1000);
        await oracle.setRegionRisk("Americas", 2000);
    });

    it("ingests a verified Web2Json proof and maps region -> risk", async () => {
        await expect(oracle.updateFromProof(web2Proof("US", "Americas")))
            .to.emit(oracle, "JurisdictionUpdated").withArgs("US", "Americas");
        expect(await oracle.jurisdictionRiskBps("US")).to.equal(2000);

        await oracle.updateFromProof(web2Proof("DE", "Europe"));
        expect(await oracle.jurisdictionRiskBps("DE")).to.equal(1000);
    });

    it("falls back to defaultRiskBps for a region with no configured entry", async () => {
        await oracle.updateFromProof(web2Proof("JP", "Asia")); // Asia not set
        expect(await oracle.jurisdictionRiskBps("JP")).to.equal(await oracle.defaultRiskBps());
    });

    it("rejects an invalid proof", async () => {
        await verifier.setValid(false);
        await expect(oracle.updateFromProof(web2Proof("US", "Americas"))).to.be.revertedWithCustomError(oracle, "InvalidProof");
    });

    it("reverts for an unknown (never-ingested) country", async () => {
        await expect(oracle.jurisdictionRiskBps("ZZ")).to.be.revertedWithCustomError(oracle, "UnknownCountry");
    });

    it("only owner can set the risk table", async () => {
        await expect(oracle.connect(other).setRegionRisk("Europe", 500)).to.be.revertedWithCustomError(oracle, "NotOwner");
        await expect(oracle.connect(other).setDefaultRisk(9000)).to.be.revertedWithCustomError(oracle, "NotOwner");
    });
});
