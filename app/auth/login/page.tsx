"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import PasswordInput from "@/components/PasswordInput";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useTranslations } from "next-intl";
import { claimMigratedAccount, login } from "@/lib/auth";
import { getPasswordPolicyErrorCode } from "@/lib/auth/password-policy";
import type { FirstLoginSetupMethod } from "@/lib/auth/first-login-policy";
import { useVenueBrand } from "@/components/VenueBrandProvider";

type LoginMode = "login" | "setup";
type AuthErrorTarget =
  | "form"
  | "email"
  | "password"
  | "setupPassword"
  | "confirmPassword";

interface AuthErrorState {
  message: string;
  target: AuthErrorTarget;
}

export default function LoginPage() {
  const { brand } = useVenueBrand();
  const t = useTranslations("Auth");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [setupPassword, setSetupPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupMethod, setSetupMethod] = useState<FirstLoginSetupMethod>("setup_code");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<LoginMode>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorState | null>(null);
  const router = useRouter();
  const showError = (message: string, target: AuthErrorTarget = "form") => {
    setAuthError({ message, target });
  };

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

  const enterSetupMode = (method: FirstLoginSetupMethod) => {
    setMode("setup");
    setSetupMethod(method);
    setSetupCode(method === "setup_code" ? formData.password : "");
    setFormData((current) => ({ ...current, password: "" }));
    setSetupPassword("");
    setConfirmPassword("");
    setAuthError(null);
  };

  const returnToLogin = () => {
    setMode("login");
    setSetupMethod("setup_code");
    setSetupPassword("");
    setSetupCode("");
    setConfirmPassword("");
    setAuthError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setAuthError(null);

    try {
      const result = await login(formData.email, formData.password);

      if (result.success) {
        router.push("/");
      } else if (result.requiresSetup) {
        enterSetupMode(result.setupMethod ?? "setup_code");
      } else {
        showError(getLoginError(result.code, result.message));
      }
    } catch {
      showError(t("genericLoginError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetup = async (event: React.FormEvent) => {
    event.preventDefault();

    const passwordPolicyError = getPasswordPolicyErrorCode(setupPassword);
    if (passwordPolicyError) {
      showError(
        passwordPolicyError === "PASSWORD_TOO_SHORT"
          ? t("passwordTooShort")
          : t("passwordRequiresLettersAndNumbers"),
        "setupPassword",
      );
      return;
    }
    if (setupPassword !== confirmPassword) {
      showError(t("passwordsDoNotMatch"), "confirmPassword");
      return;
    }

    setIsLoading(true);
    setAuthError(null);

    try {
      const claimResult = await claimMigratedAccount(
        formData.email,
        setupCode,
        setupPassword,
      );
      if (!claimResult.success) {
        showError(
          getSetupError(claimResult.code),
          claimResult.code === "PASSWORD_TOO_SHORT" ||
            claimResult.code === "PASSWORD_REQUIRES_LETTERS_AND_NUMBERS"
            ? "setupPassword"
            : "form",
        );
        return;
      }

      const loginResult = await login(formData.email, setupPassword);
      if (!loginResult.success) {
        setMode("login");
        setSetupPassword("");
        setConfirmPassword("");
        showError(
          t("automaticSignInFailed"),
        );
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
    <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <LanguageSwitcher className="mb-4 flex justify-end" compact />
        <div className="app-panel p-6 sm:p-8 lg:p-10">
          <div className="mb-8 text-center sm:mb-9">
            <div className="mx-auto mb-5 grid h-11 w-11 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
              {brand.name.charAt(0).toUpperCase()}
            </div>
            <h1 className="mb-2 max-w-full break-words text-2xl font-semibold tracking-[-0.03em] text-text-heading sm:text-3xl">{brand.name}</h1>
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
                  {setupMethod === "migration"
                    ? t("migrationSetupDescription")
                    : t("oneTimeSetupDescription")}
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
                name="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="app-field"
                placeholder="name@example.com"
                autoComplete="email"
                spellCheck={false}
                required
                disabled={isLoading}
                readOnly={mode === "setup"}
                aria-readonly={mode === "setup"}
                aria-describedby={`email-helper${authError?.target === "email" ? " auth-error" : ""}`}
                aria-invalid={authError?.target === "email"}
              />
              <p id="email-helper" className="app-helper">
                {mode === "login"
                  ? t("emailLoginHelp")
                  : setupMethod === "migration"
                    ? t("migrationEmailSetupHelp")
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
                  name="password"
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  inputClassName="app-field pr-12"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  aria-describedby={`password-helper password-support${authError?.target === "password" ? " auth-error" : ""}`}
                  aria-invalid={authError?.target === "password"}
                />
                <p id="password-helper" className="app-helper">
                  {t("passwordHelp")}
                </p>
                <div className="flex justify-end">
                  <Link
                    href="/auth/reset-password"
                    className="pressable inline-flex min-h-11 items-center rounded-control px-2 text-sm font-medium text-text-muted underline decoration-border-strong underline-offset-4 hover:text-text-heading"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label htmlFor="setup-password" className="app-label">
                    {t("newPassword")}
                  </label>
                  <PasswordInput
                    id="setup-password"
                    name="new-password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    inputClassName="app-field pr-12"
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    aria-describedby={`setup-password-policy${authError?.target === "setupPassword" ? " auth-error" : ""}`}
                    aria-invalid={authError?.target === "setupPassword"}
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
                    name="confirm-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    inputClassName="app-field pr-12"
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    aria-describedby={authError?.target === "confirmPassword" ? "auth-error" : undefined}
                    aria-invalid={authError?.target === "confirmPassword"}
                  />
                </div>
              </div>
            )}

            {authError && (
              <div id="auth-error">
                <Alert type="error" message={authError.message} />
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
                className="pressable min-h-11 w-full touch-manipulation rounded-control py-2 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text-heading disabled:opacity-50"
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
                  : setupMethod === "migration"
                    ? t("migrationSetupHelp")
                    : t("setupHelp")}
              </p>
            </div>
          </form>

          <Footer compact />
        </div>
      </div>
    </main>
  );
}
