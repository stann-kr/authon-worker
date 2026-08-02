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
import { BRAND_NAME } from "@/lib/brand";

type LoginMode = "login" | "setup";

export default function LoginPage() {
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
    <div className="min-h-screen bg-black flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="bg-surface/60 border border-border-subtle p-6 sm:p-8 lg:p-10 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="text-center mb-8 sm:mb-9">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-2 h-2 bg-white" aria-hidden="true"></div>
              <div className="w-2 h-2 bg-white" aria-hidden="true"></div>
              <div className="w-2 h-2 bg-white" aria-hidden="true"></div>
            </div>
            <h1 className="font-mono text-xl sm:text-2xl lg:text-3xl tracking-wider text-white uppercase mb-2">{BRAND_NAME}</h1>
            <p className="text-xs sm:text-sm text-gray-400 tracking-widest font-mono uppercase">
              {mode === "login" ? "USER ACCESS" : "FIRST-TIME SETUP"}
            </p>
          </div>

          <form
            onSubmit={mode === "login" ? handleSubmit : handleSetup}
            className="space-y-6"
            aria-busy={isLoading}
          >
            {mode === "setup" && (
              <div className="border border-cyan-900/60 bg-cyan-950/20 p-4" role="note">
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-cyan-200 mb-2">
                  ONE-TIME ACCOUNT SETUP
                </p>
                <p className="font-mono text-[10px] tracking-[0.08em] leading-relaxed text-gray-400">
                  Migrated accounts can set a password once without email verification. After completion, this setup path is permanently disabled for the account.
                </p>
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase mb-2"
              >
                EMAIL ADDRESS
              </label>
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full bg-surface border border-border-default px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-border-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="name@example.com"
                autoComplete="email"
                required
                disabled={isLoading}
                readOnly={mode === "setup"}
                aria-readonly={mode === "setup"}
                aria-describedby={`email-helper${error ? " auth-error" : ""}`}
                aria-invalid={error ? "true" : "false"}
              />
              <p id="email-helper" className="text-text-dim font-mono text-[10px] tracking-[0.08em] mt-2 leading-relaxed">
                {mode === "login"
                  ? "Use the email address registered to your account."
                  : "This email identifies the migrated account being activated."}
              </p>
            </div>

            {mode === "login" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="password"
                    className="block text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase"
                  >
                    PASSWORD
                  </label>
                  <button
                    type="button"
                    onClick={enterSetupMode}
                    disabled={!formData.email.trim() || isLoading}
                    className="relative inline-flex items-center gap-1 text-[10px] sm:text-xs text-white font-mono tracking-[0.22em] uppercase hover:text-gray-300 transition-colors before:absolute before:-inset-2 before:content-[''] disabled:text-gray-600 disabled:cursor-not-allowed"
                  >
                    FIRST LOGIN?
                    <i className="ri-arrow-right-line text-xs" aria-hidden="true"></i>
                  </button>
                </div>
                <PasswordInput
                  id="password"
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  inputClassName="w-full bg-surface border border-border-default px-4 py-3 sm:py-4 pr-12 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-border-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  aria-describedby={`password-helper password-support${error ? " auth-error" : ""}`}
                  aria-invalid={error ? "true" : "false"}
                />
                <p id="password-helper" className="text-text-dim font-mono text-[10px] tracking-[0.08em] leading-relaxed">
                  Case-sensitive. Migrated users will be guided to first-time setup automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label htmlFor="setup-password" className="block text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                    NEW PASSWORD
                  </label>
                  <PasswordInput
                    id="setup-password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    inputClassName="w-full bg-surface border border-border-default px-4 py-3 sm:py-4 pr-12 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-border-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    autoComplete="new-password"
                    required
                    disabled={isLoading}
                    aria-describedby={`setup-password-policy${error ? " auth-error" : ""}`}
                    aria-invalid={error ? "true" : "false"}
                  />
                  <p id="setup-password-policy" className="text-text-dim font-mono text-[10px] tracking-[0.08em] mt-2 leading-relaxed">
                    {PASSWORD_POLICY_HINT}
                  </p>
                </div>

                <div>
                  <label htmlFor="setup-password-confirm" className="block text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                    CONFIRM PASSWORD
                  </label>
                  <PasswordInput
                    id="setup-password-confirm"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    inputClassName="w-full bg-surface border border-border-default px-4 py-3 sm:py-4 pr-12 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-border-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="w-full text-gray-400 font-mono text-[10px] tracking-[0.2em] uppercase hover:text-white transition-colors disabled:opacity-50"
              >
                BACK TO SIGN IN
              </button>
            )}

            <div className="border border-white/10 bg-black/30 px-4 py-3 space-y-1.5">
              <p className="text-white font-mono text-[10px] tracking-[0.22em] uppercase">
                {mode === "login" ? "MIGRATED ACCOUNT?" : "INTERNAL SETUP WINDOW"}
              </p>
              <p id="password-support" className="text-text-dim font-mono text-[10px] tracking-[0.08em] leading-relaxed">
                {mode === "login"
                  ? "Use FIRST LOGIN to set your password once. Email recovery will be added later."
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
