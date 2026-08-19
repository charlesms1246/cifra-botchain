import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// List registered-but-UNSCORED invoices (status Registered + no attested grade) — the ones the
// marketplace shows as "Unscored". FLARE_RPC_API_KEY="" npx hardhat run scripts/listUnscored.ts --network coston2
const TOPIC0 = "0x79f69813c93babeab2d967dcc97aadba9faebeae3eeab2c15c11ddf13873a1c9"; // InvoiceRegistered
const EXPLORER = "https://coston2-explorer.flare.network";
const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.contracts.CifraAttestationNFT);

    console.log(`NFT teeAddress (attester binds to this): ${await attestation.teeAddress()}\n`);

    const url = `${EXPLORER}/api?module=logs&action=getLogs&fromBlock=33610000&toBlock=latest&address=${dep.contracts.CifraInvoiceRegistry}&topic0=${TOPIC0}`;
    const j = await (await fetch(url)).json();
    const ids = [...new Set((j.result as { topics: string[] }[]).map((r) => r.topics[1]))];

    console.log(`${ids.length} registered invoices; unscored (Registered + no grade):`);
    for (const id of ids) {
        const inv = await registry.getInvoice(id);
        const grade = await attestation.gradeForInvoice(id);
        const attested = grade.teeSigner !== ZERO;
        if (inv.status === 1n && !attested) {
            console.log(`  UNSCORED  ${id}  face ${ethers.formatUnits(inv.faceAmount, 6)} FXRP  supplier ${inv.supplier.slice(0, 10)}…`);
        }
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
