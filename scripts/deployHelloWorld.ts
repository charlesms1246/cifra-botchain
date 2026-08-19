import { ethers, run, network } from "hardhat";

// Toolchain smoke test — deploys the starter's example contract to prove the
// Hardhat + Coston2 pipeline works end to end. Not part of the Cifra product.
//
//   npx hardhat run scripts/deployHelloWorld.ts --network coston2

const WORLD = "Cifra";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(`Network:  ${network.name} (chainId ${network.config.chainId})`);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} C2FLR`);

    const HelloWorld = await ethers.getContractFactory("HelloWorld");
    const helloWorld = await HelloWorld.deploy(WORLD);
    await helloWorld.waitForDeployment();

    const address = await helloWorld.getAddress();
    console.log(`\nHelloWorld deployed to: ${address}`);
    console.log(`greetWorld(): ${await helloWorld.greetWorld()}`);
    console.log(`Explorer: https://coston2-explorer.flare.network/address/${address}`);

    // Best-effort source verification; ignore failures (e.g. not yet indexed).
    try {
        await run("verify:verify", { address, constructorArguments: [WORLD] });
    } catch (e: unknown) {
        console.log(`\nVerification skipped/failed: ${(e as Error).message}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
