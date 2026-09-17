"use server";

import { getD1Database } from "@/lib/db/client";
import { measureServerOperation } from "@/lib/observability/server-performance";

import { reportServerError } from "@/lib/observability/structured-log";
import {
  createDeletedUserPasswordHash,
  issueManagedPasswordLinkCredential,
  ManagedUserCredentialError,
  prepareAccountInvitationCredential,
  resendManagedInvitationCredential,
} from "@/lib/auth/managed-user-credentials";
import { requireAuth, requireRole, type SessionUser } from "@/lib/auth/server";
import { requireActiveVenueId } from "@/lib/tenant/active-server";
import { UserOperationError, type UserOperationErrorCode } from "@/lib/users/errors";
import {
  createUserPersistence,
  isUserEmailUniqueConstraint,
} from "@/lib/users/persistence";
import {
  createManagedUser,
  deleteManagedUser,
  listManagedUsers,
  listUserAuditEvents,
  listUserDirectory,
  loadManagedUserForCredentialOperation,
  updateManagedUserProfile,
  type UserServiceActor,
} from "@/lib/users/service";
import type {
  ManagedPasswordLinkResult,
  ManagedUserCreateInput,
  ManagedUserCreateResult,
  User,
  UserAuditEvent,
  UserDirectoryEntry,
  UserProfileUpdateInput,
} from "@/lib/users/types";
import type { ApiResponse } from "./response";

function toUserServiceActor(user: SessionUser): UserServiceActor {
  return {
    id: user.id,
    role: user.role,
    venueId: user.venueId,
    sessionVersion: user.sessionVersion,
  };
}

function getUserActionError(
  error: unknown,
  fallback: UserOperationErrorCode,
): string {
  if (error instanceof UserOperationError) return error.code;
  if (error instanceof ManagedUserCredentialError) return error.code;
  return fallback;
}

export async function fetchUsersByVenue(
  venueId?: string | null,
): Promise<ApiResponse<UserDirectoryEntry[]>> {
  return measureServerOperation("server.user_list", async (): Promise<ApiResponse<UserDirectoryEntry[]>> => {
    try {
      const actor = await requireRole([
        "super_admin",
        "venue_admin",
        "door_staff",
        "staff",
        "dj",
      ]);
      return {
        data: await listUserDirectory(
          { actor: toUserServiceActor(actor), requestedVenueId: venueId },
          createUserPersistence(getD1Database()),
        ),
        error: null,
      };
    } catch (error) {
      await reportServerError("user.directory", error);
      return { data: null, error: "Unable to load users right now." };
    }
  });
}

export async function fetchManagedUsersByVenue(
  venueId?: string | null,
): Promise<ApiResponse<User[]>> {
  return measureServerOperation("server.managed_user_list", async (): Promise<ApiResponse<User[]>> => {
    try {
      const actor = await requireRole(["super_admin", "venue_admin"]);
      return {
        data: await listManagedUsers(
          { actor: toUserServiceActor(actor), requestedVenueId: venueId },
          createUserPersistence(getD1Database()),
        ),
        error: null,
      };
    } catch (error) {
      await reportServerError("user.managed_list", error);
      return { data: null, error: "Unable to load users right now." };
    }
  });
}

export async function fetchUserAuditEvents(
  venueId?: string | null,
): Promise<ApiResponse<UserAuditEvent[]>> {
  try {
    const actor = await requireRole(["super_admin"]);
    return {
      data: await listUserAuditEvents(
        { actor: toUserServiceActor(actor), requestedVenueId: venueId },
        createUserPersistence(),
      ),
      error: null,
    };
  } catch (error) {
    await reportServerError("user.audit_list", error);
    return { data: null, error: "Unable to load user activity right now." };
  }
}

export async function updateUserProfile(
  userId: string,
  updates: UserProfileUpdateInput,
): Promise<ApiResponse<User>> {
  try {
    const actor = await requireAuth();
    return {
      data: await updateManagedUserProfile(
        { actor: toUserServiceActor(actor), userId, updates },
        {
          persistence: createUserPersistence(),
          requireActiveVenueId,
        },
      ),
      error: null,
    };
  } catch (error) {
    await reportServerError("user.update", error);
    return { data: null, error: getUserActionError(error, "UPDATE_FAILED") };
  }
}

export async function createUserViaEdge(
  params: ManagedUserCreateInput,
): Promise<ApiResponse<ManagedUserCreateResult>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    return {
      data: await createManagedUser(
        { actor: toUserServiceActor(actor), params },
        {
          persistence: createUserPersistence(),
          requireActiveVenueId,
          prepareAccountInvitation: prepareAccountInvitationCredential,
        },
      ),
      error: null,
    };
  } catch (error) {
    await reportServerError("user.create", error);
    return {
      data: null,
      error: isUserEmailUniqueConstraint(error)
        ? "EMAIL_ALREADY_EXISTS"
        : getUserActionError(error, "UPDATE_FAILED"),
    };
  }
}

export async function issueManagedPasswordLinkViaEdge(
  userId: string,
): Promise<ApiResponse<ManagedPasswordLinkResult>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const target = await loadManagedUserForCredentialOperation(
      { actor: toUserServiceActor(actor), userId },
      {
        persistence: createUserPersistence(),
        requireActiveVenueId,
      },
    );
    return {
      data: await issueManagedPasswordLinkCredential({ actor, target }),
      error: null,
    };
  } catch (error) {
    await reportServerError("user.password_link_issue", error);
    return { data: null, error: getUserActionError(error, "UPDATE_FAILED") };
  }
}

export async function deleteUserViaEdge(
  userId: string,
): Promise<{ error: string | null }> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    await deleteManagedUser(
      { actor: toUserServiceActor(actor), userId },
      {
        persistence: createUserPersistence(),
        requireActiveVenueId,
        createDeletedPasswordHash: createDeletedUserPasswordHash,
      },
    );
    return { error: null };
  } catch (error) {
    await reportServerError("user.delete", error);
    return { error: getUserActionError(error, "UPDATE_FAILED") };
  }
}

export async function resendInvitationViaEdge(
  userId: string,
): Promise<{ error: string | null }> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const target = await loadManagedUserForCredentialOperation(
      { actor: toUserServiceActor(actor), userId },
      {
        persistence: createUserPersistence(),
        requireActiveVenueId,
      },
    );
    const result = await resendManagedInvitationCredential({ target });
    if (result === "email_unavailable") {
      return {
        error:
          "Email invitations are unavailable until the mail service is configured.",
      };
    }
    return { error: null };
  } catch (error) {
    await reportServerError("user.invitation_resend", error);
    return { error: "Unable to resend invitation right now." };
  }
}
