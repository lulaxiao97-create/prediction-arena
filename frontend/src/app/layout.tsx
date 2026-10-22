import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { LocaleProvider } from "@/components/LocaleProvider";
import { ToastProvider } from "@/components/Toast";
import { ChunkReloadGuard } from "@/components/ChunkReloadGuard";
import { PwaRegister } from "@/components/PwaRegister";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://prediction-arena.vercel.app").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
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
  },
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
        <PwaRegister />
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
