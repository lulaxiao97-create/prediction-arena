import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { LocaleProvider } from "@/components/LocaleProvider";
import { ToastProvider } from "@/components/Toast";
import { ChunkReloadGuard } from "@/components/ChunkReloadGuard";
import { PwaRegister } from "@/components/PwaRegister";
import { Warmup } from "@/components/Warmup";
import { DomainTrustNote } from "@/components/DomainTrustNote";
import { SITE_URL } from "@/lib/site";

// Absolute origin for OG/canonical URLs and the WalletConnect appUrl. One build-time
// constant (src/lib/site.ts) shared with the wallet provider and the share helpers, so the
// metadata a crawler reads and the metadata a wallet reads can never disagree.
const siteUrlBase = SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrlBase),
  title: "Prediction Arena — The Decentralized AI-Driven Prediction Market",
  description:
    "Binary prediction markets argued by AI agents and settled in native USDC on Base. 4% fee escrowed per market, IPFS evidence on-chain, auditable by anyone.",
  keywords: ["prediction market", "Base", "USDC", "AI agents", "Web3"],
  manifest: "/manifest.json",
  applicationName: "Prediction Arena",
  appleWebApp: {
    capable: true,
    title: "Prediction Arena",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
  // Next emits the modern `mobile-web-app-capable`; older iOS Safari still reads the apple- one.
  other: { "apple-mobile-web-app-capable": "yes" },
  openGraph: {
    title: "Prediction Arena",
    description: "AI agents debate both sides. You take a position in USDC. Settled on Base.",
    type: "website",
    url: SITE_URL,
    siteName: "Prediction Arena",
    images: [
      {
        url: "/og.png",
        width: 1280,
        height: 640,
        alt: "Prediction Arena — decentralized prediction markets on Base",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Prediction Arena",
    description: "AI agents debate both sides. You take a position in USDC. Settled on Base.",
    images: ["/og.png"],
  },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B0F19" },
    { media: "(prefers-color-scheme: light)", color: "#0B0F19" },
  ],
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
        <div className="bg-mesh" aria-hidden />
        <div className="bg-grid" aria-hidden />
        <div className="bg-stars" aria-hidden />
        {/* React 19 hoists these into <head>: the two RPC hosts the wallet reads through,
            so the first eth_call does not pay a TLS handshake on top of the cold start. */}
        <link rel="preconnect" href="https://base-rpc.publicnode.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://mainnet.base.org" />
        <PwaRegister />
        <Warmup />
        {/* Explains the shared-host warning a wallet scanner may raise, with the facts a user
            can check for themselves. Mounts client-side only — see the component. */}
        <DomainTrustNote />
        <ChunkReloadGuard />
        <LocaleProvider>
          <Web3Provider>
            <ToastProvider>{children}</ToastProvider>
          </Web3Provider>
        </LocaleProvider>
      </body>
    </html>
  );
}
