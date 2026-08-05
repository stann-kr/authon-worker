"use client";

import { useTranslations } from "next-intl";

interface VenueLoadNoticeProps {
  onRetry: () => Promise<void>;
  isLoading: boolean;
}

export default function VenueLoadNotice({
  onRetry,
  isLoading,
}: VenueLoadNoticeProps) {
  const t = useTranslations("Common");

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 border border-status-danger/70 bg-status-danger/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-status-danger">{t("venueLoadFailed")}</p>
      <button
        type="button"
        disabled={isLoading}
        onClick={() => void onRetry()}
        className="min-h-11 shrink-0 border border-status-danger/70 px-4 py-2 text-xs font-semibold text-status-danger disabled:opacity-50"
      >
        {t("refresh")}
      </button>
    </div>
  );
}
