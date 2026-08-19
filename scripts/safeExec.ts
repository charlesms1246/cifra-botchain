import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Execute an owner-gated call through the 2-of-3 Cifra governance Safe: builds the Safe tx,
// gathers `threshold` EOA signatures (owner keys from .env), and calls execTransaction.
// Exported `execViaSafe(to, data)` is reused by governance scripts; the CLI self-tests with a
// harmless 0-value no-op when run with no SAFE_TO/SAFE_DATA.
//   FLARE_RPC_API_KEY="" npx hardhat run scripts/safeExec.ts --network coston2                       # self-test
//   FLARE_RPC_API_KEY="" SAFE_TO=0x.. SAFE_DATA=0x.. npx hardhat run scripts/safeExec.ts --network coston2

const SAFE_ABI = [
    "function nonce() view returns (uint256)",
    "function getThreshold() view returns (uint256)",
    "function getOwners() view returns (address[])",
    "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
    "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
];

const norm = (k: string) => (k.trim().startsWith("0x") ? k.trim() : "0x" + k.trim());

function ownerKeys(): string[] {
    // All candidate owner keys we hold (deployer + Acc1..Acc5); filtered to Safe owners below.
    const keys = [process.env.PRIVATE_KEY];
    for (let i = 1; i <= 5; i++) if (process.env[`Acc${i}`]) keys.push(process.env[`Acc${i}`]);
    return keys.filter(Boolean).map((k) => norm(k as string));
}

export async function execViaSafe(to: string, data: string, value: bigint = 0n): Promise<string> {
    const gov = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "cifra-gov-safe.json"), "utf8"));
    const [sender] = await ethers.getSigners();
    const safe = new ethers.Contract(gov.safe, SAFE_ABI, sender);

    const threshold: bigint = await safe.getThreshold();
    const owners: string[] = (await safe.getOwners()).map((a: string) => a.toLowerCase());
    const nonce: bigint = await safe.nonce();

    const txHash: string = await safe.getTransactionHash(
        to, value, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce
    );

    // Map our held keys to Safe owners, sort by address ascending (Safe requires it), take `threshold`.
    const signers = ownerKeys()
        .map((k) => new ethers.Wallet(k))
        .filter((w) => owners.includes(w.address.toLowerCase()))
        .sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
    if (BigInt(signers.length) < threshold) throw new Error(`have ${signers.length} owner keys, need ${threshold}`);

    // Each owner signs the raw safeTxHash (v=27/28 => Safe treats as an EOA ecrecover signature).
    let signatures = "0x";
    for (const w of signers.slice(0, Number(threshold))) {
        const sig = w.signingKey.sign(txHash); // ethers Signature, v = 27/28
        signatures += ethers.Signature.from(sig).serialized.slice(2);
    }

    const tx = await safe.execTransaction(
        to, value, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signatures, { gasLimit: 1_500_000 }
    );
    const rcpt = await tx.wait();
    console.log(`  safeExec: to=${to} nonce=${nonce} -> tx ${rcpt!.hash} (status ${rcpt!.status})`);
    if (rcpt!.status !== 1) throw new Error("Safe execTransaction reverted");
    return rcpt!.hash;
}

async function main() {
    const gov = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "cifra-gov-safe.json"), "utf8"));
    const to = process.env.SAFE_TO ?? gov.safe; // default no-op target: the Safe itself
    const data = process.env.SAFE_DATA ?? "0x"; // 0-value, empty calldata = harmless self-test
    console.log(`Executing via Safe ${gov.safe}: to=${to} data=${data.slice(0, 20)}${data.length > 20 ? "…" : ""}`);
    await execViaSafe(to, data);
    console.log("Done.");
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
