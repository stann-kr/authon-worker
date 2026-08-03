import type { VenueBrand } from "@/lib/brand";

export type TenantScope = "platform" | "venue";

export interface TenantContext {
  hostname: string;
  scope: TenantScope;
  venueId: string | null;
  baseUrl: string;
  brand: VenueBrand;
  resolved: boolean;
}
