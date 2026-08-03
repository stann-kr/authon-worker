import type { VenueBrand } from "@/lib/brand";
import type { Locale } from "@/i18n/config";

export type TenantScope = "platform" | "venue";

export interface TenantContext {
  hostname: string;
  scope: TenantScope;
  venueId: string | null;
  baseUrl: string;
  brand: VenueBrand;
  defaultLocale: Locale;
  resolved: boolean;
}
