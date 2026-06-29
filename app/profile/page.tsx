"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Footer from "@/components/Footer";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";
import RoleLabel from "@/components/RoleLabel";
import PasswordInput from "@/components/PasswordInput";
import { getUser, User } from "@/lib/auth";
import { updateUserProfile } from "@/lib/api/users";
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from "@/lib/auth/password-policy";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<"profile" | "security">(
    "profile",
  );

  const [formData, setFormData] = useState({
    name: "",
  });

  const router = useRouter();

  useEffect(() => {
    const currentUser = getUser();
    if (!currentUser) {
      router.push("/auth/login");
      return;
    }
    setUser(currentUser);
    setFormData({ name: currentUser.name });
    setIsLoading(false);
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSaving(true);

    try {
      if (!user) {
        setError("User session is unavailable.");
        return;
      }

      let nextUser: User = user;

      if (formData.name !== user.name) {
        const { data, error: nameError } = await updateUserProfile(user.id, {
          name: formData.name,
        });

        if (nameError) {
          setError("Failed to update name: " + nameError);
          setIsSaving(false);
          return;
        }

        if (data) {
          nextUser = {
            ...user,
            name: data.name,
            email: data.email,
            role: data.role,
            venue_id: data.venueId,
            guest_limit: data.guestLimit ?? 0,
          };
        }
      }

      localStorage.setItem("user", JSON.stringify(nextUser));
      setUser(nextUser);

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch {
      setError("An error occurred while saving.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <Spinner mode="fullscreen" text="LOADING..." />;
  }

  if (!user) return null;

  const profileHeader = (
    <div className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10">
        <div className="flex items-center justify-between h-16 sm:h-20">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="w-8 h-8 sm:w-10 sm:h-10 border border-gray-600 bg-black hover:bg-gray-900 transition-colors flex items-center justify-center"
            >
              <i className="ri-arrow-left-line text-gray-400 text-sm sm:text-base"></i>
            </Link>
            <div>
              <h1 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase">
                PROFILE
              </h1>
              <p className="text-xs text-gray-500 font-mono tracking-wider uppercase hidden sm:block">
                EDIT YOUR INFORMATION
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {profileHeader}
      <div className="flex-1 overflow-x-hidden pt-20 sm:pt-24 flex flex-col">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 w-full lg:flex-1 lg:min-h-0 flex flex-col">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
                <div className="flex flex-col items-center text-center">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 border border-gray-600 bg-black flex items-center justify-center mb-4">
                    <i className="ri-user-line text-gray-400 text-3xl sm:text-4xl"></i>
                  </div>
                  <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1">
                    {user.name}
                  </h2>
                  <p className="text-gray-400 font-mono text-xs tracking-[0.16em] break-all mb-3">
                    {user.email}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="px-2 py-1 bg-black border border-gray-600 text-xs font-mono text-gray-300 uppercase">
                      <RoleLabel role={user.role} />
                    </span>
                    <span className="px-2 py-1 bg-black border border-gray-600 text-xs font-mono text-gray-300">
                      LIMIT: {user.guest_limit}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
                <h3 className="font-mono text-xs sm:text-sm tracking-wider text-gray-400 uppercase mb-3">
                  ACCOUNT INFO
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-gray-500 font-mono text-xs uppercase">
                      Role
                    </span>
                    <span className="text-white font-mono text-xs uppercase text-right">
                      <RoleLabel role={user.role} />
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-gray-500 font-mono text-xs uppercase">
                      Guest Limit
                    </span>
                    <span className="text-white font-mono text-xs">
                      {user.guest_limit}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-gray-500 font-mono text-xs uppercase">
                      Status
                    </span>
                    <span className="text-green-400 font-mono text-xs uppercase">
                      ACTIVE
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-6">
              {showSuccess && (
                <Alert
                  type="success"
                  message="Profile saved successfully."
                  className="mb-6"
                />
              )}

              {error && <Alert type="error" message={error} className="mb-6" />}

              <div className="bg-gray-900 border border-gray-700 overflow-hidden">
                <div className="border-b border-gray-700 p-4 space-y-4">
                  <div>
                    <h3 className="font-mono text-xs sm:text-sm tracking-wider text-white uppercase">
                      ACCOUNT SETTINGS
                    </h3>
                    <p className="mt-2 text-gray-500 font-mono text-[10px] tracking-[0.08em] leading-relaxed">
                      Keep profile details and security actions separated so each task is easier to review on desktop and mobile.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveSection("profile")}
                      className={`px-4 py-3.5 border font-mono text-[10px] sm:text-xs tracking-[0.22em] uppercase transition-colors ${
                        activeSection === "profile"
                          ? "bg-white text-black border-white"
                          : "bg-black text-gray-400 border-gray-700 hover:text-white hover:border-gray-500"
                      }`}
                    >
                      BASIC INFO
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSection("security")}
                      className={`px-4 py-3.5 border font-mono text-[10px] sm:text-xs tracking-[0.22em] uppercase transition-colors ${
                        activeSection === "security"
                          ? "bg-white text-black border-white"
                          : "bg-black text-gray-400 border-gray-700 hover:text-white hover:border-gray-500"
                      }`}
                    >
                      SECURITY
                    </button>
                  </div>
                </div>

                {activeSection === "profile" ? (
                  <div>
                    <div className="border-b border-gray-700 p-4">
                      <h3 className="font-mono text-xs sm:text-sm tracking-wider text-white uppercase">
                        EDIT PROFILE
                      </h3>
                    </div>

                    <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6" aria-busy={isSaving}>
                      <div>
                        <label htmlFor="profile-name" className="block text-xs sm:text-sm text-gray-400 font-mono tracking-wider uppercase mb-2">
                          NAME
                        </label>
                        <input
                          id="profile-name"
                          type="text"
                          value={formData.name}
                          onChange={(e) =>
                            setFormData({ ...formData, name: e.target.value })
                          }
                          disabled={isSaving}
                          className="w-full bg-black border border-gray-600 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          required
                          aria-describedby="profile-name-helper"
                          aria-invalid={error ? "true" : "false"}
                        />
                        <p id="profile-name-helper" className="text-gray-500 font-mono text-[10px] tracking-[0.08em] mt-2 leading-relaxed">
                          Your display name or identifier within this context.
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={isSaving}
                        className="w-full bg-white text-black font-mono text-sm tracking-wider uppercase py-3 sm:py-4 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isSaving ? (
                          <>
                            <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                            SAVING...
                          </>
                        ) : (
                          <>
                            <i className="ri-save-line"></i>
                            SAVE CHANGES
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                ) : (
                  <div>
                    <div className="border-b border-gray-700 p-4">
                      <h3 className="font-mono text-xs sm:text-sm tracking-wider text-white uppercase">
                        CHANGE PASSWORD
                      </h3>
                    </div>
                    <PasswordChangeForm />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}

function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const router = useRouter();

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    const policyError = getPasswordPolicyError(newPassword);
    if (policyError) {
      setPasswordError(policyError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setIsUpdating(true);
    try {
      const res = await fetch("/api/profile/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update password");
      }

      setPasswordSuccess(data.message || "Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      if (data.reauthRequired) {
        setIsRedirecting(true);
        localStorage.removeItem("user");
        setTimeout(() => {
          router.push("/auth/login");
        }, 3000);
      }
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <form onSubmit={handlePasswordChange} className="p-4 sm:p-6 space-y-5" aria-busy={isUpdating || isRedirecting}>
      {passwordError && <Alert type="error" message={passwordError} className="mb-4" />}
      {passwordSuccess && <Alert type="success" message={passwordSuccess} className="mb-4" />}

      <div className="border border-yellow-700/60 bg-yellow-950/20 p-4 space-y-2">
        <div className="flex items-center gap-2 text-yellow-300 font-mono text-[10px] tracking-[0.24em] uppercase">
          <i className="ri-alert-line"></i>
          Security warning
        </div>
        <p id="password-warning-msg" className="text-yellow-100/80 font-mono text-[10px] sm:text-xs tracking-[0.08em] leading-relaxed">
          Changing your password will immediately sign you out. You will need to log in again on this device.
        </p>
      </div>

      <div>
        <label htmlFor="current-password" className="block text-xs sm:text-sm text-gray-400 font-mono tracking-wider uppercase mb-2">
          CURRENT PASSWORD
        </label>
        <PasswordInput
          id="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          disabled={isUpdating || isRedirecting}
          required
          aria-describedby="password-warning-msg"
          aria-invalid={passwordError ? "true" : "false"}
        />
      </div>

      <div>
        <label htmlFor="new-password" className="block text-xs sm:text-sm text-gray-400 font-mono tracking-wider uppercase mb-2">
          NEW PASSWORD
        </label>
        <PasswordInput
          id="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          disabled={isUpdating || isRedirecting}
          required
          placeholder="Create a new password"
          aria-describedby="new-password-policy"
          aria-invalid={passwordError ? "true" : "false"}
        />
        <p id="new-password-policy" className="text-gray-500 font-mono text-[10px] tracking-[0.08em] mt-2 leading-relaxed">
          {PASSWORD_POLICY_HINT}
        </p>
      </div>

      <div>
        <label htmlFor="confirm-password" className="block text-xs sm:text-sm text-gray-400 font-mono tracking-wider uppercase mb-2">
          CONFIRM NEW PASSWORD
        </label>
        <PasswordInput
          id="confirm-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          disabled={isUpdating || isRedirecting}
          required
          placeholder="Re-enter your new password"
          aria-describedby="confirm-password-helper"
          aria-invalid={passwordError ? "true" : "false"}
        />
        <p id="confirm-password-helper" className="text-gray-500 font-mono text-[10px] tracking-[0.08em] mt-2 leading-relaxed">
          Re-enter your new password to confirm accuracy before saving.
        </p>
      </div>

      <button
        type="submit"
        disabled={isUpdating || isRedirecting}
        className="w-full bg-white text-black font-mono text-sm tracking-wider uppercase py-3 sm:py-4 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isRedirecting ? (
          <>
            <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
            REDIRECTING TO LOGIN...
          </>
        ) : isUpdating ? (
          <>
            <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
            UPDATING...
          </>
        ) : (
          <>
            <i className="ri-key-line"></i>
            UPDATE PASSWORD
          </>
        )}
      </button>
    </form>
  );
}
