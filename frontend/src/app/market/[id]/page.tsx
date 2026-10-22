import type { Metadata } from "next";
import { MarketDetail } from "@/components/MarketDetail";

export const metadata: Metadata = {
  title: "Market · Prediction Arena",
};

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketDetail id={id} />;
}
