import { hashPassword } from "./password.ts";
import {
  getAdminApprovedResetPolicyError,
  getManagedPasswordResetDecisionExpiry,
  getPasswordResetApprovalExpiry,
  getPasswordResetTargetError,
  isPasswordResetRequestSource,
  isPasswordResetRequestStatus,
  isPasswordResetSetupMethod,
  isPasswordResetVerificationMethod,
  type PasswordResetSetupMethod,
  type PasswordResetVerificationMethod,
} from "./password-reset-request-policy.ts";
import type {
  PasswordResetAdminPersistence,
  PasswordResetAdminRequestRecord,
  PasswordResetAdminRequestViewRecord,
  PasswordResetAdminTarget,
} from "./password-reset-admin-persistence.ts";
import type {
  PasswordResetRequest,
  PasswordResetRequestView,
} from "./password-reset-request-types.ts";
import {
  canManageTargetAccount,
  isAccountKind,
  isRole,
  VENUE_MANAGED_ROLES,
  type Role,
} from "../users/policy.ts";

export type PasswordResetAdminErrorCode =
  | "CANNOT_MANAGE_SELF"
  | "DIRECT_RESET_NOT_ALLOWED"
  | "EXACT_SELF_SERVICE_REQUEST_REQUIRED"
  | "FORBIDDEN"
  | "INVALID_DECISION"
  | "INVALID_SETUP_METHOD"
  | "REQUEST_ALREADY_DECIDED"
  | "REQUEST_EXPIRED"
  | "REQUEST_NOT_FOUND"
  | "SIGNED_RECEIPT_REQUIRED"
  | "USER_DELETED"
  | "USER_INACTIVE"
  | "USER_NOT_FOUND"
  | "VERIFICATION_FAILED"
  | "VERIFICATION_REQUIRED"
  | "UPDATE_FAILED";

export class PasswordResetAdminError extends Error {
  readonly code: PasswordResetAdminErrorCode;
  readonly isMissingConfiguration: boolean;

  constructor(
    code: PasswordResetAdminErrorCode,
    isMissingConfiguration = false,
  ) {
    super(code);
    this.code = code;
    this.isMissingConfiguration = isMissingConfiguration;
  }
}

export interface PasswordResetAdminActor {
  id: string;
  role: Extract<Role, "super_admin" | "venue_admin">;
  venueId: string | null;
  sessionVersion: number | null;
}

export interface PasswordResetAdminServiceDependencies {
  persistence: PasswordResetAdminPersistence;
  requireActiveVenueId: (venueId: string) => Promise<string>;
  verifyChallenge: (
    requestId: string,
    challenge: string | null | undefined,
    secret: string,
  ) => Promise<boolean>;
  hashPassword?: (password: string) => Promise<string>;
  now?: () => Date;
  createId?: () => string;
  createSetupCode?: () => string;
}

export interface ManagedPasswordResetInput {
  userId?: string | null;
  setupMethod: PasswordResetSetupMethod;
  requestId?: string | null;
  verificationMethod?: PasswordResetVerificationMethod | null;
  verificationChallenge?: string | null;
  verificationAttested?: boolean;
  jwtSecret?: string;
}

export interface ManagedPasswordResetResult {
  requestId: string;
  setupMethod: PasswordResetSetupMethod;
  setupCode: string | null;
  expiresAt: string;
}

function nowIso(dependencies: PasswordResetAdminServiceDependencies): string {
  return (dependencies.now?.() ?? new Date()).toISOString();
}

function createId(dependencies: PasswordResetAdminServiceDependencies): string {
  return (dependencies.createId ?? (() => crypto.randomUUID()))();
}

function generateSetupCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const value = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `AUTH-${value.slice(0, 4)}-${value.slice(4)}`;
}

function toPasswordResetRequest(
  row: PasswordResetAdminRequestRecord,
): PasswordResetRequest {
  if (
    !isPasswordResetRequestSource(row.source) ||
    !isPasswordResetRequestStatus(row.status) ||
    (row.setupMethod !== null && !isPasswordResetSetupMethod(row.setupMethod))
  ) {
    throw new PasswordResetAdminError("UPDATE_FAILED");
  }
  return { ...row, source: row.source, status: row.status, setupMethod: row.setupMethod };
}

function toPasswordResetRequestView(
  row: PasswordResetAdminRequestViewRecord,
): PasswordResetRequestView {
  if (!isRole(row.userRole) || !isAccountKind(row.userAccountKind)) {
    throw new PasswordResetAdminError("UPDATE_FAILED");
  }
  const request = toPasswordResetRequest(row.request);
  return {
    ...request,
    userName: row.userName,
    userEmail: row.userEmail,
    userRole: row.userRole,
    userAccountKind: row.userAccountKind,
    venueName: row.venueName,
    codeFreeEligible:
      request.source === "self_service" &&
      Boolean(request.expiresAt) &&
      row.userAccountKind === "personal" &&
      VENUE_MANAGED_ROLES.some((role) => role === row.userRole),
  };
}

