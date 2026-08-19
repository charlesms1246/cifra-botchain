import { ethers } from "hardhat";

// Sweeps FXRP from the funded source wallets (Acc1..AccN in .env) into the deployer
// (PRIVATE_KEY). Each source signs its own transfer and pays gas in native C2FLR.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/collectFXRP.ts --network coston2

const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7"; // FTestXRP, 6dp
const FXRP_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function decimals() view returns (uint8)",
];

function norm(k: string): string {
    k = k.trim();
    return k.startsWith("0x") ? k : "0x" + k;
}

const TARGET_GAS = ethers.parseEther("0.3"); // FAsset transfers cost ~0.14 C2FLR — leave margin
const MIN_GAS = ethers.parseEther("0.2");

async function main() {
    const provider = ethers.provider;
    const deployer = new ethers.Wallet(norm(process.env.PRIVATE_KEY as string), provider);
    console.log(`Destination (deployer): ${deployer.address}`);
    console.log(`Deployer C2FLR: ${ethers.formatEther(await provider.getBalance(deployer.address))}\n`);

    // Collect Acc1..Acc12 that are present in the env.
    const sources: { name: string; key: string }[] = [];
    for (let i = 1; i <= 12; i++) {
        const v = process.env[`Acc${i}`];
        if (v) sources.push({ name: `Acc${i}`, key: v });
    }
    if (sources.length === 0) throw new Error("no Acc1..N keys found in .env");
    console.log(`Found ${sources.length} source wallet(s): ${sources.map((s) => s.name).join(", ")}\n`);

    const fxrpRead = new ethers.Contract(FXRP, FXRP_ABI, provider);
    let swept = 0n;

    for (const s of sources) {
        const w = new ethers.Wallet(norm(s.key), provider);
        const [bal, gas] = await Promise.all([fxrpRead.balanceOf(w.address), provider.getBalance(w.address)]);
        const balStr = ethers.formatUnits(bal, 6);
        process.stdout.write(`${s.name} ${w.address}: ${balStr} FXRP, ${ethers.formatEther(gas)} C2FLR gas — `);

        if (bal === 0n) {
            console.log("nothing to sweep");
            continue;
        }
        try {
            // Top up gas from the deployer if the source can't pay for its own transfer.
            if (gas < MIN_GAS) {
                const topup = TARGET_GAS - gas;
                const t = await deployer.sendTransaction({ to: w.address, value: topup });
                await t.wait();
                process.stdout.write(`gas-topped ${ethers.formatEther(topup)} C2FLR → `);
            }
            const fxrp = new ethers.Contract(FXRP, FXRP_ABI, w);
            const tx = await fxrp.transfer(deployer.address, bal);
            await tx.wait();
            swept += bal;
            console.log(`swept ${balStr} FXRP ✓ (${tx.hash})`);
        } catch (e: any) {
            console.log(`FAILED: ${e.shortMessage || e.message}`);
        }
    }

    const finalBal = await fxrpRead.balanceOf(deployer.address);
    console.log(`\nSwept ${ethers.formatUnits(swept, 6)} FXRP into deployer.`);
    console.log(`Deployer FXRP balance now: ${ethers.formatUnits(finalBal, 6)} FTestXRP`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
