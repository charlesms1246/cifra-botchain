"use client";

import { useAccount, useBalance, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { shortHex, amount } from "@/lib/format";
import { activeChain } from "@/lib/chain";

// Whether Privy is configured is fixed at build time, so choosing a component on it never
// changes the hook order at runtime. The two variants are separate components rather than one
// with a conditional `usePrivy()` because that hook throws outside a PrivyProvider — and calling
// hooks conditionally is a real bug, not just a lint complaint.
const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

export function WalletButton() {
  return PRIVY_ENABLED ? <PrivyWalletButton /> : <InjectedWalletButton />;
}

/** Shared connected-state UI: network guard, balance, disconnect. */
function ConnectedButton({ onDisconnect }: { onDisconnect: () => void }) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: bal } = useBalance({ address, query: { enabled: Boolean(address) } });

  // BOT Chain is absent from public chain registries, so a wallet will not know it until it is
  // added. switchChain falls back to wallet_addEthereumChain with our definition.
  if (chainId !== activeChain.id) {
    return (
      <Button size="sm" variant="outline" onClick={() => switchChain({ chainId: activeChain.id })} disabled={switching}>
        {switching ? "Switching…" : `Switch to ${activeChain.name}`}
      </Button>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={onDisconnect} title={address}>
      <span className="h-2 w-2 rounded-full bg-[color:var(--success)]" />
      <span className="hidden tabular-nums sm:inline">
        {bal ? `${amount(bal.value, bal.decimals, 3)} ${bal.symbol}` : ""}
      </span>
      <span>{shortHex(address ?? "")}</span>
    </Button>
  );
}

function InjectedWalletButton() {
  const { isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!isConnected) {
    return (
      <Button size="sm" onClick={() => connect({ connector: injected() })} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }
  return <ConnectedButton onDisconnect={() => disconnect()} />;
}

function PrivyWalletButton() {
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { login, logout, ready, authenticated } = usePrivy();

  if (!isConnected) {
    return (
      <Button size="sm" onClick={() => login()} disabled={!ready}>
        {ready ? "Sign in" : "Loading…"}
      </Button>
    );
  }
  return (
    <ConnectedButton
      onDisconnect={() => {
        if (authenticated) void logout();
        disconnect();
      }}
    />
  );
}
