import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Deploys the Cifra product-contract layer (senior/junior tranche structure) and wires it.
//
//   Local dry-run (deploys mocks for FXRP + FDC verifier; skips FTSO nav oracles):
//     npx hardhat run scripts/deployCifra.ts
//   Coston2 (resolves real FXRP + FdcVerification + FtsoV2 from the FlareContractRegistry):
//     FLARE_RPC_API_KEY="" npx hardhat run scripts/deployCifra.ts --network coston2
//
// Env overrides (all optional):
//   FXRP_ADDRESS, FDC_VERIFICATION  — skip on-chain resolution
//   CIFRA_TEE_ADDRESS               — registered TEE identity (default: deployer; owner can update later)
//   PROTOCOL_RECEIVER_HASH          — bytes32 standard-address hash of the protocol's XRPL receiver
//   CIFRA_OPERATOR                  — funding keeper (default: deployer)
//   VERIFY=false                    — skip block-explorer verification

const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"; // canonical on all Flare networks
const GRACE_PERIOD = 3 * 24 * 3600; // 3 days
const EXPLORER = "https://coston2-explorer.flare.network";

type Deployed = { address: string; contract: any; args: unknown[] };

async function deploy(name: string, args: unknown[]): Promise<Deployed> {
    const factory = await ethers.getContractFactory(name);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`  ${name.padEnd(24)} ${address}`);
    return { address, contract, args };
}