function visibilityFor(
  actor: PasswordResetAdminActor,
  requestedVenueId?: string | null,
) {
  if (actor.role === "super_admin") {
    return { kind: "platform" as const, venueId: requestedVenueId ?? null, excludedActorId: actor.id };
  }
  if (!actor.venueId) throw new PasswordResetAdminError("FORBIDDEN");
  return { kind: "venue" as const, venueId: actor.venueId, excludedActorId: actor.id };
}

async function getManagedTarget(
  actor: PasswordResetAdminActor,
  userId: string,
  dependencies: PasswordResetAdminServiceDependencies,
): Promise<PasswordResetAdminTarget & { role: Role; accountKind: "personal" | "shared" }> {
  const target = await dependencies.persistence.loadTarget(userId);
  if (!target) throw new PasswordResetAdminError("USER_NOT_FOUND");
  if (!isRole(target.role) || !isAccountKind(target.accountKind)) {
    throw new PasswordResetAdminError("FORBIDDEN");
  }
  const managedTarget = {
    ...target,
    role: target.role,
    accountKind: target.accountKind,
  };
  const targetError = getPasswordResetTargetError({
    isSelf: actor.id === managedTarget.id,
    isDeleted: Boolean(managedTarget.deletedAt),
    isManageable: canManageTargetAccount(actor, managedTarget),
    isActive: managedTarget.active,
  });
  if (targetError) throw new PasswordResetAdminError(targetError);
  if (managedTarget.venueId) await dependencies.requireActiveVenueId(managedTarget.venueId);
  return managedTarget;
}

export async function listAdminPasswordResetRequests(
  input: { actor: PasswordResetAdminActor; venueId?: string | null },
  dependencies: PasswordResetAdminServiceDependencies,
): Promise<PasswordResetRequestView[]> {
  const rows = await dependencies.persistence.listRequests({
    visibility: visibilityFor(input.actor, input.venueId),
    nowIso: nowIso(dependencies),
  });
  return rows.map(toPasswordResetRequestView);
}

export async function countPendingAdminPasswordResetRequests(
  input: { actor: PasswordResetAdminActor },
  dependencies: PasswordResetAdminServiceDependencies,
): Promise<number> {
  return dependencies.persistence.countPendingRequests({
    visibility: visibilityFor(input.actor),
    nowIso: nowIso(dependencies),
  });
}

