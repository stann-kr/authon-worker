import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { PLATFORM_BRAND, createVenueBrand } from "@/lib/brand";
import { getDb } from "@/lib/db/client";
import { venueDomains, venues } from "@/lib/db/schema";
import {
  baseUrlForHostname,
  isPlatformHostname,
  normalizeBaseUrl,
  normalizeHostname,
} from "@/lib/tenant/host";
import type { TenantContext, TenantScope } from "@/lib/tenant/types";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";

function getConfiguredBaseUrl(): string | null {
  return getCloudflareContext().env.NEXT_PUBLIC_APP_URL || null;
}

function platformContext(hostname: string, fallbackBaseUrl?: string | null): TenantContext {
  const configuredBaseUrl = normalizeBaseUrl(fallbackBaseUrl);
  return {
    hostname,
    scope: "platform",
    venueId: null,
    baseUrl: configuredBaseUrl || baseUrlForHostname(hostname),
    brand: PLATFORM_BRAND,
    defaultLocale: DEFAULT_LOCALE,
    resolved: isPlatformHostname(hostname),
  };
}

export async function resolveTenantByHostname(
  hostnameValue: string | null | undefined,
  fallbackBaseUrl?: string | null,
): Promise<TenantContext> {
  const hostname = normalizeHostname(hostnameValue) || "localhost";
  if (isPlatformHostname(hostname)) {
    return platformContext(hostname, fallbackBaseUrl);
  }

  const db = getDb();
  const rows = await db
    .select({
      scope: venueDomains.scope,
      venueId: venueDomains.venueId,
      venueName: venues.name,
      venueActive: venues.active,
      brandName: venues.brandName,
      brandTagline: venues.brandTagline,
      brandDescription: venues.brandDescription,
      brandFooter: venues.brandFooter,
      defaultLocale: venueDomains.defaultLocale,
    })
    .from(venueDomains)
    .leftJoin(venues, eq(venueDomains.venueId, venues.id))
    .where(
      and(
        eq(venueDomains.hostname, hostname),
        eq(venueDomains.active, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return platformContext(hostname, fallbackBaseUrl);

  const scope: TenantScope = row.scope === "platform" ? "platform" : "venue";
  if (scope === "platform") {
    return {
      ...platformContext(hostname, fallbackBaseUrl),
      baseUrl: baseUrlForHostname(hostname),
      defaultLocale: isLocale(row.defaultLocale) ? row.defaultLocale : DEFAULT_LOCALE,
      resolved: true,
    };
  }

  if (!row.venueId || !row.venueName || !row.venueActive) {
    return platformContext(hostname, fallbackBaseUrl);
  }

  return {
    hostname,
    scope,
    venueId: row.venueId,
    baseUrl: baseUrlForHostname(hostname),
    brand: createVenueBrand({
      venueName: row.venueName,
      brandName: row.brandName,
      brandTagline: row.brandTagline,
      brandDescription: row.brandDescription,
      brandFooter: row.brandFooter,
    }),
    defaultLocale: isLocale(row.defaultLocale) ? row.defaultLocale : DEFAULT_LOCALE,
    resolved: true,
  };
}

export const getRequestTenantContext = cache(async (): Promise<TenantContext> => {
  const requestHeaders = await headers();
  return resolveTenantByHostname(
    requestHeaders.get("host"),
    getConfiguredBaseUrl(),
  );
});

export async function getTenantContextForRequest(request: Request): Promise<TenantContext> {
  return resolveTenantByHostname(
    request.headers.get("host") || new URL(request.url).hostname,
    getConfiguredBaseUrl(),
  );
}

export async function getVenueDeliveryContext(
  venueId: string | null | undefined,
  fallbackBaseUrl?: string | null,
): Promise<Pick<TenantContext, "baseUrl" | "brand" | "venueId" | "defaultLocale">> {
  const effectiveFallbackBaseUrl = fallbackBaseUrl ?? getConfiguredBaseUrl();
  if (!venueId) {
    const fallback = platformContext("localhost", effectiveFallbackBaseUrl);
    return {
      baseUrl: fallback.baseUrl,
      brand: fallback.brand,
      venueId: null,
      defaultLocale: fallback.defaultLocale,
    };
  }

  const db = getDb();
  const rows = await db
    .select({
      hostname: venueDomains.hostname,
      venueName: venues.name,
      brandName: venues.brandName,
      brandTagline: venues.brandTagline,
      brandDescription: venues.brandDescription,
      brandFooter: venues.brandFooter,
      defaultLocale: venueDomains.defaultLocale,
    })
    .from(venues)
    .leftJoin(
      venueDomains,
      and(
        eq(venueDomains.venueId, venues.id),
        eq(venueDomains.isPrimary, true),
        eq(venueDomains.active, true),
      ),
    )
    .where(and(eq(venues.id, venueId), eq(venues.active, true)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    const fallback = platformContext("localhost", effectiveFallbackBaseUrl);
    return {
      baseUrl: fallback.baseUrl,
      brand: fallback.brand,
      venueId,
      defaultLocale: fallback.defaultLocale,
    };
  }

  return {
    venueId,
    defaultLocale: isLocale(row.defaultLocale) ? row.defaultLocale : DEFAULT_LOCALE,
    baseUrl:
      (row.hostname ? baseUrlForHostname(row.hostname) : null) ||
      normalizeBaseUrl(effectiveFallbackBaseUrl) ||
      "http://localhost:3000",
    brand: createVenueBrand({
      venueName: row.venueName,
      brandName: row.brandName,
      brandTagline: row.brandTagline,
      brandDescription: row.brandDescription,
      brandFooter: row.brandFooter,
    }),
  };
}
