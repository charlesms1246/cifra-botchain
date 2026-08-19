import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Real-FDC settle, step 1 (two-run — the grade must be scored bound to the freshly-registered id):
//   Run 1: registers a fresh invoice and prints the invoiceId to score.
//   [then] INVOICE_ID=<invoiceId> run-test -mode score   (bound grade -> attest-inputs.json)
//   Run 2: attests the bound grade, ensures tranche liquidity, and funds (advance to supplier).
// Then make the XRPL payment (memo = invoiceId) and run scripts/realSettle.ts.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/realSettlePrep.ts --network coston2

const INSTRUCTION_SENDER = "0xC2a56d4a4bBafd2bAbb62aa77fc3E6B3D08A96AC";
const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const NGROK = "https://unexposed-mountain-sushi.ngrok-free.dev";
const OUT = (net: string) => path.join(__dirname, "..", "deployments", "real-settle.json");

function normalizeV(sig: string): string {
    const b = ethers.getBytes(sig);
    if (b.length === 65 && b[64] < 27) b[64] += 27;
    return ethers.hexlify(b);
}

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const [me] = await ethers.getSigners();

    const fxrp = await ethers.getContractAt("IERC20", dep.external.fxrp);
    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.contracts.CifraAttestationNFT);
    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    const senior = await ethers.getContractAt("CifraTrancheVault", dep.contracts.CifraTrancheVaultSenior);
    const outPath = OUT(network.name);

    const faceAmount = ethers.parseUnits("5", 6);

    // --- Run 1: register + print the score command ---
    if (!fs.existsSync(outPath)) {
        const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:real-settle"));
        const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
        const ref = ethers.keccak256(ethers.toUtf8Bytes(`real-${Date.now()}`));
        const invoiceId = await registry.computeInvoiceId(me.address, buyerCommitment, faceAmount, dueDate, ref);
        await (await registry.registerInvoice(buyerCommitment, faceAmount, dueDate, ref)).wait();
        fs.writeFileSync(outPath, JSON.stringify({ invoiceId, faceAmount: faceAmount.toString(), dueDate }, null, 2));
        console.log(`Run 1 done. Registered invoice ${invoiceId} (face 5 FXRP).`);
        console.log(`\nNEXT: score bound to it, then re-run this script:`);
        console.log(`  cd tee-extension && set -a && source .env && set +a && cd go/tools && \\`);
        console.log(`  INVOICE_ID=${invoiceId} go run ./cmd/run-test -mode score -a ../../config/coston2/deployed-addresses.json -c ${RPC} -instructionSender ${INSTRUCTION_SENDER} -p ${NGROK}`);
        return;
    }

    // --- Run 2: attest (bound) + ensure liquidity + fund ---
    const rs = JSON.parse(fs.readFileSync(outPath, "utf8"));
    const inputs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tee-extension", "go", "tools", "attest-inputs.json"), "utf8"));
    const invoiceId: string = rs.invoiceId;
    const discountBps = BigInt(inputs.discountBps);
    const advance = (faceAmount * (10000n - discountBps)) / 10000n;

    const inv = await registry.getInvoice(invoiceId);
    if (inv.status !== 1n) {
        console.log(`invoice ${invoiceId} already at status ${inv.status} — skipping attest/fund. Ready for realSettle.ts.`);
        return;
    }

    if (!inputs.boundInvoiceId || inputs.boundInvoiceId.toLowerCase() !== invoiceId.toLowerCase())
        throw new Error(`attest-inputs.json is bound to ${inputs.boundInvoiceId}, not ${invoiceId}. Score it: INVOICE_ID=${invoiceId} run-test -mode score`);

    // Ensure controller pool liquidity for the advance; top up the senior tranche if short.
    const idle: bigint = await (fxrp as any).balanceOf(await controller.getAddress());
    if (idle < advance) {
        const need = advance - idle + ethers.parseUnits("1", 6);
        await (await (fxrp as any).approve(await senior.getAddress(), need)).wait();
        await (await senior.deposit(need, me.address)).wait();
        console.log(`deposited ${ethers.formatUnits(need, 6)} FXRP into senior tranche for liquidity`);
    }

    if ((await attestation.scorerAddress()) !== ethers.getAddress(inputs.signerEip191))
        await (await attestation.setScorerAddress(ethers.getAddress(inputs.signerEip191))).wait();
    await (await attestation.attest(invoiceId, inputs.resultData, inputs.actionId, inputs.submissionTag, inputs.status, normalizeV(inputs.signature))).wait();
    console.log(`attested grade ${inputs.grade} (real TEE ${inputs.signerEip191})`);

    await (await controller.fundInvoice(invoiceId)).wait();
    console.log(`funded: advanced ${ethers.formatUnits(advance, 6)} FXRP to supplier; status ${(await registry.getInvoice(invoiceId)).status} (2=Funded)`);
    console.log(`\nNEXT: XRPL payment of ${ethers.formatUnits(faceAmount, 6)} XRP with memo = invoiceId, then scripts/realSettle.ts.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
