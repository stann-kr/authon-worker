"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Footer from "@/components/Footer";
import { BRAND_NAME } from "@/lib/brand";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";

// useSearchParams()를 사용하는 내부 컴포넌트 — Suspense로 감싸야 함
function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [step, setStep] = useState<"request" | "reset" | "completed">("request");

  useEffect(() => {
    if (token) {
      setStep("reset");
    }
  }, [token]);

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
      if (!res.ok) throw new Error(data.error || "요청 중 오류가 발생했습니다.");

      setMessage({ type: "success", text: "재설정 링크가 이메일로 발송되었습니다." });
      setStep("completed");
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "비밀번호가 일치하지 않습니다." });
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
      if (!res.ok) throw new Error(data.error || "비밀번호 변경 중 오류가 발생했습니다.");

      setMessage({ type: "success", text: "비밀번호가 성공적으로 변경되었습니다." });
      setStep("completed");
      setTimeout(() => router.push("/auth/login"), 3000);
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="bg-gray-900/50 border border-gray-800 p-6 sm:p-8 lg:p-10">
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

          {message && (
            <div className="mb-6">
              <Alert type={message.type} message={message.text} />
            </div>
          )}

          {step === "request" && (
            <form onSubmit={handleRequest} className="space-y-6">
              <div>
                <label className="block text-gray-400 font-mono text-[10px] tracking-widest uppercase mb-2">
                  EMAIL ADDRESS
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-black border border-gray-800 text-white p-3 font-mono text-sm focus:outline-none focus:border-white transition-colors"
                  placeholder="ID@AUTHON.PRO"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:bg-gray-600 flex items-center justify-center gap-2"
              >
                {loading ? <Spinner mode="button" /> : "SEND RESET LINK"}
              </button>
            </form>
          )}

          {step === "reset" && (
            <form onSubmit={handleReset} className="space-y-6">
              <div>
                <label className="block text-gray-400 font-mono text-[10px] tracking-widest uppercase mb-2">
                  NEW PASSWORD
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-black border border-gray-800 text-white p-3 font-mono text-sm focus:outline-none focus:border-white transition-colors"
                />
              </div>

              <div>
                <label className="block text-gray-400 font-mono text-[10px] tracking-widest uppercase mb-2">
                  CONFIRM PASSWORD
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-black border border-gray-800 text-white p-3 font-mono text-sm focus:outline-none focus:border-white transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:bg-gray-600 flex items-center justify-center gap-2"
              >
                {loading ? <Spinner mode="button" /> : "UPDATE PASSWORD"}
              </button>
            </form>
          )}

          {step === "completed" && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 border border-green-500 flex items-center justify-center mx-auto">
                <i className="ri-check-line text-green-500 text-3xl"></i>
              </div>
              
              <p className="text-gray-400 font-mono text-xs tracking-wider leading-relaxed">
                {message?.type === "success" 
                  ? "요청이 정상적으로 처리되었습니다. 잠시 후 로그인 페이지로 이동합니다."
                  : "요청 처리 중 문제가 발생했습니다."}
              </p>

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

// 페이지 컴포넌트: useSearchParams()를 사용하는 컴포넌트를 Suspense로 감쌈
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
