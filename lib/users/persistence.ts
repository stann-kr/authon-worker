import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";

import { getDb } from "../db/client";
import {
  passwordResetRequests,
  passwordResetTokens,
  userAuditEvents,
  users,
} from "../db/schema";
import { isLocale } from "@/i18n/config";
import { isAccountKind, isRole, type Role } from "./policy";
import { UserOperationError } from "./errors";
import type { User, UserAuditEvent, UserDirectoryEntry } from "./types";

const managedUserFields = {
  id: users.id,
  venueId: users.venueId,
  email: users.email,
  name: users.name,
  role: users.role,
  accountKind: users.accountKind,
  doorAccessEnabled: users.doorAccessEnabled,
  guestLimit: users.guestLimit,
  active: users.active,
  migrationStatus: users.migrationStatus,
  preferredLocale: users.preferredLocale,
  passwordSetAt: users.passwordSetAt,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
  deletedAt: users.deletedAt,
};

function toUser(row: {
  id: string;
  venueId: string | null;
  email: string;
  name: string;
  role: string;
  accountKind: string;
  doorAccessEnabled: boolean;
  guestLimit: number | null;
  active: boolean;
  migrationStatus: string;
  preferredLocale: string | null;
  passwordSetAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  deletedAt: string | null;
}): User {
  if (!isRole(row.role)) throw new UserOperationError("INVALID_ROLE");
  if (!isAccountKind(row.accountKind)) {
    throw new UserOperationError("INVALID_INPUT");
  }
  if (
    row.migrationStatus !== "native" &&
    row.migrationStatus !== "pending_reset" &&
    row.migrationStatus !== "active"
  ) {
    throw new UserOperationError("INVALID_INPUT");
  }

  return {
    ...row,
    role: row.role,
    accountKind: row.accountKind,
    migrationStatus: row.migrationStatus,
    preferredLocale: isLocale(row.preferredLocale) ? row.preferredLocale : null,
  };
}

function parseAuditDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface UserProfileMutationValues {
  name?: string;
  guestLimit?: number | null;
  active?: boolean;
  role?: Role;
  accountKind?: User["accountKind"];
  doorAccessEnabled?: boolean;
}

export interface UserPersistence {
  listDirectory(input: {
    venueId: string | null;
    excludeSuperAdmins: boolean;
  }): Promise<UserDirectoryEntry[]>;
  listManaged(input: {
    venueId: string | null;
    roles: readonly Role[] | null;
  }): Promise<User[]>;
  listAuditEvents(venueId: string | null): Promise<UserAuditEvent[]>;
  loadUser(userId: string): Promise<User | null>;
  hasEmail(email: string): Promise<boolean>;
  hasAnotherActiveSuperAdmin(targetId: string): Promise<boolean>;
  updateProfile(input: {
    target: User;
    actorId: string;
    isSelfUpdate: boolean;
    values: UserProfileMutationValues;
    incrementsSessionVersion: boolean;
    invalidatesCredentials: boolean;
    audit: {
      id: string;
      action: string;
      details: Record<string, unknown>;
      createdAt: string;
    } | null;
  }): Promise<void>;
  createUser(input: {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      accountKind: User["accountKind"];
      doorAccessEnabled: boolean;
      venueId: string;
      guestLimit: number | null;
      passwordHash: string;
      preferredLocale: User["preferredLocale"];
      createdAt: string;
    };
    invitation: {
      id: string;
      tokenHash: string;
      expiresAt: string;
    };
    audit: {
      id: string;
      actorUserId: string;
      details: Record<string, unknown>;
    };
  }): Promise<void>;
  deleteUser(input: {
    target: User;
    actorUserId: string;
    passwordHash: string;
    tombstoneEmail: string;
    deletedAt: string;
    auditId: string;
  }): Promise<void>;
}

export function isUserEmailUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed: users.email")
  );
}

