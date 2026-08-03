import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

interface LocaleResolutionInput {
  explicitLocale?: string | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
  domainDefaultLocale?: string | null;
}

interface ParsedAcceptLanguage {
  hasValidLanguageRange: boolean;
  locale: Locale | null;
}

function normalizeLanguageRange(value: string): Locale | null {
  const primaryLanguage = value.trim().toLowerCase().split("-", 1)[0];
  return isLocale(primaryLanguage) ? primaryLanguage : null;
}

export function parseAcceptLanguage(value: string | null | undefined): ParsedAcceptLanguage {
  if (!value?.trim()) return { hasValidLanguageRange: false, locale: null };

  const ranges = value
    .split(",")
    .map((part, index) => {
      const [rawRange, ...parameters] = part.trim().split(";");
      const range = rawRange?.trim() ?? "";
      if (!range || (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(range) && range !== "*")) {
        return null;
      }

      let quality = 1;
      for (const parameter of parameters) {
        const normalizedParameter = parameter.trim();
        const match = normalizedParameter.match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
        if (match) quality = Number(match[1]);
        else if (normalizedParameter.toLowerCase().startsWith("q=")) return null;
      }
      if (quality <= 0) return null;
      return { range, quality, index, locale: normalizeLanguageRange(range) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  return {
    hasValidLanguageRange: ranges.length > 0,
    locale: ranges.find((entry) => entry.locale)?.locale ?? null,
  };
}

export function resolveLocale({
  explicitLocale,
  cookieLocale,
  acceptLanguage,
  domainDefaultLocale,
}: LocaleResolutionInput): Locale {
  if (isLocale(explicitLocale)) return explicitLocale;
  if (isLocale(cookieLocale)) return cookieLocale;

  const browserPreference = parseAcceptLanguage(acceptLanguage);
  if (browserPreference.locale) return browserPreference.locale;
  if (browserPreference.hasValidLanguageRange) return DEFAULT_LOCALE;

  return isLocale(domainDefaultLocale) ? domainDefaultLocale : DEFAULT_LOCALE;
}
