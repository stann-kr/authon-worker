import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Authon — Interactive portfolio demo",
  description: "Explore Authon's venue guest operations in a safe, browser-local sandbox.",
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
