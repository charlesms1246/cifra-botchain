import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Hand every owner-gated Cifra contract to the governance Safe.
//
//   npx hardhat run scripts/transferOwnershipToGov.ts --network botchain
//
// THIS IS ONE-WAY from this machine's perspective: afterwards only the Safe can change protocol
// parameters or the scorer/attester/operator roles. Run scripts/setRoles.ts FIRST, or every
// subsequent role change becomes a multi-sig proposal.
//
// Owner-gated surface (NavOracle and NativeDepositHelper have no owner — both are stateless):
//   registry      setStatusUpdater
//   attestation   setScorerAddress, setAttester
//   controller ×2 setOperator, setSettlement, setSeniorYieldShareBps, pause/unpause
//   settlement ×2 sweep

async function main() {
    const [signer] = await ethers.getSigners();
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const govFile = path.join(__dirname, "..", "deployments", `cifra-gov-safe-${network.name}.json`);
    if (!fs.existsSync(govFile)) throw new Error(`No governance Safe for ${network.name}. Run scripts/deployGovSafe.ts first.`);
    const gov = JSON.parse(fs.readFileSync(govFile, "utf8"));
    const safe: string = ethers.getAddress(gov.safe);

    if ((await ethers.provider.getCode(safe)) === "0x") throw new Error(`Safe ${safe} has no code on ${network.name}`);

    const targets: { name: string; address: string }[] = [
        { name: "CifraInvoiceRegistry", address: dep.shared.CifraInvoiceRegistry },
        { name: "CifraAttestationNFT", address: dep.shared.CifraAttestationNFT },
    ];
    for (const [key, b] of Object.entries<any>(dep.books)) {
        targets.push({ name: `CifraTrancheController[${key}]`, address: b.controller });
        if (b.settlement) targets.push({ name: `CifraSettlement[${key}]`, address: b.settlement });
    }

    console.log(`Network ${network.name}   signer ${signer.address}`);
    console.log(`Safe    ${safe} (${gov.threshold}-of-${gov.owners.length})\n`);

    const abi = ["function owner() view returns (address)", "function transferOwnership(address)"];
    for (const t of targets) {
        const c = new ethers.Contract(t.address, abi, signer);
        const current: string = await c.owner();
        if (current.toLowerCase() === safe.toLowerCase()) {
            console.log(`  = ${t.name.padEnd(32)} already owned by the Safe`);
            continue;
        }
        if (current.toLowerCase() !== signer.address.toLowerCase()) {
            console.log(`  ! ${t.name.padEnd(32)} owned by ${current} — signer cannot transfer it. SKIPPED.`);
            continue;
        }
        const rcpt = await (await c.transferOwnership(safe)).wait();
        // Read it back. This is the one irreversible step in the pipeline, so its success is
        // observed rather than inferred from a receipt.
        const after: string = await c.owner();
        if (after.toLowerCase() !== safe.toLowerCase())
            throw new Error(
                `${t.name}: transferOwnership mined (${rcpt!.hash}) but owner is still ${after}. ` +
                    `Stopping before touching anything else.`
            );
        console.log(`  → ${t.name.padEnd(32)} ${current} -> ${after}  (${rcpt!.hash})`);
    }

    console.log(`\nVerify with: npx hardhat run scripts/verifyGov.ts --network ${network.name}`);
    console.log(`From here on, owner-gated calls go through scripts/safeExec.ts.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
