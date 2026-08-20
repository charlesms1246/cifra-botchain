This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## BOT Chain configuration

The app reads its addresses from `lib/deployment.json`, which is a copy of the repo-root
`deployments/cifra-<network>.json` written by the deploy script. Vercel only sees `frontend/`,
so it cannot reach the repo-root file — if addresses look wrong, re-sync:

```bash
NETWORK=botchainTestnet npx ts-node scripts/syncFrontendDeployment.ts   # from the repo root
```

`lib/chain.ts` picks the chain from that record's `chainId`. Note that **Multicall3 is not
deployed on chain 968**, so the testnet definition deliberately omits it — declaring it would
make wagmi batch every read into a call to an empty address.

### Wallets

Injected wallets work with no configuration. Privy is optional:

```bash
NEXT_PUBLIC_PRIVY_APP_ID=<your app id>   # enables email / social login + embedded wallets
```

Without it the app still builds and runs on injected wallets alone, so a fresh clone works
without credentials.

⚠️ `@privy-io/wagmi` pins `viem` to an exact version, so `package.json` pins `viem` and carries
an `overrides` entry. Installs need `--legacy-peer-deps` because Privy's optional
`permissionless`/`ox` sub-tree conflicts otherwise.