async function resolveByName(name: string): Promise<string> {
    const reg = new ethers.Contract(
        FLARE_CONTRACT_REGISTRY,
        ["function getContractAddressByName(string) view returns (address)"],
        ethers.provider
    );
    const addr: string = await reg.getContractAddressByName(name);
    if (addr === ethers.ZeroAddress) throw new Error(`FlareContractRegistry has no "${name}" on ${network.name}`);
    return addr;
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const chainId = Number(network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);
    const isLocal = chainId === 31337 || network.name === "hardhat" || network.name === "localhost";

    console.log(`Network:  ${network.name} (chainId ${chainId})`);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}\n`);

    // --- Resolve external dependencies (FXRP, FDC verifier, FtsoV2) ---
    let fxrp = process.env.FXRP_ADDRESS;
    let fdcVerifier = process.env.FDC_VERIFICATION;
    let ftso: string | undefined;

    if (isLocal) {
        console.log("Local network — deploying mocks for FXRP + FDC verifier:");
        if (!fxrp) fxrp = (await deploy("MockFXRP", [])).address;
        if (!fdcVerifier) fdcVerifier = (await deploy("MockFdcVerifier", [])).address;
    } else {
        if (!fdcVerifier) fdcVerifier = await resolveByName("FdcVerification");
        if (!fxrp) {
            const assetManager = await resolveByName("AssetManagerFXRP");
            const am = new ethers.Contract(assetManager, ["function fAsset() view returns (address)"], ethers.provider);
            fxrp = await am.fAsset();
        }
        ftso = await resolveByName("FtsoV2");
        console.log(`Resolved FXRP:            ${fxrp}`);
        console.log(`Resolved FdcVerification: ${fdcVerifier}`);
        console.log(`Resolved FtsoV2:          ${ftso}`);
    }

    const teeAddress = process.env.CIFRA_TEE_ADDRESS ?? deployer.address;
    const operator = process.env.CIFRA_OPERATOR ?? deployer.address;
    const receiverHash =
        process.env.PROTOCOL_RECEIVER_HASH ?? ethers.keccak256(ethers.toUtf8Bytes("CIFRA_PLACEHOLDER_XRPL_RECEIVER"));
    if (!process.env.CIFRA_TEE_ADDRESS)
        console.log(`\n(!) CIFRA_TEE_ADDRESS unset — using deployer as placeholder TEE identity; owner can setTeeAddress once the machine is registered.`);
    if (!process.env.PROTOCOL_RECEIVER_HASH)
        console.log(`(!) PROTOCOL_RECEIVER_HASH unset — using a placeholder; set the real value now or later via settlement.setProtocolReceiverHash (owner-only).`);

    // --- Deploy the product contracts (tranche structure) ---
    console.log(`\nDeploying Cifra contracts:`);
    const registry = await deploy("CifraInvoiceRegistry", []);
    const attestation = await deploy("CifraAttestationNFT", ["Cifra Attestation", "CIFRA-ATT", teeAddress, registry.address]);
    const controller = await deploy("CifraTrancheController", [fxrp, registry.address, attestation.address]);
    const senior = await deploy("CifraTrancheVault", [fxrp, controller.address, "Cifra Senior FXRP", "cFXRP-S"]);
    const junior = await deploy("CifraTrancheVault", [fxrp, controller.address, "Cifra Junior FXRP", "cFXRP-J"]);
    const settlement = await deploy("CifraSettlement", [
        registry.address,
        controller.address,
        fxrp,
        fdcVerifier,
        receiverHash,
        GRACE_PERIOD,
    ]);

    // Two NAV oracles (one per tranche) — pure FTSO-priced views; skipped on local (no FtsoV2).
    let seniorNav: Deployed | undefined;
    let juniorNav: Deployed | undefined;
    if (ftso) {
        seniorNav = await deploy("CifraNavOracle", [senior.address, ftso]);
        juniorNav = await deploy("CifraNavOracle", [junior.address, ftso]);
    }

    // --- Wire ---
    console.log(`\nWiring:`);
    await (await registry.contract.setStatusUpdater(controller.address, true)).wait();
    console.log(`  registry.setStatusUpdater(controller, true)`);
    await (await controller.contract.setTrancheVaults(senior.address, junior.address)).wait();
    console.log(`  controller.setTrancheVaults(senior, junior)`);
    await (await controller.contract.setSettlement(settlement.address)).wait();
    console.log(`  controller.setSettlement(settlement)`);
    if (operator !== deployer.address) {
        await (await controller.contract.setOperator(operator)).wait();
        console.log(`  controller.setOperator(${operator})`);
    }
    console.log(`  seniorYieldShareBps = ${await controller.contract.seniorYieldShareBps()} (50/50 default)`);

    // --- Persist ---
    const out = {
        network: network.name,
        chainId,
        deployedAt: new Date().toISOString(),
        deployer: deployer.address,
        external: { fxrp, fdcVerification: fdcVerifier, ftsoV2: ftso },
        config: {
            teeAddress,
            operator,
            protocolReceiverHash: receiverHash,
            gracePeriodSeconds: GRACE_PERIOD,
            seniorYieldShareBps: 5000,
        },
        contracts: {
            CifraInvoiceRegistry: registry.address,
            CifraAttestationNFT: attestation.address,
            CifraTrancheController: controller.address,
            CifraTrancheVaultSenior: senior.address,
            CifraTrancheVaultJunior: junior.address,
            CifraSettlement: settlement.address,
            ...(seniorNav ? { CifraNavOracleSenior: seniorNav.address } : {}),
            ...(juniorNav ? { CifraNavOracleJunior: juniorNav.address } : {}),
        },
    };
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `cifra-${network.name}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`\nSaved: ${file}`);

    if (!isLocal) {
        console.log(`\nExplorer:`);
        for (const [name, addr] of Object.entries(out.contracts)) console.log(`  ${name}: ${EXPLORER}/address/${addr}`);

        if (process.env.VERIFY !== "false") {
            console.log(`\nVerifying source (best-effort)...`);
            const toVerify: Deployed[] = [registry, attestation, controller, senior, junior, settlement];
            if (seniorNav) toVerify.push(seniorNav);
            if (juniorNav) toVerify.push(juniorNav);
            for (const c of toVerify) {
                try {
                    await run("verify:verify", { address: c.address, constructorArguments: c.args });
                    console.log(`  verified ${c.address}`);
                } catch (e: any) {
                    console.log(`  verify ${c.address}: ${e.message?.split("\n")[0] ?? e}`);
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
