import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getRequestTenantContext } from "@/lib/tenant/server";
import {
  LOCALE_COOKIE_NAME,
  REQUEST_LOCALE_HEADER,
} from "@/i18n/config";
import { resolveLocale } from "@/i18n/resolve";
import { getCurrentUser } from "@/lib/auth/server";
import { isLocale } from "@/i18n/config";

export default getRequestConfig(async () => {
  const [requestHeaders, cookieStore, tenant, user] = await Promise.all([
    headers(),
    cookies(),
    getRequestTenantContext(),
    getCurrentUser(),
  ]);

  const explicitLocale = requestHeaders.get(REQUEST_LOCALE_HEADER);
  const locale = isLocale(explicitLocale)
    ? explicitLocale
    : isLocale(user?.preferredLocale)
      ? user.preferredLocale
      : resolveLocale({
        explicitLocale,
        cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
        acceptLanguage: requestHeaders.get("accept-language"),
        domainDefaultLocale: tenant.defaultLocale,
      });

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
