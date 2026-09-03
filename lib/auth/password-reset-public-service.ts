import {
  createPasswordResetClaimGrant,
  createPasswordResetReceipt,
  derivePasswordResetChallenge,
  getPasswordResetReceiptRequestIdForCandidate,
  getPasswordResetReceiptState,
  getPasswordResetRequestExpiry,
  PASSWORD_RESET_CLAIM_MAX_AGE_SECONDS,
  type PasswordResetClaimGrant,
  type PasswordResetReceiptState,
} from "./password-reset-receipt.ts";
import { shouldCreatePasswordResetRequest } from "./password-reset-request-policy.ts";
import type {
  PasswordResetPublicPersistence,
  PublicPasswordResetUserRecord,
} from "./password-reset-public-persistence.ts";

export interface PublicPasswordResetTenant {
  scope: "platform" | "venue";
  venueId: string | null;
  resolved: boolean;
}

export interface PublicPasswordResetServiceDependencies {
  persistence: PasswordResetPublicPersistence;
  getReceiptRequestIdForCandidate?: (
    headers: Pick<Headers, "get">,
    candidate: string,
    secret: string,
  ) => Promise<string | null>;
  createReceipt?: (
    requestId: string,
    secret: string,
    candidate: string,
  ) => Promise<string>;
  deriveChallenge?: (requestId: string, secret: string) => Promise<string>;
  createClaimGrant?: (
    requestId: string,
    expiresAtMs: number,
    secret: string,
  ) => Promise<string>;
  createId?: () => string;
  now?: () => Date;
}

export interface PublicPasswordResetSubmission {
  receipt: string;
  challenge: string;
  persistenceError: unknown | null;
}

export interface PublicPasswordResetStatus {
  state: PasswordResetReceiptState["state"] | "expired";
  challenge: string | null;
  expiresAt: string | null;
  claim: string | null;
  claimCookieMaxAge: number | null;
  shouldClearRecoveryCookies: boolean;
  shouldClearReceiptCookie: boolean;
}

function nowIso(dependencies: PublicPasswordResetServiceDependencies): string {
  return (dependencies.now?.() ?? new Date()).toISOString();
}

function createId(dependencies: PublicPasswordResetServiceDependencies): string {
  return (dependencies.createId ?? (() => crypto.randomUUID()))();
}

function waitingStatus(challenge: string | null): PublicPasswordResetStatus {
  return {
    state: "waiting",
    challenge,
    expiresAt: null,
    claim: null,
    claimCookieMaxAge: null,
    shouldClearRecoveryCookies: false,
    shouldClearReceiptCookie: false,
  };
}

function expiredStatus(): PublicPasswordResetStatus {
  return {
    state: "expired",
    challenge: null,
    expiresAt: null,
    claim: null,
    claimCookieMaxAge: null,
    shouldClearRecoveryCookies: true,
    shouldClearReceiptCookie: false,
  };
}

function eligibleUserId(
  user: PublicPasswordResetUserRecord | null,
  tenant: PublicPasswordResetTenant,
  dependencies: PublicPasswordResetServiceDependencies,
): string {
  return shouldCreatePasswordResetRequest({
    tenantResolved: tenant.resolved,
    tenantScope: tenant.scope,
    tenantVenueId: tenant.venueId,
    user,
  }) && user
    ? user.id
    : createId(dependencies);
}

export async function submitPublicPasswordResetRequest(
  input: {
    email: string;
    headers: Pick<Headers, "get">;
    secret: string;
    tenant: PublicPasswordResetTenant;
  },
  dependencies: PublicPasswordResetServiceDependencies,
): Promise<PublicPasswordResetSubmission> {
  const readExistingReceipt =
    dependencies.getReceiptRequestIdForCandidate ??
    getPasswordResetReceiptRequestIdForCandidate;
  const [user, existingReceiptRequestId] = await Promise.all([
    dependencies.persistence.findUserByEmail(input.email),
    readExistingReceipt(input.headers, input.email, input.secret),
  ]);
  const requestId = existingReceiptRequestId ?? createId(dependencies);
  let receiptRequestId = requestId;
  let persistenceError: unknown | null = null;
  const currentTime = nowIso(dependencies);

  try {
    const created = await dependencies.persistence.createOrSelectBrowserRequest({
      requestId,
      existingReceiptRequestId,
      eligibleUserId: eligibleUserId(user, input.tenant, dependencies),
      expiresAt: getPasswordResetRequestExpiry(Date.parse(currentTime)),
      nowIso: currentTime,
      tenantScope: input.tenant.scope,
      tenantVenueId: input.tenant.venueId,
    });
    if (created.insertedRequestId === requestId) {
      receiptRequestId = requestId;
    } else if (
      existingReceiptRequestId &&
      created.existingRequestId === existingReceiptRequestId
    ) {
      receiptRequestId = existingReceiptRequestId;
    }
  } catch (error) {
    // Public response and receipt behavior stay indistinguishable for a decoy.
    persistenceError = error;
  }

  const createReceipt = dependencies.createReceipt ?? createPasswordResetReceipt;
  const deriveChallenge = dependencies.deriveChallenge ?? derivePasswordResetChallenge;
  const [receipt, challenge] = await Promise.all([
    createReceipt(receiptRequestId, input.secret, input.email),
    deriveChallenge(receiptRequestId, input.secret),
  ]);
  return { receipt, challenge, persistenceError };
}

