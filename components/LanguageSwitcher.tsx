"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type Locale } from "@/i18n/config";

interface LanguageSwitcherProps {
  className?: string;
  compact?: boolean;
}

export default function LanguageSwitcher({
  className = "",
  compact = false,
}: LanguageSwitcherProps) {
  const currentLocale = useLocale();
  const t = useTranslations("Common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const changeLocale = (locale: Locale) => {
    if (locale === currentLocale || isPending) return;
    setError("");

    startTransition(async () => {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      }).catch(() => null);

      if (!response?.ok) {
        setError(t("localeUpdateFailed"));
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("lang", locale);
      // URL 교체와 RSC 갱신을 각각 한 번만 수행한다. router.replace 직후
      // refresh를 겹치면 같은 화면의 navigation이 중복될 수 있다.
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      router.refresh();
    });
  };

  return (
    <div className={className}>
      <div
        role="group"
        aria-label={t("language")}
        className="inline-flex border border-border-strong bg-canvas p-0.5"
      >
        {(["en", "ko"] as const).map((locale) => (
          <button
            key={locale}
            type="button"
            aria-pressed={currentLocale === locale}
            disabled={isPending}
            onClick={() => changeLocale(locale)}
            className={`${compact ? "min-h-11 px-2 text-xs" : "min-h-11 px-3 text-xs"} font-medium transition-colors disabled:opacity-60 ${
              currentLocale === locale
                ? "bg-action-primary text-action-text"
                : "text-text-muted hover:bg-surface-hover hover:text-text-heading"
            }`}
          >
            {locale === "en" ? t("english") : t("korean")}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-status-danger">
          {error}
        </p>
      )}
    </div>
  );
}
