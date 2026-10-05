import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoExperience } from "@/demo/demo-experience";
import { readAppMode } from "@/lib/demo/config";

export const metadata: Metadata = {
  title: "Interactive portfolio demo",
  description: "Explore Horizon with fictional portfolio data in your browser.",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  if (!readAppMode(process.env).demo) notFound();
  return <DemoExperience />;
}
