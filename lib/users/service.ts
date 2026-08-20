import { isLocale } from "../../i18n/config.ts";

import { shouldInvalidateManagedUserCredentials } from "../auth/managed-user-credential-policy.ts";
import { UserOperationError } from "./errors.ts";
import type {
  UserPersistence,
  UserProfileMutationValues,
} from "./persistence.ts";
import {
  canManageTargetAccount,
  canManageTargetRole,
  isAccountKind,
  isRole,
  isVenueManagedRole,
  VENUE_MANAGED_ROLES,
  type Role,
} from "./policy.ts";
import type {
  ManagedUserCreateInput,
  ManagedUserCreateResult,
  User,
  UserAuditEvent,
  UserDirectoryEntry,
  UserProfileUpdateInput,
} from "./types.ts";

export interface UserServiceActor {
  id: string;
  role: Role;
  venueId: string | null;
}

type RequireActiveVenueId = (venueId: string) => Promise<string>;

export interface PreparedManagedUserInvitation {
  passwordHash: string;
  invitation: {
    id: string;
    tokenHash: string;
    expiresAt: string;
    url: string;
  };
}

function requireTarget(target: User | null): User {
  if (!target) throw new UserOperationError("USER_NOT_FOUND");
  return target;
}

function assertManagedTarget(actor: UserServiceActor, target: User): void {
  if (actor.id === target.id) {
    throw new UserOperationError("CANNOT_MANAGE_SELF");
  }
  if (target.deletedAt) throw new UserOperationError("USER_DELETED");
  if (!canManageTargetAccount(actor, target)) {
    throw new UserOperationError("FORBIDDEN");
  }
}

async function requireActiveTargetVenue(
  target: User,
  requireActiveVenueId: RequireActiveVenueId,
): Promise<void> {
  if (target.venueId) await requireActiveVenueId(target.venueId);
}

async function requireAnotherActiveSuperAdmin(
  target: User,
  persistence: UserPersistence,
): Promise<void> {
  if (
    target.role === "super_admin" &&
    !(await persistence.hasAnotherActiveSuperAdmin(target.id))
  ) {
    throw new UserOperationError("LAST_SUPER_ADMIN");
  }
}

export async function listUserDirectory(
  input: { actor: UserServiceActor; requestedVenueId?: string | null },
  persistence: UserPersistence,
): Promise<UserDirectoryEntry[]> {
  const venueId =
    input.actor.role === "super_admin"
      ? input.requestedVenueId ?? null
      : input.actor.venueId;
  if (input.actor.role !== "super_admin" && !venueId) {
    throw new UserOperationError("FORBIDDEN");
  }
  return persistence.listDirectory({
    venueId,
    excludeSuperAdmins: input.actor.role !== "super_admin",
  });
}

export async function listManagedUsers(
  input: { actor: UserServiceActor; requestedVenueId?: string | null },
  persistence: UserPersistence,
): Promise<User[]> {
  if (
    input.actor.role !== "super_admin" &&
    input.actor.role !== "venue_admin"
  ) {
    throw new UserOperationError("FORBIDDEN");
  }
  const venueId =
    input.actor.role === "super_admin"
      ? input.requestedVenueId ?? null
      : input.actor.venueId;
  if (input.actor.role !== "super_admin" && !venueId) {
    throw new UserOperationError("FORBIDDEN");
  }
  return persistence.listManaged({
    venueId,
    roles: input.actor.role === "super_admin" ? null : VENUE_MANAGED_ROLES,
  });
}

export async function listUserAuditEvents(
  input: { actor: UserServiceActor; requestedVenueId?: string | null },
  persistence: UserPersistence,
): Promise<UserAuditEvent[]> {
  if (input.actor.role !== "super_admin") {
    throw new UserOperationError("FORBIDDEN");
  }
  return persistence.listAuditEvents(input.requestedVenueId ?? null);
}

interface UserProfileUpdatePlan {
  values: UserProfileMutationValues;
  changedFields: string[];
  incrementsSessionVersion: boolean;
  invalidatesCredentials: boolean;
  requiresAnotherActiveSuperAdmin: boolean;
  audit: { action: string; details: Record<string, unknown> } | null;
}

