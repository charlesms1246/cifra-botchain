import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { execViaSafe } from "./safeExec";

// ---------------------------------------------------------------------------
// Live default path, step 1 (register -> attest -> fund a short-grace invoice).
//
// Two-run flow (the grade must be scored bound to the freshly-registered id):
//   Run 1: deploys a demo CifraSettlement with GRACE=0 (shortened for the live demo —
//          the canonical settlement keeps the real 3-day grace), registers the invoice,
//          and prints the invoiceId to score.
//   [then] INVOICE_ID=<invoiceId> run-test -mode score   (bound grade -> attest-inputs.json)
//   Run 2: attests the bound grade and funds the invoice (advance to supplier).
//
// After dueDate passes with no buyer payment, scripts/defaultSettle.ts proves default via
// a real FDC ReferencedPaymentNonexistence attestation.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/defaultPrep.ts --network coston2
// ---------------------------------------------------------------------------

const RECEIVER_HASH = "0x3be1ff50026ff3e80885a8360715cb9743921339be1c38edb9c25a96cce68b21"; // protocol XRPL receiver
const DUE_BUFFER = 240; // seconds until due — covers register + score + attest + fund, then a short wait
const GRACE = 0; // demo grace (canonical settlement uses 3 days); disclosed
const OUT = (net: string) => path.join(__dirname, "..", "deployments", `cifra-default-${net}.json`);

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

    // --- Run 1: deploy demo settlement + register ---
    if (!fs.existsSync(outPath)) {
        const settlement = await (await ethers.getContractFactory("CifraSettlement")).deploy(
            dep.contracts.CifraInvoiceRegistry, dep.contracts.CifraTrancheController, dep.external.fxrp,
            dep.external.fdcVerification, RECEIVER_HASH, GRACE
        );
        await settlement.waitForDeployment();
        // controller.setSettlement is owner-gated and owner is now the 2-of-3 Safe → route the
        // swap through governance (demonstrates the multisig in the default flow).
        await execViaSafe(
            dep.contracts.CifraTrancheController,
            controller.interface.encodeFunctionData("setSettlement", [await settlement.getAddress()])
        );

        const faceAmount = ethers.parseUnits("5", 6);
        const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:default-demo"));
        const ref = ethers.keccak256(ethers.toUtf8Bytes(`default-${Date.now()}`));
        const dueDate = Math.floor(Date.now() / 1000) + DUE_BUFFER;
        const invoiceId = await registry.computeInvoiceId(me.address, buyerCommitment, faceAmount, dueDate, ref);
        await (await registry.registerInvoice(buyerCommitment, faceAmount, dueDate, ref)).wait();

        fs.writeFileSync(outPath, JSON.stringify({
            invoiceId, faceAmount: faceAmount.toString(), dueDate, ref, buyerCommitment,
            settlement: await settlement.getAddress(), grace: GRACE, supplier: me.address,
        }, null, 2));
        console.log(`Run 1 done. Demo settlement ${await settlement.getAddress()} (GRACE=${GRACE}).`);
        console.log(`Registered invoice ${invoiceId} (face 5 FXRP, due in ${DUE_BUFFER}s @ ${dueDate}).`);
        console.log(`\nNEXT: score bound to it, then re-run this script:`);
        console.log(`  cd tee-extension && set -a && source .env && set +a && cd go/tools && \\`);
        console.log(`  INVOICE_ID=${invoiceId} go run ./cmd/run-test -mode score -a ../../config/coston2/deployed-addresses.json -c ${dep?.rpc ?? "https://coston2-api.flare.network/ext/C/rpc"} -instructionSender 0xC2a56d4a4bBafd2bAbb62aa77fc3E6B3D08A96AC -p https://unexposed-mountain-sushi.ngrok-free.dev`);
        return;
    }

    // --- Run 2: attest (bound) + fund ---
    const st = JSON.parse(fs.readFileSync(outPath, "utf8"));
    const inputs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tee-extension", "go", "tools", "attest-inputs.json"), "utf8"));
    const invoiceId: string = st.invoiceId;
    const faceAmount = BigInt(st.faceAmount);

    if (!inputs.boundInvoiceId || inputs.boundInvoiceId.toLowerCase() !== invoiceId.toLowerCase())
        throw new Error(`attest-inputs.json is bound to ${inputs.boundInvoiceId}, not ${invoiceId}. Score it first: INVOICE_ID=${invoiceId} run-test -mode score`);

    const inv = await registry.getInvoice(invoiceId);
    if (inv.status === 1n) {
        if ((await attestation.scorerAddress()) !== ethers.getAddress(inputs.signerEip191))
            await (await attestation.setScorerAddress(ethers.getAddress(inputs.signerEip191))).wait();
        await (await attestation.attest(invoiceId, inputs.resultData, inputs.actionId, inputs.submissionTag, inputs.status, normalizeV(inputs.signature))).wait();
        console.log(`attested grade ${inputs.grade} (real TEE ${inputs.signerEip191})`);

        const discountBps = BigInt(inputs.discountBps);
        const advance = (faceAmount * (10000n - discountBps)) / 10000n;
        const idle: bigint = await (fxrp as any).balanceOf(await controller.getAddress());
        if (idle < advance) {
            const need = advance - idle + ethers.parseUnits("1", 6);
            await (await (fxrp as any).approve(await senior.getAddress(), need)).wait();
            await (await senior.deposit(need, me.address)).wait();
        }
        await (await controller.fundInvoice(invoiceId)).wait();
        console.log(`funded: advanced ${ethers.formatUnits(advance, 6)} FXRP, status ${(await registry.getInvoice(invoiceId)).status} (2=Funded)`);
    } else {
        console.log(`invoice already at status ${inv.status} — skipping attest/fund`);
    }

    console.log(`\nDue at ${st.dueDate} (grace ${st.grace}s). After that, run: FLARE_RPC_API_KEY="" npx hardhat run scripts/defaultSettle.ts --network coston2`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
