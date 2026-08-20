"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/Icon";
import { logout, type LogoutResult } from "@/lib/auth";

export default function LogoutControl({
  onLogout = logout,
}: {
  onLogout?: () => Promise<LogoutResult>;
}) {
  const t = useTranslations("Common");
  const logoutErrorId = useId();
  const logoutInFlight = useRef(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  const handleLogout = async () => {
    if (logoutInFlight.current) return;

    logoutInFlight.current = true;
    setIsLoggingOut(true);
    setLogoutFailed(false);

    try {
      const result = await onLogout();
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
        className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading disabled:cursor-wait disabled:opacity-60"
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        <Icon name="logout" size={18} />
      </button>
      {logoutFailed && (
        <p
          id={logoutErrorId}
          className="absolute right-0 top-full z-[var(--app-z-toast)] mt-2 w-[min(20rem,calc(100vw-2rem))] border border-status-danger/40 bg-surface-raised px-3 py-2 text-xs leading-relaxed text-status-danger"
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
