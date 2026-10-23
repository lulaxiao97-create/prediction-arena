"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet } from "lucide-react";
import { shortAddr } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Isolated so RainbowKit only ever renders on the client (its connectors touch indexedDB /
 * localStorage during wallet discovery, which must not run during prerender).
 */
export function WalletButton() {
  const { t } = useI18n();
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
                  <button onClick={openConnectModal} className="btn-gold shrink-0 px-3 py-2 text-[13px] sm:px-4">
                    <Wallet className="size-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.connect")}</span>
                  </button>
                );
              }
              if (chain.unsupported) {
                return (
                  <button
                    onClick={openChainModal}
                    className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-2 text-[13px] font-medium text-loss"
                  >
                    {t("nav.wrongNetwork")}
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
                  <button onClick={openAccountModal} className="btn-ghost shrink-0 px-2.5 py-2 text-[13px] sm:px-3">
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
