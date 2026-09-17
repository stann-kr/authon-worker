import { measureServerOperation } from "@/lib/observability/server-performance";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./home.css";
import "./auth/auth.css";
import "./profile/profile.css";
import "./admin/components/user-management.css";
import "./guest/components/external-guest.css";
import "@/components/overlays/sheet.css";
import "@/components/guests/roster.css";
import "@/components/records/records.css";
import "@/components/operations/operations.css";
import "@/components/workspace/workspace.css";
import DesignSystemProvider from "@/components/DesignSystemProvider";
import VenueBrandProvider from "@/components/VenueBrandProvider";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import { VenueDataProvider } from "@/components/VenueSelector";
import { getRequestTenantContext } from "@/lib/tenant/server";
import { getRenderUser } from "@/lib/auth/server";
import { toClientUser } from "@/lib/auth/user-profile";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
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
  themeColor: "#000000",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [tenant, locale, messages, t, sessionUser] = await measureServerOperation("server.layout", () => Promise.all([
    getRequestTenantContext(),
    getLocale(),
    getMessages(),
    getTranslations("Common"),
    getRenderUser(),
  ]));

  return (
    <html lang={locale} suppressHydrationWarning={true}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-canvas text-text-body`}
        style={{ minHeight: "100dvh" }}
      >
        <NextIntlClientProvider messages={messages}>
          <AuthSessionProvider
            initialUser={sessionUser ? toClientUser(sessionUser) : null}
          >
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
          </AuthSessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
