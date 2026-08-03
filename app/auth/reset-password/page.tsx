"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Footer from "@/components/Footer";
import { BRAND_NAME } from "@/lib/brand";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";
import PasswordInput from "@/components/PasswordInput";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from "@/lib/auth/password-policy";

const STEP_ITEMS = ["REQUEST", "EMAIL", "RESET", "DONE"] as const;

function StepIndicator({ currentStep }: { currentStep: 0 | 1 | 2 | 3 }) {
  return (
    <div className="mb-8" aria-label={`Password reset progress: ${STEP_ITEMS[currentStep]}`}>
      <div className="grid grid-cols-4 gap-2">
        {STEP_ITEMS.map((label, index) => {
          const active = index === currentStep;
          const complete = index < currentStep;
          return (
            <div key={label} className="space-y-2" aria-current={active ? "step" : undefined}>
              <div
                className={`h-1 ${
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error || "An error occurred while sending the reset request.",
        );
      }

      setMessage({ type: "success", text: "A reset link has been sent to your email." });
      setStep("requestSent");
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    const policyError = getPasswordPolicyError(newPassword);
    if (policyError) {
      setMessage({ type: "error", text: policyError });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match." });
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error || "An error occurred while updating your password.",
        );
      }

      setMessage({
        type: "success",
        text: "Your password has been updated successfully.",
      });
      setStep("resetComplete");
      setTimeout(() => router.push("/auth/login"), 4500);
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="app-panel p-6 sm:p-8 lg:p-10">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 grid h-11 w-11 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
              A
            </div>
            <h1 className="mb-2 text-2xl font-semibold tracking-[-0.03em] text-text-heading sm:text-3xl">
              {BRAND_NAME}
            </h1>
            <p className="text-sm text-text-muted">
              Reset your password securely
            </p>
          </div>

          <StepIndicator currentStep={stepIndex} />

          <div className="mb-6 rounded-control border border-border-default bg-canvas p-4">
            <p className="mb-2 text-sm font-semibold text-text-heading">
              Secure recovery flow
            </p>
            <p className="text-xs leading-relaxed text-text-muted">
              Reset links are single-use, time-limited, and only work for registered accounts.
            </p>
          </div>

          {message && (
            <div className="mb-6">
              <Alert type={message.type} message={message.text} />
            </div>
          )}

          {step === "request" && (
            <form onSubmit={handleRequest} className="space-y-6" aria-busy={loading}>
              <div>
                <label htmlFor="email" className="app-label">
                  EMAIL ADDRESS
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="app-field"
                  placeholder="name@example.com"
                  aria-describedby="email-helper request-helper"
                  aria-invalid={message?.type === "error" ? "true" : "false"}
                />
                <p id="email-helper" className="app-helper">
                  Use the email address registered to your account.
                </p>
              </div>

              <p id="request-helper" className="text-xs leading-relaxed text-text-dim">
                For security, we do not confirm whether an email is registered during the request step.
              </p>

              <Button type="submit" isLoading={loading} fullWidth size="lg">
                Send reset link
              </Button>
            </form>
          )}

          {step === "reset" && (
            <form onSubmit={handleReset} className="space-y-6" aria-busy={loading}>
              <div>
                <label htmlFor="new-password" className="app-label">
                  NEW PASSWORD
                </label>
                <PasswordInput
                  id="new-password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  inputClassName="app-field pr-12"
                  placeholder="Create a new password"
                  aria-describedby="password-policy"
                  aria-invalid={message?.type === "error" ? "true" : "false"}
                />
                <p id="password-policy" className="app-helper">
                  {PASSWORD_POLICY_HINT}
                </p>
              </div>

              <div>
                <label htmlFor="confirm-password" className="app-label">
                  CONFIRM PASSWORD
                </label>
                <PasswordInput
                  id="confirm-password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  inputClassName="app-field pr-12"
                  placeholder="Re-enter your new password"
                  aria-describedby="confirm-helper"
                  aria-invalid={message?.type === "error" ? "true" : "false"}
                />
                <p id="confirm-helper" className="app-helper">
                  Re-enter the same password to confirm it before submission.
                </p>
              </div>

              <Button type="submit" isLoading={loading} fullWidth size="lg">
                Update password
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
                  A secure reset link has been sent to your email.
                </p>
                <p className="text-xs leading-relaxed text-text-dim">
                  The link is valid for 1 hour. If it does not arrive, check your spam folder or contact your administrator/support team.
                </p>
              </div>

              <Button onClick={() => router.push("/auth/login")} fullWidth size="lg">
                Return to login
              </Button>
            </div>
          )}

          {step === "resetComplete" && (
            <div className="text-center space-y-6">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-panel border border-border-strong bg-surface-raised text-text-heading">
                <Icon name="check" size={24} />
              </div>

              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-text-body">
                  Your password has been updated successfully.
                </p>
                <p className="text-xs leading-relaxed text-text-dim">
                  Redirecting you back to login so you can sign in with the new password.
                </p>
              </div>

              <Button onClick={() => router.push("/auth/login")} fullWidth size="lg">
                Return to login
              </Button>
            </div>
          )}

          <div className="mt-8 text-center">
            <button
              onClick={() => router.push("/auth/login")}
              className="pressable rounded-control px-3 py-2 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text-heading"
            >
              Back to login
            </button>
          </div>

          <Footer compact />
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-canvas">
          <Spinner mode="inline" text="LOADING..." />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