export async function startAdminManagedPasswordReset(
  input: { actor: PasswordResetAdminActor; params: ManagedPasswordResetInput },
  dependencies: PasswordResetAdminServiceDependencies,
): Promise<ManagedPasswordResetResult> {
  const { actor, params } = input;
  if (!isPasswordResetSetupMethod(params.setupMethod)) {
    throw new PasswordResetAdminError("INVALID_SETUP_METHOD");
  }
  const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
  const requestedUserId = typeof params.userId === "string" ? params.userId.trim() : "";
  if (!requestId && !requestedUserId) throw new PasswordResetAdminError("INVALID_DECISION");

  const currentTime = nowIso(dependencies);
  const shortLivedExpiresAt = getPasswordResetApprovalExpiry(params.setupMethod, Date.parse(currentTime));

  if (!requestId) {
    if (!requestedUserId || params.setupMethod !== "setup_code") {
      throw new PasswordResetAdminError("DIRECT_RESET_NOT_ALLOWED");
    }
    const target = await getManagedTarget(actor, requestedUserId, dependencies);
    const manualRequestId = createId(dependencies);
    const setupCode = (dependencies.createSetupCode ?? generateSetupCode)();
    const passwordHash = await (dependencies.hashPassword ?? hashPassword)(setupCode);
    const operationId = createId(dependencies);
    const result = await dependencies.persistence.createDirectSetupCodeReset({
      actor,
      target,
      manualRequestId,
      setupCodeHash: passwordHash,
      operationId,
      nowIso: currentTime,
      expiresAt: shortLivedExpiresAt,
      auditDetails: JSON.stringify({
        requestId: manualRequestId,
        setupMethod: "setup_code",
        delivery: "manual_setup_code",
      }),
    });
    if (result.updatedUserId !== target.id || result.approvedUserId !== target.id) {
      throw new PasswordResetAdminError("UPDATE_FAILED");
    }
    return { requestId: manualRequestId, setupMethod: "setup_code", setupCode, expiresAt: shortLivedExpiresAt };
  }

  const request = await dependencies.persistence.loadRequest(requestId);
  if (!request) throw new PasswordResetAdminError("REQUEST_NOT_FOUND");
  if (requestedUserId && requestedUserId !== request.userId) {
    throw new PasswordResetAdminError("REQUEST_NOT_FOUND");
  }
  if (request.status !== "pending") throw new PasswordResetAdminError("REQUEST_ALREADY_DECIDED");
  if (request.expiresAt && request.expiresAt <= currentTime) {
    throw new PasswordResetAdminError("REQUEST_EXPIRED");
  }
  const expiresAt = getManagedPasswordResetDecisionExpiry(
    params.setupMethod,
    request.expiresAt,
    Date.parse(currentTime),
  );
  const target = await getManagedTarget(actor, request.userId, dependencies);

  let verificationMethod: PasswordResetVerificationMethod | null = null;
  if (params.setupMethod === "admin_approved") {
    if (params.verificationAttested !== true) {
      throw new PasswordResetAdminError("VERIFICATION_REQUIRED");
    }
    if (!params.jwtSecret) throw new PasswordResetAdminError("UPDATE_FAILED", true);
    const challengeMatches = await dependencies.verifyChallenge(
      request.id,
      params.verificationChallenge,
      params.jwtSecret,
    );
    if (!challengeMatches) throw new PasswordResetAdminError("VERIFICATION_FAILED");
    const policyError = getAdminApprovedResetPolicyError({
      isSelf: actor.id === target.id,
      isManageable: canManageTargetAccount(actor, target),
      isExactRequest: true,
      hasSignedReceipt: true,
      requestSource: request.source,
      targetRole: target.role,
      targetAccountKind: target.accountKind,
      verificationMethod: params.verificationMethod,
    });
    if (policyError) throw new PasswordResetAdminError(policyError);
    if (!isPasswordResetVerificationMethod(params.verificationMethod)) {
      throw new PasswordResetAdminError("VERIFICATION_REQUIRED");
    }
    verificationMethod = params.verificationMethod;
  }

  const operationId = createId(dependencies);
  const auditDetails = JSON.stringify({
    requestId,
    setupMethod: params.setupMethod,
    delivery: params.setupMethod === "setup_code" ? "manual_setup_code" : "browser_receipt",
    verificationMethod,
    verificationAttested: params.setupMethod === "admin_approved",
  });
  if (params.setupMethod === "admin_approved") {
    const result = await dependencies.persistence.approveBrowserRequest({
      actor,
      target,
      requestId,
      expiresAt,
      nowIso: currentTime,
      operationId,
      auditDetails,
    });
    if (result.approvedUserId !== target.id) {
      throw new PasswordResetAdminError("REQUEST_ALREADY_DECIDED");
    }
    return { requestId, setupMethod: params.setupMethod, setupCode: null, expiresAt };
  }

  const setupCode = (dependencies.createSetupCode ?? generateSetupCode)();
  const passwordHash = await (dependencies.hashPassword ?? hashPassword)(setupCode);
  const result = await dependencies.persistence.approveSetupCodeRequest({
    actor,
    target,
    requestId,
    passwordHash,
    expiresAt,
    nowIso: currentTime,
    operationId,
    auditDetails,
  });
  if (!result.updatedUserId || result.approvedUserId !== result.updatedUserId) {
    throw new PasswordResetAdminError("REQUEST_ALREADY_DECIDED");
  }
  return { requestId, setupMethod: params.setupMethod, setupCode, expiresAt };
}

export async function rejectAdminPasswordResetRequest(
  input: { actor: PasswordResetAdminActor; requestId: unknown },
  dependencies: PasswordResetAdminServiceDependencies,
): Promise<PasswordResetRequest> {
  if (typeof input.requestId !== "string" || !input.requestId.trim()) {
    throw new PasswordResetAdminError("INVALID_DECISION");
  }
  const requestId = input.requestId;
  const request = await dependencies.persistence.loadRequest(requestId);
  if (!request) throw new PasswordResetAdminError("REQUEST_NOT_FOUND");
  const target = await getManagedTarget(input.actor, request.userId, dependencies);
  if (request.status !== "pending") throw new PasswordResetAdminError("REQUEST_ALREADY_DECIDED");
  const rejectedRequestId = await dependencies.persistence.rejectRequest({
    actor: input.actor,
    target,
    requestId,
    nowIso: nowIso(dependencies),
    operationId: createId(dependencies),
  });
  if (rejectedRequestId !== requestId) {
    throw new PasswordResetAdminError("REQUEST_ALREADY_DECIDED");
  }
  const updated = await dependencies.persistence.loadRequest(requestId);
  if (!updated) throw new PasswordResetAdminError("UPDATE_FAILED");
  return toPasswordResetRequest(updated);
}
