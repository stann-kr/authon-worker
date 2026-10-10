"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";
import Alert from "@/components/Alert";
import RoleLabel from "@/components/RoleLabel";
import PasswordInput from "@/components/PasswordInput";
import Icon from "@/components/Icon";
import Button from "@/components/Button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import WorkspaceShell from "@/components/WorkspaceShell";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { useTranslations } from "next-intl";
import { updateUserProfile } from "@/lib/api/users";
import { hasAccess } from "@/lib/auth";
import { getPasswordPolicyErrorCode } from "@/lib/auth/password-policy";
import {
  selectProfilePasswordError,
  type ProfilePasswordErrorTarget,
} from "@/lib/auth/profile-password-feedback";

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
  // 비밀번호 변경으로 세션이 끝난 경우 로그인 화면에서 결과를 안내합니다.
  const [signedOutAfterPasswordChange, setSignedOutAfterPasswordChange] =
    useState(false);

  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.replace(
        signedOutAfterPasswordChange
          ? "/auth/login?reason=password-changed"
          : "/auth/login",
      );
      return;
    }
    setFormData({ name: user.name });
  }, [router, signedOutAfterPasswordChange, user]);

  const handleReauthRequired = () => {
    setSignedOutAfterPasswordChange(true);
    setUser(null);
  };

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

  const isAdmin = hasAccess(user, ["admin"]);
  const hasProfileChanges = formData.name !== user.name;

  return (
    <WorkspaceShell width="narrow" contentClassName="gap-6">
      <h1 id="profile-page-title" className="sr-only">{t("title")}</h1>

      <section
        aria-labelledby="profile-page-title"
        className="profile-workspace"
      >
        <section className="profile-summary" aria-label={t("accountInfo")}>
          <div className="profile-identity"><span aria-hidden="true">{user.name.charAt(0)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div>
          <dl className="profile-facts">
            <div><dt>{t("role")}</dt><dd><RoleLabel role={user.account_kind === "shared" ? "shared" : user.role} /></dd></div>
            {/* Admin accounts do not register against a personal guest quota. */}
            {!isAdmin && <div><dt>{t("guestLimit")}</dt><dd>{user.guest_limit === null ? t("unlimited") : t("guestLimitCount", { count: user.guest_limit })}</dd></div>}
          </dl>
        </section>

        <div className="space-y-6">
          {showSuccess && (
            <Alert
              type="success"
              message={t("profileUpdated")}
              className="mb-6"
            />
          )}

          {error && <div id="profile-error"><Alert type="error" message={error} className="mb-6" /></div>}

          <div className="app-panel overflow-hidden">
            <div className="space-y-4 border-b border-border-subtle p-4">
              <div>
                <h2 className="text-sm font-semibold text-text-heading">
                  {t("accountSettings")}
                </h2>
              </div>

              <div className="profile-tabs">
                <button
                  type="button"
                  onClick={() => setActiveSection("profile")}
                  aria-pressed={activeSection === "profile"}
                  className={`min-h-11 rounded-control border px-4 py-3 text-sm font-medium ${
                    activeSection === "profile"
                      ? "border-border-strong bg-surface-active text-text-heading"
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
                      ? "border-border-strong bg-surface-active text-text-heading"
                      : "bg-canvas text-text-muted border-border-default hover:text-text-heading hover:border-border-strong"
                  }`}
                >
                  {t("security")}
                </button>
              </div>
            </div>

            <div hidden={activeSection !== "profile"}>
                <div className="border-b border-border-subtle p-4">
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
                      aria-describedby={error ? "profile-error" : undefined}
                      aria-invalid={error ? "true" : "false"}
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={!hasProfileChanges}
                    isLoading={isSaving}
                    fullWidth
                    size="lg"
                    leftIcon={<Icon name="save" size={17} />}
                  >
                    {commonT("saveChanges")}
                  </Button>
                </form>

                {/* 언어는 저장 버튼과 무관하게 선택 즉시 적용되므로 폼 밖에 둡니다. */}
                <div
                  role="group"
                  aria-labelledby="profile-language-label"
                  aria-describedby="profile-language-help"
                  className="border-t border-border-subtle p-4 sm:p-6"
                >
                  <p id="profile-language-label" className="app-label">
                    {t("preferredLanguage")}
                  </p>
                  <LanguageSwitcher />
                  <p id="profile-language-help" className="app-helper">
                    {t("preferredLanguageHelp")}
                  </p>
                </div>
              </div>
              <div hidden={activeSection !== "security"}>
                <div className="border-b border-border-subtle p-4">
                  <h3 className="text-xs font-semibold text-text-heading sm:text-sm">
                    {t("changePassword")}
                  </h3>
                </div>
                <PasswordChangeForm onReauthRequired={handleReauthRequired} />
              </div>
          </div>
        </div>
      </section>
    </WorkspaceShell>
  );
}

