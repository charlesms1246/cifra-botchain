import { ethers, network } from "hardhat";
import { NETWORKS, TWAP_WINDOW_SECONDS } from "../config/networks";

// Measure what a mainnet launch actually costs, by running the real deploy + a full lifecycle
// against a fork of mainnet and summing gas. Estimates from testnet are close but not identical
// (different token contracts, different pool), and the budget here is 1 BOT total.
//
//   FORK=1 npx hardhat run scripts/estimateMainnetCost.ts

const GWEI = 20n; // BOT Chain's fixed gas price
const M = NETWORKS[677];
let total = 0n;

const track = async (label: string, p: Promise<any>) => {
    const r = await p;
    const rcpt = r.deploymentTransaction ? await r.deploymentTransaction()!.wait() : await r.wait();
    total += rcpt.gasUsed;
    console.log(`  ${label.padEnd(42)} ${rcpt.gasUsed.toString().padStart(9)} gas`);
    return r;
};

async function main() {
    await network.provider.send("evm_mine", []);
    const [dep, funder, supplier] = await ethers.getSigners();
    const F = (n: string) => ethers.getContractFactory(n);

    console.log(`Deploy (both books, allowlist, governance-ready):`);
    const registry = await track("CifraInvoiceRegistry", (await F("CifraInvoiceRegistry")).deploy());
    const attestation = await track(
        "CifraAttestationNFT",
        (await F("CifraAttestationNFT")).deploy("Cifra Attestation", "CIFRA-ATT", dep.address, await registry.getAddress())
    );
    const funders = await track("CifraFunderRegistry", (await F("CifraFunderRegistry")).deploy(false));

    for (const [key, book] of Object.entries(M.books)) {
        const c = await track(
            `CifraTrancheController[${key}]`,
            (await F("CifraTrancheController")).deploy(book.asset, await registry.getAddress(), await attestation.getAddress())
        );
        const s = await track(
            `CifraTrancheVault[${key}:senior]`,
            (await F("CifraTrancheVault")).deploy(book.asset, await c.getAddress(), book.seniorName, book.seniorSymbol, await funders.getAddress())
        );
        const j = await track(
            `CifraTrancheVault[${key}:junior]`,
            (await F("CifraTrancheVault")).deploy(book.asset, await c.getAddress(), book.juniorName, book.juniorSymbol, await funders.getAddress())
        );
        await track(`CifraSettlement[${key}]`, (await F("CifraSettlement")).deploy(await c.getAddress(), 3 * 24 * 3600));
        if (book.navPool)
            await track(`CifraNavOracle[${key}]`, (await F("CifraNavOracle")).deploy(await s.getAddress(), book.navPool, TWAP_WINDOW_SECONDS));
        if (book.nativeHelper)
            await track(`CifraNativeDepositHelper[${key}]`, (await F("CifraNativeDepositHelper")).deploy(M.wrappedNative));

        await track(`  wire ${key}: setTrancheVaults`, c.setTrancheVaults(await s.getAddress(), await j.getAddress()));
        await track(`  wire ${key}: setSettlement`, c.setSettlement(dep.address));
        await track(`  wire ${key}: registry.setStatusUpdater`, registry.setStatusUpdater(await c.getAddress(), true));
    }

    const deployGas = total;
    console.log(`\n  DEPLOY SUBTOTAL${" ".repeat(28)}${deployGas.toString().padStart(9)} gas  = ${ethers.formatEther(deployGas * GWEI * 10n ** 9n)} BOT\n`);

    console.log(`Governance handover (Safe deploy is separate; these are our calls):`);
    const before = total;
    await track("  setScorerAddress", attestation.setScorerAddress(funder.address));
    await track("  setAttester", attestation.setAttester(funder.address));
    await track("  transferOwnership x6 (one shown)", attestation.transferOwnership(funder.address));
    // Three calls measured; the real handover is 2 setters + 6 transferOwnership. Scale by 8/3.
    const govGas = ((total - before) * 8n) / 3n;
    const cost = (g: bigint) => ethers.formatEther(g * GWEI * 10n ** 9n);
    console.log(`  GOVERNANCE (2 setters + 6 transfers)${" ".repeat(7)}${govGas.toString().padStart(9)} gas  = ${cost(govGas)} BOT`);
    console.log(`  (the Safe proxy itself is ~300k more, ≈ 0.006 BOT)\n`);

    console.log(`TOTAL FIXED LAUNCH COST ≈ ${cost(deployGas + govGas + 300_000n)} BOT at ${GWEI} gwei`);
    console.log(`\nNote: tranche deposits and invoice face amounts are RECYCLABLE — they come back`);
    console.log(`on withdrawal/settlement. Only gas is actually spent.`);
}

main().catch((e) => {
    console.error(String(e).split("\n").slice(0, 3).join("\n"));
    process.exit(1);
});
