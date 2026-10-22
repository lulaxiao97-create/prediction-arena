"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  WagmiProvider,
  cookieStorage,
  createConfig,
  createStorage,
  http,
  type Config,
} from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";

const projectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "").trim();
// WalletConnect needs a real 32-char project id; without it we still ship injected +
// Coinbase Wallet so the dApp is usable (RainbowKit's own QR flow stays disabled).
const hasWalletConnect = /^[a-f0-9]{32}$/i.test(projectId);

const rpcBase = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const rpcBaseSepolia = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const chains = [base, baseSepolia] as const;

const config: Config = hasWalletConnect
  ? getDefaultConfig({
      appName: "Prediction Arena",
      appDescription: "The decentralized AI-driven prediction market — Base / USDC",
      projectId,
      chains,
      ssr: true,
      transports: {
        [base.id]: http(rpcBase),
        [baseSepolia.id]: http(rpcBaseSepolia),
      },
    })
  : createConfig({
      chains,
      // WalletConnect Core opens an IndexedDB store as soon as it is constructed, which throws
      // during SSR. It is therefore only wired in when a real project id exists (then
      // getDefaultConfig handles it above).
      connectors: [injected({ shimDisconnect: true }), coinbaseWallet({ appName: "Prediction Arena" })],
      transports: {
        [base.id]: http(rpcBase),
        [baseSepolia.id]: http(rpcBaseSepolia),
      },
      storage: createStorage({ storage: cookieStorage }),
      ssr: true,
    });

const rainbowTheme = darkTheme({
  accentColor: "#F59E0B",
  accentColorForeground: "#0A0A0C",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});

export function Web3Provider({ children }: { children: ReactNode }) {
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
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
