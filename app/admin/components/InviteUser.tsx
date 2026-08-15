"use client";

import { useState, useEffect, useRef } from "react";
import { createUserViaEdge } from "../../../lib/api/users";
import Alert from "../../../components/Alert";
import Icon from "../../../components/Icon";
import RoleLabel from "../../../components/RoleLabel";
import { useLocale, useTranslations } from "next-intl";
import { useVenueSelector } from "../../../components/VenueSelector";
import Button from "../../../components/Button";
import { captureImmutableDraft } from "../../../lib/forms/immutable-draft";
import { shareUrl, toUrlShareData } from "../../../lib/share/url";

interface CreatedInvitation {
  expiresAt: string;
  url: string;
}

export default function InviteUser() {
  const t = useTranslations("UserAdmin");
  const locale = useLocale();
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    role: "dj" as "venue_admin" | "door_staff" | "staff" | "dj",
    account_kind: "personal" as "personal" | "shared",
    door_access_enabled: false,
    guest_limit: "",
    venue_id: "",
    preferred_locale: "auto" as "auto" | "en" | "ko",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createdInvitation, setCreatedInvitation] =
    useState<CreatedInvitation | null>(null);
  const [invitationActionMessage, setInvitationActionMessage] = useState("");
  const [isInvitationActionPending, setIsInvitationActionPending] = useState(false);
  const invitationPanelRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!createdInvitation) return;
    const frameId = window.requestAnimationFrame(() => {
      invitationPanelRef.current?.focus({ preventScroll: true });
      invitationPanelRef.current?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [createdInvitation]);

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
    setIsLoading(true);
    setError("");
    setSuccess("");
    setCreatedInvitation(null);
    setInvitationActionMessage("");

    if (!draft.venue_id) {
      setError(t("venueRequired"));
      setIsLoading(false);
      return;
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
      const { data, error: createError } = await createUserViaEdge({
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
        preferredLocale:
          draft.preferred_locale === "auto"
            ? null
            : draft.preferred_locale,
      });

      if (createError || !data) {
        console.error("Failed to create user:", createError);
        setError(t("createFailed"));
      } else {
        const msg = t("created", { name: draft.name, email: draft.email });
        setSuccess(msg);
        setCreatedInvitation({
          expiresAt: data.expiresAt,
          url: data.invitationUrl,
        });
        setFormData((prev) => ({
          ...prev,
          email: "",
          name: "",
          role: "dj",
          account_kind: "personal",
          door_access_enabled: false,
          guest_limit: "",
        }));
      }
    } catch (err: unknown) {
      console.error("Failed to create user:", err);
      setError(t("createFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleInvitationShare = async () => {
    if (!createdInvitation || isInvitationActionPending) return;
    setIsInvitationActionPending(true);
    setInvitationActionMessage("");

    const result = await shareUrl(toUrlShareData(createdInvitation.url), {
      share:
        typeof navigator.share === "function"
          ? (data) => navigator.share(data)
          : undefined,
      canShare:
        typeof navigator.canShare === "function"
          ? (data) => navigator.canShare(data)
          : undefined,
      copy: async (url) => {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard API is unavailable");
        }
        await navigator.clipboard.writeText(url);
      },
    });

    if (result === "shared") {
      setInvitationActionMessage(t("invitationLinkShared"));
    } else if (result === "copied") {
      setInvitationActionMessage(t("invitationLinkCopied"));
    } else if (result === "failed") {
      setInvitationActionMessage(t("invitationLinkCopyFailed"));
    }
    setIsInvitationActionPending(false);
  };

  return (
    <div className="space-y-6">
      <div className="app-panel p-4 sm:p-5">
        <h3 className="type-section-title mb-4">
          {t("createUser")}
        </h3>

        <p className="mb-4 border border-border-strong bg-surface-raised p-3 font-mono text-xs leading-relaxed tracking-[0.12em] text-text-muted" role="note">
          {t("invitationLinkHelp")}
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

          {error && <Alert type="error" message={error} />}

          {success && createdInvitation && (
            <div
              ref={invitationPanelRef}
              className="space-y-3 border border-status-waiting/70 bg-status-waiting/10 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              role="region"
              aria-labelledby="created-invitation-title"
              tabIndex={-1}
            >
              <p id="created-invitation-title" className="text-text-heading text-xs font-medium">
                {t("accountCreated")}
              </p>
              <p className="break-words text-text-heading font-mono text-xs tracking-wider">
                {success}
              </p>
              <p className="text-xs leading-relaxed text-text-muted">
                {t("invitationLinkCreatedHelp")}
              </p>
              <a
                href={createdInvitation.url}
                target="_blank"
                rel="noreferrer"
                className="block select-all break-all border border-border-strong bg-canvas px-3 py-2 font-mono text-xs text-text-heading underline decoration-border-strong underline-offset-4 hover:text-text-heading"
              >
                {createdInvitation.url}
              </a>
              <p className="text-xs text-text-muted">
                {t("invitationExpiresAt", {
                  expiresAt: new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(createdInvitation.expiresAt)),
                })}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  fullWidth
                  isLoading={isInvitationActionPending}
                  onClick={() => void handleInvitationShare()}
                >
                  {t("shareInvitationLink")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  fullWidth
                  variant="secondary"
                  disabled={isInvitationActionPending}
                  onClick={() => {
                    setCreatedInvitation(null);
                    setSuccess("");
                    setInvitationActionMessage("");
                  }}
                >
                  {t("closeInvitationLink")}
                </Button>
              </div>
              {invitationActionMessage && (
                <p className="text-xs text-text-muted" role="status">
                  {invitationActionMessage}
                </p>
              )}
            </div>
          )}

          <Button
            type="submit"
            isLoading={isLoading}
            fullWidth
            size="lg"
          >
            {isLoading ? t("creating") : t("createAccountAndLink")}
          </Button>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
