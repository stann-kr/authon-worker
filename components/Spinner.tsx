"use client";

import { useTranslations } from "next-intl";

/**
 * Spinner — 로딩 스피너 컴포넌트.
 *
 * 4가지 모드:
 * - fullscreen: 전체 화면 로딩 (페이지 초기 로딩)
 * - content: 앱 프레임 안의 콘텐츠 로딩 (route 전환)
 * - inline: 콘텐츠 영역 내 로딩 (패널 내부)
 * - button: 버튼 내부 스피너 (submit 버튼 등)
 *
 * 사용 예:
 * <Spinner mode="fullscreen" text="LOADING..." />
 * <Spinner mode="content" text="LOADING..." />
 * <Spinner mode="inline" />
 * <Spinner mode="button" color="black" />
 */

interface SpinnerProps {
  mode?: "fullscreen" | "content" | "inline" | "button";
  text?: string;
  /** 스피너 테두리 색상. 기본: 'white' */
  color?: "white" | "black" | "gray";
}

const colorMap = {
  white: "border-action-primary border-t-transparent",
  black: "border-canvas border-t-transparent",
  gray: "border-text-muted border-t-transparent",
};

export default function Spinner({
  mode = "inline",
  text,
  color = "white",
}: SpinnerProps) {
  const t = useTranslations("Common");
  if (mode === "fullscreen" || mode === "content") {
    return (
      <div
        className={`flex w-full items-center justify-center bg-canvas ${
          mode === "fullscreen" ? "min-h-[100dvh]" : "h-full"
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="text-center">
          <div
            className={`mx-auto mb-4 h-8 w-8 rounded-full border-2 ${colorMap[color]} animate-spin`}
            aria-hidden="true"
          ></div>
          {text && (
            <p className="text-sm text-text-muted">
              {text}
            </p>
          )}
          {!text && <span className="sr-only">{t("loading")}</span>}
        </div>
      </div>
    );
  }

  if (mode === "inline") {
    return (
      <div className="flex min-h-[200px] flex-1 items-center justify-center p-8" role="status" aria-live="polite">
        <div
          className={`h-6 w-6 rounded-full border-2 ${colorMap[color]} animate-spin`}
          aria-hidden="true"
        ></div>
        {text && (
          <span className="ml-2 text-sm text-text-muted">{text}</span>
        )}
        {!text && <span className="sr-only">{t("loading")}</span>}
      </div>
    );
  }

  // button
  return (
    <div
      className={`h-4 w-4 rounded-full border-2 ${colorMap[color]} animate-spin`}
      aria-hidden="true"
    ></div>
  );
}
