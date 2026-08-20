import * as fs from "fs";
import * as path from "path";

// Copy a deployment record into the frontend so the app is self-contained (Vercel builds only
// see `frontend/`, so it cannot reach up into `deployments/`).
//
//   npx hardhat run scripts/syncFrontendDeployment.ts --network botchainTestnet
//   NETWORK=botchain npx ts-node scripts/syncFrontendDeployment.ts
//
// Run this after every deploy — addresses change whenever a contract's ABI does.

const network = process.env.NETWORK ?? process.env.HARDHAT_NETWORK ?? "botchainTestnet";
const src = path.join(__dirname, "..", "deployments", `cifra-${network}.json`);
const dst = path.join(__dirname, "..", "frontend", "lib", "deployment.json");

if (!fs.existsSync(src)) {
    console.error(`No deployment record at ${src}. Deploy first.`);
    process.exit(1);
}
const dep = JSON.parse(fs.readFileSync(src, "utf8"));
if (dep.chainId === 31337 || dep.chainId === 1337) {
    console.error(
        `Refusing to sync a LOCAL deployment (chainId ${dep.chainId}). Those addresses exist only ` +
            `on an ephemeral in-memory chain and would silently repoint the app at nothing.`
    );
    process.exit(1);
}
fs.writeFileSync(dst, JSON.stringify(dep, null, 2) + "\n");
console.log(`synced ${network} (chainId ${dep.chainId}) -> frontend/lib/deployment.json`);
for (const [k, v] of Object.entries<any>(dep.books)) console.log(`  ${k}: controller ${v.controller}`);
