"use client";

import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { Button } from "@/components/ui/button";
import { shortHex } from "@/lib/format";
import { coston2 } from "@/lib/chain";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    return (
      <Button size="sm" onClick={() => connect({ connector: injected() })} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  if (chainId !== coston2.id) {
    return (
      <Button size="sm" variant="outline" onClick={() => switchChain({ chainId: coston2.id })}>
        Switch to Coston2
      </Button>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={() => disconnect()} title={address}>
      <span className="h-2 w-2 rounded-full bg-[color:var(--success)]" />
      {shortHex(address ?? "")}
    </Button>
  );
}
