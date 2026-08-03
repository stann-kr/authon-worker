"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import PasswordInput from "@/components/PasswordInput";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useTranslations } from "next-intl";
import { claimMigratedAccount, login } from "@/lib/auth";
import { getPasswordPolicyErrorCode } from "@/lib/auth/password-policy";
import { useVenueBrand } from "@/components/VenueBrandProvider";

type LoginMode = "login" | "setup";

export default function LoginPage() {
  const { brand } = useVenueBrand();
  const t = useTranslations("Auth");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [setupPassword, setSetupPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<LoginMode>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const getLoginError = (code?: string, fallback?: string) => {
    switch (code) {
      case "MISSING_CREDENTIALS":
        return t("missingCredentials");
      case "RATE_LIMITED":
        return t("rateLimited");
      case "INVALID_CREDENTIALS":
        return t("invalidCredentials");
      case "SERVER_ERROR":
        return t("serverError");
      case "MISSING_SETUP_FIELDS":
        return t("setupMissingFields");
      case "PASSWORD_TOO_SHORT":
        return t("passwordTooShort");
      case "PASSWORD_REQUIRES_LETTERS_AND_NUMBERS":
        return t("passwordRequiresLettersAndNumbers");
      case "UNKNOWN_VENUE":
        return t("unknownVenue");
      case "ACCOUNT_NOT_ELIGIBLE":
        return t("setupNotEligible");
      default:
        return fallback || t("loginFailed");
    }
  };

  const getSetupError = (code?: string) => {
    if (code === "RATE_LIMITED") return t("setupRateLimited");
    return getLoginError(code, t("firstSetupFailed"));
  };

  useEffect(() => {
    const targetId = mode === "setup" ? "setup-password" : "email";
    document.getElementById(targetId)?.focus();
  }, [mode]);

  const enterSetupMode = () => {
    setMode("setup");
    setSetupCode(formData.password);
    setFormData((current) => ({ ...current, password: "" }));
    setSetupPassword("");
    setConfirmPassword("");
    setError("");
  };

  const returnToLogin = () => {
    setMode("login");
    setSetupPassword("");
    setSetupCode("");
    setConfirmPassword("");
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await login(formData.email, formData.password);

      if (result.success) {
        router.push("/");
      } else if (result.requiresSetup) {
        enterSetupMode();
      } else {
        setError(getLoginError(result.code, result.message));
      }
    } catch {
      setError(t("genericLoginError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetup = async (event: React.FormEvent) => {
    event.preventDefault();

    const passwordPolicyError = getPasswordPolicyErrorCode(setupPassword);
    if (passwordPolicyError) {
      setError(
        passwordPolicyError === "PASSWORD_TOO_SHORT"
          ? t("passwordTooShort")
          : t("passwordRequiresLettersAndNumbers"),
      );
      return;
    }
    if (setupPassword !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const claimResult = await claimMigratedAccount(
        formData.email,
        setupCode,
        setupPassword,
      );
      if (!claimResult.success) {
        setError(getSetupError(claimResult.code));
        return;
      }

      const loginResult = await login(formData.email, setupPassword);
      if (!loginResult.success) {
        setMode("login");
        setSetupPassword("");
        setConfirmPassword("");
        setError(
          t("automaticSignInFailed"),
        );
        return;
      }

      router.push("/");
    } catch {
      setError(t("firstSetupFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <LanguageSwitcher className="mb-4 flex justify-end" compact />
        <div className="app-panel p-6 sm:p-8 lg:p-10">
          <div className="mb-8 text-center sm:mb-9">
            <div className="mx-auto mb-5 grid h-11 w-11 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
              {brand.name.charAt(0).toUpperCase()}
            </div>
            <h1 className="mb-2 text-2xl font-semibold tracking-[-0.03em] text-text-heading sm:text-3xl">{brand.name}</h1>
            <p className="text-sm text-text-muted">
              {mode === "login" ? t("signInTitle") : t("setupTitle")}
            </p>
          </div>

          <form
            onSubmit={mode === "login" ? handleSubmit : handleSetup}
            className="space-y-6"
            aria-busy={isLoading}
          >
            {mode === "setup" && (
              <div className="rounded-control border border-border-default bg-surface-raised p-4" role="note">
                <p className="mb-2 text-sm font-semibold text-text-heading">
                  {t("oneTimeSetup")}
                </p>
                <p className="text-sm leading-relaxed text-text-muted">
                  {t("oneTimeSetupDescription")}
                </p>
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="app-label"
              >
                {t("email")}
              </label>
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="app-field"
                placeholder="name@example.com"
                autoComplete="email"
                required
                disabled={isLoading}
                readOnly={mode === "setup"}
                aria-readonly={mode === "setup"}
                aria-describedby={`email-helper${error ? " auth-error" : ""}`}
                aria-invalid={error ? "true" : "false"}
              />
              <p id="email-helper" className="app-helper">
                {mode === "login"
                  ? t("emailLoginHelp")
                  : t("emailSetupHelp")}
              </p>
            </div>

            {mode === "login" ? (
              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="app-label"
                >
                  {t("password")}
                </label>
                <PasswordInput
                  id="password"
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  inputClassName="app-field pr-12"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  aria-describedby={`password-helper password-support${error ? " auth-error" : ""}`}
                  aria-invalid={error ? "true" : "false"}
                />
                <p id="password-helper" className="app-helper">
                  {t("passwordHelp")}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label htmlFor="setup-password" className="app-label">
                    {t("newPassword")}
                  </label>
                  <PasswordInput
                    id="setup-password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    inputClassName="app-field pr-12"
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    aria-describedby={`setup-password-policy${error ? " auth-error" : ""}`}
                    aria-invalid={error ? "true" : "false"}
                  />
                  <p id="setup-password-policy" className="app-helper">
                    {t("passwordPolicyHint")}
                  </p>
                </div>

                <div>
                  <label htmlFor="setup-password-confirm" className="app-label">
                    {t("confirmPassword")}
                  </label>
                  <PasswordInput
                    id="setup-password-confirm"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    inputClassName="app-field pr-12"
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    aria-describedby={error ? "auth-error" : undefined}
                    aria-invalid={error ? "true" : "false"}
                  />
                </div>
              </div>
            )}

            {error && (
              <div id="auth-error">
                <Alert type="error" message={error} />
              </div>
            )}

            <Button
              type="submit"
              isLoading={isLoading}
              fullWidth
              size="lg"
            >
              {mode === "login" ? t("signIn") : t("setPasswordAndSignIn")}
            </Button>

            {mode === "setup" && (
              <button
                type="button"
                onClick={returnToLogin}
                disabled={isLoading}
                className="pressable w-full rounded-control py-2 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text-heading disabled:opacity-50"
              >
                {t("backToSignIn")}
              </button>
            )}

            <div className="space-y-1.5 rounded-control border border-border-default bg-canvas px-4 py-3">
              <p className="text-sm font-semibold text-text-heading">
                {mode === "login" ? t("migratedAccount") : t("internalSetupWindow")}
              </p>
              <p id="password-support" className="text-xs leading-relaxed text-text-dim">
                {mode === "login"
                  ? t("migratedHelp")
                  : t("setupHelp")}
              </p>
            </div>
          </form>

          <Footer compact />
        </div>
      </div>
    </div>
  );
}
