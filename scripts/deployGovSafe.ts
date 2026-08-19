import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Deploy a real 2-of-3 Gnosis Safe on Coston2 via the canonical SafeProxyFactory (v1.4.1,
// already deployed on Coston2). This becomes the governance owner of the Cifra contracts —
// no single key can change protocol params. Owners: deployer + Acc1 + Acc2 (from .env), all
// keys we control so governance is executable for the demo (see scripts/safeExec.ts).
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/deployGovSafe.ts --network coston2

const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a"; // Safe 1.4.1 (L1 singleton), present on Coston2
const SAFE_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"; // SafeProxyFactory 1.4.1
const THRESHOLD = 2;

const SAFE_SETUP_ABI = [
    "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
];
const FACTORY_ABI = [
    "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
    "event ProxyCreation(address indexed proxy, address singleton)",
];

const norm = (k: string) => (k.trim().startsWith("0x") ? k.trim() : "0x" + k.trim());

async function main() {
    const [deployer] = await ethers.getSigners();

    const acc1 = process.env.Acc1, acc2 = process.env.Acc2;
    if (!acc1 || !acc2) throw new Error("need Acc1 + Acc2 keys in .env for the 2-of-3 Safe owners");
    const owners = [
        deployer.address,
        new ethers.Wallet(norm(acc1)).address,
        new ethers.Wallet(norm(acc2)).address,
    ];
    console.log(`Owners (${THRESHOLD}-of-${owners.length}): ${owners.join(", ")}`);

    // Build the Safe.setup() initializer (no fallback handler / payment for a minimal governance Safe).
    const setupIface = new ethers.Interface(SAFE_SETUP_ABI);
    const initializer = setupIface.encodeFunctionData("setup", [
        owners, THRESHOLD, ethers.ZeroAddress, "0x", ethers.ZeroAddress, ethers.ZeroAddress, 0, ethers.ZeroAddress,
    ]);

    const factory = new ethers.Contract(SAFE_FACTORY, FACTORY_ABI, deployer);
    const saltNonce = BigInt(Date.now());
    const tx = await factory.createProxyWithNonce(SAFE_SINGLETON, initializer, saltNonce);
    const rcpt = await tx.wait();

    // Parse the ProxyCreation event for the deployed Safe address.
    let safeAddr = "";
    for (const lg of rcpt!.logs) {
        try {
            const parsed = factory.interface.parseLog(lg);
            if (parsed?.name === "ProxyCreation") { safeAddr = parsed.args.proxy; break; }
        } catch { /* not our event */ }
    }
    if (!safeAddr) throw new Error("ProxyCreation event not found");

    // Verify on-chain state.
    const safe = new ethers.Contract(safeAddr, [
        "function getOwners() view returns (address[])",
        "function getThreshold() view returns (uint256)",
        "function nonce() view returns (uint256)",
    ], ethers.provider);
    const [onOwners, onThreshold] = [await safe.getOwners(), await safe.getThreshold()];
    console.log(`\nSafe deployed: ${safeAddr} (tx ${rcpt!.hash})`);
    console.log(`  owners:    ${onOwners.join(", ")}`);
    console.log(`  threshold: ${onThreshold} · nonce ${await safe.nonce()}`);

    const out = {
        network: network.name,
        safe: safeAddr,
        singleton: SAFE_SINGLETON,
        factory: SAFE_FACTORY,
        owners,
        threshold: THRESHOLD,
        deployTx: rcpt!.hash,
        deployedAt: new Date().toISOString(),
    };
    const file = path.join(__dirname, "..", "deployments", "cifra-gov-safe.json");
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`\nSaved ${file}`);
    console.log(`Explorer: https://coston2-explorer.flare.network/address/${safeAddr}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
