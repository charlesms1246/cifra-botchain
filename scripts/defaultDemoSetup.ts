import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { execViaSafe } from "./safeExec";

// Set up the live default demo for the already-funded short invoice (default-invoice.json):
// deploy a GRACE=0 demo settlement, repoint controller.settlement to it via the 2-of-3 Safe, and
// write the state file defaultSettle.ts consumes. (Canonical settlement is restored afterwards.)
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/defaultDemoSetup.ts --network coston2

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const di = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "default-invoice.json"), "utf8"));

    const settlement = await (await ethers.getContractFactory("CifraSettlement")).deploy(
        dep.contracts.CifraInvoiceRegistry, dep.contracts.CifraTrancheController, dep.external.fxrp,
        dep.external.fdcVerification, dep.config.protocolReceiverHash, 0 /* GRACE=0 demo */
    );
    await settlement.waitForDeployment();
    const addr = await settlement.getAddress();
    console.log(`demo GRACE=0 settlement ${addr}`);

    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    await execViaSafe(dep.contracts.CifraTrancheController, controller.interface.encodeFunctionData("setSettlement", [addr]));
    console.log(`controller.settlement -> demo (via Safe): ${(await controller.settlement()).toLowerCase() === addr.toLowerCase() ? "✓" : "✗"}`);

    fs.writeFileSync(path.join(__dirname, "..", "deployments", `cifra-default-${network.name}.json`), JSON.stringify({
        invoiceId: di.invoiceId, faceAmount: di.faceAmount, dueDate: di.dueDate, grace: 0,
        settlement: addr, supplier: di.supplier,
    }, null, 2));
    console.log(`wrote cifra-default-${network.name}.json — next: scripts/defaultSettle.ts`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
