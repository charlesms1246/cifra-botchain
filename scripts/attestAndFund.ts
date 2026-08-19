import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Attest the current attest-inputs.json grade to an already-registered INVOICE_ID and fund it.
// (The TEE address must already be set on the NFT — do it via safeExec first if the signer rotated.)
//   FLARE_RPC_API_KEY="" INVOICE_ID=0x… npx hardhat run scripts/attestAndFund.ts --network coston2
function normalizeV(sig: string): string {
    const b = ethers.getBytes(sig);
    if (b.length === 65 && b[64] < 27) b[64] += 27;
    return ethers.hexlify(b);
}

async function main() {
    const invoiceId = process.env.INVOICE_ID;
    if (!invoiceId) throw new Error("set INVOICE_ID");
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const inputs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tee-extension", "go", "tools", "attest-inputs.json"), "utf8"));
    const [me] = await ethers.getSigners();

    if (!inputs.boundInvoiceId || inputs.boundInvoiceId.toLowerCase() !== invoiceId.toLowerCase())
        throw new Error(`attest-inputs.json is bound to ${inputs.boundInvoiceId}, not ${invoiceId} — re-score with this INVOICE_ID`);

    const fxrp = await ethers.getContractAt("IERC20", dep.external.fxrp);
    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.contracts.CifraAttestationNFT);
    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    const senior = await ethers.getContractAt("CifraTrancheVault", dep.contracts.CifraTrancheVaultSenior);

    const inv = await registry.getInvoice(invoiceId);
    if (inv.status !== 1n) { console.log(`invoice status ${inv.status} — already attested/funded; nothing to do.`); return; }

    if ((await attestation.teeAddress()).toLowerCase() !== inputs.signerEip191.toLowerCase())
        throw new Error(`NFT teeAddress != score signer ${inputs.signerEip191}. Set it via the Safe first:\n  SAFE_TO=${dep.contracts.CifraAttestationNFT} SAFE_DATA=$(node -e "…setTeeAddress(${inputs.signerEip191})…") npx hardhat run scripts/safeExec.ts --network coston2`);

    await (await attestation.attest(invoiceId, inputs.resultData, inputs.actionId, inputs.submissionTag, inputs.status, normalizeV(inputs.signature))).wait();
    console.log(`attested grade ${inputs.grade} (real TEE ${inputs.signerEip191})`);

    if (process.env.ATTEST_ONLY) {
        console.log(`ATTEST_ONLY — leaving the invoice Registered + graded so it can be funded manually (Fund button / fundInvoice).`);
        return;
    }

    // Ensure the controller pool can cover the advance; top up the senior tranche if short.
    const discountBps = BigInt(inputs.discountBps);
    const advance = (inv.faceAmount * (10000n - discountBps)) / 10000n;
    const idle: bigint = await (fxrp as any).balanceOf(await controller.getAddress());
    if (idle < advance) {
        const need = advance - idle + ethers.parseUnits("1", 6);
        await (await (fxrp as any).approve(await senior.getAddress(), need)).wait();
        await (await senior.deposit(need, me.address)).wait();
        console.log(`topped up senior tranche with ${ethers.formatUnits(need, 6)} FXRP for liquidity`);
    }
    await (await controller.fundInvoice(invoiceId)).wait();
    console.log(`funded: advanced ${ethers.formatUnits(advance, 6)} FXRP to the supplier; status ${(await registry.getInvoice(invoiceId)).status} (2=Funded)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
