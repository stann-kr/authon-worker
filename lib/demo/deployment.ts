export const DEMO_CUSTOM_HOSTNAME = "demo.authon.stann.kr";

export type DemoRouteDisposition = "allow" | "redirect_to_demo" | "not_found";

export function isDemoDeployment(value: unknown): boolean {
  return value === "demo";
}

export function isAllowedDemoHostname(hostname: string | null): boolean {
  if (!hostname) return false;
  return (
    hostname === DEMO_CUSTOM_HOSTNAME ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".workers.dev")
  );
}

export function getDemoRouteDisposition(
  pathname: string,
  hostname: string | null,
): DemoRouteDisposition {
  if (!isAllowedDemoHostname(hostname)) return "not_found";
  if (pathname === "/") return "redirect_to_demo";
  if (pathname === "/demo" || pathname.startsWith("/demo/")) return "allow";
  if (pathname === "/api/locale") return "allow";
  return "not_found";
}
