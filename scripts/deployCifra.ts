import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { networkConfig, isLocalChain, TWAP_WINDOW_SECONDS, type BookConfig, type BookKey } from "../config/networks";

// Deploys the Cifra product layer to BOT Chain as TWO INDEPENDENT BOOKS (BOT + USDT).
//
//   Local dry-run (mock assets, mock pool, mock wrapped-native):
//     npx hardhat run scripts/deployCifra.ts
//   BOT Chain testnet (968):
//     npx hardhat run scripts/deployCifra.ts --network botchainTestnet
//   BOT Chain mainnet (677):
//     npx hardhat run scripts/deployCifra.ts --network botchain
//
// WHY TWO BOOKS AND NOT ONE MULTI-ASSET POOL
// CifraTrancheController holds a single immutable IERC20 and never converts between assets.
// Running the stack once per settlement asset is what keeps FX risk out of the loan book: an
// invoice is faced, funded and repaid in the same token, so no price oracle is ever consulted
// on a path where money moves. See claude-docs/DECISIONS.md D3.
//
// The registry and the attestation NFT are SHARED across both books — an invoice is registered
// and graded once, and the book it is funded from is a funding-time decision.
//
// Env overrides (all optional):
//   CIFRA_SCORER_ADDRESS  — the scoring service's signing key (default: deployer, updatable later)
//   CIFRA_OPERATOR        — funding keeper (default: deployer)
//   CIFRA_BOOKS           — comma-separated subset, e.g. "usdt" (default: both)
//   CIFRA_GRACE_DAYS      — days past due before an invoice can be defaulted (default: 3)
//   CIFRA_RESTRICT_FUNDERS — "true" deploys the funder allowlist ENFORCING from block one
//                            (default: false — deploy the registry but leave it open, so it can
//                            be switched on by governance without redeploying the vaults)
//   VERIFY=false          — skip block-explorer verification

type Deployed = { name: string; address: string; contract: any; args: unknown[] };

/** Read an env var, treating "" as unset. `.env.example` ships empty placeholders, so a plain
 *  `??` would hand an empty string straight to ethers and fail deep inside ENS resolution. */
const env = (key: string): string | undefined => {
    const v = process.env[key];
    return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
};

const deployedAll: Deployed[] = [];

async function deploy(name: string, args: unknown[], label?: string): Promise<Deployed> {
    const factory = await ethers.getContractFactory(name);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`  ${(label ?? name).padEnd(34)} ${address}`);
    const d = { name, address, contract, args };
    deployedAll.push(d);
    return d;
}

