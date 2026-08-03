"use client";

import { createContext, useContext } from "react";
import { PLATFORM_BRAND } from "@/lib/brand";
import type { TenantContext } from "@/lib/tenant/types";

const fallbackTenant: TenantContext = {
  hostname: "localhost",
  scope: "platform",
  venueId: null,
  baseUrl: "http://localhost:3000",
  brand: PLATFORM_BRAND,
  defaultLocale: "en",
  resolved: false,
};

const VenueBrandContext = createContext<TenantContext>(fallbackTenant);

export default function VenueBrandProvider({
  children,
  tenant,
}: Readonly<{
  children: React.ReactNode;
  tenant: TenantContext;
}>) {
  return (
    <VenueBrandContext.Provider value={tenant}>
      {children}
    </VenueBrandContext.Provider>
  );
}

export function useVenueBrand(): TenantContext {
  return useContext(VenueBrandContext);
}
