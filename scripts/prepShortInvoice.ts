import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Register a short-due invoice for the LIVE default demo, then (2nd run) attest + fund it —
// WITHOUT touching controller.settlement (so it can't disturb a pending settle). The settlement
// repoint to a GRACE=0 demo settlement happens later, at markDefault time.
//   Run 1: FLARE_RPC_API_KEY="" npx hardhat run scripts/prepShortInvoice.ts --network coston2
//   [then] INVOICE_ID=<id> run-test -mode score
//   Run 2: same command → attests (bound) + funds
const DUE_BUFFER = 360; // seconds until due — enough to score/attest/fund, then default shortly after
const OUT = path.join(__dirname, "..", "deployments", "default-invoice.json");

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
    const faceAmount = ethers.parseUnits("5", 6);

    if (!fs.existsSync(OUT)) {
        const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:default-demo"));
        const ref = ethers.keccak256(ethers.toUtf8Bytes(`default-${Date.now()}`));
        const dueDate = Math.floor(Date.now() / 1000) + DUE_BUFFER;
        const invoiceId = await registry.computeInvoiceId(me.address, buyerCommitment, faceAmount, dueDate, ref);
        await (await registry.registerInvoice(buyerCommitment, faceAmount, dueDate, ref)).wait();
        fs.writeFileSync(OUT, JSON.stringify({ invoiceId, faceAmount: faceAmount.toString(), dueDate, ref, buyerCommitment, supplier: me.address }, null, 2));
        console.log(`Run 1: registered ${invoiceId} (face 5 FXRP, due +${DUE_BUFFER}s @ ${dueDate}). Score it now.`);
        return;
    }

    const st = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const inputs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tee-extension", "go", "tools", "attest-inputs.json"), "utf8"));
    const invoiceId: string = st.invoiceId;
    if (!inputs.boundInvoiceId || inputs.boundInvoiceId.toLowerCase() !== invoiceId.toLowerCase())
        throw new Error(`attest-inputs bound to ${inputs.boundInvoiceId}, not ${invoiceId}`);

    const inv = await registry.getInvoice(invoiceId);
    if (inv.status !== 1n) { console.log(`already status ${inv.status} — skipping`); return; }

    const discountBps = BigInt(inputs.discountBps);
    const advance = (faceAmount * (10000n - discountBps)) / 10000n;
    const idle: bigint = await (fxrp as any).balanceOf(await controller.getAddress());
    if (idle < advance) {
        const need = advance - idle + ethers.parseUnits("1", 6);
        await (await (fxrp as any).approve(await senior.getAddress(), need)).wait();
        await (await senior.deposit(need, me.address)).wait();
    }
    // scorerAddress already set via Safe; attester = keeper (deployer), so attest directly.
    await (await attestation.attest(invoiceId, inputs.resultData, inputs.actionId, inputs.submissionTag, inputs.status, normalizeV(inputs.signature))).wait();
    await (await controller.fundInvoice(invoiceId)).wait();
    console.log(`Run 2: attested grade ${inputs.grade} + funded (advance ${ethers.formatUnits(advance, 6)} FXRP), status ${(await registry.getInvoice(invoiceId)).status} (2=Funded). Due @ ${st.dueDate}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
