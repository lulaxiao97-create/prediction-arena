"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider, connectorsForWallets, darkTheme } from "@rainbow-me/rainbowkit";
import {
  binanceWallet,
  bitgetWallet,
  braveWallet,
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  rainbowWallet,
  tokenPocketWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, cookieStorage, createConfig, createStorage, http, type Config } from "wagmi";
import { fallback } from "viem";
import { base, baseSepolia } from "wagmi/chains";
import { coinbaseWallet as coinbaseConnector, injected } from "wagmi/connectors";
import { useI18n } from "@/components/LocaleProvider";
import type { Locale } from "@/lib/i18n";

const projectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
// WalletConnect needs a real 32-char project id; without it we still ship injected +
// Coinbase Wallet so the dApp is usable (RainbowKit's own QR flow stays disabled).
const hasWalletConnect = /^[a-f0-9]{32}$/i.test(projectId);

/**
 * Every wallet that hands us an origin compares it against the page origin before it will
 * open — MetaMask deep links, OKX, Bitget and the WalletConnect relay all reject a mismatch.
 * This value is build-time inlined, so it has to be the live production origin; the fallback
 * keeps a local `next start` run honest instead of pointing at a domain that does not serve it.
 */
const APP_NAME = "Prediction Arena";
const APP_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://prediction-arena-81d9.onrender.com").replace(/\/+$/, "");
const APP_ICON = `${APP_URL}/icon-192.png`;
const APP_DESCRIPTION = "Binary prediction markets argued by AI agents, settled in native USDC on Base.";

const rpcBase = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const rpcBaseSepolia = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

/**
 * Base's public gateway answers bursts with HTTP 429, and some providers refuse a browser
 * origin outright. The fallback list is therefore ordered by measured browser CORS behaviour
 * (probed from this app's own origin), not by reputation: llamarpc fails its preflight and
 * 1rpc/blockpi reject keyless calls, so neither is in the list.
 */
const baseTransport = fallback([
  // Order is measured, not assumed, and it leads with the one endpoint that survives the
  // call the app actually makes most: `eth_getLogs`. Putting a 429-then-400-then-403 chain in
  // front of it meant every scan paid three failed round trips and stamped three red lines
  // into the user's console. Tenderly answers getLogs in ~1s from this origin, so it leads;
  // NEXT_PUBLIC_BASE_RPC_URL stays in the chain as the first fallback and keeps serving
  // ordinary reads whenever it is healthy.
  http("https://base.gateway.tenderly.co", { retryCount: 1, timeout: 12_000 }),
  http(rpcBase, { retryCount: 1, timeout: 12_000 }),
  http("https://base.drpc.org", { retryCount: 1, timeout: 12_000 }),
  http("https://base-rpc.publicnode.com", { retryCount: 1, timeout: 12_000 }),
  // `rank: false` — with ranking on, viem periodically probes *every* transport to score it,
  // and each probe against a rate-limited or origin-restricted endpoint writes a red line into
  // the console. The order above is already measured, so there is nothing left to rank.
], { rank: false });
const baseSepoliaTransport = fallback([
  http(rpcBaseSepolia, { retryCount: 1, timeout: 12_000 }),
  http("https://base-sepolia-rpc.publicnode.com", { retryCount: 1, timeout: 12_000 }),
]);

const chains = [base, baseSepolia] as const;

/**
 * Explicit wallet list, in the order the modal renders it.
 *
 * `injectedWallet` sits first on purpose: inside MetaMask / OKX / Bitget / TokenPocket's own
 * in-app browser the dApp is already injected, and this connects to `window.ethereum` with no
 * deep link, no relay and no QR — the "tap and it just connects" path on mobile. The branded
 * entries after it handle desktop extensions and the mobile hand-off (deep link or QR).
 */
const connectors = hasWalletConnect
  ? connectorsForWallets(
      [
        {
          groupName: "Popular",
          wallets: [
            injectedWallet,
            metaMaskWallet,
            okxWallet,
            bitgetWallet,
            trustWallet,
            binanceWallet,
            tokenPocketWallet,
          ],
        },
        {
          groupName: "More wallets",
          wallets: [coinbaseWallet, rainbowWallet, rabbyWallet, braveWallet, walletConnectWallet],
        },
      ],
      {
        appName: APP_NAME,
        appDescription: APP_DESCRIPTION,
        appUrl: APP_URL,
        appIcon: APP_ICON,
        projectId,
      }
    )
  : [
      injected({ shimDisconnect: true }),
      coinbaseConnector({ appName: APP_NAME, appLogoUrl: APP_ICON }),
    ];

const config: Config = createConfig({
  chains,
  connectors,
  transports: {
    [base.id]: baseTransport,
    [baseSepolia.id]: baseSepoliaTransport,
  },
  // cookieStorage + ssr keeps the server and the first client render in agreement; without it
  // a returning visitor's connected state flips after hydration.
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
});

// RainbowKit brings its own strings for the connect modal. Left unset it follows the
// browser language, which produced a Chinese modal inside an English page. Map the app's
// locale onto it so the wallet surface speaks the same language as the rest of the UI.
const RAINBOW_LOCALES: Record<Locale, string> = {
  en: "en-US",
  "zh-TW": "zh-TW",
  de: "de",
  fr: "fr",
  ja: "ja-JP",
  ko: "ko-KR",
};

const rainbowTheme = darkTheme({
  accentColor: "#F59E0B",
  accentColorForeground: "#0A0A0C",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});

export function Web3Provider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 8_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={rainbowTheme}
          modalSize="compact"
          locale={RAINBOW_LOCALES[locale] as never}
          appInfo={{ appName: APP_NAME, learnMoreUrl: `${APP_URL}/docs` }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
