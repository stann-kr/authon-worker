import {
  isAccountKind,
  isRole,
  type AccountKind,
  type Role,
} from "../users/policy.ts";

export interface User {
  id: string;
  venue_id?: string | null;
  email: string;
  name: string;
  role: Role;
  account_kind: AccountKind;
  door_access_enabled: boolean;
  guest_limit: number | null;
  preferred_locale?: "en" | "ko" | null;
}

export interface SessionUserProfile {
  id: string;
  venueId: string | null;
  email: string;
  name: string;
  role: Role;
  accountKind: AccountKind;
  doorAccessEnabled: boolean;
  guestLimit: number | null;
  preferredLocale: "en" | "ko" | null;
}

function nullableGuestLimit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function toClientUser(profile: SessionUserProfile): User {
  return {
    id: profile.id,
    venue_id: profile.venueId,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    account_kind: profile.accountKind,
    door_access_enabled: profile.doorAccessEnabled,
    guest_limit: nullableGuestLimit(profile.guestLimit),
    preferred_locale: profile.preferredLocale,
  };
}

export function normalizeCachedUser(value: unknown): User | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<User>;
  if (
    typeof parsed.id !== "string" ||
    typeof parsed.email !== "string" ||
    typeof parsed.name !== "string" ||
    !isRole(parsed.role)
  ) {
    return null;
  }

  return {
    id: parsed.id,
    venue_id:
      typeof parsed.venue_id === "string" || parsed.venue_id === null
        ? parsed.venue_id
        : null,
    email: parsed.email,
    name: parsed.name,
    role: parsed.role,
    account_kind: isAccountKind(parsed.account_kind)
      ? parsed.account_kind
      : "personal",
    door_access_enabled: parsed.door_access_enabled === true,
    guest_limit: nullableGuestLimit(parsed.guest_limit),
    preferred_locale:
      parsed.preferred_locale === "en" || parsed.preferred_locale === "ko"
        ? parsed.preferred_locale
        : null,
  };
}
