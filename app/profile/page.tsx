"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";
import RoleLabel from "@/components/RoleLabel";
import PasswordInput from "@/components/PasswordInput";
import Icon from "@/components/Icon";
import Button from "@/components/Button";
import AdminHeader from "@/app/admin/components/AdminHeader";
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

  return (
    <div className="min-h-[100dvh] bg-canvas flex flex-col">
      <AdminHeader />
      <div className="flex-1 overflow-x-hidden pt-20 sm:pt-24 flex flex-col">
        <div className="page-container">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1 space-y-4">
              <div className="app-panel p-4 sm:p-5">
                <div className="flex flex-col items-center text-center">
                  <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-panel border border-border-default bg-surface-raised sm:h-24 sm:w-24">
                    <Icon name="user" size={30} className="text-text-muted" />
                  </div>
                  <h2 className="mb-1 text-base font-semibold text-text-heading sm:text-lg">
                    {user.name}
                  </h2>
                  <p className="mb-3 break-all text-xs text-text-muted">
                    {user.email}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="px-2 py-1 bg-canvas border border-border-strong text-xs font-mono text-text-body uppercase">
                      <RoleLabel role={user.role} />
                    </span>
                    <span className="px-2 py-1 bg-canvas border border-border-strong text-xs font-mono text-text-body">
                      LIMIT: {user.guest_limit}
                    </span>
                  </div>
                </div>
              </div>

              <div className="app-panel p-4 sm:p-5">
                <h3 className="text-xs font-medium text-text-muted sm:text-sm mb-3">
                  ACCOUNT INFO
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-xs text-text-dim">
                      Role
                    </span>
                    <span className="text-xs text-text-heading text-right">
                      <RoleLabel role={user.role} />
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-xs text-text-dim">
                      Guest Limit
                    </span>
                    <span className="text-text-heading font-mono text-xs">
                      {user.guest_limit}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-xs text-text-dim">
                      Status
                    </span>
                    <span className="text-xs text-text-heading">
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

              <div className="app-panel overflow-hidden">
                <div className="border-b border-border-default p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-heading">
                      Account settings
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-text-muted">
                      Keep profile details and security actions separated so each task is easier to review on desktop and mobile.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveSection("profile")}
                      aria-pressed={activeSection === "profile"}
                      className={`min-h-11 rounded-control border px-4 py-3 text-sm font-medium ${
                        activeSection === "profile"
                          ? "border-action-primary bg-action-primary text-action-text"
                          : "bg-canvas text-text-muted border-border-default hover:text-text-heading hover:border-border-strong"
                      }`}
                    >
                      Basic info
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSection("security")}
                      aria-pressed={activeSection === "security"}
                      className={`min-h-11 rounded-control border px-4 py-3 text-sm font-medium ${
                        activeSection === "security"
                          ? "border-action-primary bg-action-primary text-action-text"
                          : "bg-canvas text-text-muted border-border-default hover:text-text-heading hover:border-border-strong"
                      }`}
                    >
                      Security
                    </button>
                  </div>
                </div>

                {activeSection === "profile" ? (
                  <div>
                    <div className="border-b border-border-default p-4">
                      <h3 className="text-xs font-semibold text-text-heading sm:text-sm">
                        EDIT PROFILE
                      </h3>
                    </div>

                    <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6" aria-busy={isSaving}>
                      <div>
                        <label htmlFor="profile-name" className="app-label">
                          Name
                        </label>
                        <input
                          id="profile-name"
                          type="text"
                          value={formData.name}
                          onChange={(e) =>
                            setFormData({ ...formData, name: e.target.value })
                          }
                          disabled={isSaving}
                          className="app-field"
                          required
                          aria-describedby="profile-name-helper"
                          aria-invalid={error ? "true" : "false"}
                        />
                        <p id="profile-name-helper" className="app-helper">
                          Your display name or identifier within this context.
                        </p>
                      </div>

                      <Button type="submit" isLoading={isSaving} fullWidth size="lg" leftIcon={<Icon name="save" size={17} />}>
                        Save changes
                      </Button>
                    </form>
                  </div>
                ) : (
                  <div>
                    <div className="border-b border-border-default p-4">
                      <h3 className="text-xs font-semibold text-text-heading sm:text-sm">
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

      <div className="border border-border-strong bg-surface-raised p-4 space-y-2">
        <div className="flex items-center gap-2 text-text-muted font-mono text-xs tracking-[0.24em] uppercase">
          <Icon name="warning" size={16} />
          Security warning
        </div>
        <p id="password-warning-msg" className="text-text-muted font-mono text-xs sm:text-xs tracking-[0.08em] leading-relaxed">
          Changing your password will immediately sign you out. You will need to log in again on this device.
        </p>
      </div>

      <div>
        <label htmlFor="current-password" className="app-label">
          Current password
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
        <label htmlFor="new-password" className="app-label">
          New password
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
        <p id="new-password-policy" className="app-helper">
          {PASSWORD_POLICY_HINT}
        </p>
      </div>

      <div>
        <label htmlFor="confirm-password" className="app-label">
          Confirm new password
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
        <p id="confirm-password-helper" className="app-helper">
          Re-enter your new password to confirm accuracy before saving.
        </p>
      </div>

      <Button
        type="submit"
        disabled={isRedirecting}
        isLoading={isUpdating || isRedirecting}
        fullWidth
        size="lg"
        leftIcon={<Icon name="key" size={17} />}
      >
        {isRedirecting ? "Redirecting to login" : "Update password"}
      </Button>
    </form>
  );
}
