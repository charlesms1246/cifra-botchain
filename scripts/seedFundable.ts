import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Seed a fundable invoice for the UI: register + attest a fresh invoice, left in
// Registered state (NOT funded) with a far-future due date, so the operator Fund button
// is clickable end-to-end.
//
// Two runs (the grade must be scored bound to the freshly-registered id):
//   Run 1: register the invoice, print its id to score.
//   [then] post-build (open forwarding window) + INVOICE_ID=<id> run-test -mode score
//   Run 2: attest the bound grade → invoice is Registered + attested = fundable.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/seedFundable.ts --network coston2
const OUT = (net: string) => path.join(__dirname, "..", "deployments", `cifra-fundable-${net}.json`);

function normalizeV(sig: string): string {
  const b = ethers.getBytes(sig);
  if (b.length === 65 && b[64] < 27) b[64] += 27;
  return ethers.hexlify(b);
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
  const [me] = await ethers.getSigners();
  const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.contracts.CifraInvoiceRegistry);
  const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.contracts.CifraAttestationNFT);
  const outPath = OUT(network.name);
  const faceAmount = ethers.parseUnits("8", 6);
  const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:Northwind-Traders"));

  if (!fs.existsSync(outPath)) {
    const ref = ethers.keccak256(ethers.toUtf8Bytes(`fundable-${Date.now()}`));
    const dueDate = Math.floor(Date.now() / 1000) + 60 * 24 * 3600; // +60d (not defaultable meanwhile)
    const invoiceId = await registry.computeInvoiceId(me.address, buyerCommitment, faceAmount, dueDate, ref);
    await (await registry.registerInvoice(buyerCommitment, faceAmount, dueDate, ref)).wait();
    fs.writeFileSync(outPath, JSON.stringify({ invoiceId, faceAmount: faceAmount.toString(), dueDate, ref, buyerCommitment, supplier: me.address }, null, 2));
    console.log(`Run 1 done. Registered fundable invoice ${invoiceId} (face 8 FXRP, due +60d).`);
    console.log(`\nNEXT: open a forwarding window + score it, then re-run this script:`);
    console.log(`  cd tee-extension && ./scripts/post-build.sh`);
    console.log(`  cd tee-extension && set -a && source .env && set +a && cd go/tools && \\`);
    console.log(`  INVOICE_ID=${invoiceId} go run ./cmd/run-test -mode score -a ../../config/coston2/deployed-addresses.json -c https://coston2-api.flare.network/ext/C/rpc -instructionSender 0xC2a56d4a4bBafd2bAbb62aa77fc3E6B3D08A96AC -p https://unexposed-mountain-sushi.ngrok-free.dev`);
    return;
  }

  const st = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const inputs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tee-extension", "go", "tools", "attest-inputs.json"), "utf8"));
  const invoiceId: string = st.invoiceId;
  if (!inputs.boundInvoiceId || inputs.boundInvoiceId.toLowerCase() !== invoiceId.toLowerCase())
    throw new Error(`attest-inputs.json is bound to ${inputs.boundInvoiceId}, not ${invoiceId}. Score it first: INVOICE_ID=${invoiceId} run-test -mode score`);

  const inv = await registry.getInvoice(invoiceId);
  if (inv.status !== 1n) {
    console.log(`invoice status ${inv.status} (not Registered) — nothing to do.`);
    return;
  }
  if ((await attestation.teeAddress()) !== ethers.getAddress(inputs.signerEip191))
    await (await attestation.setTeeAddress(ethers.getAddress(inputs.signerEip191))).wait();
  await (await attestation.attest(invoiceId, inputs.resultData, inputs.actionId, inputs.submissionTag, inputs.status, normalizeV(inputs.signature))).wait();
  console.log(`✅ attested grade ${inputs.grade} — invoice ${invoiceId} is Registered + attested (fundable).`);
  console.log(`   It will appear in the marketplace with an active Fund button for the vault operator.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
