"use client";

import { Suspense, useState, useEffect } from "react";
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
  const [step, setStep] = useState<"request" | "reset" | "requestSent" | "resetComplete">("request");

  useEffect(() => {
    if (token) {
      setStep("reset");
    }
  }, [token]);

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
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        throw new Error(
          t("requestFailed"),
        );
      }

      setMessage({
        type: "success",
        text: t("requestSuccess"),
        target: "form",
      });
      setStep("requestSent");
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : t("unexpectedError"),
        target: "form",
      });
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
      const res = await fetch("/api/auth/reset-password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      if (!res.ok) {
        throw new Error(
          t("updateFailed"),
        );
      }

      setMessage({
        type: "success",
        text: t("resetSuccess"),
        target: "form",
      });
      setStep("resetComplete");
      setTimeout(() => router.push("/auth/login"), 4500);
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : t("unexpectedError"),
        target: "form",
      });
    } finally {
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
              {t("secureFlow")}
            </p>
            <p className="text-xs leading-relaxed text-text-muted">
              {t("secureFlowDescription")}
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
                  disabled={loading}
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

              <Button type="submit" isLoading={loading} fullWidth size="lg">
                {t("sendLink")}
              </Button>
            </form>
          )}

          {step === "reset" && (
            <form onSubmit={handleReset} className="space-y-6" aria-busy={loading}>
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
                {t("updatePassword")}
              </Button>
            </form>
          )}

          {step === "requestSent" && (
            <div className="text-center space-y-6">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-panel border border-border-strong bg-surface-raised text-text-heading">
                <Icon name="email" size={24} />
              </div>

              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-text-body">
                  {t("requestSent")}
                </p>
                <p className="text-xs leading-relaxed text-text-dim">
                  {t("requestSentHelp")}
                </p>
              </div>

              <ButtonLink href="/auth/login" fullWidth size="lg">
                {t("returnToLogin")}
              </ButtonLink>
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
