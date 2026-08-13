"use client";

import { useState, useEffect } from "react";
import { createUserViaEdge } from "../../../lib/api/users";
import PasswordInput from "../../../components/PasswordInput";
import Alert from "../../../components/Alert";
import Icon from "../../../components/Icon";
import { getPasswordPolicyErrorCode } from "../../../lib/auth/password-policy";
import RoleLabel from "../../../components/RoleLabel";
import { useTranslations } from "next-intl";
import { useVenueSelector } from "../../../components/VenueSelector";
import Button from "../../../components/Button";
import { captureImmutableDraft } from "../../../lib/forms/immutable-draft";

export default function InviteUser() {
  const t = useTranslations("UserAdmin");
  const authT = useTranslations("Auth");
  const [createMode, setCreateMode] = useState<"invite" | "password">("password");
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    role: "dj" as "venue_admin" | "door_staff" | "staff" | "dj",
    account_kind: "personal" as "personal" | "shared",
    door_access_enabled: false,
    guest_limit: "",
    venue_id: "",
    password: "",
    preferred_locale: "auto" as "auto" | "en" | "ko",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [showTempPassword, setShowTempPassword] = useState(false);
  const { venues, user: currentUser } = useVenueSelector();

  useEffect(() => {
    // Set default venue_id from current user
    if (currentUser?.venue_id) {
      setFormData((prev) => ({
        ...prev,
        venue_id: currentUser.venue_id as string,
      }));
    }
  }, [currentUser?.venue_id]);

  const isSuperAdmin = currentUser?.role === "super_admin";

  // Role options depend on caller role
  const roleOptions = isSuperAdmin
    ? [
        { value: "venue_admin", label: "VENUE ADMIN" },
        { value: "door_staff", label: "DOOR STAFF" },
        { value: "staff", label: "STAFF" },
        { value: "dj", label: "DJ" },
      ]
    : [
        { value: "door_staff", label: "DOOR STAFF" },
        { value: "staff", label: "STAFF" },
        { value: "dj", label: "DJ" },
      ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    const draft = captureImmutableDraft(formData);
    const mode = createMode;
    setIsLoading(true);
    setError("");
    setSuccess("");

    if (!draft.venue_id) {
      setError(t("venueRequired"));
      setIsLoading(false);
      return;
    }

    if (mode === "password") {
      const passwordPolicyErrorCode = getPasswordPolicyErrorCode(draft.password);
      if (passwordPolicyErrorCode) {
        setError(
          authT(
            passwordPolicyErrorCode === "PASSWORD_TOO_SHORT"
              ? "passwordTooShort"
              : "passwordRequiresLettersAndNumbers",
          ),
        );
        setIsLoading(false);
        return;
      }
    }

    // guest_limit 유효성 검사
    if (draft.role !== "venue_admin") {
      const limitVal = parseInt(String(draft.guest_limit));
      if (isNaN(limitVal) || limitVal < 0) {
        setError(t("guestLimitInvalid"));
        setIsLoading(false);
        return;
      }
    }

    try {
      const { error: createError } = await createUserViaEdge({
        email: draft.email,
        name: draft.name,
        role: draft.role,
        accountKind: draft.account_kind,
        doorAccessEnabled:
          draft.account_kind === "shared" && draft.door_access_enabled,
        venueId: draft.venue_id,
        guestLimit:
          draft.role === "venue_admin"
            ? null
            : parseInt(String(draft.guest_limit)),
        ...(mode === "password" && draft.password
          ? { password: draft.password }
          : {}),
        preferredLocale:
          draft.preferred_locale === "auto"
            ? null
            : draft.preferred_locale,
      });

      if (createError) {
        console.error("Failed to create user:", createError);
        setError(t("createFailed"));
      } else {
        if (mode === "password" && draft.password) {
          setTempPassword(draft.password);
          setShowTempPassword(false);
        }
        const msg =
          mode === "password"
            ? t("created", { name: draft.name, email: draft.email })
            : t("invited", { name: draft.name, email: draft.email });
        setSuccess(msg);
        setFormData((prev) => ({
          ...prev,
          email: "",
          name: "",
          role: "dj",
          account_kind: "personal",
          door_access_enabled: false,
          guest_limit: "",
          password: "",
        }));
      }
    } catch (err: unknown) {
      console.error("Failed to create user:", err);
      setError(t("createFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="app-panel p-4 sm:p-5">
        <h3 className="type-section-title mb-4">
          {t("createUser")}
        </h3>

        <div className="grid grid-cols-2 gap-px bg-surface-active mb-4">
          <button
            type="button"
            disabled
            aria-disabled="true"
            title={t("inviteUnavailableTitle")}
            className={`flex min-h-12 items-center justify-center gap-2 p-3 text-xs font-medium transition-colors ${
              createMode === "invite"
                ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                : "bg-canvas text-text-dim cursor-not-allowed"
            }`}
          >
            <Icon name="email" size={16} />
            <span>{t("emailLater")}</span>
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => setCreateMode("password")}
            aria-pressed={createMode === "password"}
            className={`flex min-h-12 items-center justify-center gap-2 p-3 text-xs font-medium transition-colors ${
              createMode === "password"
                ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                : "bg-canvas text-text-muted hover:text-text-heading"
            }`}
          >
            <Icon name="key" size={16} />
            <span>{t("temporaryPassword")}</span>
          </button>
        </div>

        <p className="mb-4 border border-border-strong bg-surface-raised p-3 font-mono text-xs leading-relaxed tracking-[0.12em] text-text-muted" role="note">
          {t("inviteUnavailableHelp")}
        </p>

        <form onSubmit={handleSubmit} aria-busy={isLoading}>
          <fieldset disabled={isLoading} className="space-y-4">
          {isSuperAdmin && venues.length > 0 && (
            <div>
              <label htmlFor="invite-venue" className="app-label">
                {t("venue")}
              </label>
              <div className="relative">
                <select
                  id="invite-venue"
                  name="venue-id"
                  value={formData.venue_id}
                  autoComplete="off"
                  onChange={(e) =>
                    setFormData({ ...formData, venue_id: e.target.value })
                  }
                  className="app-field appearance-none pr-10"
                  required
                >
                  <option value="">{t("selectVenue")}</option>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name} ({venue.type})
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="invite-email" className="app-label">
              {t("emailAddress")}
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="app-field"
              placeholder="user@example.com"
              autoComplete="email"
              spellCheck={false}
              required
            />
          </div>

          <div>
            <label htmlFor="invite-name" className="app-label">
              {t("name")}
            </label>
            <input
              id="invite-name"
              name="name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="app-field"
              placeholder={t("namePlaceholder")}
              autoComplete="name"
              required
            />
          </div>

          <fieldset>
            <legend className="app-label">{t("accountType")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["personal", "shared"] as const).map((accountKind) => (
                <button
                  key={accountKind}
                  type="button"
                  aria-pressed={formData.account_kind === accountKind}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      account_kind: accountKind,
                      role: accountKind === "shared" ? "staff" : formData.role,
                      door_access_enabled:
                        accountKind === "shared" ? formData.door_access_enabled : false,
                    })
                  }
                  className={`min-h-11 border p-3 text-xs font-medium transition-colors ${
                    formData.account_kind === accountKind
                      ? "border-action-primary bg-action-primary text-action-text"
                      : "border-border-default bg-canvas text-text-muted hover:border-border-strong hover:text-text-heading"
                  }`}
                >
                  {accountKind === "shared" ? t("sharedAccount") : t("personalAccount")}
                </button>
              ))}
            </div>
            <p className="app-helper">
              {formData.account_kind === "shared"
                ? t("sharedAccountHelp")
                : t("personalAccountHelp")}
            </p>
          </fieldset>

          {formData.account_kind === "personal" ? (
          <fieldset>
            <legend className="app-label">
              {t("role")}
            </legend>
            <div
              className={`grid grid-cols-2 gap-2 ${
                isSuperAdmin ? "sm:grid-cols-4" : "sm:grid-cols-3"
              }`}
            >
              {roleOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={formData.role === opt.value}
                  onClick={() =>
                    setFormData({ ...formData, role: opt.value as typeof formData.role })
                  }
                  className={`min-h-11 border p-3 text-xs font-medium transition-colors ${
                    formData.role === opt.value
                      ? "border-action-primary bg-action-primary text-action-text"
                      : "bg-canvas text-text-muted border-border-default hover:text-text-heading hover:border-border-strong"
                  }`}
                >
                  <RoleLabel role={opt.value} />
                </button>
              ))}
            </div>
          </fieldset>
          ) : (
            <div className="border border-border-default bg-surface-raised p-3 text-sm text-text-body">
              <RoleLabel role="shared" />
            </div>
          )}

          {formData.account_kind === "shared" && (
            <label className="flex items-start gap-3 border border-border-default bg-canvas p-3">
              <input
                name="door-access-enabled"
                type="checkbox"
                checked={formData.door_access_enabled}
                onChange={(event) =>
                  setFormData({ ...formData, door_access_enabled: event.target.checked })
                }
                className="mt-0.5 h-4 w-4"
                autoComplete="off"
              />
              <span>
                <span className="block text-sm font-medium text-text-heading">
                  {t("doorAccess")}
                </span>
                <span className="mt-1 block text-xs text-text-muted">
                  {t("doorAccessHelp")}
                </span>
              </span>
            </label>
          )}

          {formData.role !== "venue_admin" && (
            <div>
              <label htmlFor="invite-guest-limit" className="app-label">
                {t("guestLimit")}
              </label>
              <input
                id="invite-guest-limit"
                name="guest-limit"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={formData.guest_limit}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, "");
                  setFormData({ ...formData, guest_limit: val });
                }}
                className="app-field"
                placeholder={t("guestLimitPlaceholder")}
                autoComplete="off"
              />
            </div>
          )}

          <div>
            <label htmlFor="invite-preferred-locale" className="app-label">
              {t("preferredLanguage")}
            </label>
            <select
              id="invite-preferred-locale"
              name="preferred-locale"
              value={formData.preferred_locale}
              autoComplete="off"
              onChange={(event) =>
                setFormData({
                  ...formData,
                  preferred_locale: event.target.value as "auto" | "en" | "ko",
                })
              }
              className="app-field"
            >
              <option value="auto">{t("automaticLanguage")}</option>
              <option value="en">English</option>
              <option value="ko">한국어</option>
            </select>
            <p className="app-helper">{t("preferredLanguageHelp")}</p>
          </div>

          {createMode === "password" && (
            <div>
              <label htmlFor="invite-password" className="app-label">
                {t("temporaryPassword")}
              </label>
              <PasswordInput
                id="invite-password"
                name="temporary-password"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                inputClassName="app-field pr-12"
                placeholder={t("passwordPlaceholder")}
                autoComplete="new-password"
                aria-describedby="invite-password-help"
                required
              />
              <p id="invite-password-help" className="app-helper">
                {authT("passwordPolicyHint")} {t("passwordShareHelp")}
              </p>
            </div>
          )}

          {error && <Alert type="error" message={error} />}

          {success && (
            <div className="bg-surface-raised border border-border-strong p-4 space-y-2" role="status" aria-live="polite">
              <p className="text-text-heading text-xs font-medium">
                {tempPassword ? t("accountCreated") : t("invitationSent")}
              </p>
              <p className="break-words text-text-heading font-mono text-xs tracking-wider">
                {success}
              </p>
              {tempPassword && (
                <div className="mt-2 flex flex-col gap-2 border border-border-strong p-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 break-all font-mono text-xs text-text-heading tracking-wider">
                    {t("tempPassword")}:{" "}
                    <span className="select-all">
                      {showTempPassword ? tempPassword : "•".repeat(tempPassword.length)}
                    </span>
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowTempPassword((v) => !v)}
                      className="min-h-11 px-2 text-xs font-medium text-text-heading"
                    >
                      {showTempPassword ? t("hide") : t("show")}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(tempPassword)}
                      className="min-h-11 px-2 text-xs font-medium text-text-heading"
                    >
                      {t("copy")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <Button
            type="submit"
            isLoading={isLoading}
            fullWidth
            size="lg"
          >
            {isLoading
              ? createMode === "password"
                ? t("creating")
                : t("sending")
              : createMode === "password"
                ? t("createAccount")
                : t("sendInvitation")}
          </Button>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
