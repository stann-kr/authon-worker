"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  PasswordResetAdminError,
  countPendingAdminPasswordResetRequests,
  listAdminPasswordResetRequests,
  rejectAdminPasswordResetRequest,
  startAdminManagedPasswordReset,
  type PasswordResetAdminActor,
} from "@/lib/auth/password-reset-admin-service";
import { createPasswordResetAdminPersistence } from "@/lib/auth/password-reset-admin-persistence";
import {
  isPasswordResetSetupMethod,
  type PasswordResetSetupMethod,
  type PasswordResetVerificationMethod,
} from "@/lib/auth/password-reset-request-policy";
import { verifyPasswordResetChallenge } from "@/lib/auth/password-reset-receipt";
import {
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";
import { requireRole } from "@/lib/auth/server";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import type {
  PasswordResetRequest,
  PasswordResetRequestView,
} from "@/lib/auth/password-reset-request-types";
import type { ApiResponse } from "./response";

function toAdminActor(
  actor: Awaited<ReturnType<typeof requireRole>>,
): PasswordResetAdminActor {
  return {
    id: actor.id,
    role: actor.role as PasswordResetAdminActor["role"],
    venueId: actor.venueId,
    sessionVersion: actor.sessionVersion,
  };
}

function getActionError(error: unknown): string {
  return error instanceof PasswordResetAdminError ? error.code : "UPDATE_FAILED";
}

function createDependencies(database: Parameters<typeof createPasswordResetAdminPersistence>[0]) {
  return {
    persistence: createPasswordResetAdminPersistence(database),
    requireActiveVenueId,
    verifyChallenge: verifyPasswordResetChallenge,
  };
}

export async function fetchPasswordResetRequests(
  venueId?: string | null,
): Promise<ApiResponse<PasswordResetRequestView[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const { env } = getCloudflareContext();
    return {
      data: await listAdminPasswordResetRequests(
        { actor: toAdminActor(actor), venueId },
        createDependencies(env.DB),
      ),
      error: null,
    };
  } catch (error) {
    await reportServerError("password_reset.admin_list", error);
    return { data: null, error: getActionError(error) };
  }
}

export async function fetchPendingPasswordResetRequestCount(): Promise<
  ApiResponse<number>
> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const { env } = getCloudflareContext();
    return {
      data: await countPendingAdminPasswordResetRequests(
        { actor: toAdminActor(actor) },
        createDependencies(env.DB),
      ),
      error: null,
    };
  } catch (error) {
    await reportServerError("password_reset.pending_count", error);
    return { data: null, error: getActionError(error) };
  }
}

export async function startManagedPasswordReset(params: {
  userId?: string | null;
  setupMethod: PasswordResetSetupMethod;
  requestId?: string | null;
  verificationMethod?: PasswordResetVerificationMethod | null;
  verificationChallenge?: string | null;
  verificationAttested?: boolean;
}): Promise<
  ApiResponse<{
    requestId: string;
    setupMethod: PasswordResetSetupMethod;
    setupCode: string | null;
    expiresAt: string;
  }>
> {
  let actor: Awaited<ReturnType<typeof requireRole>> | null = null;
  try {
    actor = await requireRole(["super_admin", "venue_admin"]);
    if (!isPasswordResetSetupMethod(params.setupMethod)) {
      throw new PasswordResetAdminError("INVALID_SETUP_METHOD");
    }
    const { env } = getCloudflareContext();
    return {
      data: await startAdminManagedPasswordReset(
        {
          actor: toAdminActor(actor),
          params: { ...params, jwtSecret: env.JWT_SECRET },
        },
        createDependencies(env.DB),
      ),
      error: null,
    };
  } catch (error) {
    if (error instanceof PasswordResetAdminError && error.isMissingConfiguration && actor) {
      await writeStructuredLog("error", {
        event: "password_reset.admin_decide",
        actorId: actor.id,
        venueId: actor.venueId,
        outcome: "unavailable",
        errorKind: "MissingConfiguration",
      });
    }
    await reportServerError("password_reset.admin_decide", error);
    return { data: null, error: getActionError(error) };
  }
}

export async function rejectPasswordResetRequest(
  requestId: string,
): Promise<ApiResponse<PasswordResetRequest>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const { env } = getCloudflareContext();
    return {
      data: await rejectAdminPasswordResetRequest(
        { actor: toAdminActor(actor), requestId },
        createDependencies(env.DB),
      ),
      error: null,
    };
  } catch (error) {
    await reportServerError("password_reset.admin_reject", error);
    return { data: null, error: getActionError(error) };
  }
}
