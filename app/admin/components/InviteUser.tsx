"use client";

import { useState, useEffect } from "react";
import { getUser, type User } from "../../../lib/auth";
import { createUserViaEdge } from "../../../lib/api/users";
import { fetchVenues } from "../../../lib/api/venues";
import type { Venue } from "../../../lib/api/types";
import PasswordInput from "../../../components/PasswordInput";
import Alert from "../../../components/Alert";
import Icon from "../../../components/Icon";
import { getPasswordPolicyError, PASSWORD_POLICY_HINT } from "../../../lib/auth/password-policy";

export default function InviteUser() {
  const [createMode, setCreateMode] = useState<"invite" | "password">("password");
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    role: "dj" as "venue_admin" | "door_staff" | "staff" | "dj",
    guest_limit: "",
    venue_id: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    const user = getUser();
    setCurrentUser(user);

    // Set default venue_id from current user
    if (user?.venue_id) {
      setFormData((prev) => ({ ...prev, venue_id: user.venue_id as string }));
    }

    // Super admin can choose venue
    if (user?.role === "super_admin") {
      fetchVenues().then(({ data }) => {
        if (data) setVenues(data);
      });
    }
  }, []);

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
    setIsLoading(true);
    setError("");
    setSuccess("");

    if (!formData.venue_id) {
      setError("Please select a venue.");
      setIsLoading(false);
      return;
    }

    if (createMode === "password") {
      const passwordPolicyError = getPasswordPolicyError(formData.password);
      if (passwordPolicyError) {
        setError(passwordPolicyError);
        setIsLoading(false);
        return;
      }
    }

    // guest_limit 유효성 검사
    if (formData.role !== "venue_admin") {
      const limitVal = parseInt(String(formData.guest_limit));
      if (isNaN(limitVal) || limitVal < 1) {
        setError("Guest limit must be a number of 1 or more.");
        setIsLoading(false);
        return;
      }
    }

    try {
      const { error: createError } = await createUserViaEdge({
        email: formData.email,
        name: formData.name,
        role: formData.role,
        venueId: formData.venue_id,
        guestLimit:
          formData.role === "venue_admin"
            ? 999
            : parseInt(String(formData.guest_limit)),
        ...(createMode === "password" && formData.password
          ? { password: formData.password }
          : {}),
      });

      if (createError) {
        setError(createError || "Failed to create user.");
      } else {
        if (createMode === "password" && formData.password) {
          setTempPassword(formData.password);
          setShowTempPassword(false);
        }
        const msg =
          createMode === "password"
            ? `Account created for ${formData.name} (${formData.email}).`
            : `Invitation email sent to ${formData.name} (${formData.email}).`;
        setSuccess(msg);
        setFormData((prev) => ({
          ...prev,
          email: "",
          name: "",
          role: "dj",
          guest_limit: "",
          password: "",
        }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred while creating the user.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="app-panel p-4 sm:p-5">
        <h2 className="type-section-title mb-4">
          CREATE USER
        </h2>

        <div className="grid grid-cols-2 gap-px bg-surface-active mb-4">
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Available after the email service is connected"
            className={`p-3 text-xs font-medium transition-colors ${
              createMode === "invite"
                ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                : "bg-canvas text-text-dim cursor-not-allowed"
            }`}
          >
            <Icon name="email" size={16} /> EMAIL LATER
          </button>
          <button
            type="button"
            onClick={() => setCreateMode("password")}
            aria-pressed={createMode === "password"}
            className={`p-3 text-xs font-medium transition-colors ${
              createMode === "password"
                ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                : "bg-canvas text-text-muted hover:text-text-heading"
            }`}
          >
            <Icon name="key" size={16} /> TEMP PASSWORD
          </button>
        </div>

        <p className="mb-4 border border-border-strong bg-surface-raised p-3 font-mono text-xs leading-relaxed tracking-[0.12em] text-text-muted" role="note">
          EMAIL INVITES ARE TEMPORARILY UNAVAILABLE. CREATE THE ACCOUNT WITH A TEMPORARY PASSWORD AND SHARE IT SECURELY.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={isLoading}>
          {isSuperAdmin && venues.length > 0 && (
            <div>
              <label htmlFor="invite-venue" className="app-label">
                VENUE
              </label>
              <div className="relative">
                <select
                  id="invite-venue"
                  value={formData.venue_id}
                  onChange={(e) =>
                    setFormData({ ...formData, venue_id: e.target.value })
                  }
                  className="w-full appearance-none bg-canvas border border-border-default px-4 py-3 pr-10 text-text-heading text-sm focus:outline-none focus:border-border-focus"
                  required
                >
                  <option value="">SELECT VENUE</option>
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
              EMAIL ADDRESS
            </label>
            <input
              id="invite-email"
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="w-full bg-canvas border border-border-default px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus"
              placeholder="user@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="invite-name" className="app-label">
              NAME
            </label>
            <input
              id="invite-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full bg-canvas border border-border-default px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus"
              placeholder="Enter full name"
              required
            />
          </div>

          <fieldset>
            <legend className="app-label">
              ROLE
            </legend>
            <div className="grid grid-cols-4 gap-2">
              {roleOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={formData.role === opt.value}
                  onClick={() =>
                    setFormData({ ...formData, role: opt.value as typeof formData.role })
                  }
                  className={`p-3 border text-xs font-medium transition-colors ${
                    formData.role === opt.value
                      ? "border-action-primary bg-action-primary text-action-text"
                      : "bg-canvas text-text-muted border-border-default hover:text-text-heading hover:border-border-strong"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          {formData.role !== "venue_admin" && (
            <div>
              <label htmlFor="invite-guest-limit" className="app-label">
                GUEST LIMIT
              </label>
              <input
                id="invite-guest-limit"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={formData.guest_limit}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, "");
                  setFormData({ ...formData, guest_limit: val });
                }}
                className="w-full bg-canvas border border-border-default px-4 py-3 text-text-heading text-sm focus:outline-none focus:border-border-focus"
                placeholder="Enter guest limit"
              />
            </div>
          )}

          {createMode === "password" && (
            <div>
              <label htmlFor="invite-password" className="app-label">
                TEMPORARY PASSWORD
              </label>
              <PasswordInput
                id="invite-password"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                inputClassName="w-full bg-canvas border border-border-default px-4 py-3 pr-12 text-text-heading text-sm focus:outline-none focus:border-border-focus"
                placeholder="Create a temporary password"
                autoComplete="new-password"
                aria-describedby="invite-password-help"
                required
              />
              <p id="invite-password-help" className="text-text-dim font-mono text-xs mt-1 tracking-wider">
                {PASSWORD_POLICY_HINT} Share it securely and ask the user to change it after first login.
              </p>
            </div>
          )}

          {error && <Alert type="error" message={error} />}

          {success && (
            <div className="bg-surface-raised border border-border-strong p-4 space-y-2" role="status" aria-live="polite">
              <p className="text-text-heading text-xs font-medium">
                {tempPassword ? "ACCOUNT CREATED" : "INVITATION SENT"}
              </p>
              <p className="text-text-heading font-mono text-xs tracking-wider">
                {success}
              </p>
              {tempPassword && (
                <div className="mt-2 border border-border-strong p-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-text-heading tracking-wider">
                    TEMP PASSWORD:{" "}
                    <span className="select-all">
                      {showTempPassword ? tempPassword : "•".repeat(tempPassword.length)}
                    </span>
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowTempPassword((v) => !v)}
                      className="text-text-heading hover:text-xs text-text-heading"
                    >
                      {showTempPassword ? "HIDE" : "SHOW"}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(tempPassword)}
                      className="text-text-heading hover:text-xs text-text-heading"
                    >
                      COPY
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-action-primary py-3 text-sm font-semibold text-action-text transition-colors hover:bg-action-hover disabled:opacity-50"
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border border-canvas border-t-transparent rounded-full animate-spin"></div>
                <span>
                  {createMode === "password" ? "CREATING..." : "SENDING..."}
                </span>
              </div>
            ) : createMode === "password" ? (
              "CREATE ACCOUNT"
            ) : (
              "SEND INVITATION"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
