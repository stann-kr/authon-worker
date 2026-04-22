"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";
import { BRAND_NAME } from "@/lib/brand";
import { createClient } from "@/lib/supabase/client";
import { activateUserByAuthId } from "@/lib/api/guests";

export default function ResetPasswordPage() {
  // ... (omitted for brevity in replacement chunk, but I'll make sure to replace the right block)

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [isInvite, setIsInvite] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [authCode, setAuthCode] = useState<string | null>(null);
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [flowType, setFlowType] = useState<string | null>(null);

  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const parseUrl = async () => {
      setError("");

      try {
        const hashParams = new URLSearchParams(
          window.location.hash.replace(/^#/, ""),
        );
        const queryParams = new URLSearchParams(window.location.search);

        const type = hashParams.get("type") || queryParams.get("type");
        const code = queryParams.get("code");
        const hash =
          hashParams.get("token_hash") || queryParams.get("token_hash");
        const errorMsg =
          hashParams.get("error_description") ||
          hashParams.get("error") ||
          queryParams.get("error_description") ||
          queryParams.get("error");

        setFlowType(type);
        setAuthCode(code);
        setTokenHash(hash);
        setIsInvite(type === "invite");

        if (errorMsg) {
          console.warn("Auth URL error:", errorMsg);
          setError(decodeURIComponent(errorMsg));
          setIsValid(false);
          return;
        }

        // If we have any valid verification method in URL or an existing session, show the form
        if (code || hash) {
          setIsValid(true);
        } else {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          setIsValid(!!session);
        }
      } catch (err) {
        console.error("Failed to parse URL:", err);
        setError("Invalid link. Please request a new one.");
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    };

    parseUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      // 1. URL 토큰(초대/재설정 링크)을 기존 세션보다 우선 처리
      // 기존 로그인된 관리자가 초대 링크를 눌렀을 때 관리자 비번이 바뀌는 충돌 방지
      if (authCode) {
        // PKCE Flow
        const { error: codeError } =
          await supabase.auth.exchangeCodeForSession(authCode);
        if (codeError) throw codeError;

        // 중복 교환 시도 방지
        setAuthCode(null);
      } else if (tokenHash && flowType) {
        // OTP / Magic Link Flow
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: flowType as any,
        });
        if (otpError) throw otpError;

        // 중복 교환 시도 방지
        setTokenHash(null);
      } else {
        // URL에 토큰이 없다면 기존 세션 유무만 확인
        const {
          data: { session: existingSession },
        } = await supabase.auth.getSession();

        if (!existingSession) {
          throw new Error(
            "No active session or valid token found. Please use the original link from your email.",
          );
        }
      }

      // 2. Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        throw updateError;
      }

      // Activate user account after successful password setup
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { error: activeErr } = await activateUserByAuthId(user.id);

        if (activeErr) {
          console.error("Activation error:", activeErr);
        }
      }

      // Sign out after password change for clean state
      await supabase.auth.signOut();
      setSuccess(true);
      setTimeout(() => {
        router.push("/auth/login");
      }, 3000);
    } catch (err: any) {
      console.error("Password update error:", err);
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return <Spinner mode="fullscreen" text="VERIFYING..." />;
  }

  if (success) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 border border-green-500 flex items-center justify-center mx-auto mb-6">
            <i className="ri-check-line text-green-500 text-3xl"></i>
          </div>
          <h2 className="font-mono text-xl tracking-wider text-white uppercase mb-2">
            PASSWORD CHANGED
          </h2>
          <p className="text-gray-400 font-mono text-xs tracking-wider mb-6">
            Your password has been changed. Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  if (!isValid) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 border border-red-500 flex items-center justify-center mx-auto mb-6">
            <i className="ri-close-line text-red-500 text-3xl"></i>
          </div>
          <h2 className="font-mono text-xl tracking-wider text-white uppercase mb-2">
            INVALID LINK
          </h2>
          <p className="text-gray-400 font-mono text-xs tracking-wider mb-6">
            {error ||
              "This link is invalid or expired. Please request password reset again."}
          </p>
          <button
            onClick={() => router.push("/auth/login")}
            className="bg-white text-black px-6 py-3 font-mono text-xs tracking-wider uppercase hover:bg-gray-200 transition-colors"
          >
            GO TO LOGIN
          </button>
        </div>
      </div>
    );
  }

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
              {isInvite ? "SET YOUR PASSWORD" : "SET NEW PASSWORD"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-gray-400 font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                NEW PASSWORD
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white transition-colors"
                placeholder="Minimum 6 characters"
                required
                minLength={6}
              />
            </div>

            <div>
              <label className="block text-gray-400 font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                CONFIRM PASSWORD
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white transition-colors"
                placeholder="Confirm your password"
                required
                minLength={6}
              />
            </div>

            {error && <Alert type="error" message={error} />}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border border-black border-t-transparent rounded-full animate-spin"></div>
                  <span>CHANGING...</span>
                </div>
              ) : (
                "CHANGE PASSWORD"
              )}
            </button>
          </form>

          <Footer compact />
        </div>
      </div>
    </div>
  );
}
