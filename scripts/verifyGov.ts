import "dotenv/config";
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Assert the production security posture. This is the gate to run immediately before, and
// immediately after, a mainnet launch — it is the difference between "we think governance is
// set up" and "we read it off the chain".
//
//   npx hardhat run scripts/verifyGov.ts --network botchain

let failures = 0;
const ok = (label: string, pass: boolean, detail = "") => {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
    if (!pass) failures++;
};
const warn = (label: string, detail = "") => console.log(`  WARN  ${label}${detail ? "  — " + detail : ""}`);

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const govFile = path.join(__dirname, "..", "deployments", `cifra-gov-safe-${network.name}.json`);
    const hasGov = fs.existsSync(govFile);
    const gov = hasGov ? JSON.parse(fs.readFileSync(govFile, "utf8")) : null;
    const safe: string | null = gov ? ethers.getAddress(gov.safe) : null;

    console.log(`Network ${network.name}   deployer ${dep.deployer}\n`);

    console.log("governance Safe");
    ok("a governance Safe is recorded", hasGov, hasGov ? `${safe}` : "run scripts/deployGovSafe.ts");
    if (safe) {
        // Check for code FIRST: decoding a call to an empty address throws, and the stack trace
        // would replace the very FAIL line written to diagnose a stale or wrong-network record.
        const hasCode = (await ethers.provider.getCode(safe)) !== "0x";
        ok("Safe has code", hasCode, hasCode ? "" : `${safe} — stale record, or wrong network?`);
        if (!hasCode) {
            console.log("\n1 FAILURE — the recorded Safe does not exist on this chain.");
            process.exitCode = 1;
            return;
        }
        const s = new ethers.Contract(
            safe,
            ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"],
            ethers.provider
        );
        const owners: string[] = await s.getOwners();
        const threshold: bigint = await s.getThreshold();
        ok("threshold >= 2 (no single signer can act)", Number(threshold) >= 2, `${threshold}-of-${owners.length}`);
        ok(
            "the deployer alone cannot meet the threshold",
            !(owners.length === 1 && owners[0].toLowerCase() === dep.deployer.toLowerCase()),
            owners.join(", ")
        );
    }

    console.log("\nownership");
    const targets: { name: string; address: string }[] = [
        { name: "CifraInvoiceRegistry", address: dep.shared.CifraInvoiceRegistry },
        { name: "CifraAttestationNFT", address: dep.shared.CifraAttestationNFT },
    ];
    for (const [key, b] of Object.entries<any>(dep.books)) {
        targets.push({ name: `CifraTrancheController[${key}]`, address: b.controller });
        if (b.settlement) targets.push({ name: `CifraSettlement[${key}]`, address: b.settlement });
    }
    for (const t of targets) {
        const c = new ethers.Contract(t.address, ["function owner() view returns (address)"], ethers.provider);
        const owner: string = await c.owner();
        ok(`${t.name} owned by the Safe`, Boolean(safe) && owner.toLowerCase() === safe!.toLowerCase(), owner);
    }

    console.log("\nrole separation");
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.shared.CifraAttestationNFT, ethers.provider);
    const scorer: string = await attestation.scorerAddress();
    const attester: string = await attestation.attester();
    const deployer: string = dep.deployer;

    ok(
        "scorer key is NOT the deployer",
        scorer.toLowerCase() !== deployer.toLowerCase(),
        `${scorer} — the scorer key should live only inside the Cloud Run service`
    );
    ok("scorer is NOT the Safe", !safe || scorer.toLowerCase() !== safe.toLowerCase(), scorer);
    if (attester.toLowerCase() === deployer.toLowerCase())
        warn("attester is still the deployer", `${attester} — acceptable if the deployer key is the intended keeper`);
    else ok("attester is a distinct keeper", true, attester);

    for (const [key, b] of Object.entries<any>(dep.books)) {
        const controller = await ethers.getContractAt("CifraTrancheController", b.controller, ethers.provider);
        const operator: string = await controller.operator();
        const settlement: string = await controller.settlement();
        ok(`${key}: settlement is wired`, settlement.toLowerCase() === String(b.settlement).toLowerCase(), settlement);
        ok(`${key}: operator is not the scorer`, operator.toLowerCase() !== scorer.toLowerCase(), operator);
        ok(`${key}: controller is unpaused`, !(await controller.paused()));
    }

    console.log(
        failures === 0
            ? "\nAll governance checks passed."
            : `\n${failures} FAILURE(S) — do not treat this deployment as production-ready.`
    );
    if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
