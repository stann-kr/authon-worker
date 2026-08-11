export type PasswordResetRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed"
  | "cancelled";

export type PasswordResetSetupMethod = "setup_code" | "admin_approved";

export type PasswordResetRequestSource = "self_service" | "admin";

export const PASSWORD_RESET_VERIFICATION_METHODS = [
  "in_person",
  "registered_phone",
  "verified_messenger",
] as const;

export type PasswordResetVerificationMethod =
  (typeof PASSWORD_RESET_VERIFICATION_METHODS)[number];

export type PasswordResetTargetErrorCode =
  | "CANNOT_MANAGE_SELF"
  | "FORBIDDEN"
  | "USER_DELETED"
  | "USER_INACTIVE";

export type AdminApprovedResetPolicyErrorCode =
  | "CANNOT_MANAGE_SELF"
  | "FORBIDDEN"
  | "EXACT_SELF_SERVICE_REQUEST_REQUIRED"
  | "SIGNED_RECEIPT_REQUIRED"
  | "VERIFICATION_REQUIRED"
  | "DIRECT_RESET_NOT_ALLOWED";

export interface AdminApprovedResetPolicyInput {
  isSelf: boolean;
  isManageable: boolean;
  isExactRequest: boolean;
  hasSignedReceipt: boolean;
  requestSource: unknown;
  targetRole: unknown;
  targetAccountKind: unknown;
  verificationMethod: unknown;
}

export const PASSWORD_RESET_APPROVAL_TTL_MS = 15 * 60 * 1000;

// 기존 호출부 호환용이다. setup code와 활성화된 browser claim이 이 TTL을 사용한다.
// browser 승인 row 자체는 원래 요청의 최대 24시간 만료를 유지한다.
export const ADMIN_APPROVED_RESET_TTL_MS = PASSWORD_RESET_APPROVAL_TTL_MS;

const REQUEST_STATUSES: readonly PasswordResetRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "completed",
  "cancelled",
];

const DIRECT_RESET_TARGET_ROLES = ["door_staff", "staff", "dj"] as const;

const SETUP_CODE_ONLY_METHODS: readonly PasswordResetSetupMethod[] = [
  "setup_code",
];

const DIRECT_AND_SETUP_CODE_METHODS: readonly PasswordResetSetupMethod[] = [
  "setup_code",
  "admin_approved",
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

export function isPasswordResetVerificationMethod(
  value: unknown,
): value is PasswordResetVerificationMethod {
  return typeof value === "string" &&
    PASSWORD_RESET_VERIFICATION_METHODS.includes(
      value as PasswordResetVerificationMethod,
    );
}

export function getPasswordResetApprovalExpiry(
  setupMethod: PasswordResetSetupMethod,
  nowMs: number = Date.now(),
): string {
  if (!isPasswordResetSetupMethod(setupMethod)) {
    throw new Error("INVALID_SETUP_METHOD");
  }
  return new Date(nowMs + PASSWORD_RESET_APPROVAL_TTL_MS).toISOString();
}

export function getAdminApprovedResetExpiry(nowMs: number = Date.now()): string {
  return getPasswordResetApprovalExpiry("admin_approved", nowMs);
}

export function getManagedPasswordResetDecisionExpiry(
  setupMethod: PasswordResetSetupMethod,
  requestExpiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (setupMethod === "admin_approved" && requestExpiresAt) {
    const requestExpiryMs = Date.parse(requestExpiresAt);
    if (Number.isFinite(requestExpiryMs) && requestExpiryMs > nowMs) {
      return requestExpiresAt;
    }
  }
  return getPasswordResetApprovalExpiry(setupMethod, nowMs);
}

export function getAdminApprovedResetPolicyError(
  input: AdminApprovedResetPolicyInput,
): AdminApprovedResetPolicyErrorCode | null {
  if (input.isSelf) return "CANNOT_MANAGE_SELF";
  if (!input.isManageable) return "FORBIDDEN";
  if (input.requestSource !== "self_service" || !input.isExactRequest) {
    return "EXACT_SELF_SERVICE_REQUEST_REQUIRED";
  }
  if (!input.hasSignedReceipt) return "SIGNED_RECEIPT_REQUIRED";
  if (!isPasswordResetVerificationMethod(input.verificationMethod)) {
    return "VERIFICATION_REQUIRED";
  }
  if (
    input.targetAccountKind !== "personal" ||
    typeof input.targetRole !== "string" ||
    !DIRECT_RESET_TARGET_ROLES.some((role) => role === input.targetRole)
  ) {
    return "DIRECT_RESET_NOT_ALLOWED";
  }
  return null;
}

export function canUseAdminApprovedReset(
  input: AdminApprovedResetPolicyInput,
): boolean {
  return getAdminApprovedResetPolicyError(input) === null;
}

export function getAllowedPasswordResetSetupMethods(
  input: AdminApprovedResetPolicyInput,
): readonly PasswordResetSetupMethod[] {
  if (input.isSelf || !input.isManageable) return [];
  return canUseAdminApprovedReset(input)
    ? DIRECT_AND_SETUP_CODE_METHODS
    : SETUP_CODE_ONLY_METHODS;
}

export function isOpenPasswordResetRequestStatus(
  status: PasswordResetRequestStatus,
): boolean {
  return status === "pending" || status === "approved";
}

export function isUsablePasswordResetApproval(
  approval: {
    status: string;
    setupMethod: string | null;
    expiresAt: string | null;
  } | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (
    !approval ||
    approval.status !== "approved" ||
    !isPasswordResetSetupMethod(approval.setupMethod) ||
    !approval.expiresAt
  ) {
    return false;
  }

  const expiresAtMs = Date.parse(approval.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
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
    grant?.setupMethod !== "admin_approved"
  ) {
    return false;
  }
  return isUsablePasswordResetApproval(grant, nowMs);
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
