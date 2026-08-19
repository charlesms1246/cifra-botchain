import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Transfer `owner` of the Cifra contracts to the 2-of-3 governance Safe (deployGovSafe.ts).
// Owner = protocol-parameter governance (setSettlement, setSeniorYieldShareBps,
// setProtocolReceiverHash, setTeeAddress, setAttester, pause, transferOwnership). The
// `operator` (fundInvoice) and `attester` (attest) hot roles deliberately STAY with the keeper
// EOA — bounded operational keys, the correct production split. Run once, as the current owner.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/transferOwnershipToGov.ts --network coston2

const JURISDICTION_ORACLE = "0x5BEA2143d4D515b12bacE4dc3f70B364240D029C"; // standalone (not in cifra-coston2.json)

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const gov = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "cifra-gov-safe.json"), "utf8"));
    const [deployer] = await ethers.getSigners();
    const safe: string = gov.safe;

    const targets: { name: string; address: string }[] = [
        { name: "CifraInvoiceRegistry", address: dep.contracts.CifraInvoiceRegistry },
        { name: "CifraAttestationNFT", address: dep.contracts.CifraAttestationNFT },
        { name: "CifraTrancheController", address: dep.contracts.CifraTrancheController },
        { name: "CifraSettlement", address: dep.contracts.CifraSettlement },
        { name: "CifraJurisdictionOracle", address: JURISDICTION_ORACLE },
    ];

    // All five share the same owner()/transferOwnership(address) shape.
    const OWNABLE = [
        "function owner() view returns (address)",
        "function transferOwnership(address newOwner)",
    ];

    console.log(`Governance Safe: ${safe}\nDeployer:        ${deployer.address}\n`);
    for (const t of targets) {
        const c = new ethers.Contract(t.address, OWNABLE, deployer);
        const cur: string = await c.owner();
        if (cur.toLowerCase() === safe.toLowerCase()) {
            console.log(`  ${t.name.padEnd(24)} already owned by Safe ✓`);
            continue;
        }
        if (cur.toLowerCase() !== deployer.address.toLowerCase()) {
            console.log(`  ${t.name.padEnd(24)} owner is ${cur} (not deployer) — SKIPPING`);
            continue;
        }
        await (await c.transferOwnership(safe)).wait();
        const now: string = await c.owner();
        const ok = now.toLowerCase() === safe.toLowerCase();
        console.log(`  ${t.name.padEnd(24)} owner -> Safe ${ok ? "✓" : "✗ (got " + now + ")"}`);
        if (!ok) throw new Error(`${t.name} ownership transfer failed`);
    }

    // Confirm the operator/attester hot roles stayed with the keeper (not the Safe).
    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.contracts.CifraAttestationNFT);
    console.log(`\nHot roles (unchanged, keeper EOA):`);
    console.log(`  controller.operator  = ${await controller.operator()}`);
    console.log(`  attestation.attester = ${await attestation.attester()}`);

    // Record governance in the deployment file.
    dep.governance = {
        safe,
        threshold: gov.threshold,
        owners: gov.owners,
        ownedContracts: targets.map((t) => t.name),
        keeper: deployer.address,
        note: "owner=Safe (2-of-3); operator+attester stay with the keeper EOA (bounded hot roles).",
    };
    fs.writeFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), JSON.stringify(dep, null, 2));
    console.log(`\nSaved governance section to deployments/cifra-${network.name}.json`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