export function createUserPersistence(): UserPersistence {
  const db = getDb();

  return {
    async listDirectory({ venueId, excludeSuperAdmins }) {
      let query = db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          accountKind: users.accountKind,
          doorAccessEnabled: users.doorAccessEnabled,
        })
        .from(users)
        .$dynamic();

      if (venueId && excludeSuperAdmins) {
        query = query.where(
          and(eq(users.venueId, venueId), ne(users.role, "super_admin")),
        );
      } else if (venueId) {
        query = query.where(eq(users.venueId, venueId));
      } else if (excludeSuperAdmins) {
        query = query.where(ne(users.role, "super_admin"));
      }

      const rows = await query.orderBy(asc(users.name));
      return rows.map((row) => {
        if (!isRole(row.role) || !isAccountKind(row.accountKind)) {
          throw new UserOperationError("INVALID_ROLE");
        }
        return { ...row, role: row.role, accountKind: row.accountKind };
      });
    },

    async listManaged({ venueId, roles }) {
      let query = db.select(managedUserFields).from(users).$dynamic();
      if (venueId && roles) {
        query = query.where(
          and(eq(users.venueId, venueId), inArray(users.role, [...roles])),
        );
      } else if (venueId) {
        query = query.where(eq(users.venueId, venueId));
      } else if (roles) {
        query = query.where(inArray(users.role, [...roles]));
      }

      const rows = await query.orderBy(asc(users.name));
      return rows.map(toUser);
    },

    async listAuditEvents(venueId) {
      let query = db.select().from(userAuditEvents).$dynamic();
      if (venueId) query = query.where(eq(userAuditEvents.venueId, venueId));

      const rows = await query.orderBy(desc(userAuditEvents.createdAt)).limit(50);
      return rows.map((event) => ({
        ...event,
        details: parseAuditDetails(event.details),
      }));
    },

    async loadUser(userId) {
      const [row] = await db
        .select(managedUserFields)
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row ? toUser(row) : null;
    },

    async hasEmail(email) {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return Boolean(row);
    },

    async hasAnotherActiveSuperAdmin(targetId) {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, "super_admin"),
            eq(users.active, true),
            isNull(users.deletedAt),
            ne(users.id, targetId),
          ),
        )
        .limit(1);
      return Boolean(row);
    },

    async updateProfile({
      target,
      actorId,
      isSelfUpdate,
      values,
      incrementsSessionVersion,
      invalidatesCredentials,
      audit,
    }) {
      const dbUpdates: Partial<
        Omit<typeof users.$inferInsert, "sessionVersion">
      > & { sessionVersion?: number | SQL } = { ...values };
      if (incrementsSessionVersion) {
        dbUpdates.sessionVersion = sql`${users.sessionVersion} + 1`;
      }
      const updateStatement = db
        .update(users)
        .set(dbUpdates)
        .where(eq(users.id, target.id));

      if (isSelfUpdate || !audit) {
        await updateStatement;
        return;
      }

      const auditStatement = db.insert(userAuditEvents).values({
        id: audit.id,
        venueId: target.venueId,
        actorUserId: actorId,
        targetUserId: target.id,
        action: audit.action,
        details: JSON.stringify(audit.details),
        createdAt: audit.createdAt,
      });
      if (!invalidatesCredentials) {
        await db.batch([updateStatement, auditStatement]);
        return;
      }

      // Account/session policy and credential revocation must commit together.
      await db.batch([
        updateStatement,
        db
          .update(passwordResetRequests)
          .set({ status: "cancelled", updatedAt: audit.createdAt })
          .where(
            and(
              eq(passwordResetRequests.userId, target.id),
              sql`${passwordResetRequests.status} IN ('pending', 'approved')`,
            ),
          ),
        db
          .update(passwordResetTokens)
          .set({ used: true })
          .where(eq(passwordResetTokens.userId, target.id)),
        auditStatement,
      ]);
    },

    async createUser({ user, invitation, audit }) {
      await db.batch([
        db.insert(users).values({
          ...user,
          active: true,
          migrationStatus: "pending_reset",
          passwordSetAt: null,
        }),
        db.insert(passwordResetTokens).values({
          id: invitation.id,
          userId: user.id,
          token: invitation.tokenHash,
          expiresAt: invitation.expiresAt,
          used: false,
          createdAt: user.createdAt,
        }),
        db.insert(userAuditEvents).values({
          id: audit.id,
          venueId: user.venueId,
          actorUserId: audit.actorUserId,
          targetUserId: user.id,
          action: "created",
          details: JSON.stringify(audit.details),
          createdAt: user.createdAt,
        }),
      ]);
    },

    async deleteUser({
      target,
      actorUserId,
      passwordHash,
      tombstoneEmail,
      deletedAt,
      auditId,
    }) {
      await db.batch([
        db
          .update(users)
          .set({
            legacyAuthUserId: null,
            email: tombstoneEmail,
            passwordHash,
            name: "Deleted user",
            accountKind: "personal",
            doorAccessEnabled: false,
            guestLimit: null,
            active: false,
            sessionVersion: sql`${users.sessionVersion} + 1`,
            migrationStatus: "active",
            passwordSetAt: null,
            preferredLocale: null,
            lastLoginAt: null,
            deletedAt,
            deletedBy: actorUserId,
          })
          .where(eq(users.id, target.id)),
        db
          .update(passwordResetTokens)
          .set({ used: true })
          .where(eq(passwordResetTokens.userId, target.id)),
        db
          .update(passwordResetRequests)
          .set({ status: "cancelled", updatedAt: deletedAt })
          .where(
            and(
              eq(passwordResetRequests.userId, target.id),
              sql`${passwordResetRequests.status} IN ('pending', 'approved')`,
            ),
          ),
        db.insert(userAuditEvents).values({
          id: auditId,
          venueId: target.venueId,
          actorUserId,
          targetUserId: target.id,
          action: "deleted",
          details: JSON.stringify({
            previousRole: target.role,
            personalDataRemoved: true,
          }),
          createdAt: deletedAt,
        }),
      ]);
    },
  };
}
