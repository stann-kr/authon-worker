"use client";

import { useTranslations } from "next-intl";

interface SkeletonProps {
  rows?: number;
  compact?: boolean;
}

export default function Skeleton({ rows = 5, compact = false }: SkeletonProps) {
  const t = useTranslations("Common");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loadingContent")}
      className="skeleton-pulse"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={`flex items-center gap-4 border-b border-border-subtle px-4 sm:px-5 ${compact ? "py-3" : "py-4"}`}
        >
          <div className="h-10 w-10 shrink-0 rounded-control bg-surface-active" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/5 rounded-control bg-surface-active" />
            <div className="h-2.5 w-3/5 rounded-control bg-surface-hover" />
          </div>
          <div className="h-9 w-20 rounded-control bg-surface-active" />
        </div>
      ))}
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}