export async function cancelPublicPasswordResetRequest(
  input: {
    receiptRequestId: string | null;
    claimGrant: PasswordResetClaimGrant | null;
    tenant: PublicPasswordResetTenant;
  },
  dependencies: PublicPasswordResetServiceDependencies,
): Promise<void> {
  const requestId = input.claimGrant?.requestId ?? input.receiptRequestId;
  if (!requestId || !input.tenant.resolved) return;
  await dependencies.persistence.cancelBrowserRequest({
    requestId,
    nowIso: nowIso(dependencies),
    tenantScope: input.tenant.scope,
    tenantVenueId: input.tenant.venueId,
  });
}

export async function getPublicPasswordResetStatus(
  input: {
    receiptRequestId: string | null;
    claimGrant: PasswordResetClaimGrant | null;
    secret: string;
    tenant: PublicPasswordResetTenant;
  },
  dependencies: PublicPasswordResetServiceDependencies,
): Promise<PublicPasswordResetStatus> {
  const requestId = input.claimGrant?.requestId ?? input.receiptRequestId;
  if (!requestId) return waitingStatus(null);

  const deriveChallenge = dependencies.deriveChallenge ?? derivePasswordResetChallenge;
  const nowMs = (dependencies.now?.() ?? new Date()).getTime();
  const challenge = await deriveChallenge(requestId, input.secret);
  if (!input.tenant.resolved) return waitingStatus(challenge);

  const record = await dependencies.persistence.loadReceiptStatus(requestId);
  const state = getPasswordResetReceiptState(record, input.tenant, nowMs);
  if (input.claimGrant && Date.parse(input.claimGrant.expiresAt) <= nowMs) {
    await dependencies.persistence.cancelExpiredApprovedRequest({
      requestId,
      nowIso: new Date(nowMs).toISOString(),
    });
    return expiredStatus();
  }

  if (state.state !== "approved") {
    if (input.claimGrant) return expiredStatus();
    return {
      ...waitingStatus(challenge),
      ...state,
      challenge,
    };
  }

  if (input.claimGrant?.requestId === requestId) {
    return {
      state: "approved",
      challenge,
      expiresAt: new Date(
        Math.min(Date.parse(input.claimGrant.expiresAt), Date.parse(state.expiresAt)),
      ).toISOString(),
      claim: null,
      claimCookieMaxAge: null,
      shouldClearRecoveryCookies: false,
      shouldClearReceiptCookie: false,
    };
  }

  const databaseExpiryMs = Date.parse(state.expiresAt);
  const claimExpiresAtMs = Math.min(
    nowMs + PASSWORD_RESET_CLAIM_MAX_AGE_SECONDS * 1000,
    databaseExpiryMs,
  );
  if (claimExpiresAtMs <= nowMs + 1000) {
    await dependencies.persistence.cancelExpiredApprovedRequest({
      requestId,
      nowIso: new Date(nowMs).toISOString(),
    });
    return expiredStatus();
  }

  const createClaimGrant = dependencies.createClaimGrant ?? createPasswordResetClaimGrant;
  return {
    state: "approved",
    challenge,
    expiresAt: new Date(claimExpiresAtMs).toISOString(),
    claim: await createClaimGrant(requestId, claimExpiresAtMs, input.secret),
    claimCookieMaxAge: Math.max(
      1,
      Math.ceil((databaseExpiryMs - nowMs) / 1000),
    ),
    shouldClearRecoveryCookies: false,
    shouldClearReceiptCookie: true,
  };
}
