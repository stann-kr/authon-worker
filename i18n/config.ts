export const LOCALES = ["en", "ko"] as const;

export type Locale = (typeof LOCALES)[number];
export type ExternalLinkLocaleMode = Locale | "auto";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE_NAME = "AUTHON_LOCALE";
export const REQUEST_LOCALE_HEADER = "x-authon-request-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale);
}

export function isExternalLinkLocaleMode(value: unknown): value is ExternalLinkLocaleMode {
  return value === "auto" || isLocale(value);
}
