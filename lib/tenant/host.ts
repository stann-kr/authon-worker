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

export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

export function baseUrlForHostname(hostname: string, requestHost?: string | null): string {
  const local = isLocalHostname(hostname);
  const host = hostname === "::1" ? "[::1]" : hostname;
  const baseUrl = new URL(`${local ? "http" : "https"}://${host}`);
  if (local && requestHost && isLocalHostname(normalizeHostname(requestHost) ?? "")) {
    try {
      baseUrl.port = new URL(`http://${requestHost}`).port;
    } catch {
      // Invalid request authorities never replace the configured hostname.
    }
  }
  return baseUrl.origin;
}