function prepareUserProfileUpdate(input: {
  actor: UserServiceActor;
  target: User;
  updates: UserProfileUpdateInput;
  isSelfUpdate: boolean;
}): UserProfileUpdatePlan {
  const { actor, target, updates, isSelfUpdate } = input;
  if (
    isSelfUpdate &&
    (updates.guestLimit !== undefined ||
      updates.active !== undefined ||
      updates.role !== undefined ||
      updates.accountKind !== undefined ||
      updates.doorAccessEnabled !== undefined)
  ) {
    throw new UserOperationError("CANNOT_MANAGE_SELF");
  }

  const values: UserProfileMutationValues = {};
  const changedFields: string[] = [];
  if (updates.name !== undefined) {
    const name = updates.name.trim();
    if (!name || name.length > 100) {
      throw new UserOperationError("INVALID_INPUT");
    }
    if (name !== target.name) {
      values.name = name;
      changedFields.push("name");
    }
  }

  if (updates.guestLimit !== undefined) {
    if (isSelfUpdate) throw new UserOperationError("CANNOT_MANAGE_SELF");
    if (
      updates.guestLimit !== null &&
      (!Number.isInteger(updates.guestLimit) ||
        updates.guestLimit < 0 ||
        updates.guestLimit > 999)
    ) {
      throw new UserOperationError("INVALID_INPUT");
    }
    if (updates.guestLimit !== target.guestLimit) {
      values.guestLimit = updates.guestLimit;
      changedFields.push("guestLimit");
    }
  }

  if (updates.role !== undefined) {
    if (
      !isRole(updates.role) ||
      !canManageTargetRole(actor.role, target.role, updates.role)
    ) {
      throw new UserOperationError("INVALID_ROLE");
    }
    if (updates.role !== target.role) {
      values.role = updates.role;
      changedFields.push("role");
    }
  }

  const nextRole = updates.role ?? target.role;
  const nextAccountKind = updates.accountKind ?? target.accountKind;
  const nextDoorAccessEnabled =
    updates.doorAccessEnabled ?? target.doorAccessEnabled;
  if (!isAccountKind(nextAccountKind)) {
    throw new UserOperationError("INVALID_INPUT");
  }
  if (nextAccountKind === "shared" && nextRole !== "staff") {
    throw new UserOperationError("INVALID_ROLE");
  }
  if (nextAccountKind === "personal" && nextDoorAccessEnabled) {
    throw new UserOperationError("INVALID_INPUT");
  }

  if (
    updates.accountKind !== undefined &&
    updates.accountKind !== target.accountKind
  ) {
    values.accountKind = updates.accountKind;
    changedFields.push("accountKind");
  }
  if (
    updates.doorAccessEnabled !== undefined &&
    updates.doorAccessEnabled !== target.doorAccessEnabled
  ) {
    values.doorAccessEnabled = updates.doorAccessEnabled;
    changedFields.push("doorAccessEnabled");
  }
  if (updates.active !== undefined && updates.active !== target.active) {
    if (isSelfUpdate) throw new UserOperationError("CANNOT_MANAGE_SELF");
    values.active = updates.active;
    changedFields.push("active");
  }

  const incrementsSessionVersion = changedFields.some((field) =>
    ["role", "accountKind", "doorAccessEnabled", "active"].includes(field),
  );
  const invalidatesCredentials = shouldInvalidateManagedUserCredentials({
    changedFields,
    nextActive: updates.active ?? target.active,
  });
  const requiresAnotherActiveSuperAdmin =
    changedFields.includes("active") &&
    updates.active === false &&
    target.role === "super_admin";

  if (isSelfUpdate || changedFields.length === 0) {
    return {
      values,
      changedFields,
      incrementsSessionVersion,
      invalidatesCredentials,
      requiresAnotherActiveSuperAdmin,
      audit: null,
    };
  }

  const action =
    changedFields.length === 1 && changedFields[0] === "role"
      ? "role_changed"
      : changedFields.length === 1 && changedFields[0] === "active"
        ? updates.active
          ? "reactivated"
          : "deactivated"
        : "user_updated";
  return {
    values,
    changedFields,
    incrementsSessionVersion,
    invalidatesCredentials,
    requiresAnotherActiveSuperAdmin,
    audit: {
      action,
      details: {
        fields: changedFields,
        ...(changedFields.includes("role")
          ? { previousRole: target.role, nextRole: updates.role }
          : {}),
        ...(changedFields.includes("accountKind")
          ? {
              previousAccountKind: target.accountKind,
              nextAccountKind: updates.accountKind,
            }
          : {}),
      },
    },
  };
}

export async function updateManagedUserProfile(
  input: {
    actor: UserServiceActor;
    userId: string;
    updates: UserProfileUpdateInput;
  },
  dependencies: {
    persistence: UserPersistence;
    requireActiveVenueId: RequireActiveVenueId;
    now?: () => Date;
    createId?: () => string;
  },
): Promise<User> {
  const target = requireTarget(
    await dependencies.persistence.loadUser(input.userId),
  );
  await requireActiveTargetVenue(target, dependencies.requireActiveVenueId);
  const isSelfUpdate = input.actor.id === target.id;
  if (!isSelfUpdate) assertManagedTarget(input.actor, target);

  const plan = prepareUserProfileUpdate({
    actor: input.actor,
    target,
    updates: input.updates,
    isSelfUpdate,
  });
  if (plan.requiresAnotherActiveSuperAdmin) {
    await requireAnotherActiveSuperAdmin(target, dependencies.persistence);
  }
  if (plan.changedFields.length === 0) return target;

  const now = (dependencies.now?.() ?? new Date()).toISOString();
  await dependencies.persistence.updateProfile({
    target,
    actorId: input.actor.id,
    isSelfUpdate,
    values: plan.values,
    incrementsSessionVersion: plan.incrementsSessionVersion,
    invalidatesCredentials: plan.invalidatesCredentials,
    audit: plan.audit
      ? {
          id: (dependencies.createId ?? (() => crypto.randomUUID()))(),
          action: plan.audit.action,
          details: plan.audit.details,
          createdAt: now,
        }
      : null,
  });
  return requireTarget(await dependencies.persistence.loadUser(target.id));
}

