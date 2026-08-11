"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import ButtonLink from "@/components/ButtonLink";
import Footer from "@/components/Footer";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PasswordInput from "@/components/PasswordInput";
import { useVenueBrand } from "@/components/VenueBrandProvider";
import { claimMigratedAccount, login } from "@/lib/auth";
import { getPasswordPolicyErrorCode } from "@/lib/auth/password-policy";

type SetupErrorTarget =
  | "form"
  | "email"
  | "setupCode"
  | "newPassword"
  | "confirmPassword";

interface SetupError {
  message: string;
  target: SetupErrorTarget;
}

export default function SetupPasswordPage() {
  const t = useTranslations("Auth");
  const { brand } = useVenueBrand();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);

  const showError = (message: string, target: SetupErrorTarget = "form") => {
    setError({ message, target });
    window.requestAnimationFrame(() => {
      const targetId =
        target === "setupCode"
          ? "setup-code"
          : target === "newPassword"
            ? "setup-new-password"
            : target === "confirmPassword"
              ? "setup-confirm-password"
              : target === "email"
                ? "setup-email"
                : "setup-error";
      document.getElementById(targetId)?.focus();
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !setupCode) {
      showError(
        t("setupCodeMissingFields"),
        !email.trim() ? "email" : "setupCode",
      );
      return;
    }

    const passwordPolicyError = getPasswordPolicyErrorCode(newPassword);
    if (passwordPolicyError) {
      showError(
        passwordPolicyError === "PASSWORD_TOO_SHORT"
          ? t("passwordTooShort")
          : t("passwordRequiresLettersAndNumbers"),
        "newPassword",
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      showError(t("passwordsDoNotMatch"), "confirmPassword");
      return;
    }

    setIsLoading(true);
    try {
      const claimResult = await claimMigratedAccount(
        email.trim(),
        setupCode,
        newPassword,
      );
      if (!claimResult.success) {
        showError(
          claimResult.code === "RATE_LIMITED"
            ? t("setupRateLimited")
            : claimResult.code === "PASSWORD_TOO_SHORT"
              ? t("passwordTooShort")
              : claimResult.code === "PASSWORD_REQUIRES_LETTERS_AND_NUMBERS"
                ? t("passwordRequiresLettersAndNumbers")
                : t("setupNotEligible"),
          claimResult.code === "PASSWORD_TOO_SHORT" ||
            claimResult.code === "PASSWORD_REQUIRES_LETTERS_AND_NUMBERS"
            ? "newPassword"
            : "form",
        );
        return;
      }

      const loginResult = await login(email.trim(), newPassword);
      if (!loginResult.success) {
        showError(t("automaticSignInFailed"));
        return;
      }
      router.push("/");
    } catch {
      showError(t("firstSetupFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 py-10 sm:px-6 lg:px-8"
    >
      <div className="w-full max-w-sm sm:max-w-md">
        <LanguageSwitcher className="mb-4 flex justify-end" compact />
        <div className="app-panel p-6 sm:p-8 lg:p-10">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 grid h-11 w-11 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
              {brand.name.charAt(0).toUpperCase()}
            </div>
            <h1 className="mb-2 break-words text-2xl font-semibold tracking-[-0.03em] text-text-heading sm:text-3xl">
              {t("setupCodePageTitle")}
            </h1>
            <p className="text-sm leading-relaxed text-text-muted">
              {t("setupCodePageDescription")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" aria-busy={isLoading}>
            <div>
              <label htmlFor="setup-email" className="app-label">
                {t("email")}
              </label>
              <input
                id="setup-email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="app-field"
                autoComplete="email"
                spellCheck={false}
                required
                disabled={isLoading}
                aria-describedby={`setup-email-help${
                  error?.target === "email" ? " setup-error" : ""
                }`}
                aria-invalid={error?.target === "email"}
              />
              <p id="setup-email-help" className="app-helper">
                {t("emailSetupHelp")}
              </p>
            </div>

            <div>
              <label htmlFor="setup-code" className="app-label">
                {t("setupCode")}
              </label>
              <PasswordInput
                id="setup-code"
                name="setup-code"
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
                inputClassName="app-field pr-12 font-mono tracking-wider"
                autoComplete="one-time-code"
                required
                disabled={isLoading}
                aria-describedby={`setup-code-help${
                  error?.target === "setupCode" ? " setup-error" : ""
                }`}
                aria-invalid={error?.target === "setupCode"}
              />
              <p id="setup-code-help" className="app-helper">
                {t("setupCodeHelp")}
              </p>
            </div>

            <div>
              <label htmlFor="setup-new-password" className="app-label">
                {t("newPassword")}
              </label>
              <PasswordInput
                id="setup-new-password"
                name="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                inputClassName="app-field pr-12"
                autoComplete="new-password"
                required
                disabled={isLoading}
                aria-describedby={`setup-password-policy${
                  error?.target === "newPassword" ? " setup-error" : ""
                }`}
                aria-invalid={error?.target === "newPassword"}
              />
              <p id="setup-password-policy" className="app-helper">
                {t("passwordPolicyHint")}
              </p>
            </div>

            <div>
              <label htmlFor="setup-confirm-password" className="app-label">
                {t("confirmPassword")}
              </label>
              <PasswordInput
                id="setup-confirm-password"
                name="confirm-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                inputClassName="app-field pr-12"
                autoComplete="new-password"
                required
                disabled={isLoading}
                aria-describedby={
                  error?.target === "confirmPassword" ? "setup-error" : undefined
                }
                aria-invalid={error?.target === "confirmPassword"}
              />
            </div>

            {error && (
              <div id="setup-error" tabIndex={-1}>
                <Alert type="error" message={error.message} />
              </div>
            )}

            <Button type="submit" isLoading={isLoading} fullWidth size="lg">
              {t("setPasswordAndSignIn")}
            </Button>
            <ButtonLink href="/auth/login" variant="ghost" fullWidth size="sm">
              {t("backToSignIn")}
            </ButtonLink>
          </form>

          <Footer compact />
        </div>
      </div>
    </main>
  );
}
