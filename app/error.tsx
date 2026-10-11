"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import ButtonLink from "@/components/ButtonLink";

/**
 * 화면 렌더링 중 예외가 나도 앱 셸의 언어·스타일로 복구 경로를 제공합니다.
 */
export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Common");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 text-center">
      <div className="app-panel w-full max-w-md p-8 sm:p-10">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-panel bg-surface-raised text-text-muted">
          <Icon name="warning" size={22} />
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-text-heading outline-none">
          {t("errorTitle")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          {t("errorDescription")}
        </p>
        <div className="mx-auto mt-8 grid w-full max-w-xs gap-3">
          <Button fullWidth size="lg" onClick={reset}>
            {t("retry")}
          </Button>
          <ButtonLink href="/" variant="secondary" size="lg" fullWidth>
            {t("goHome")}
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
