import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Verify the governance hardening is real: every owned contract's owner == Safe, and the
// deployer (former owner) can no longer call an owner-gated function.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/verifyGov.ts --network coston2

const JURISDICTION_ORACLE = "0x5BEA2143d4D515b12bacE4dc3f70B364240D029C";

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const gov = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "cifra-gov-safe.json"), "utf8"));
    const [deployer] = await ethers.getSigners();
    const safe: string = gov.safe;

    const owned: [string, string][] = [
        ["CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry],
        ["CifraAttestationNFT", dep.contracts.CifraAttestationNFT],
        ["CifraTrancheController", dep.contracts.CifraTrancheController],
        ["CifraSettlement", dep.contracts.CifraSettlement],
        ["CifraJurisdictionOracle", JURISDICTION_ORACLE],
    ];

    console.log(`Safe: ${safe}\n`);
    let ok = true;
    for (const [name, addr] of owned) {
        const c = new ethers.Contract(addr, ["function owner() view returns (address)"], ethers.provider);
        const o: string = await c.owner();
        const pass = o.toLowerCase() === safe.toLowerCase();
        ok = ok && pass;
        console.log(`  ${pass ? "✓" : "✗"} ${name.padEnd(24)} owner == Safe${pass ? "" : ` (got ${o})`}`);
    }

    // Negative test: deployer can no longer set a protocol param on the controller.
    const controller = new ethers.Contract(
        dep.contracts.CifraTrancheController,
        ["function setSeniorYieldShareBps(uint256)", "function seniorYieldShareBps() view returns (uint256)"],
        deployer
    );
    let reverted = false;
    try {
        await controller.setSeniorYieldShareBps.staticCall(3000);
    } catch {
        reverted = true;
    }
    console.log(`\n  ${reverted ? "✓" : "✗"} deployer setSeniorYieldShareBps reverts (single key can't govern)`);
    console.log(`  seniorYieldShareBps still = ${await controller.seniorYieldShareBps()} (50/50)`);

    ok = ok && reverted;
    console.log(`\n${ok ? "✅ Governance hardening verified." : "❌ Governance check FAILED."}`);
    if (!ok) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