const PASSWORD_FIELD_IDS: Record<
  Exclude<ProfilePasswordErrorTarget, "form">,
  string
> = {
  currentPassword: "current-password",
  newPassword: "new-password",
  confirmPassword: "confirm-password",
};

function PasswordChangeForm({
  onReauthRequired,
}: {
  onReauthRequired: () => void;
}) {
  const t = useTranslations("Profile");
  const authT = useTranslations("Auth");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [passwordError, setPasswordError] = useState<{
    message: string;
    target: ProfilePasswordErrorTarget;
  } | null>(null);
  const pendingFocusRef = useRef<ProfilePasswordErrorTarget | null>(null);

  // 입력란은 요청 중 disabled이므로, 활성화된 뒤에 오류 입력란으로 focus를 옮깁니다.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (isUpdating || !target) return;
    pendingFocusRef.current = null;
    if (target === "form") return;
    document.getElementById(PASSWORD_FIELD_IDS[target])?.focus();
  }, [isUpdating, passwordError]);

  const showPasswordError = (message: string, target: ProfilePasswordErrorTarget) => {
    pendingFocusRef.current = target;
    setPasswordError({ message, target });
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    const policyErrorCode = getPasswordPolicyErrorCode(newPassword);
    if (policyErrorCode) {
      showPasswordError(
        authT(
          policyErrorCode === "PASSWORD_TOO_SHORT"
            ? "passwordTooShort"
            : "passwordRequiresLettersAndNumbers",
        ),
        "newPassword",
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      showPasswordError(t("passwordsDoNotMatch"), "confirmPassword");
      return;
    }

    setIsUpdating(true);
    let reauthRequired = false;
    try {
      const res = await fetch("/api/profile/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = (await res.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      if (!res.ok) {
        console.error("Failed to update password:", data?.code ?? res.status);
        const { key, target } = selectProfilePasswordError(data?.code);
        if (target === "currentPassword") setCurrentPassword("");
        showPasswordError(t(key), target);
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // 성공 응답은 항상 현재 세션을 만료시키므로 다시 로그인해야 합니다.
      reauthRequired = true;
    } catch {
      showPasswordError(t("passwordUpdateFailed"), "form");
    } finally {
      setIsUpdating(false);
    }

    // 서버가 세션을 이미 만료시켰으므로 클라이언트 세션도 비우고,
    // 로그인 화면에서 변경 완료를 안내합니다.
    if (reauthRequired) onReauthRequired();
  };

  return (
    <form onSubmit={handlePasswordChange} className="p-4 sm:p-6 space-y-5" aria-busy={isUpdating}>
      {passwordError && (
        <div id="profile-password-error" className="mb-4">
          <Alert type="error" message={passwordError.message} />
        </div>
      )}

      <p id="password-warning-msg" className="text-sm leading-relaxed text-text-muted">
        {t("securityWarningText")}
      </p>

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
          disabled={isUpdating}
          required
          aria-describedby={`password-warning-msg${
            passwordError?.target === "currentPassword"
              ? " profile-password-error"
              : ""
          }`}
          aria-invalid={passwordError?.target === "currentPassword" || undefined}
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
          disabled={isUpdating}
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
          disabled={isUpdating}
          required
          placeholder={t("confirmNewPassword")}
          aria-describedby={
            passwordError?.target === "confirmPassword"
              ? "profile-password-error"
              : undefined
          }
          aria-invalid={
            passwordError?.target === "confirmPassword" || undefined
          }
        />
      </div>

      <Button
        type="submit"
        isLoading={isUpdating}
        fullWidth
        size="lg"
        leftIcon={<Icon name="key" size={17} />}
      >
        {t("changePassword")}
      </Button>
    </form>
  );
}
