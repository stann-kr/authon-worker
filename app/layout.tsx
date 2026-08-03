import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import DesignSystemProvider from "@/components/DesignSystemProvider";
import VenueBrandProvider from "@/components/VenueBrandProvider";
import { getRequestTenantContext } from "@/lib/tenant/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getRequestTenantContext();
  return { title: brand.name, description: brand.description };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0B0C",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tenant = await getRequestTenantContext();

  return (
    <html lang="ko" suppressHydrationWarning={true}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-canvas text-text-body`}
        style={{ minHeight: "100dvh" }}
      >
        <VenueBrandProvider tenant={tenant}>
          <DesignSystemProvider>
            <a href="#main-content" className="skip-link">
              본문으로 건너뛰기
            </a>
            <div id="main-content" tabIndex={-1}>
              {children}
            </div>
          </DesignSystemProvider>
        </VenueBrandProvider>
      </body>
    </html>
  );
}
