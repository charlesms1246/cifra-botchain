import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Post-deploy assertions: re-read every wiring decision off-chain state rather than trusting
// the deploy log. Run after any deploy:
//   npx hardhat run scripts/checkDeploy.ts --network botchainTestnet

const ok = (label: string, pass: boolean, detail = "") => {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
    if (!pass) process.exitCode = 1;
};

async function main() {
    const file = path.join(__dirname, "..", "deployments", `cifra-${network.name}.json`);
    const dep = JSON.parse(fs.readFileSync(file, "utf8"));
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    console.log(`${network.name} (chainId ${chainId})  deployed ${dep.deployedAt}\n`);
    ok("deployment file matches the connected chain", dep.chainId === chainId, `${dep.chainId} vs ${chainId}`);

    const registry = await ethers.getContractAt("CifraInvoiceRegistry", dep.shared.CifraInvoiceRegistry);
    const attestation = await ethers.getContractAt("CifraAttestationNFT", dep.shared.CifraAttestationNFT);

    console.log("\nshared");
    ok("registry has code", (await ethers.provider.getCode(dep.shared.CifraInvoiceRegistry)) !== "0x");
    ok("attestation.REGISTRY points at the registry", (await attestation.REGISTRY()) === dep.shared.CifraInvoiceRegistry);
    ok("attestation.scorerAddress is set", (await attestation.scorerAddress()) === dep.config.scorerAddress);
    ok("attestation.attester is set", (await attestation.attester()) === dep.deployer);

    if (dep.shared.CifraFunderRegistry) {
        const fr = await ethers.getContractAt("CifraFunderRegistry", dep.shared.CifraFunderRegistry, ethers.provider);
        const restricted = await fr.restricted();
        ok("funder allowlist deployed", true, dep.shared.CifraFunderRegistry);
        console.log(`        participation: ${restricted ? "RESTRICTED — allowlist enforced" : "OPEN — anyone may deposit"}`);
    } else {
        ok("funder allowlist deployed", false, "vaults are permanently permissionless — cannot be restricted later");
    }

    for (const [key, b] of Object.entries<any>(dep.books)) {
        console.log(`\n${key} book`);
        const controller = await ethers.getContractAt("CifraTrancheController", b.controller);
        const senior = await ethers.getContractAt("CifraTrancheVault", b.seniorVault);
        const junior = await ethers.getContractAt("CifraTrancheVault", b.juniorVault);

        ok("controller.ASSET is the book asset", (await controller.ASSET()) === b.asset);
        ok("controller.REGISTRY is the shared registry", (await controller.REGISTRY()) === dep.shared.CifraInvoiceRegistry);
        ok("controller.ATTESTATION is the shared NFT", (await controller.ATTESTATION()) === dep.shared.CifraAttestationNFT);
        ok("controller.seniorVault wired", (await controller.seniorVault()) === b.seniorVault);
        ok("controller.juniorVault wired", (await controller.juniorVault()) === b.juniorVault);
        ok("senior.asset() matches the book", (await senior.asset()) === b.asset);
        ok("junior.asset() matches the book", (await junior.asset()) === b.asset);
        ok("senior.CONTROLLER points back", (await senior.CONTROLLER()) === b.controller);
        if (dep.shared.CifraFunderRegistry)
            ok("senior vault is bound to the allowlist", (await senior.FUNDER_REGISTRY()) === dep.shared.CifraFunderRegistry);
        ok("junior.CONTROLLER points back", (await junior.CONTROLLER()) === b.controller);
        ok("registry trusts this controller as a status updater", await registry.isStatusUpdater(b.controller));
        ok("controller is unpaused", !(await controller.paused()));
        ok("seniorYieldShareBps = 5000", (await controller.seniorYieldShareBps()) === 5000n);
        // NOT "NAV is zero" — this script is also run post-launch, where a non-zero NAV is the
        // whole point. Assert the accounting invariant from the controller's header instead,
        // which must hold at every moment of the protocol's life:
        //   ASSET.balanceOf(controller) + totalDeployed == assetsOf[senior] + assetsOf[junior]
        const assetToken = new ethers.Contract(
            b.asset,
            ["function balanceOf(address) view returns (uint256)"],
            ethers.provider
        );
        const idle: bigint = await assetToken.balanceOf(b.controller);
        const deployed: bigint = await controller.totalDeployed();
        const claims: bigint = (await controller.claimOf(b.seniorVault)) + (await controller.claimOf(b.juniorVault));
        ok(
            "NAV invariant: idle + deployed == senior + junior claims",
            idle + deployed === claims,
            `idle ${idle} + deployed ${deployed} = ${idle + deployed} vs claims ${claims}`
        );
        console.log(`        NAV ${await controller.nav()} (idle ${idle}, deployed ${deployed})`);

        // Share decimals = asset decimals + 3 (the ERC-4626 inflation-attack offset).
        const assetMeta = new ethers.Contract(b.asset, ["function decimals() view returns (uint8)", "function symbol() view returns (string)"], ethers.provider);
        const assetDec = Number(await assetMeta.decimals());
        ok(`share decimals = asset(${assetDec}) + 3`, Number(await senior.decimals()) === assetDec + 3, `${await senior.decimals()}`);
        console.log(`        asset symbol ${await assetMeta.symbol()}, ${assetDec}dp; shares ${await senior.symbol()} / ${await junior.symbol()}`);

        if (b.settlement) {
            const settlement = await ethers.getContractAt("CifraSettlement", b.settlement);
            ok("settlement.CONTROLLER points at this book", (await settlement.CONTROLLER()) === b.controller);
            ok("settlement.ASSET matches the book asset", (await settlement.ASSET()) === b.asset);
            ok("controller trusts this settlement", (await controller.settlement()) === b.settlement);
            ok("grace period is set", (await settlement.GRACE_PERIOD()) === BigInt(dep.config.gracePeriodSeconds));
            // Settlement is atomic — funds pass straight through to the controller — so any
            // resting balance means someone transferred the asset directly instead of calling
            // payInvoice, and it needs sweeping.
            const stuck = await new ethers.Contract(b.asset, ["function balanceOf(address) view returns (uint256)"], ethers.provider).balanceOf(b.settlement);
            ok("settlement holds no balance at rest", stuck === 0n, `${stuck} stranded`);
        } else {
            ok("settlement deployed", false, "missing from the deployment record");
        }

        if (b.nativeDepositHelper) {
            const helper = await ethers.getContractAt("CifraNativeDepositHelper", b.nativeDepositHelper);
            ok("helper.WRAPPED is the canonical wrapped native", (await helper.WRAPPED()) === dep.external.wrappedNative);
            ok("helper wraps the same asset this book uses", (await helper.WRAPPED()) === b.asset);
        }
        if (b.navOracle) {
            const oracle = await ethers.getContractAt("CifraNavOracle", b.navOracle);
            ok("navOracle base token is the book asset", (await oracle.BASE_TOKEN()) === b.asset);
            const [tick, tickOk] = await oracle.meanTickSafe();
            console.log(`        TWAP tick ${tick} (usable: ${tickOk})`);
        }
    }
    console.log(process.exitCode ? "\nFAILURES ABOVE" : "\nAll checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
