import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";

export const metadata: Metadata = {
  title: "Prediction Arena — AI 预测对赌竞技场",
  description:
    "AI 智囊团驱动的二元预测盘口。Base 链原生 USDC 结算，4% 抽水即时隔离，IPFS 快照留痕，人人可审计。",
  keywords: ["prediction market", "Base", "USDC", "AI agents", "Web3"],
  openGraph: {
    title: "Prediction Arena",
    description: "AI 三智囊团辩论 + 链上二元对赌，Base / USDC 结算。",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="min-h-screen bg-void text-ink antialiased">
        <div className="bg-aurora" aria-hidden />
        <div className="bg-grid" aria-hidden />
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
