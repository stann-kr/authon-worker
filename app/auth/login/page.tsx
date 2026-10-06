"use client";

import { useEffect, useRef, useState } from "react";
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
import { completeAuthenticatedClientSession } from "@/lib/auth/client-session";
import { useVenueBrand } from "@/components/VenueBrandProvider";
import { useAuthSession } from "@/components/AuthSessionProvider";

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

const AUTH_ERROR_FIELD_IDS: Partial<Record<AuthErrorTarget, string>> = {
  email: "email",
  password: "password",
  setupPassword: "setup-password",
  confirmPassword: "setup-password-confirm",
};

// 로그인 화면으로 돌아온 이유. 허용된 값만 안내하며 다른 값은 무시합니다.
const LOGIN_NOTICE_KEYS = {
  "password-changed": "passwordChangedSignIn",
} as const;

function readLoginNoticeKey() {
  const reason = new URLSearchParams(window.location.search).get("reason");
  return reason && Object.prototype.hasOwnProperty.call(LOGIN_NOTICE_KEYS, reason)
    ? LOGIN_NOTICE_KEYS[reason as keyof typeof LOGIN_NOTICE_KEYS]
    : null;
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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [mode, setMode] = useState<LoginMode>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorState | null>(null);
  const [noticeKey, setNoticeKey] = useState<
    (typeof LOGIN_NOTICE_KEYS)[keyof typeof LOGIN_NOTICE_KEYS] | null
  >(null);
  const pendingErrorFocusRef = useRef(false);
  const router = useRouter();
  const { setUser } = useAuthSession();
  const showError = (message: string, target: AuthErrorTarget = "form") => {
    pendingErrorFocusRef.current = true;
    setAuthError({ message, target });
  };

  useEffect(() => {
    setNoticeKey(readLoginNoticeKey());
  }, []);

  // 입력란은 요청 중 disabled이므로 다시 활성화된 뒤 오류 입력란으로 focus를 옮깁니다.
  useEffect(() => {
    if (isLoading || !authError || !pendingErrorFocusRef.current) return;
    pendingErrorFocusRef.current = false;
    const fieldId = AUTH_ERROR_FIELD_IDS[authError.target];
    if (fieldId) document.getElementById(fieldId)?.focus();
  }, [authError, isLoading]);

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

  const getLoginErrorTarget = (code?: string): AuthErrorTarget => {
    if (code === "INVALID_CREDENTIALS") return "password";
    if (code === "MISSING_CREDENTIALS") {
      return formData.email.trim() ? "password" : "email";
    }
    return "form";
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
    setAuthError(null);
  };

  const returnToLogin = () => {
    setMode("login");
    setSetupPassword("");
    setSetupCode("");
    setConfirmPassword("");
    setAuthError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setAuthError(null);
    setNoticeKey(null);

    try {
      const result = await login(
        formData.email,
        formData.password,
        keepSignedIn,
      );

      if (result.success) {
        completeAuthenticatedClientSession({
          user: result.user,
          setUser,
          navigate: (href) => router.replace(href),
        });
      } else if (result.requiresSetup) {
        enterSetupMode();
      } else {
        showError(
          getLoginError(result.code, result.message),
          getLoginErrorTarget(result.code),
        );
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

      const loginResult = await login(
        formData.email,
        setupPassword,
        keepSignedIn,
      );
      if (!loginResult.success) {
        setMode("login");
        setSetupPassword("");
        setConfirmPassword("");
        showError(
          t("automaticSignInFailed"),
        );
        return;
      }

      completeAuthenticatedClientSession({
        user: loginResult.user,
        setUser,
        navigate: (href) => router.replace(href),
      });
    } catch {
      showError(t("firstSetupFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="auth-page auth-login-page">
      <div className="auth-frame">
        <header className="auth-login-header">
          <p className="auth-brand">{brand.name}</p>
          <LanguageSwitcher compact />
        </header>
        <div className="auth-panel">
          <div className="auth-heading">
            <h1>{mode === "login" ? t("signInTitle") : t("setupTitle")}</h1>
          </div>

          <form
            method="post"
            onSubmit={mode === "login" ? handleSubmit : handleSetup}
            className="auth-login-form"
            aria-busy={isLoading}
          >
            {noticeKey && mode === "login" && (
              <Alert type="success" message={t(noticeKey)} />
            )}

            {mode === "setup" && (
              <p className="text-sm text-text-muted" role="note">
                {t("oneTimeSetupDescription")}
              </p>
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
                aria-describedby={
                  mode === "setup"
                    ? `email-helper${authError?.target === "email" ? " auth-error" : ""}`
                    : authError?.target === "email"
                      ? "auth-error"
                      : undefined
                }
                aria-invalid={authError?.target === "email"}
              />
              {mode === "setup" && (
                <p id="email-helper" className="app-helper">
                  {t("emailSetupHelp")}
                </p>
              )}
            </div>

            {mode === "login" ? (
              <div>
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
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  aria-describedby={`password-helper${authError?.target === "password" ? " auth-error" : ""}`}
                  aria-invalid={authError?.target === "password"}
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

            {mode === "login" && (
              <div className="auth-login-options">
                <label
                  htmlFor="keep-signed-in"
                  className="auth-login-remember"
                >
                  <input
                    id="keep-signed-in"
                    name="keep-signed-in"
                    type="checkbox"
                    checked={keepSignedIn}
                    onChange={(event) => setKeepSignedIn(event.target.checked)}
                    disabled={isLoading}
                    className="h-4 w-4 shrink-0 accent-action-primary"
                  />
                  <span>{t("keepSignedIn")}</span>
                </label>
                <Link href="/auth/reset-password" className="auth-login-link">
                  {t("forgotPassword")}
                </Link>
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
                className="auth-login-secondary"
              >
                {t("backToSignIn")}
              </button>
            )}

            {mode === "login" && (
              <Link
                href="/auth/setup-password"
                className="auth-login-secondary"
              >
                {t("openSetupCodePage")}
              </Link>
            )}
          </form>

          <Footer compact />
        </div>
      </div>
    </main>
  );
}
