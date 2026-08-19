import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { execViaSafe } from "./safeExec";

// Redeploy the hardened CifraSettlement (explicit reserve, M3) and repoint the controller to it.
// controller.setSettlement is owner-gated and the owner is the governance Safe, so the repoint
// goes through a 2-of-3 exec. The new settlement's ownership is transferred to the Safe too.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/redeploySettlement.ts --network coston2

const GRACE_PERIOD = 3 * 24 * 3600;
const EXPLORER = "https://coston2-explorer.flare.network";

async function main() {
    const depPath = path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`);
    const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
    const gov = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "cifra-gov-safe.json"), "utf8"));
    const [deployer] = await ethers.getSigners();

    const args = [
        dep.contracts.CifraInvoiceRegistry,
        dep.contracts.CifraTrancheController,
        dep.external.fxrp,
        dep.external.fdcVerification,
        dep.config.protocolReceiverHash,
        GRACE_PERIOD,
    ] as const;

    console.log(`Deploying hardened CifraSettlement (real receiverHash ${dep.config.protocolReceiverHash})...`);
    const settlement = await (await ethers.getContractFactory("CifraSettlement")).deploy(...args);
    await settlement.waitForDeployment();
    const addr = await settlement.getAddress();
    console.log(`  CifraSettlement ${addr}`);

    // Hand the new settlement to governance, and repoint the controller via the Safe.
    await (await settlement.transferOwnership(gov.safe)).wait();
    console.log(`  settlement.transferOwnership(Safe) ✓`);

    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    console.log(`  repointing controller.setSettlement via 2-of-3 Safe...`);
    await execViaSafe(dep.contracts.CifraTrancheController, controller.interface.encodeFunctionData("setSettlement", [addr]));

    const now: string = await controller.settlement();
    const ok = now.toLowerCase() === addr.toLowerCase();
    console.log(`  controller.settlement == new settlement ${ok ? "✓" : "✗ (got " + now + ")"}`);
    if (!ok) throw new Error("controller.setSettlement did not take effect");

    // Persist (archive the previous settlement address).
    dep.contracts.CifraSettlementPrevious = dep.contracts.CifraSettlement;
    dep.contracts.CifraSettlement = addr;
    fs.writeFileSync(depPath, JSON.stringify(dep, null, 2));
    console.log(`  saved ${depPath}`);

    try {
        await run("verify:verify", { address: addr, constructorArguments: [...args] });
        console.log(`  verified`);
    } catch (e: any) {
        console.log(`  verify: ${e.message?.split("\n")[0] ?? e}`);
    }
    console.log(`Explorer: ${EXPLORER}/address/${addr}#code`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
