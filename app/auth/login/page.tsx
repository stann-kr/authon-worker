"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import PasswordInput from "@/components/PasswordInput";
import { claimMigratedAccount, login } from "@/lib/auth";
import {
  getPasswordPolicyError,
  PASSWORD_POLICY_HINT,
} from "@/lib/auth/password-policy";
import { useVenueBrand } from "@/components/VenueBrandProvider";

type LoginMode = "login" | "setup";

export default function LoginPage() {
  const { brand } = useVenueBrand();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [setupPassword, setSetupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<LoginMode>("login");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    const targetId = mode === "setup" ? "setup-password" : "email";
    document.getElementById(targetId)?.focus();
  }, [mode]);

  const enterSetupMode = () => {
    setMode("setup");
    setFormData((current) => ({ ...current, password: "" }));
    setSetupPassword("");
    setConfirmPassword("");
    setError("");
  };

  const returnToLogin = () => {
    setMode("login");
    setSetupPassword("");
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
        setError(result.message || "Login failed.");
      }
    } catch {
      setError("An error occurred during login.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetup = async (event: React.FormEvent) => {
    event.preventDefault();

    const passwordPolicyError = getPasswordPolicyError(setupPassword);
    if (passwordPolicyError) {
      setError(passwordPolicyError);
      return;
    }
    if (setupPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const claimResult = await claimMigratedAccount(
        formData.email,
        setupPassword,
      );
      if (!claimResult.success) {
        setError(claimResult.message || "First-time setup failed.");
        return;
      }

      const loginResult = await login(formData.email, setupPassword);
      if (!loginResult.success) {
        setMode("login");
        setSetupPassword("");
        setConfirmPassword("");
        setError(
          "Your password was set, but automatic sign-in failed. Sign in again with the new password.",
        );
        return;
      }

      router.push("/");
    } catch {
      setError("An error occurred during first-time setup.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="app-panel p-6 sm:p-8 lg:p-10">
          <div className="mb-8 text-center sm:mb-9">
            <div className="mx-auto mb-5 grid h-11 w-11 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
              {brand.name.charAt(0).toUpperCase()}
            </div>
            <h1 className="mb-2 text-2xl font-semibold tracking-[-0.03em] text-text-heading sm:text-3xl">{brand.name}</h1>
            <p className="text-sm text-text-muted">
              {mode === "login" ? "Sign in to your workspace" : "Complete your account setup"}
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
                  One-time account setup
                </p>
                <p className="text-sm leading-relaxed text-text-muted">
                  Migrated accounts can set a password once without email verification. After completion, this setup path is permanently disabled for the account.
                </p>
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="app-label"
              >
                EMAIL ADDRESS
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
                  ? "Use the email address registered to your account."
                  : "This email identifies the migrated account being activated."}
              </p>
            </div>

            {mode === "login" ? (
              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="app-label"
                >
                  PASSWORD
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
                  Case-sensitive. Migrated users will be guided to first-time setup automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label htmlFor="setup-password" className="app-label">
                    NEW PASSWORD
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
                    {PASSWORD_POLICY_HINT}
                  </p>
                </div>

                <div>
                  <label htmlFor="setup-password-confirm" className="app-label">
                    CONFIRM PASSWORD
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
              {mode === "login" ? "SIGN IN" : "SET PASSWORD & SIGN IN"}
            </Button>

            {mode === "setup" && (
              <button
                type="button"
                onClick={returnToLogin}
                disabled={isLoading}
                className="pressable w-full rounded-control py-2 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text-heading disabled:opacity-50"
              >
                BACK TO SIGN IN
              </button>
            )}

            <div className="space-y-1.5 rounded-control border border-border-default bg-canvas px-4 py-3">
              <p className="text-sm font-semibold text-text-heading">
                {mode === "login" ? "Migrated account?" : "Internal setup window"}
              </p>
              <p id="password-support" className="text-xs leading-relaxed text-text-dim">
                {mode === "login"
                  ? "Migrated users can enter any password once. Accounts awaiting setup will continue to the new password step automatically."
                  : "Only accounts awaiting migration setup can use this flow. Active accounts must sign in normally or contact an administrator."}
              </p>
            </div>
          </form>

          <Footer compact />
        </div>
      </div>
    </div>
  );
}
