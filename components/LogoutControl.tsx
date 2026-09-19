"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/Icon";
import { logout, type LogoutResult } from "@/lib/auth";
import { confirmWorkspaceNavigation, withApprovedNavigation } from "./overlays/navigation-guard";

export default function LogoutControl({
  onLogout = logout,
  expanded = false,
}: {
  onLogout?: () => Promise<LogoutResult>;
  expanded?: boolean;
}) {
  const t = useTranslations("Common");
  const logoutErrorId = useId();
  const logoutInFlight = useRef(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  const handleLogout = async () => {
    if (logoutInFlight.current || !confirmWorkspaceNavigation()) return;

    logoutInFlight.current = true;
    setIsLoggingOut(true);
    setLogoutFailed(false);

    try {
      const result = await withApprovedNavigation(onLogout);
      if (result.success) return;
    } catch {
      // Present the same retryable, non-sensitive error for unexpected failures.
    }

    logoutInFlight.current = false;
    setIsLoggingOut(false);
    setLogoutFailed(true);
  };

  const buttonLabel = isLoggingOut ? t("logoutInProgress") : t("logout");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
        aria-busy={isLoggingOut}
        aria-describedby={logoutFailed ? logoutErrorId : undefined}
        className={`pressable flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading disabled:cursor-wait disabled:opacity-60 ${expanded ? "w-full px-4 py-3 text-sm" : "h-11 w-11"}`}
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        <Icon name="logout" size={18} />
        {expanded && <span>{buttonLabel}</span>}
      </button>
      {logoutFailed && (
        <p
          id={logoutErrorId}
          className={`mt-2 border border-status-danger/40 bg-surface-raised px-3 py-2 text-xs leading-relaxed text-status-danger ${expanded ? "" : "absolute right-0 top-full z-[var(--app-z-toast)] w-[min(20rem,calc(100vw-2rem))]"}`}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {t("logoutFailed")}
        </p>
      )}
    </div>
  );
}
