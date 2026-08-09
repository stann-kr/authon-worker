"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Footer from "@/components/Footer";
import { useVenueBrand } from "@/components/VenueBrandProvider";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";
import PasswordInput from "@/components/PasswordInput";
import Button from "@/components/Button";
import ButtonLink from "@/components/ButtonLink";
import Icon from "@/components/Icon";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { getPasswordPolicyErrorCode } from "@/lib/auth/password-policy";
import { useTranslations } from "next-intl";

function StepIndicator({
  currentStep,
  labels,
  progressLabel,
}: {
  currentStep: 0 | 1 | 2 | 3;
  labels: readonly string[];
  progressLabel: string;
}) {
  return (
    <div className="mb-8">
      <p className="sr-only" aria-live="polite">
        {progressLabel}
      </p>
      <ol className="grid grid-cols-4 gap-2" aria-label={progressLabel}>
        {labels.map((label, index) => {
          const active = index === currentStep;
          const complete = index < currentStep;
          return (
            <li key={label} className="space-y-2" aria-current={active ? "step" : undefined}>
              <span
                aria-hidden="true"
                className={`block h-1 ${
                  complete || active ? "bg-action-primary" : "bg-border-subtle"
                }`}
              />
              <p
                className={`font-mono text-xs ${
                  active ? "text-text-heading" : complete ? "text-text-muted" : "text-text-dim"
                }`}
              >
                {label}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type ResetMessageTarget =
  | "form"
  | "email"
  | "newPassword"
  | "confirmPassword";

interface ResetMessage {
  type: "success" | "error";
  text: string;
  target: ResetMessageTarget;
}

type ResetKind = "token" | "admin_approved";

function ResetPasswordContent() {
  const t = useTranslations("ResetPassword");
  const authT = useTranslations("Auth");
  const { brand } = useVenueBrand();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<ResetMessage | null>(null);
  const [requestChallenge, setRequestChallenge] = useState<string | null>(null);
  const [checkingApproval, setCheckingApproval] = useState(true);
  const [resetKind, setResetKind] = useState<ResetKind>("token");
  const [step, setStep] = useState<"request" | "reset" | "requestSent" | "resetComplete">("request");

  useEffect(() => {
    if (token) {
      setResetKind("token");
      setStep("reset");
    }
  }, [token]);

  const checkApprovalStatus = useCallback(async (restore = false) => {
    setCheckingApproval(true);
    try {
      const response = await fetch("/api/auth/password-reset-requests/status", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        if (!restore) {
          setMessage({
            type: "error",
            text:
              response.status === 429
                ? t("approvalStatusRateLimited")
                : t("approvalStatusFailed"),
            target: "form",
          });
        }
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      if (!data || typeof data !== "object") return;
      const status = data as {
        state?: unknown;
        challenge?: unknown;
        expiresAt?: unknown;
      };
      const challenge = typeof status.challenge === "string"
        ? status.challenge
        : null;
      if (challenge) setRequestChallenge(challenge);
      if (status.state === "approved") {
        setResetKind("admin_approved");
        setMessage({
          type: "success",
          text: t("approvalReady"),
          target: "form",
        });
        setStep("reset");
      } else if (restore && challenge) {
        setStep("requestSent");
      }
    } catch {
      if (!restore) {
        setMessage({
          type: "error",
          text: t("approvalStatusFailed"),
          target: "form",
        });
      }
    } finally {
      setCheckingApproval(false);
    }
  }, [t]);

  useEffect(() => {
    if (token) return;
    void checkApprovalStatus(true);
  }, [checkApprovalStatus, token]);

  useEffect(() => {
    if (step !== "requestSent" || token) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkApprovalStatus();
      }
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [checkApprovalStatus, step, token]);

  const stepIndex: 0 | 1 | 2 | 3 =
    step === "request"
      ? 0
      : step === "requestSent"
        ? 1
        : step === "reset"
          ? 2
          : 3;

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/auth/password-reset-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(t("requestFailed")) as Error & { code?: string };
        error.code = typeof data.code === "string" ? data.code : undefined;
        throw error;
      }

      setMessage({
        type: "success",
        text: t("adminRequestSuccess"),
        target: "form",
      });
      setRequestChallenge(
        typeof data.challenge === "string" ? data.challenge : null,
      );
      setStep("requestSent");
    } catch (err: unknown) {
      const code = err instanceof Error && "code" in err
        ? (err as Error & { code?: string }).code
        : undefined;
      setMessage({
        type: "error",
        text:
          code === "INVALID_EMAIL"
            ? t("invalidEmail")
            : code === "RATE_LIMITED"
              ? t("requestRateLimited")
              : err instanceof Error
                ? err.message
                : t("unexpectedError"),
        target: code === "INVALID_EMAIL" ? "email" : "form",
      });
      if (code === "INVALID_EMAIL") document.getElementById("email")?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    const policyErrorCode = getPasswordPolicyErrorCode(newPassword);
    if (policyErrorCode) {
      setMessage({
        type: "error",
        text: authT(
          policyErrorCode === "PASSWORD_TOO_SHORT"
            ? "passwordTooShort"
            : "passwordRequiresLettersAndNumbers",
        ),
        target: "newPassword",
      });
      document.getElementById("new-password")?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({
        type: "error",
        text: authT("passwordsDoNotMatch"),
        target: "confirmPassword",
      });
      document.getElementById("confirm-password")?.focus();
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch(
        resetKind === "token"
          ? "/api/auth/reset-password"
          : "/api/auth/claim-account",
        {
        method: resetKind === "token" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          resetKind === "token"
            ? { token, newPassword }
            : { recoveryReceipt: true, newPassword },
        ),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(
          data.code === "ACCOUNT_NOT_ELIGIBLE"
            ? t("approvalNotReady")
            : data.code === "RATE_LIMITED"
              ? t("approvalClaimRateLimited")
              : t("updateFailed"),
        ) as Error & { code?: string };
        error.code = typeof data.code === "string" ? data.code : undefined;
        throw error;
      }

      setMessage({
        type: "success",
        text: t("resetSuccess"),
        target: "form",
      });
      setStep("resetComplete");
      setTimeout(() => router.push("/auth/login"), 4500);
    } catch (err: unknown) {
      const code = err instanceof Error && "code" in err
        ? (err as Error & { code?: string }).code
        : undefined;
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : t("unexpectedError"),
        target: "form",
      });
      if (code === "ACCOUNT_NOT_ELIGIBLE" && resetKind === "admin_approved") {
        setStep("requestSent");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRestartRequest = async () => {
    setLoading(true);
    try {
      await fetch("/api/auth/password-reset-requests", { method: "DELETE" });
    } finally {
      setEmail("");
      setRequestChallenge(null);
      setMessage(null);
      setResetKind("token");
      setStep("request");
      setLoading(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="app-panel p-6 sm:p-8 lg:p-10">
          <div className="mb-5 flex justify-end">
            <LanguageSwitcher compact />
          </div>
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 grid h-11 w-11 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
              {brand.name.charAt(0).toUpperCase()}
            </div>
            <h1 className="mb-2 text-2xl font-semibold tracking-[-0.03em] text-text-heading sm:text-3xl">
              {brand.name}
            </h1>
            <p className="text-sm text-text-muted">
              {t("tagline")}
            </p>
          </div>

          <StepIndicator
            currentStep={stepIndex}
            labels={[
              t("requestStep"),
              t("emailStep"),
              t("resetStep"),
              t("doneStep"),
            ]}
            progressLabel={t("progress", {
              step: [
                t("requestStep"),
                t("emailStep"),
                t("resetStep"),
                t("doneStep"),
              ][stepIndex],
            })}
          />

          <div className="mb-6 rounded-control border border-border-default bg-canvas p-4">
            <p className="mb-2 text-sm font-semibold text-text-heading">
              {token ? t("secureFlow") : t("adminFlow")}
            </p>
            <p className="text-xs leading-relaxed text-text-muted">
              {token
                ? t("secureFlowDescription")
                : t("adminFlowDescription")}
            </p>
          </div>

          {message && (
            <div id="reset-message" className="mb-6">
              <Alert type={message.type} message={message.text} />
            </div>
          )}

          {step === "request" && (
            <form onSubmit={handleRequest} className="space-y-6" aria-busy={loading}>
              <div>
                <label htmlFor="email" className="app-label">
                  {t("email")}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading || checkingApproval}
                  autoComplete="email"
                  spellCheck={false}
                  className="app-field"
                  placeholder="name@example.com"
                  aria-describedby={`email-helper request-helper${
                    message?.type === "error" && message.target === "email"
                      ? " reset-message"
                      : ""
                  }`}
                  aria-invalid={
                    message?.type === "error" && message.target === "email"
                  }
                />
                <p id="email-helper" className="app-helper">
                  {t("emailHelp")}
                </p>
              </div>

              <p id="request-helper" className="text-xs leading-relaxed text-text-dim">
                {t("privacyHelp")}
              </p>

              <div className="space-y-2">
                <Button
                  type="button"
                  disabled
                  aria-describedby="email-reset-disabled-help"
                  fullWidth
                  size="lg"
                  variant="outline"
                >
                  {t("sendLinkDisabled")}
                </Button>
                <p
                  id="email-reset-disabled-help"
                  className="text-xs leading-relaxed text-text-dim"
                  role="note"
                >
                  {t("emailResetDisabledHelp")}
                </p>
              </div>

              <Button
                type="submit"
                isLoading={loading || checkingApproval}
                disabled={checkingApproval}
                fullWidth
                size="lg"
              >
                {t("requestAdministrator")}
              </Button>
            </form>
          )}

          {step === "reset" && (
            <form onSubmit={handleReset} className="space-y-6" aria-busy={loading}>
              {resetKind === "admin_approved" && (
                <div className="rounded-control border border-status-waiting/70 bg-status-waiting/10 p-4" role="note">
                  <p className="text-sm font-semibold text-text-heading">
                    {t("adminApprovedResetTitle")}
                  </p>
                  <p className="mt-2 break-words text-xs leading-relaxed text-text-muted">
                    {t("adminApprovedResetHelp")}
                  </p>
                </div>
              )}
              <div>
                <label htmlFor="new-password" className="app-label">
                  {t("newPassword")}
                </label>
                <PasswordInput
                  id="new-password"
                  name="new-password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  inputClassName="app-field pr-12"
                  placeholder={t("newPasswordPlaceholder")}
                  aria-describedby={`password-policy${
                    message?.type === "error" &&
                    message.target === "newPassword"
                      ? " reset-message"
                      : ""
                  }`}
                  aria-invalid={
                    message?.type === "error" &&
                    message.target === "newPassword"
                  }
                />
                <p id="password-policy" className="app-helper">
                  {authT("passwordPolicyHint")}
                </p>
              </div>

              <div>
                <label htmlFor="confirm-password" className="app-label">
                  {t("confirmPassword")}
                </label>
                <PasswordInput
                  id="confirm-password"
                  name="confirm-password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  inputClassName="app-field pr-12"
                  placeholder={t("confirmPasswordPlaceholder")}
                  aria-describedby={`confirm-helper${
                    message?.type === "error" &&
                    message.target === "confirmPassword"
                      ? " reset-message"
                      : ""
                  }`}
                  aria-invalid={
                    message?.type === "error" &&
                    message.target === "confirmPassword"
                  }
                />
                <p id="confirm-helper" className="app-helper">
                  {t("confirmHelp")}
                </p>
              </div>

              <Button type="submit" isLoading={loading} fullWidth size="lg">
                {resetKind === "admin_approved"
                  ? t("completeApprovedReset")
                  : t("updatePassword")}
              </Button>
            </form>
          )}

          {step === "requestSent" && (
            <div className="text-center space-y-6">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-panel border border-border-strong bg-surface-raised text-text-heading">
                <Icon name="user-admin" size={24} />
              </div>

              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-text-body">
                  {t("adminRequestSent")}
                </p>
                <p className="text-xs leading-relaxed text-text-dim">
                  {t("adminRequestSentHelp")}
                </p>
              </div>

              {requestChallenge && (
                <div className="border border-border-strong bg-canvas p-4 text-left">
                  <p className="text-xs font-semibold text-text-heading">
                    {t("requestChallenge")}
                  </p>
                  <code className="mt-3 block select-all text-center font-mono text-lg font-semibold tracking-wider text-text-heading">
                    {requestChallenge}
                  </code>
                  <p className="mt-3 text-xs leading-relaxed text-text-muted">
                    {t("requestChallengeHelp")}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Button
                  type="button"
                  fullWidth
                  size="lg"
                  isLoading={checkingApproval}
                  onClick={() => void checkApprovalStatus()}
                >
                  {t("checkApproval")}
                </Button>
                <ButtonLink href="/auth/login" variant="outline" fullWidth size="lg">
                  {t("useSetupCodeAtLogin")}
                </ButtonLink>
                <Button
                  type="button"
                  variant="ghost"
                  fullWidth
                  size="sm"
                  disabled={loading}
                  onClick={() => void handleRestartRequest()}
                >
                  {t("restartRequest")}
                </Button>
              </div>
            </div>
          )}

          {step === "resetComplete" && (
            <div className="text-center space-y-6">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-panel border border-border-strong bg-surface-raised text-text-heading">
                <Icon name="check" size={24} />
              </div>

              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-text-body">
                  {t("resetSuccess")}
                </p>
                <p className="text-xs leading-relaxed text-text-dim">
                  {t("resetSuccessHelp")}
                </p>
              </div>

              <ButtonLink href="/auth/login" fullWidth size="lg">
                {t("returnToLogin")}
              </ButtonLink>
            </div>
          )}

          {(step === "request" || step === "reset") && (
            <div className="mt-8 text-center">
              <ButtonLink
                href="/auth/login"
                variant="ghost"
                size="sm"
              >
                {t("backToLogin")}
              </ButtonLink>
            </div>
          )}

          <Footer compact />
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("Common");
  return (
    <Suspense
      fallback={
        <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] items-center justify-center bg-canvas">
          <Spinner mode="inline" text={t("loading")} />
        </main>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
