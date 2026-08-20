import "dotenv/config";
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Separate the operational roles BEFORE handing ownership to the Safe.
//
//   CIFRA_SCORER=0x… CIFRA_OPERATOR=0x… CIFRA_ATTESTER=0x… \
//     npx hardhat run scripts/setRoles.ts --network botchain
//
// ORDER MATTERS. Every setter here is owner-gated, so this must run while the deployer still
// owns the contracts. Run it after transferOwnershipToGov.ts and each of these becomes a
// multi-sig proposal instead of a transaction.
//
// WHY SEPARATE KEYS AT ALL. Today one EOA is owner, operator, attester and scorer. That single
// key can retarget the scorer, mint any grade, fund any invoice and sweep settlement. Splitting
// them means a leak of the hot service key cannot change who is trusted, and a leak of the
// keeper key cannot forge a grade.
//
//   scorer   — held ONLY by the Cloud Run service (GCP Secret Manager). Signs grades.
//   attester — submits signed grades on-chain. A warm keeper.
//   operator — calls fundInvoice. A warm keeper. May be the same as attester.
//   owner    — the Safe. Changes parameters and the three roles above.

/** First non-empty of the given env names. Empty strings count as unset — `.env.example` ships
 *  placeholders, and `??` would happily pass "" straight through to ethers. */
const req = (...keys: string[]): string => {
    for (const k of keys) {
        const v = process.env[k];
        if (v && v.trim() !== "") return ethers.getAddress(v.trim());
    }
    throw new Error(`One of ${keys.join(" / ")} is required (an address)`);
};

async function main() {
    const [signer] = await ethers.getSigners();
    const file = path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`);
    const dep = JSON.parse(fs.readFileSync(file, "utf8"));

    // CIFRA_SCORER_ADDRESS is the name used by deployCifra.ts and .env.example; CIFRA_SCORER is
    // accepted as a synonym so the documented variable cannot silently fail here.
    const scorer = req("CIFRA_SCORER_ADDRESS", "CIFRA_SCORER");
    const operator = req("CIFRA_OPERATOR");
    const attester = process.env.CIFRA_ATTESTER ? ethers.getAddress(process.env.CIFRA_ATTESTER) : operator;

    console.log(`Network ${network.name}   signer ${signer.address}\n`);
    console.log(`  scorer   -> ${scorer}`);
    console.log(`  attester -> ${attester}`);
    console.log(`  operator -> ${operator}\n`);

    if (scorer.toLowerCase() === signer.address.toLowerCase())
        console.log(`(!) scorer equals the deployer. On mainnet the scorer key should exist ONLY inside\n    the Cloud Run service, never on this machine.\n`);

    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.shared.CifraAttestationNFT, signer);

    // Check EVERY contract this script will write to, before writing to any of them. Checking
    // only the attestation contract meant a controller owned by someone else reverted halfway,
    // leaving the scorer and attester already changed and the on-disk record never updated.
    const willWrite: { label: string; owner: string }[] = [
        { label: "CifraAttestationNFT", owner: await attestation.owner() },
    ];
    for (const [key, b] of Object.entries<any>(dep.books)) {
        const c = await ethers.getContractAt("CifraTrancheController", b.controller, ethers.provider);
        willWrite.push({ label: `CifraTrancheController[${key}]`, owner: await c.owner() });
    }
    const notOurs = willWrite.filter((w) => w.owner.toLowerCase() !== signer.address.toLowerCase());
    if (notOurs.length > 0)
        throw new Error(
            `The signer does not own: ${notOurs.map((n) => `${n.label} (owner ${n.owner})`).join(", ")}. ` +
                `Ownership has already moved — set these roles through the Safe (scripts/safeExec.ts) ` +
                `instead. Nothing was changed.`
        );

    if ((await attestation.scorerAddress()).toLowerCase() !== scorer.toLowerCase()) {
        await (await attestation.setScorerAddress(scorer)).wait();
        console.log(`  attestation.setScorerAddress(${scorer})`);
    }
    if ((await attestation.attester()).toLowerCase() !== attester.toLowerCase()) {
        await (await attestation.setAttester(attester)).wait();
        console.log(`  attestation.setAttester(${attester})`);
    }

    for (const [key, b] of Object.entries<any>(dep.books)) {
        const controller = await ethers.getContractAt("CifraTrancheController", b.controller, signer);
        if ((await controller.operator()).toLowerCase() !== operator.toLowerCase()) {
            await (await controller.setOperator(operator)).wait();
            console.log(`  ${key}: controller.setOperator(${operator})`);
        }
    }

    dep.config = { ...dep.config, scorerAddress: scorer, operator, attester };
    fs.writeFileSync(file, JSON.stringify(dep, null, 2) + "\n");
    const feDir = path.join(__dirname, "..", "frontend", "lib");
    if (fs.existsSync(feDir)) fs.writeFileSync(path.join(feDir, "deployment.json"), JSON.stringify(dep, null, 2) + "\n");
    console.log(`\nUpdated ${file} (and the frontend copy).`);
    console.log(`Next: scripts/transferOwnershipToGov.ts`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
