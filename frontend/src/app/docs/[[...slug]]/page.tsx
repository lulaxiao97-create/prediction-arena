import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsPage } from "@/components/DocsPage";
import { findDoc } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Docs · Prediction Arena",
  description:
    "Interactive protocol documentation: architecture, hardened contract spec, P0 mitigations, AI debate engine, fees and the settlement roadmap.",
};

export default async function DocsRoute({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  // Resolve on the server so an unknown slug answers 404 instead of a 200 with an empty page.
  if (!findDoc(slug)) notFound();
  return <DocsPage slug={slug} />;
}
