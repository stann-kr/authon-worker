/**
 * Cookie 또는 browser-bound capability를 소비하는 mutation이 현재 origin에서
 * 시작됐는지 확인한다. 브라우저가 Origin을 보내지 않는 동일 origin 폼/탐색과
 * 비브라우저 클라이언트는 Sec-Fetch-Site가 cross-site가 아닌 경우 허용한다.
 */
export function isTrustedMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const requestUrl = new URL(request.url);
      const requestHost = request.headers.get("host")?.trim() || requestUrl.host;
      const forwardedProtocol = request.headers
        .get("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim()
        .toLowerCase();
      const requestProtocol =
        forwardedProtocol === "http" || forwardedProtocol === "https"
          ? `${forwardedProtocol}:`
          : requestUrl.protocol;
      const expectedOrigin = new URL(`${requestProtocol}//${requestHost}`).origin;
      return new URL(origin).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    fetchSite === null ||
    fetchSite === "none" ||
    fetchSite === "same-origin"
  );
}
