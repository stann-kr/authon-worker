"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Footer from "@/components/Footer";
import { BRAND_NAME } from "@/lib/brand";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";
import PasswordInput from "@/components/PasswordInput";
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from "@/lib/auth/password-policy";

const STEP_ITEMS = ["REQUEST", "EMAIL", "RESET", "DONE"] as const;

function StepIndicator({ currentStep }: { currentStep: 0 | 1 | 2 | 3 }) {
  return (
    <div className="mb-8">
      <div className="grid grid-cols-4 gap-2">
        {STEP_ITEMS.map((label, index) => {
          const active = index === currentStep;
          const complete = index < currentStep;
          return (
            <div key={label} className="space-y-2">
              <div
                className={`h-1 ${
                  complete || active ? "bg-white" : "bg-gray-800"
                }`}
              />
              <p
                className={`font-mono text-[9px] tracking-[0.24em] uppercase ${
                  active ? "text-white" : complete ? "text-gray-300" : "text-gray-600"
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
    <div className="min-h-screen bg-black flex items-center justify-center px-4 sm:px-6 lg:px-8 py-10">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="bg-gray-900/60 border border-gray-800 p-6 sm:p-8 lg:p-10 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-2 h-2 bg-white"></div>
              <div className="w-2 h-2 bg-white"></div>
              <div className="w-2 h-2 bg-white"></div>
            </div>
            <h1 className="font-mono text-xl sm:text-2xl lg:text-3xl tracking-wider text-white uppercase mb-2">
              {BRAND_NAME}
            </h1>
            <p className="text-xs sm:text-sm text-gray-400 tracking-widest font-mono uppercase">
              PASSWORD RESET
            </p>
          </div>

          <StepIndicator currentStep={stepIndex} />

          <div className="mb-6 border border-white/10 bg-black/30 p-4">
            <p className="font-mono text-[10px] tracking-[0.24em] uppercase text-white mb-2">
              Secure recovery flow
            </p>
            <p className="font-mono text-[10px] tracking-[0.08em] text-gray-400 leading-relaxed">
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
                <label htmlFor="email" className="block text-gray-400 font-mono text-[10px] tracking-widest uppercase mb-2">
                  EMAIL ADDRESS
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="w-full bg-black border border-gray-800 text-white p-3 font-mono text-sm focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="name@example.com"
                  aria-describedby="email-helper request-helper"
                  aria-invalid={message?.type === "error" ? "true" : "false"}
                />
                <p id="email-helper" className="text-gray-500 font-mono text-[10px] tracking-[0.08em] mt-2 leading-relaxed">
                  Use the email address registered to your account.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="border border-gray-800 bg-black/40 p-3">
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-white mb-1">1</p>
                  <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-500">Request</p>
                </div>
                <div className="border border-gray-800 bg-black/40 p-3">
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-white mb-1">2</p>
                  <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-500">Check inbox</p>
                </div>
                <div className="border border-gray-800 bg-black/40 p-3">
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-white mb-1">3</p>
                  <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-500">Set password</p>
                </div>
              </div>

              <p id="request-helper" className="text-gray-500 font-mono text-[10px] tracking-[0.08em] leading-relaxed">
                For security, we do not confirm whether an email is registered during the request step.
              </p>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Spinner mode="button" /> : "SEND RESET LINK"}
              </button>
            </form>
          )}

          {step === "reset" && (
            <form onSubmit={handleReset} className="space-y-6" aria-busy={loading}>
              <div>
                <label htmlFor="new-password" className="block text-gray-400 font-mono text-[10px] tracking-widest uppercase mb-2">
                  NEW PASSWORD
                </label>
                <PasswordInput
                  id="new-password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  inputClassName="w-full bg-black border border-gray-800 text-white p-3 pr-12 font-mono text-sm focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Create a new password"
                  aria-describedby="password-policy"
                  aria-invalid={message?.type === "error" ? "true" : "false"}
                />
                <p id="password-policy" className="text-gray-500 font-mono text-[10px] tracking-[0.08em] mt-2 leading-relaxed">
                  {PASSWORD_POLICY_HINT}
                </p>
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-gray-400 font-mono text-[10px] tracking-widest uppercase mb-2">
                  CONFIRM PASSWORD
                </label>
                <PasswordInput
                  id="confirm-password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  inputClassName="w-full bg-black border border-gray-800 text-white p-3 pr-12 font-mono text-sm focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Re-enter your new password"
                  aria-describedby="confirm-helper"
                  aria-invalid={message?.type === "error" ? "true" : "false"}
                />
                <p id="confirm-helper" className="text-gray-500 font-mono text-[10px] tracking-[0.08em] mt-2 leading-relaxed">
                  Re-enter the same password to confirm it before submission.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Spinner mode="button" /> : "UPDATE PASSWORD"}
              </button>
            </form>
          )}

          {step === "requestSent" && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 border border-green-500 bg-green-950/20 flex items-center justify-center mx-auto">
                <i className="ri-mail-check-line text-green-500 text-3xl"></i>
              </div>

              <div className="space-y-3">
                <p className="text-gray-300 font-mono text-xs tracking-[0.08em] leading-relaxed">
                  A secure reset link has been sent to your email.
                </p>
                <p className="text-gray-500 font-mono text-[10px] tracking-[0.08em] leading-relaxed">
                  The link is valid for 1 hour. If it does not arrive, check your spam folder or contact your administrator/support team.
                </p>
              </div>

              <button
                onClick={() => router.push("/auth/login")}
                className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors"
              >
                RETURN TO LOGIN
              </button>
            </div>
          )}

          {step === "resetComplete" && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 border border-green-500 bg-green-950/20 flex items-center justify-center mx-auto">
                <i className="ri-check-line text-green-500 text-3xl"></i>
              </div>

              <div className="space-y-3">
                <p className="text-gray-300 font-mono text-xs tracking-[0.08em] leading-relaxed">
                  Your password has been updated successfully.
                </p>
                <p className="text-gray-500 font-mono text-[10px] tracking-[0.08em] leading-relaxed">
                  Redirecting you back to login so you can sign in with the new password.
                </p>
              </div>

              <button
                onClick={() => router.push("/auth/login")}
                className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors"
              >
                RETURN TO LOGIN
              </button>
            </div>
          )}

          <div className="mt-8 text-center">
            <button
              onClick={() => router.push("/auth/login")}
              className="text-gray-500 font-mono text-[10px] tracking-widest uppercase hover:text-white transition-colors"
            >
              BACK TO LOGIN
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
        <div className="min-h-screen bg-black flex items-center justify-center">
          <Spinner mode="inline" text="LOADING..." />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
