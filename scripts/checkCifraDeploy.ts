import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Verifies a Cifra deployment is live and correctly wired, then registers one
// invoice on-chain as an end-to-end smoke test.
//   npx hardhat run scripts/checkCifraDeploy.ts --network coston2

async function main() {
    const file = path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`);
    const dep = JSON.parse(fs.readFileSync(file, "utf8"));
    const [signer] = await ethers.getSigners();
    console.log(`Network ${network.name} — checking deployment from ${file}\n`);

    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.contracts.CifraAttestationNFT);
    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    const senior = await ethers.getContractAt("CifraTrancheVault", dep.contracts.CifraTrancheVaultSenior);
    const junior = await ethers.getContractAt("CifraTrancheVault", dep.contracts.CifraTrancheVaultJunior);
    const settlement = await ethers.getContractAt("CifraSettlement", dep.contracts.CifraSettlement);

    // --- Wiring assertions ---
    const checks: [string, unknown, unknown][] = [
        ["controller.FXRP() == FXRP", (await controller.FXRP()).toLowerCase(), dep.external.fxrp.toLowerCase()],
        ["controller.REGISTRY() == registry", await controller.REGISTRY(), dep.contracts.CifraInvoiceRegistry],
        ["controller.ATTESTATION() == attestation", await controller.ATTESTATION(), dep.contracts.CifraAttestationNFT],
        ["controller.seniorVault() == senior", await controller.seniorVault(), dep.contracts.CifraTrancheVaultSenior],
        ["controller.juniorVault() == junior", await controller.juniorVault(), dep.contracts.CifraTrancheVaultJunior],
        ["controller.settlement() == settlement", await controller.settlement(), dep.contracts.CifraSettlement],
        ["controller.seniorYieldShareBps() == 5000", await controller.seniorYieldShareBps(), 5000n],
        ["senior.CONTROLLER() == controller", await senior.CONTROLLER(), dep.contracts.CifraTrancheController],
        ["junior.CONTROLLER() == controller", await junior.CONTROLLER(), dep.contracts.CifraTrancheController],
        ["senior.asset() == FXRP", (await senior.asset()).toLowerCase(), dep.external.fxrp.toLowerCase()],
        ["registry.isStatusUpdater(controller)", await registry.isStatusUpdater(dep.contracts.CifraTrancheController), true],
        ["attestation.REGISTRY() == registry", await attestation.REGISTRY(), dep.contracts.CifraInvoiceRegistry],
        ["settlement.CONTROLLER() == controller", await settlement.CONTROLLER(), dep.contracts.CifraTrancheController],
        ["settlement.FXRP() == FXRP", (await settlement.FXRP()).toLowerCase(), dep.external.fxrp.toLowerCase()],
    ];
    let ok = true;
    for (const [label, got, want] of checks) {
        const pass = String(got).toLowerCase() === String(want).toLowerCase();
        ok = ok && pass;
        console.log(`  ${pass ? "✓" : "✗"} ${label}${pass ? "" : `  (got ${got}, want ${want})`}`);
    }
    if (!ok) throw new Error("wiring check failed");

    // --- Live smoke test: register one invoice ---
    console.log(`\nRegistering a test invoice on-chain...`);
    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:smoke-test"));
    const faceAmount = ethers.parseUnits("1000", 6);
    const dueDate = Math.floor(Date.now() / 1000) + 14 * 24 * 3600;
    const ref = ethers.keccak256(ethers.toUtf8Bytes(`smoke-${Date.now()}`));
    const invoiceId = await registry.computeInvoiceId(signer.address, buyerCommitment, faceAmount, dueDate, ref);

    const tx = await registry.registerInvoice(buyerCommitment, faceAmount, dueDate, ref);
    const receipt = await tx.wait();
    const inv = await registry.getInvoice(invoiceId);

    console.log(`  tx: ${receipt?.hash}`);
    console.log(`  invoiceId: ${invoiceId}`);
    console.log(`  stored: supplier=${inv.supplier} faceAmount=${inv.faceAmount} status=${inv.status} (1=Registered)`);
    console.log(`  exists: ${await registry.exists(invoiceId)}`);

    console.log(`\nAll wiring verified and a real invoice registered on ${network.name}.`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
