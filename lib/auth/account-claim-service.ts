import {
  hashPassword,
  verifyPassword,
  verifyPasswordWithDummies,
} from "./password.ts";
import { getPasswordPolicyErrorCode } from "./password-policy.ts";
import type {
  AccountClaimCandidate,
  AccountClaimPersistence,
} from "./account-claim-persistence.ts";

export type AccountClaimResult =
  | { status: "not_eligible" }
  | { status: "grant_expired" }
  | {
      status: "claimed";
      userId: string;
      venueId: string | null;
      requestId: string | null;
    };

export interface AccountClaimServiceDependencies {
  persistence: AccountClaimPersistence;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  hashPassword(password: string): Promise<string>;
  createOperationId(): string;
  now(): string;
}

export interface ClaimAccountInput {
  useBrowserReceipt: boolean;
  email: string;
  setupCode: string;
  newPassword: string;
  receiptRequestId: string | null;
  claimGrantExpiresAt: string | null;
  nowIso: string;
  expectedVenueId: string | null;
}

export function prepareAccountClaimPassword(
  password: unknown,
):
  | { status: "missing" }
  | {
      status: "policy_error";
      code: "PASSWORD_TOO_SHORT" | "PASSWORD_REQUIRES_LETTERS_AND_NUMBERS";
    }
  | { status: "ready"; password: string } {
  if (typeof password !== "string") return { status: "missing" };
  const code = getPasswordPolicyErrorCode(password);
  return code
    ? { status: "policy_error", code }
    : { status: "ready", password };
}

function isLegacySetupCodeCandidate(
  useBrowserReceipt: boolean,
  candidate: AccountClaimCandidate | null,
): boolean {
  return !useBrowserReceipt &&
    candidate !== null &&
    !candidate.request_id &&
    candidate.has_setup_code_history === 0;
}

export async function claimAccount(
  input: ClaimAccountInput,
  dependencies: AccountClaimServiceDependencies,
): Promise<AccountClaimResult> {
  const candidate = input.useBrowserReceipt && input.receiptRequestId
    ? await dependencies.persistence.findBrowserReceiptCandidate({
      requestId: input.receiptRequestId,
      nowIso: input.nowIso,
      expectedVenueId: input.expectedVenueId,
    })
    : !input.useBrowserReceipt
      ? await dependencies.persistence.findSetupCodeCandidate({
        email: input.email,
        nowIso: input.nowIso,
        expectedVenueId: input.expectedVenueId,
      })
      : null;

  const isLegacySetup = isLegacySetupCodeCandidate(
    input.useBrowserReceipt,
    candidate,
  );
  const setupCodeMatches = !input.useBrowserReceipt
    ? await verifyPasswordWithDummies(
      input.setupCode,
      candidate && (Boolean(candidate.request_id) || isLegacySetup)
        ? candidate.password_hash
        : null,
      dependencies.verifyPassword,
    )
    : false;

  if (
    !candidate ||
    (input.useBrowserReceipt && !candidate.request_id) ||
    (!input.useBrowserReceipt && !setupCodeMatches)
  ) {
    return { status: "not_eligible" };
  }

  const passwordHash = await dependencies.hashPassword(input.newPassword);
  const credentialChangedAt = dependencies.now();
  if (
    input.useBrowserReceipt &&
    (!input.claimGrantExpiresAt || input.claimGrantExpiresAt <= credentialChangedAt)
  ) {
    return { status: "grant_expired" };
  }

  const claimMethod = input.useBrowserReceipt
    ? "browser_receipt"
    : isLegacySetup
      ? "legacy_setup_code"
      : "manual_setup_code";
  const claimedUserId = await dependencies.persistence.consumeClaim({
    candidate,
    expectedVenueId: input.expectedVenueId,
    passwordHash,
    credentialChangedAt,
    operationId: dependencies.createOperationId(),
    claimMethod,
    exactRequestId: candidate.request_id ?? "",
  });

  if (!claimedUserId) return { status: "not_eligible" };
  return {
    status: "claimed",
    userId: claimedUserId,
    venueId: candidate.venue_id,
    requestId: candidate.request_id,
  };
}

export const accountClaimPasswordDependencies = {
  verifyPassword,
  hashPassword,
};
