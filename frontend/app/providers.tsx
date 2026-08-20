"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyConfig } from "@privy-io/wagmi";
import { useState, type ReactNode } from "react";
import { activeChain } from "@/lib/chain";

// BOT Chain is not in ethereum-lists/chains, so nothing here can rely on a wallet already
// knowing the network — every connector is handed an explicit chain definition.
// `as const` on a single-element tuple keeps wagmi's chain-id union narrow, which is what makes
// the transports record type-check against exactly that id rather than every known chain.
const chains = [activeChain] as const;
const transports = { [activeChain.id]: http() } as Record<(typeof chains)[number]["id"], ReturnType<typeof http>>;

const wagmiConfig = createConfig({ chains, connectors: [injected()], transports, ssr: true });

// Privy manages its own connectors, so its config must NOT declare `injected` as well — the two
// would race to claim the same browser wallet.
const privyWagmiConfig = createPrivyConfig({ chains, transports, ssr: true });

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  // Privy is optional: without an app id the build still runs, on injected wallets alone. That
  // keeps `npm run dev` working for anyone who clones this without credentials, rather than
  // failing at boot with an opaque Privy error.
  if (!PRIVY_APP_ID) {
    return (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["wallet", "email", "google"],
        defaultChain: activeChain,
        supportedChains: [activeChain],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: { theme: "dark", accentColor: "#7c5cff", walletChainType: "ethereum-only" },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={privyWagmiConfig}>{children}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

export const privyEnabled = Boolean(PRIVY_APP_ID);
