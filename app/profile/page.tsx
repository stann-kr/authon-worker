"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";
import Alert from "@/components/Alert";
import RoleLabel from "@/components/RoleLabel";
import PasswordInput from "@/components/PasswordInput";
import Icon from "@/components/Icon";
import Button from "@/components/Button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PageHeader from "@/components/PageHeader";
import WorkspaceShell from "@/components/WorkspaceShell";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { useTranslations } from "next-intl";
import { updateUserProfile } from "@/lib/api/users";
import { getPasswordPolicyErrorCode } from "@/lib/auth/password-policy";

export default function ProfilePage() {
  const t = useTranslations("Profile");
  const commonT = useTranslations("Common");
  const { user, setUser } = useAuthSession();
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<"profile" | "security">(
    "profile",
  );

  const [formData, setFormData] = useState({ name: user?.name ?? "" });

  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.replace("/auth/login");
      return;
    }
    setFormData({ name: user.name });
  }, [router, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSaving(true);

    try {
      if (!user) {
        setError(t("sessionUnavailable"));
        return;
      }

      let nextUser = user;

      if (formData.name !== user.name) {
        const { data, error: nameError } = await updateUserProfile(user.id, {
          name: formData.name,
        });

        if (nameError) {
          console.error("Failed to update name:", nameError);
          setError(t("nameUpdateFailed"));
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
            guest_limit:
              typeof data.guestLimit === "number" ? data.guestLimit : null,
          };
        }
      }

      setUser(nextUser);

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  if (!user) {
    return <RouteLoadingFallback />;
  }

  return (
    <WorkspaceShell width="narrow" contentClassName="gap-6">
      <PageHeader
        titleId="profile-page-title"
        title={t("title")}
      />

      <section
        aria-labelledby="profile-page-title"
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
      >
        <aside
          className="app-panel self-start p-4 sm:p-5"
          aria-labelledby="account-info-title"
        >
          <h2
            id="account-info-title"
            className="text-xs font-medium text-text-muted sm:text-sm"
          >
            {t("accountInfo")}
          </h2>

          <div className="mt-4 flex flex-col items-center text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-panel border border-border-default bg-surface-raised sm:h-24 sm:w-24">
              <Icon name="user" size={30} className="text-text-muted" />
            </div>
            <p className="mb-1 max-w-full break-words text-base font-semibold text-text-heading sm:text-lg">
              {user.name}
            </p>
            <p className="break-all text-xs text-text-muted">{user.email}</p>
          </div>

          <dl className="mt-5 space-y-3 border-t border-border-default pt-4">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-xs text-text-dim">{t("role")}</dt>
              <dd className="text-right text-xs text-text-heading">
                <RoleLabel role={user.role} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-xs text-text-dim">{t("guestLimit")}</dt>
              <dd className="font-mono text-xs text-text-heading">
                {user.guest_limit === null ? t("unlimited") : user.guest_limit}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-xs text-text-dim">{t("status")}</dt>
              <dd className="text-xs text-text-heading">{t("active")}</dd>
            </div>
          </dl>
        </aside>

        <div className="space-y-6">
          {showSuccess && (
            <Alert
              type="success"
              message={t("profileUpdated")}
              className="mb-6"
            />
          )}

          {error && <Alert type="error" message={error} className="mb-6" />}

          <div className="app-panel overflow-hidden">
            <div className="space-y-4 border-b border-border-default p-4">
              <div>
                <h2 className="text-sm font-semibold text-text-heading">
                  {t("accountSettings")}
                </h2>
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
                  {t("basicInfo")}
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
                  {t("security")}
                </button>
              </div>
            </div>

            {activeSection === "profile" ? (
              <div>
                <div className="border-b border-border-default p-4">
                  <h3 className="text-xs font-semibold text-text-heading sm:text-sm">
                    {t("editProfile")}
                  </h3>
                </div>

                <form
                  onSubmit={handleSubmit}
                  className="space-y-6 p-4 sm:p-6"
                  aria-busy={isSaving}
                >
                  <div>
                    <label htmlFor="profile-name" className="app-label">
                      {t("name")}
                    </label>
                    <input
                      id="profile-name"
                      name="name"
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      disabled={isSaving}
                      autoComplete="name"
                      className="app-field"
                      required
                      aria-describedby="profile-name-helper"
                      aria-invalid={error ? "true" : "false"}
                    />
                    <p id="profile-name-helper" className="app-helper">
                      {t("nameHelp")}
                    </p>
                  </div>

                  <div>
                    <p className="app-label">{t("preferredLanguage")}</p>
                    <LanguageSwitcher />
                    <p className="app-helper">
                      {t("preferredLanguageHelp")}
                    </p>
                  </div>

                  <Button
                    type="submit"
                    isLoading={isSaving}
                    fullWidth
                    size="lg"
                    leftIcon={<Icon name="save" size={17} />}
                  >
                    {commonT("saveChanges")}
                  </Button>
                </form>
              </div>
            ) : (
              <div>
                <div className="border-b border-border-default p-4">
                  <h3 className="text-xs font-semibold text-text-heading sm:text-sm">
                    {t("changePassword")}
                  </h3>
                </div>
                <PasswordChangeForm />
              </div>
            )}
          </div>
        </div>
      </section>
    </WorkspaceShell>
  );
}

