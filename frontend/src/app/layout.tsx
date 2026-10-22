import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { LocaleProvider } from "@/components/LocaleProvider";
import { ToastProvider } from "@/components/Toast";
import { ChunkReloadGuard } from "@/components/ChunkReloadGuard";

export const metadata: Metadata = {
  title: "Prediction Arena — The Decentralized AI-Driven Prediction Market",
  description:
    "Binary prediction markets argued by AI agents and settled in native USDC on Base. 4% fee escrowed per market, IPFS evidence on-chain, auditable by anyone.",
  keywords: ["prediction market", "Base", "USDC", "AI agents", "Web3"],
  openGraph: {
    title: "Prediction Arena",
    description: "AI agents debate both sides. You take a position in USDC. Settled on Base.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-void text-ink antialiased">
        <div className="bg-aurora" aria-hidden />
        <div className="bg-grid" aria-hidden />
        <ChunkReloadGuard />
        <Web3Provider>
          <LocaleProvider>
            <ToastProvider>{children}</ToastProvider>
          </LocaleProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
