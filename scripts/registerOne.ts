import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Register one fresh invoice and save its id (for the v2 live-score proof).
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/registerOne.ts --network coston2
async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const [me] = await ethers.getSigners();
    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:v2-demo"));
    const faceAmount = ethers.parseUnits("5", 6);
    const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const ref = ethers.keccak256(ethers.toUtf8Bytes(`v2-${Date.now()}`));
    const invoiceId = await registry.computeInvoiceId(me.address, buyerCommitment, faceAmount, dueDate, ref);
    await (await registry.registerInvoice(buyerCommitment, faceAmount, dueDate, ref)).wait();
    fs.writeFileSync(path.join(__dirname, "..", "deployments", "v2-invoice.json"), JSON.stringify({ invoiceId, faceAmount: faceAmount.toString(), dueDate }, null, 2));
    console.log(`registered v2 invoice ${invoiceId}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
