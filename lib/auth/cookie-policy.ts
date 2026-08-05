function isLocalDevelopmentHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".localhost")
  );
}

function hostnameFromHostHeader(headers: Pick<Headers, "get"> | undefined): string | null {
  const host = headers?.get("host");
  if (!host) return null;

  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export function shouldUseSecureAuthCookies(
  request: Pick<Request, "url"> & Partial<Pick<Request, "headers">>,
  environment = process.env.NODE_ENV,
): boolean {
  if (environment !== "development") return true;

  const url = new URL(request.url);
  if (url.protocol !== "http:") return true;

  const canonicalHostname = hostnameFromHostHeader(request.headers) ?? url.hostname;
  return !isLocalDevelopmentHostname(canonicalHostname);
}