function PasswordChangeForm() {
  const t = useTranslations("Profile");
  const authT = useTranslations("Auth");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [passwordError, setPasswordError] = useState<{
    message: string;
    target: "form" | "newPassword" | "confirmPassword";
  } | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const router = useRouter();
  const { setUser } = useAuthSession();

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess("");

    const policyErrorCode = getPasswordPolicyErrorCode(newPassword);
    if (policyErrorCode) {
      setPasswordError({
        message: authT(
          policyErrorCode === "PASSWORD_TOO_SHORT"
            ? "passwordTooShort"
            : "passwordRequiresLettersAndNumbers",
        ),
        target: "newPassword",
      });
      document.getElementById("new-password")?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError({
        message: t("passwordsDoNotMatch"),
        target: "confirmPassword",
      });
      document.getElementById("confirm-password")?.focus();
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
        console.error("Failed to update password:", data.error);
        throw new Error(t("passwordUpdateFailed"));
      }

      setPasswordSuccess(t("passwordUpdated"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      if (data.reauthRequired) {
        setIsRedirecting(true);
        setUser(null);
        setTimeout(() => {
          router.push("/auth/login");
        }, 3000);
      }
    } catch (err: unknown) {
      setPasswordError({
        message:
          err instanceof Error ? err.message : t("passwordUpdateFailed"),
        target: "form",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <form onSubmit={handlePasswordChange} className="p-4 sm:p-6 space-y-5" aria-busy={isUpdating || isRedirecting}>
      {passwordError && (
        <div id="profile-password-error" className="mb-4">
          <Alert type="error" message={passwordError.message} />
        </div>
      )}
      {passwordSuccess && <Alert type="success" message={passwordSuccess} className="mb-4" />}

      <div className="border border-border-strong bg-surface-raised p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-heading">
          <Icon name="warning" size={16} />
          {t("securityWarning")}
        </div>
        <p id="password-warning-msg" className="text-xs leading-relaxed text-text-muted">
          {t("securityWarningText")}
        </p>
      </div>

      <div>
        <label htmlFor="current-password" className="app-label">
          {t("currentPassword")}
        </label>
        <PasswordInput
          id="current-password"
          name="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          disabled={isUpdating || isRedirecting}
          required
          aria-describedby="password-warning-msg"
        />
      </div>

      <div>
        <label htmlFor="new-password" className="app-label">
          {t("newPassword")}
        </label>
        <PasswordInput
          id="new-password"
          name="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          disabled={isUpdating || isRedirecting}
          required
          placeholder={t("newPassword")}
          aria-describedby={`new-password-policy${
            passwordError?.target === "newPassword"
              ? " profile-password-error"
              : ""
          }`}
          aria-invalid={passwordError?.target === "newPassword" || undefined}
        />
        <p id="new-password-policy" className="app-helper">
          {authT("passwordPolicyHint")}
        </p>
      </div>

      <div>
        <label htmlFor="confirm-password" className="app-label">
          {t("confirmNewPassword")}
        </label>
        <PasswordInput
          id="confirm-password"
          name="confirm-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          disabled={isUpdating || isRedirecting}
          required
          placeholder={t("confirmNewPassword")}
          aria-describedby={`confirm-password-helper${
            passwordError?.target === "confirmPassword"
              ? " profile-password-error"
              : ""
          }`}
          aria-invalid={
            passwordError?.target === "confirmPassword" || undefined
          }
        />
        <p id="confirm-password-helper" className="app-helper">
          {t("confirmPasswordHelp")}
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
        {isRedirecting ? t("redirectingToLogin") : t("changePassword")}
      </Button>
    </form>
  );
}
