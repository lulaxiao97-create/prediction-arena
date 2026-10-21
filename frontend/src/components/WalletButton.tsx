"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet } from "lucide-react";
import { shortAddr } from "@/lib/format";

/**
 * Isolated so RainbowKit only ever renders on the client (its connectors touch indexedDB /
 * localStorage during wallet discovery, which must not run during prerender).
 */
export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div
            {...(!ready && {
              "aria-hidden": true,
              style: { opacity: 0, pointerEvents: "none", userSelect: "none" as const },
            })}
          >
            {(() => {
              if (!connected) {
                return (
                  <button onClick={openConnectModal} className="btn-gold px-4 py-2 text-[13px]">
                    <Wallet className="size-4" />
                    连接钱包
                  </button>
                );
              }
              if (chain.unsupported) {
                return (
                  <button
                    onClick={openChainModal}
                    className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-2 text-[13px] font-medium text-loss"
                  >
                    切换网络
                  </button>
                );
              }
              return (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openChainModal}
                    className="hidden items-center gap-1.5 rounded-xl border border-gold/30 bg-gold/10 px-2.5 py-2 text-[12px] font-medium text-gold-bright sm:flex"
                  >
                    <span className="size-1.5 rounded-full bg-profit shadow-[0_0_8px_2px_rgba(16,185,129,0.55)]" />
                    {chain.name}
                  </button>
                  <button onClick={openAccountModal} className="btn-ghost px-3 py-2 text-[13px]">
                    <span className="size-5 rounded-full bg-gradient-to-br from-gold-bright to-gold-deep" />
                    <span className="mono">{shortAddr(account.address)}</span>
                  </button>
                </div>
              );
            })()}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
