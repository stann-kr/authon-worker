import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import DesignSystemProvider from "@/components/DesignSystemProvider";
import VenueBrandProvider from "@/components/VenueBrandProvider";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import { VenueDataProvider } from "@/components/VenueSelector";
import { getRequestTenantContext } from "@/lib/tenant/server";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

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
  return {
    title: brand.name,
    description: brand.description,
    robots: { index: false, follow: false },
  };
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
  const [tenant, locale, messages, t] = await Promise.all([
    getRequestTenantContext(),
    getLocale(),
    getMessages(),
    getTranslations("Common"),
  ]);

  return (
    <html lang={locale} suppressHydrationWarning={true}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-canvas text-text-body`}
        style={{ minHeight: "100dvh" }}
      >
        <NextIntlClientProvider messages={messages}>
          <VenueBrandProvider tenant={tenant}>
            <DesignSystemProvider>
              <RouteTransitionProvider>
                <VenueDataProvider>
                  <a href="#main-content" className="skip-link">
                    {t("skipToContent")}
                  </a>
                  {children}
                </VenueDataProvider>
              </RouteTransitionProvider>
            </DesignSystemProvider>
          </VenueBrandProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
