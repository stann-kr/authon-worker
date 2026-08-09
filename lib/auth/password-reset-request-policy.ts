export type PasswordResetRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed"
  | "cancelled";

export type PasswordResetSetupMethod = "setup_code" | "admin_approved";

export type PasswordResetRequestSource = "self_service" | "admin";

export type PasswordResetTargetErrorCode =
  | "CANNOT_MANAGE_SELF"
  | "FORBIDDEN"
  | "USER_DELETED"
  | "USER_INACTIVE";

export const ADMIN_APPROVED_RESET_TTL_MS = 24 * 60 * 60 * 1000;

const REQUEST_STATUSES: readonly PasswordResetRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "completed",
  "cancelled",
];

export function isPasswordResetRequestStatus(
  value: unknown,
): value is PasswordResetRequestStatus {
  return typeof value === "string" &&
    REQUEST_STATUSES.includes(value as PasswordResetRequestStatus);
}

export function isPasswordResetSetupMethod(
  value: unknown,
): value is PasswordResetSetupMethod {
  return value === "setup_code" || value === "admin_approved";
}

export function isPasswordResetRequestSource(
  value: unknown,
): value is PasswordResetRequestSource {
  return value === "self_service" || value === "admin";
}

export function getAdminApprovedResetExpiry(nowMs: number = Date.now()): string {
  return new Date(nowMs + ADMIN_APPROVED_RESET_TTL_MS).toISOString();
}

export function isOpenPasswordResetRequestStatus(
  status: PasswordResetRequestStatus,
): boolean {
  return status === "pending" || status === "approved";
}

export function isUsableAdminApprovedResetGrant(
  grant: {
    status: string;
    setupMethod: string | null;
    expiresAt: string | null;
  } | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (
    !grant ||
    grant.status !== "approved" ||
    grant.setupMethod !== "admin_approved" ||
    !grant.expiresAt
  ) {
    return false;
  }

  const expiresAtMs = Date.parse(grant.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export function shouldCreatePasswordResetRequest(params: {
  tenantResolved: boolean;
  tenantScope: "platform" | "venue";
  tenantVenueId: string | null;
  user?: {
    venueId: string | null;
    role: string;
    active: boolean;
    deletedAt: string | null;
  } | null;
}): boolean {
  const { user } = params;
  if (!params.tenantResolved || !user?.active || user.deletedAt) return false;

  return (
    params.tenantScope === "platform" ||
    user.role === "super_admin" ||
    user.venueId === params.tenantVenueId
  );
}

export function getPasswordResetTargetError(target: {
  isSelf: boolean;
  isDeleted: boolean;
  isManageable: boolean;
  isActive: boolean;
}): PasswordResetTargetErrorCode | null {
  if (target.isSelf) return "CANNOT_MANAGE_SELF";
  if (!target.isManageable) return "FORBIDDEN";
  if (target.isDeleted) return "USER_DELETED";
  if (!target.isActive) return "USER_INACTIVE";
  return null;
}
