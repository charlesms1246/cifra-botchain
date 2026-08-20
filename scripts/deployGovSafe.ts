import "dotenv/config";
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Deploy the governance Safe that will own every Cifra contract.
//
//   GOV_OWNERS=0xA,0xB,0xC GOV_THRESHOLD=2 npx hardhat run scripts/deployGovSafe.ts --network botchain
//
// Owners are given as ADDRESSES, not keys. On mainnet the whole point is that no single machine
// holds enough to move the protocol, so the owners should be hardware wallets or separate
// people — this script never needs their private keys, only the deployer's gas.
//
// Safe 1.4.1 is deployed on BOT Chain mainnet (verified 2026-08-20) but NOT on testnet 968.
// The script checks for bytecode and fails loudly rather than deploying a proxy to nothing.

const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a"; // Safe 1.4.1 L1 singleton
const SAFE_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"; // SafeProxyFactory 1.4.1

const SAFE_SETUP_ABI = [
    "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
];
const FACTORY_ABI = [
    "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
    "event ProxyCreation(address indexed proxy, address singleton)",
];

async function main() {
    const [deployer] = await ethers.getSigners();

    for (const [name, addr] of [
        ["Safe singleton", SAFE_SINGLETON],
        ["SafeProxyFactory", SAFE_FACTORY],
    ] as const) {
        if ((await ethers.provider.getCode(addr)) === "0x")
            throw new Error(
                `${name} has no code at ${addr} on ${network.name}. Safe is not deployed on this ` +
                    `chain (it is absent from BOT Chain testnet 968). Deploy Safe yourself via the ` +
                    `CREATE2 deployer, or run this against mainnet.`
            );
    }

    const ownersRaw = (process.env.GOV_OWNERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (ownersRaw.length < 2)
        throw new Error("Set GOV_OWNERS to at least 2 comma-separated addresses, e.g. GOV_OWNERS=0xA,0xB,0xC");

    const owners = ownersRaw.map((a) => ethers.getAddress(a));
    if (new Set(owners.map((o) => o.toLowerCase())).size !== owners.length)
        throw new Error("GOV_OWNERS contains duplicates — a duplicated owner silently weakens the threshold");

    // `Number("")` is 0 and `Number("abc")` is NaN; NaN fails every comparison, so a naive range
    // check lets both through and the failure resurfaces as an opaque ethers BigNumberish error.
    const rawThreshold = (process.env.GOV_THRESHOLD ?? "").trim();
    const threshold = rawThreshold === "" ? Math.min(2, owners.length) : Number(rawThreshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length)
        throw new Error(
            `GOV_THRESHOLD must be an integer in 1..${owners.length}; got ${JSON.stringify(rawThreshold)}`
        );
    if (threshold === 1)
        console.log(`(!) threshold is 1 — this Safe is recoverable and auditable, but NOT multi-party.`);

    console.log(`Network:   ${network.name}`);
    console.log(`Deployer:  ${deployer.address} (pays gas only; not necessarily an owner)`);
    console.log(`Owners:    ${threshold}-of-${owners.length}`);
    owners.forEach((o) => console.log(`             ${o}`));

    const initializer = new ethers.Interface(SAFE_SETUP_ABI).encodeFunctionData("setup", [
        owners,
        threshold,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0,
        ethers.ZeroAddress,
    ]);

    const factory = new ethers.Contract(SAFE_FACTORY, FACTORY_ABI, deployer);
    const rcpt = await (await factory.createProxyWithNonce(SAFE_SINGLETON, initializer, BigInt(Date.now()))).wait();

    let safeAddr = "";
    for (const lg of rcpt!.logs) {
        try {
            const parsed = factory.interface.parseLog({ topics: [...lg.topics], data: lg.data });
            if (parsed?.name === "ProxyCreation") safeAddr = parsed.args[0] as string;
        } catch {
            /* not a factory event */
        }
    }
    if (!safeAddr) throw new Error("ProxyCreation event not found — Safe address unknown");

    // Read the deployed state back rather than trusting the initializer we sent.
    const safe = new ethers.Contract(
        safeAddr,
        ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"],
        ethers.provider
    );
    const onChainOwners: string[] = await safe.getOwners();
    const onChainThreshold: bigint = await safe.getThreshold();

    console.log(`\nSafe deployed: ${safeAddr}  (tx ${rcpt!.hash})`);
    console.log(`  on-chain owners:    ${onChainOwners.join(", ")}`);
    console.log(`  on-chain threshold: ${onChainThreshold}`);
    if (Number(onChainThreshold) !== threshold) throw new Error("threshold mismatch after deploy");

    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `cifra-gov-safe-${network.name}.json`);
    fs.writeFileSync(
        file,
        JSON.stringify(
            { network: network.name, chainId: Number((await ethers.provider.getNetwork()).chainId), safe: safeAddr, owners: onChainOwners, threshold: Number(onChainThreshold), deployedAt: new Date().toISOString() },
            null,
            2
        ) + "\n"
    );
    console.log(`\nSaved: ${file}`);
    console.log(`\nNext: scripts/setRoles.ts (while still EOA-owned), then scripts/transferOwnershipToGov.ts.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