/** Deploy one book: controller + senior/junior vaults (+ NAV oracle, + native helper). */
async function deployBook(
    key: BookKey,
    book: BookConfig,
    registry: string,
    attestation: string,
    operator: string,
    deployer: string,
    wrappedNative: string,
    gracePeriod: number,
    funderRegistry: string
) {
    console.log(`\n── ${book.label} book ──`);
    console.log(`  asset                              ${book.asset}`);

    const controller = await deploy(
        "CifraTrancheController",
        [book.asset, registry, attestation],
        `CifraTrancheController[${key}]`
    );
    const senior = await deploy(
        "CifraTrancheVault",
        [book.asset, controller.address, book.seniorName, book.seniorSymbol, funderRegistry],
        `CifraTrancheVault[${key}:senior]`
    );
    const junior = await deploy(
        "CifraTrancheVault",
        [book.asset, controller.address, book.juniorName, book.juniorSymbol, funderRegistry],
        `CifraTrancheVault[${key}:junior]`
    );

    // Display-only NAV oracle. Deployed for the senior tranche of a volatile book only; the
    // USDT book has no navPool because its NAV already IS the USD figure.
    let navOracle: Deployed | undefined;
    if (book.navPool) {
        navOracle = await deploy(
            "CifraNavOracle",
            [senior.address, book.navPool, TWAP_WINDOW_SECONDS],
            `CifraNavOracle[${key}:senior]`
        );
    } else {
        console.log(`  CifraNavOracle[${key}]              (skipped — no navPool configured)`);
    }

    // One-transaction native-BOT entry/exit, only for the wrapped-native book.
    let helper: Deployed | undefined;
    if (book.nativeHelper && book.asset.toLowerCase() === wrappedNative.toLowerCase()) {
        helper = await deploy("CifraNativeDepositHelper", [wrappedNative], `CifraNativeDepositHelper[${key}]`);
    }

    // Settlement reads its asset straight off the controller, so it takes no asset argument
    // and the two can never be pointed at different tokens.
    const settlement = await deploy("CifraSettlement", [controller.address, gracePeriod], `CifraSettlement[${key}]`);

    console.log(`  wiring:`);
    await (await controller.contract.setTrancheVaults(senior.address, junior.address)).wait();
    console.log(`    controller.setTrancheVaults(senior, junior)`);
    await (await controller.contract.setSettlement(settlement.address)).wait();
    console.log(`    controller.setSettlement(${settlement.address})`);
    if (operator !== deployer) {
        await (await controller.contract.setOperator(operator)).wait();
        console.log(`    controller.setOperator(${operator})`);
    }

    return {
        asset: book.asset,
        controller: controller.address,
        seniorVault: senior.address,
        juniorVault: junior.address,
        settlement: settlement.address,
        ...(navOracle ? { navOracle: navOracle.address } : {}),
        ...(helper ? { nativeDepositHelper: helper.address } : {}),
    };
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const chainId = Number(network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);
    const local = isLocalChain(chainId) || network.name === "hardhat" || network.name === "localhost";

    console.log(`Network:  ${network.name} (chainId ${chainId})`);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}\n`);

    // ── Resolve external addresses PER NETWORK ──────────────────────────────────
    // Never share addresses across chains: on BOT Chain testnet the mainnet USDT address is a
    // different token entirely (`WES`) and would transact silently. See config/networks.ts.
    let cfg;
    let explorer: string;
    if (local) {
        console.log("Local network — deploying mock externals:");
        const wbot = await deploy("MockWrappedNative", []);
        const usdt = await deploy("MockAsset", ["Mock USDT", "USDT", 6]);
        const pool = await deploy("MockV3Pool", [wbot.address, usdt.address]);
        await (await pool.contract.setTicks(0, 0)).wait();
        cfg = {
            wrappedNative: wbot.address,
            books: {
                bot: {
                    label: "BOT",
                    asset: wbot.address,
                    seniorName: "Cifra Senior BOT",
                    seniorSymbol: "cBOT-S",
                    juniorName: "Cifra Junior BOT",
                    juniorSymbol: "cBOT-J",
                    navPool: pool.address,
                    nativeHelper: true,
                },
                usdt: {
                    label: "USDT",
                    asset: usdt.address,
                    seniorName: "Cifra Senior USDT",
                    seniorSymbol: "cUSDT-S",
                    juniorName: "Cifra Junior USDT",
                    juniorSymbol: "cUSDT-J",
                },
            } as Record<BookKey, BookConfig>,
        };
        explorer = "";
    } else {
        const n = networkConfig(chainId);
        cfg = { wrappedNative: n.wrappedNative, books: n.books };
        explorer = n.explorer;
        console.log(`Resolved wrappedNative (WBOT): ${n.wrappedNative}`);
        for (const [k, b] of Object.entries(n.books)) console.log(`Resolved ${k.padEnd(5)} asset:          ${b.asset}`);
        if (!n.multicall3) console.log(`(!) Multicall3 is NOT deployed on chain ${chainId} — frontend must omit it.`);
        if (!n.safe)
            console.log(`(!) Safe is NOT deployed on chain ${chainId} — governance stays on the deployer here.`);
    }

    const scorerAddress = env("CIFRA_SCORER_ADDRESS") ?? deployer.address;
    const graceDays = Number(env("CIFRA_GRACE_DAYS") ?? "3");
    const gracePeriod = graceDays * 24 * 3600;
    const operator = env("CIFRA_OPERATOR") ?? deployer.address;
    if (!env("CIFRA_SCORER_ADDRESS"))
        console.log(
            `\n(!) CIFRA_SCORER_ADDRESS unset — using the deployer as a placeholder scoring key.\n` +
                `    Point it at the real service key later with attestation.setScorerAddress(...).`
        );

    // ── Shared layer: one registry + one attestation NFT across both books ──────
    console.log(`\n── shared ──`);
    const registry = await deploy("CifraInvoiceRegistry", []);

    // The allowlist is ALWAYS deployed, even when it starts open. The vaults bind it
    // immutably at construction, so a book deployed without one can never be restricted later
    // without redeploying — and "we might need KYC eventually" is not a reason to redeploy a
    // live vault. Restriction is then a governance switch, not a migration.
    const restrictFrom = env("CIFRA_RESTRICT_FUNDERS") === "true";
    const funderRegistry = await deploy("CifraFunderRegistry", [restrictFrom]);
    console.log(
        `  funder allowlist                   ${restrictFrom ? "ENFORCING from deploy" : "deployed but OPEN (setRestricted(true) to enforce)"}`
    );
    const attestation = await deploy("CifraAttestationNFT", [
        "Cifra Attestation",
        "CIFRA-ATT",
        scorerAddress,
        registry.address,
    ]);

    // ── Books ───────────────────────────────────────────────────────────────────
    const requested = (env("CIFRA_BOOKS") ?? "bot,usdt")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as BookKey[];

    const books: Record<string, unknown> = {};
    const controllers: string[] = [];
    for (const key of requested) {
        const book = cfg.books[key];
        if (!book) throw new Error(`Unknown book "${key}". Known: ${Object.keys(cfg.books).join(", ")}`);
        const out = await deployBook(
            key,
            book,
            registry.address,
            attestation.address,
            operator,
            deployer.address,
            cfg.wrappedNative,
            gracePeriod,
            funderRegistry.address
        );
        books[key] = out;
        controllers.push(out.controller);
    }

    // Every book's controller must be able to advance invoice status on the shared registry.
    console.log(`\n── shared wiring ──`);
    for (const c of controllers) {
        await (await registry.contract.setStatusUpdater(c, true)).wait();
        console.log(`  registry.setStatusUpdater(${c}, true)`);
    }

    // ── Persist ─────────────────────────────────────────────────────────────────
    const out = {
        network: network.name,
        chainId,
        deployedAt: new Date().toISOString(),
        deployer: deployer.address,
        config: {
            scorerAddress,
            operator,
            twapWindowSeconds: TWAP_WINDOW_SECONDS,
            gracePeriodSeconds: gracePeriod,
            fundersRestricted: restrictFrom,
        },
        external: { wrappedNative: cfg.wrappedNative },
        shared: {
            CifraInvoiceRegistry: registry.address,
            CifraAttestationNFT: attestation.address,
            CifraFunderRegistry: funderRegistry.address,
        },
        books,
    };
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `cifra-${network.name}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`\nSaved: ${file}`);

    // Keep the frontend's copy in step. Vercel only ever sees `frontend/`, so it cannot read
    // `deployments/` — and a stale copy means the UI silently points at dead addresses.
    const feDir = path.join(__dirname, "..", "frontend", "lib");
    if (fs.existsSync(feDir)) {
        fs.writeFileSync(path.join(feDir, "deployment.json"), JSON.stringify(out, null, 2) + "\n");
        console.log(`Synced: frontend/lib/deployment.json`);
    }

    if (!local) {
        console.log(`\nExplorer:`);
        for (const d of deployedAll) console.log(`  ${d.name.padEnd(28)} ${explorer}/address/${d.address}`);

        if (env("VERIFY") !== "false") {
            console.log(`\nVerifying source (best-effort)...`);
            for (const d of deployedAll) {
                try {
                    await run("verify:verify", { address: d.address, constructorArguments: d.args });
                    console.log(`  verified ${d.address}`);
                } catch (e: any) {
                    console.log(`  verify ${d.address}: ${String(e.message ?? e).split("\n")[0]}`);
                }
            }
        }
    }

    console.log(`\nDone.`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
