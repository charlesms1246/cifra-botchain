import { network } from "hardhat";
import { createWalletClient, createPublicClient, http, defineChain, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// BOT Chain reports baseFeePerGas = 0 with a fixed 20 gwei eth_gasPrice. viem and wagmi default
// to EIP-1559 fee estimation, which on a zero-basefee chain can compute a maxFeePerGas below
// what the node will accept — producing transactions that are silently never mined.
//
// The frontend uses viem, but everything tested so far went through ethers/hardhat. This script
// closes that gap by sending a real transaction through viem with DEFAULT estimation, exactly as
// the browser would.
//
//   npx hardhat run scripts/checkGasModel.ts --network botchainTestnet

// Read the same variables the deploy targets use, or this validates fee behaviour against a
// different endpoint than the one that actually matters — the exact gap it exists to close.
const rpcFor = (chainId: number): string => {
    const pick = (key: string, fallback: string) => {
        const v = process.env[key];
        return v && v.trim() !== "" ? v.trim() : fallback;
    };
    if (chainId === 677) return pick("BOTCHAIN_RPC_URL", "https://rpc.botchain.ai");
    if (chainId === 968) return pick("BOTCHAIN_TESTNET_RPC_URL", "https://rpc.bohr.life");
    throw new Error(
        `checkGasModel only applies to BOT Chain (677 / 968); got chainId ${chainId}. ` +
            `Run it with --network botchain or --network botchainTestnet.`
    );
};

async function main() {
    const chainId = Number(network.config.chainId);
    const chain = defineChain({
        id: chainId,
        name: `BOT Chain ${chainId}`,
        nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
        rpcUrls: { default: { http: [rpcFor(chainId)] } },
    });

    const pk = process.env.PRIVATE_KEY!;
    const account = privateKeyToAccount((pk.startsWith("0x") ? pk : "0x" + pk) as `0x${string}`);
    const pub = createPublicClient({ chain, transport: http() });
    const wallet = createWalletClient({ account, chain, transport: http() });

    const block = await pub.getBlock();
    const gasPrice = await pub.getGasPrice();
    console.log(`chain ${chainId}  block ${block.number}`);
    console.log(`  baseFeePerGas   ${block.baseFeePerGas ?? "null"}`);
    console.log(`  eth_gasPrice    ${gasPrice} (${Number(gasPrice) / 1e9} gwei)`);

    let est: Awaited<ReturnType<typeof pub.estimateFeesPerGas>> | null = null;
    try {
        est = await pub.estimateFeesPerGas();
        console.log(`  viem 1559 est   maxFee ${est.maxFeePerGas} / maxPriority ${est.maxPriorityFeePerGas}`);
    } catch (e) {
        console.log(`  viem 1559 est   FAILED: ${String(e).split("\n")[0]}`);
    }

    if (est?.maxFeePerGas !== undefined && est.maxFeePerGas < gasPrice) {
        console.log(
            `\n(!) viem's estimated maxFeePerGas (${est.maxFeePerGas}) is BELOW eth_gasPrice ` +
                `(${gasPrice}). Transactions using default estimation may never be mined — the ` +
                `frontend must pin fees or send legacy transactions.`
        );
    }

    // The real test: a 0-value self-send with viem's default fee handling.
    console.log(`\nsending a 0-value self-transfer with viem defaults…`);
    const hash = await wallet.sendTransaction({ to: account.address, value: 0n });
    console.log(`  tx ${hash}`);
    const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    const tx = await pub.getTransaction({ hash });
    console.log(`  mined in block ${rcpt.blockNumber}  status ${rcpt.status}  type ${tx.type}`);
    console.log(`  effectiveGasPrice ${rcpt.effectiveGasPrice} (${Number(rcpt.effectiveGasPrice) / 1e9} gwei)`);
    console.log(
        rcpt.status === "success"
            ? `\nPASS — viem's default fee path works on this chain; the frontend needs no override.`
            : `\nFAIL — transaction reverted.`
    );
}

main().catch((e) => {
    console.error(String(e).split("\n").slice(0, 4).join("\n"));
    process.exit(1);
});
