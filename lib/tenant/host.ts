export function normalizeHostname(value: string | null | undefined): string | null {
  if (!value) return null;

  const firstValue = value.split(",", 1)[0]?.trim().toLowerCase();
  if (!firstValue || /[\s/@]/.test(firstValue)) return null;

  let hostname = firstValue;
  if (hostname.startsWith("[")) {
    const closingBracket = hostname.indexOf("]");
    if (closingBracket < 0) return null;
    hostname = hostname.slice(1, closingBracket);
  } else {
    hostname = hostname.split(":", 1)[0] || "";
  }

  hostname = hostname.replace(/\.$/, "");
  if (!hostname || hostname.length > 253) return null;
  return hostname;
}

export function isPlatformHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".workers.dev")
  );
}

export function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function baseUrlForHostname(hostname: string): string {
  const protocol =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
      ? "http"
      : "https";
  return `${protocol}://${hostname}`;
}
