import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { LocaleProvider } from "@/components/LocaleProvider";
import { ToastProvider } from "@/components/Toast";
import { RewardsProvider } from "@/components/RewardsProvider";
import { ChunkReloadGuard } from "@/components/ChunkReloadGuard";
import { PwaRegister } from "@/components/PwaRegister";
import { Warmup } from "@/components/Warmup";
import { ReferralCapture } from "@/components/ReferralCapture";
import { DomainTrustNote } from "@/components/DomainTrustNote";
import { SITE_URL } from "@/lib/site";
import { SOCIAL, X_HANDLE } from "@/lib/social";

// Absolute origin for OG/canonical URLs and the WalletConnect appUrl. One build-time
// constant (src/lib/site.ts) shared with the wallet provider and the share helpers, so the
// metadata a crawler reads and the metadata a wallet reads can never disagree.
const siteUrlBase = SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrlBase),
  title: "Prediction Arena — Decentralized Prediction Market, Powered by Real-Time Data & AI",
  description:
    "Binary prediction markets priced from live Binance, CoinGecko and DefiLlama feeds, argued by two AI agents, and settled in native USDC on Base with an on-chain evidence hash. 4% fee escrowed per market, auditable by anyone.",
  keywords: ["prediction market", "Base", "USDC", "AI agents", "Web3", "real-time data", "DeFi"],
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
  other: { "apple-mobile-web-app-capable": "yes", "twitter:site": `@${X_HANDLE}` },
  openGraph: {
    title: "Prediction Arena — Powered by Real-Time Data & AI",
    description:
      "Real-time feeds price every strike. Two AI agents argue both sides. You take a position in USDC, and settlement is written on-chain on Base.",
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
    // Attribution matters here: x.com/PredictionArena is an unrelated sports-news account, so the
    // metadata must name the real one.
    site: `@${X_HANDLE}`,
    creator: `@${X_HANDLE}`,
    title: "Prediction Arena — Powered by Real-Time Data & AI",
    description:
      "Real-time feeds price every strike. Two AI agents argue both sides. USDC settles on Base.",
    images: ["/og.png"],
  },
  alternates: { canonical: "/" },
};

/** Ties the site to its official profiles for crawlers and social previews. */
const ORGANIZATION_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Prediction Arena",
  url: siteUrlBase,
  sameAs: [SOCIAL.x.url, SOCIAL.telegram.url, SOCIAL.github.url],
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
        <script
          type="application/ld+json"
          // Static, server-rendered, no user input — safe to inline.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_LD) }}
        />
        {/* React 19 hoists these into <head>: the two RPC hosts the wallet reads through,
            so the first eth_call does not pay a TLS handshake on top of the cold start. */}
        <link rel="preconnect" href="https://base-rpc.publicnode.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://mainnet.base.org" />
        <PwaRegister />
        <Warmup />
      <ReferralCapture />
        {/* Explains the shared-host warning a wallet scanner may raise, with the facts a user
            can check for themselves. Mounts client-side only — see the component. */}
        <DomainTrustNote />
        <ChunkReloadGuard />
        <LocaleProvider>
          <Web3Provider>
            <ToastProvider>
              <RewardsProvider>{children}</RewardsProvider>
            </ToastProvider>
          </Web3Provider>
        </LocaleProvider>
      </body>
    </html>
  );
}
