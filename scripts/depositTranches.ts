import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Seed the senior + junior tranches with FXRP liquidity (real approve + deposit writes).
// Amounts in whole FXRP via env (defaults 6 senior / 4 junior — a junior first-loss buffer).
//   FLARE_RPC_API_KEY="" SENIOR=6 JUNIOR=4 npx hardhat run scripts/depositTranches.ts --network coston2

async function main() {
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`), "utf8"));
    const [me] = await ethers.getSigners();

    const fxrp = await ethers.getContractAt("IERC20", dep.external.fxrp);
    const controller = await ethers.getContractAt("CifraTrancheController", dep.contracts.CifraTrancheController);
    const senior = await ethers.getContractAt("CifraTrancheVault", dep.contracts.CifraTrancheVaultSenior);
    const junior = await ethers.getContractAt("CifraTrancheVault", dep.contracts.CifraTrancheVaultJunior);

    const seniorAmt = ethers.parseUnits(process.env.SENIOR ?? "6", 6);
    const juniorAmt = ethers.parseUnits(process.env.JUNIOR ?? "4", 6);

    const bal: bigint = await (fxrp as any).balanceOf(me.address);
    console.log(`Deployer FXRP: ${ethers.formatUnits(bal, 6)} — depositing ${ethers.formatUnits(seniorAmt, 6)} senior / ${ethers.formatUnits(juniorAmt, 6)} junior`);
    if (bal < seniorAmt + juniorAmt) throw new Error("insufficient FXRP — run scripts/collectFXRP.ts or use the faucet");

    for (const [name, vault, amt] of [["senior", senior, seniorAmt], ["junior", junior, juniorAmt]] as const) {
        await (await (fxrp as any).approve(await vault.getAddress(), amt)).wait();
        await (await vault.deposit(amt, me.address)).wait();
        const claim: bigint = await controller.claimOf(await vault.getAddress());
        const shares: bigint = await vault.balanceOf(me.address);
        console.log(`  ${name}: deposited ${ethers.formatUnits(amt, 6)} FXRP → claim ${ethers.formatUnits(claim, 6)}, shares ${ethers.formatUnits(shares, 9)}`);
    }

    console.log(`\nController NAV: ${ethers.formatUnits(await controller.nav(), 6)} FXRP (pool ${ethers.formatUnits(await (fxrp as any).balanceOf(await controller.getAddress()), 6)} idle + ${ethers.formatUnits(await controller.totalDeployed(), 6)} deployed)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