export async function createManagedUser(
  input: { actor: UserServiceActor; params: ManagedUserCreateInput },
  dependencies: {
    persistence: UserPersistence;
    requireActiveVenueId: RequireActiveVenueId;
    prepareAccountInvitation(input: {
      venueId: string;
      preferredLocale: User["preferredLocale"];
    }): Promise<PreparedManagedUserInvitation>;
    now?: () => Date;
    createId?: () => string;
  },
): Promise<ManagedUserCreateResult> {
  if (input.actor.role !== "super_admin" && input.actor.role !== "venue_admin") {
    throw new UserOperationError("FORBIDDEN");
  }
  const venueId =
    input.actor.role === "super_admin"
      ? input.params.venueId ?? null
      : input.actor.venueId;
  if (!venueId) throw new UserOperationError("FORBIDDEN");
  await dependencies.requireActiveVenueId(venueId);

  if (
    !isRole(input.params.role) ||
    input.params.role === "super_admin" ||
    (input.actor.role !== "super_admin" &&
      !isVenueManagedRole(input.params.role))
  ) {
    throw new UserOperationError("INVALID_ROLE");
  }
  const accountKind = input.params.accountKind ?? "personal";
  const doorAccessEnabled = input.params.doorAccessEnabled ?? false;
  if (!isAccountKind(accountKind)) {
    throw new UserOperationError("INVALID_INPUT");
  }
  if (accountKind === "shared" && input.params.role !== "staff") {
    throw new UserOperationError("INVALID_ROLE");
  }
  if (accountKind === "personal" && doorAccessEnabled) {
    throw new UserOperationError("INVALID_INPUT");
  }

  const email = input.params.email.trim().toLowerCase();
  const name = input.params.name.trim();
  if (!email || !name || name.length > 100) {
    throw new UserOperationError("INVALID_INPUT");
  }
  if (
    input.params.guestLimit !== undefined &&
    input.params.guestLimit !== null &&
    (!Number.isInteger(input.params.guestLimit) ||
      input.params.guestLimit < 0 ||
      input.params.guestLimit > 999)
  ) {
    throw new UserOperationError("INVALID_INPUT");
  }
  if (await dependencies.persistence.hasEmail(email)) {
    throw new UserOperationError("EMAIL_ALREADY_EXISTS");
  }

  const preferredLocale = isLocale(input.params.preferredLocale)
    ? input.params.preferredLocale
    : null;
  const prepared = await dependencies.prepareAccountInvitation({
    venueId,
    preferredLocale,
  });
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const id = createId();
  const createdAt = (dependencies.now?.() ?? new Date()).toISOString();
  await dependencies.persistence.createUser({
    user: {
      id,
      email,
      name,
      role: input.params.role,
      accountKind,
      doorAccessEnabled,
      venueId,
      guestLimit: input.params.guestLimit ?? null,
      passwordHash: prepared.passwordHash,
      preferredLocale,
      createdAt,
    },
    invitation: prepared.invitation,
    audit: {
      id: createId(),
      actorUserId: input.actor.id,
      details: {
        role: input.params.role,
        accountKind,
        doorAccessEnabled,
        setupMethod: "invitation_link",
        invitationExpiresAt: prepared.invitation.expiresAt,
      },
    },
  });
  return {
    id,
    invitationUrl: prepared.invitation.url,
    expiresAt: prepared.invitation.expiresAt,
  };
}

export async function loadManagedUserForCredentialOperation(
  input: { actor: UserServiceActor; userId: string },
  dependencies: {
    persistence: UserPersistence;
    requireActiveVenueId: RequireActiveVenueId;
  },
): Promise<User> {
  const target = requireTarget(
    await dependencies.persistence.loadUser(input.userId),
  );
  await requireActiveTargetVenue(target, dependencies.requireActiveVenueId);
  assertManagedTarget(input.actor, target);
  if (!target.active) throw new UserOperationError("USER_INACTIVE");
  return target;
}

export async function deleteManagedUser(
  input: { actor: UserServiceActor; userId: string },
  dependencies: {
    persistence: UserPersistence;
    requireActiveVenueId: RequireActiveVenueId;
    createDeletedPasswordHash: () => Promise<string>;
    now?: () => Date;
    createId?: () => string;
  },
): Promise<void> {
  const target = requireTarget(
    await dependencies.persistence.loadUser(input.userId),
  );
  await requireActiveTargetVenue(target, dependencies.requireActiveVenueId);
  assertManagedTarget(input.actor, target);
  if (target.active) {
    throw new UserOperationError("USER_MUST_BE_INACTIVE");
  }
  await requireAnotherActiveSuperAdmin(target, dependencies.persistence);

  await dependencies.persistence.deleteUser({
    target,
    actorUserId: input.actor.id,
    passwordHash: await dependencies.createDeletedPasswordHash(),
    tombstoneEmail: `deleted+${target.id}@deleted.invalid`,
    deletedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    auditId: (dependencies.createId ?? (() => crypto.randomUUID()))(),
  });
}
