import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database, D1Result } from "@cloudflare/workers-types";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  userAuditEvents,
  users,
} from "../db/schema.ts";
import { isLocale } from "../../i18n/config.ts";
import { isAccountKind, isRole, type Role } from "./policy.ts";
import { UserOperationError } from "./errors.ts";
import type { User, UserAuditEvent, UserDirectoryEntry } from "./types.ts";

const UPDATE_PROFILE_CAS_SQL = `
  UPDATE users
  SET
    name = CASE WHEN ? = 1 THEN ? ELSE name END,
    guest_limit = CASE WHEN ? = 1 THEN ? ELSE guest_limit END,
    active = CASE WHEN ? = 1 THEN ? ELSE active END,
    role = CASE WHEN ? = 1 THEN ? ELSE role END,
    account_kind = CASE WHEN ? = 1 THEN ? ELSE account_kind END,
    door_access_enabled = CASE WHEN ? = 1 THEN ? ELSE door_access_enabled END,
    session_version = session_version + ?
  WHERE id = ?
    AND venue_id IS ?
    AND name = ?
    AND role = ?
    AND account_kind = ?
    AND door_access_enabled = ?
    AND guest_limit IS ?
    AND active = ?
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM users mutation_actor
      WHERE mutation_actor.id = ?
        AND mutation_actor.role = ?
        AND mutation_actor.venue_id IS ?
        AND mutation_actor.session_version = ?
        AND mutation_actor.active = 1
        AND mutation_actor.deleted_at IS NULL
        AND (
          mutation_actor.role = 'super_admin'
          OR EXISTS (
            SELECT 1
            FROM venues actor_venue
            WHERE actor_venue.id = mutation_actor.venue_id
              AND actor_venue.active = 1
          )
        )
        AND (
          (? = 1 AND mutation_actor.id = users.id)
          OR (
            ? = 0
            AND mutation_actor.id <> users.id
            AND (
              mutation_actor.role = 'super_admin'
              OR (
                mutation_actor.role = 'venue_admin'
                AND mutation_actor.venue_id = users.venue_id
                AND users.role IN ('door_staff', 'staff', 'dj')
              )
            )
          )
        )
    )
    AND (
      users.role = 'super_admin'
      OR EXISTS (
        SELECT 1
        FROM venues target_venue
        WHERE target_venue.id = users.venue_id
          AND target_venue.active = 1
      )
    )
    AND (
      ? = 0
      OR users.role <> 'super_admin'
      OR EXISTS (
        SELECT 1
        FROM users other_super_admin
        WHERE other_super_admin.role = 'super_admin'
          AND other_super_admin.active = 1
          AND other_super_admin.deleted_at IS NULL
          AND other_super_admin.id <> users.id
      )
    )
  RETURNING id
`;

const INSERT_PROFILE_AUDIT_AFTER_CAS_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, venue_id, ?, id, ?, ?, ?
  FROM users
  WHERE id = ?
    AND changes() = 1
  RETURNING target_user_id
`;

const INVALIDATE_RESET_TOKENS_AFTER_USER_AUDIT_SQL = `
  UPDATE password_reset_tokens
  SET used = 1
  WHERE user_id = ?
    AND EXISTS (
      SELECT 1
      FROM user_audit_events
      WHERE id = ?
        AND actor_user_id = ?
        AND target_user_id = ?
        AND action = ?
        AND created_at = ?
    )
`;

const CANCEL_RESET_REQUESTS_AFTER_USER_AUDIT_SQL = `
  UPDATE password_reset_requests
  SET status = 'cancelled', updated_at = ?
  WHERE user_id = ?
    AND status IN ('pending', 'approved')
    AND EXISTS (
      SELECT 1
      FROM user_audit_events
      WHERE id = ?
        AND actor_user_id = ?
        AND target_user_id = ?
        AND action = ?
        AND created_at = ?
    )
`;

const DELETE_USER_CAS_SQL = `
  UPDATE users
  SET
    legacy_auth_user_id = NULL,
    email = ?,
    password_hash = ?,
    name = 'Deleted user',
    account_kind = 'personal',
    door_access_enabled = 0,
    guest_limit = NULL,
    active = 0,
    session_version = session_version + 1,
    migration_status = 'active',
    password_set_at = NULL,
    preferred_locale = NULL,
    last_login_at = NULL,
    deleted_at = ?,
    deleted_by = ?
  WHERE id = ?
    AND venue_id IS ?
    AND email = ?
    AND name = ?
    AND role = ?
    AND account_kind = ?
    AND door_access_enabled = ?
    AND guest_limit IS ?
    AND active = 0
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM users mutation_actor
      WHERE mutation_actor.id = ?
        AND mutation_actor.role = ?
        AND mutation_actor.venue_id IS ?
        AND mutation_actor.session_version = ?
        AND mutation_actor.active = 1
        AND mutation_actor.deleted_at IS NULL
        AND mutation_actor.id <> users.id
        AND (
          mutation_actor.role = 'super_admin'
          OR (
            mutation_actor.role = 'venue_admin'
            AND mutation_actor.venue_id = users.venue_id
            AND users.role IN ('door_staff', 'staff', 'dj')
            AND EXISTS (
              SELECT 1
              FROM venues actor_venue
              WHERE actor_venue.id = mutation_actor.venue_id
                AND actor_venue.active = 1
            )
          )
        )
    )
    AND (
      users.role = 'super_admin'
      OR EXISTS (
        SELECT 1
        FROM venues target_venue
        WHERE target_venue.id = users.venue_id
          AND target_venue.active = 1
      )
    )
    AND (
      users.role <> 'super_admin'
      OR EXISTS (
        SELECT 1
        FROM users other_super_admin
        WHERE other_super_admin.role = 'super_admin'
          AND other_super_admin.active = 1
          AND other_super_admin.deleted_at IS NULL
          AND other_super_admin.id <> users.id
      )
    )
  RETURNING id
`;

const INSERT_DELETE_AUDIT_AFTER_CAS_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, venue_id, ?, id, 'deleted', ?, ?
  FROM users
  WHERE id = ?
    AND deleted_at = ?
    AND changes() = 1
  RETURNING target_user_id
`;

const INSERT_MANAGED_USER_GUARDED_SQL = `
  INSERT INTO users (
    id, email, password_hash, name, role, account_kind,
    door_access_enabled, venue_id, guest_limit, active, session_version,
    migration_status, password_set_at, preferred_locale, created_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, target_venue.id, ?, 1, 0,
         'pending_reset', NULL, ?, ?
  FROM venues target_venue
  WHERE target_venue.id = ?
    AND target_venue.active = 1
    AND EXISTS (
      SELECT 1
      FROM users mutation_actor
      WHERE mutation_actor.id = ?
        AND mutation_actor.role = ?
        AND mutation_actor.venue_id IS ?
        AND mutation_actor.session_version = ?
        AND mutation_actor.active = 1
        AND mutation_actor.deleted_at IS NULL
        AND (
          (
            mutation_actor.role = 'super_admin'
            AND ? IN ('venue_admin', 'door_staff', 'staff', 'dj')
          )
          OR (
            mutation_actor.role = 'venue_admin'
            AND mutation_actor.venue_id = target_venue.id
            AND ? IN ('door_staff', 'staff', 'dj')
          )
        )
    )
  RETURNING id
`;

const INSERT_INVITATION_AFTER_USER_CREATE_SQL = `
  INSERT INTO password_reset_tokens (
    id, user_id, token, expires_at, used, created_at
  )
  SELECT ?, id, ?, ?, 0, ?
  FROM users
  WHERE id = ?
    AND email = ?
    AND venue_id = ?
    AND created_at = ?
    AND migration_status = 'pending_reset'
    AND changes() = 1
  RETURNING id
`;

const INSERT_CREATE_AUDIT_AFTER_INVITATION_SQL = `
  INSERT INTO user_audit_events (
    id, venue_id, actor_user_id, target_user_id, action, details, created_at
  )
  SELECT ?, created_user.venue_id, ?, created_user.id, 'created', ?, ?
  FROM users created_user
  JOIN password_reset_tokens invitation
    ON invitation.id = ?
    AND invitation.user_id = created_user.id
  WHERE created_user.id = ?
    AND created_user.email = ?
    AND created_user.created_at = ?
    AND changes() = 1
  RETURNING target_user_id
`;

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

export interface UserMutationActor {
  id: string;
  role: Role;
  venueId: string | null;
  sessionVersion: number;
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
    actor: UserMutationActor;
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
  }): Promise<boolean>;
  createUser(input: {
    actor: UserMutationActor;
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
      details: Record<string, unknown>;
    };
  }): Promise<boolean>;
  deleteUser(input: {
    target: User;
    actor: UserMutationActor;
    passwordHash: string;
    tombstoneEmail: string;
    deletedAt: string;
    auditId: string;
  }): Promise<boolean>;
}

export function isUserEmailUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed: users.email")
  );
}

function hasReturnedId(result: D1Result<unknown>): boolean {
  return Boolean((result.results?.[0] as { id?: string } | undefined)?.id);
}

function presence<T>(value: T | undefined): 0 | 1 {
  return value === undefined ? 0 : 1;
}

function toSqlBoolean(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

export function createUserPersistence(
  database?: D1Database,
): UserPersistence {
  const d1 = database ?? getCloudflareContext().env.DB;
  const db = drizzle(d1);

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
      actor,
      isSelfUpdate,
      values,
      incrementsSessionVersion,
      invalidatesCredentials,
      audit,
    }) {
      const statements = [
        d1.prepare(UPDATE_PROFILE_CAS_SQL).bind(
          presence(values.name),
          values.name ?? null,
          presence(values.guestLimit),
          values.guestLimit ?? null,
          presence(values.active),
          toSqlBoolean(values.active),
          presence(values.role),
          values.role ?? null,
          presence(values.accountKind),
          values.accountKind ?? null,
          presence(values.doorAccessEnabled),
          toSqlBoolean(values.doorAccessEnabled),
          incrementsSessionVersion ? 1 : 0,
          target.id,
          target.venueId,
          target.name,
          target.role,
          target.accountKind,
          target.doorAccessEnabled ? 1 : 0,
          target.guestLimit,
          target.active ? 1 : 0,
          actor.id,
          actor.role,
          actor.venueId,
          actor.sessionVersion,
          isSelfUpdate ? 1 : 0,
          isSelfUpdate ? 1 : 0,
          values.active === false && target.role === "super_admin" ? 1 : 0,
        ),
      ];

      if (audit) {
        statements.push(
          d1.prepare(INSERT_PROFILE_AUDIT_AFTER_CAS_SQL).bind(
            audit.id,
            actor.id,
            audit.action,
            JSON.stringify(audit.details),
            audit.createdAt,
            target.id,
          ),
        );
        if (invalidatesCredentials) {
          statements.push(
            d1.prepare(CANCEL_RESET_REQUESTS_AFTER_USER_AUDIT_SQL).bind(
              audit.createdAt,
              target.id,
              audit.id,
              actor.id,
              target.id,
              audit.action,
              audit.createdAt,
            ),
            d1.prepare(INVALIDATE_RESET_TOKENS_AFTER_USER_AUDIT_SQL).bind(
              target.id,
              audit.id,
              actor.id,
              target.id,
              audit.action,
              audit.createdAt,
            ),
          );
        }
      }

      const results = await d1.batch(statements);
      return hasReturnedId(results[0]);
    },

    async createUser({ actor, user, invitation, audit }) {
      const [createResult] = await d1.batch([
        d1.prepare(INSERT_MANAGED_USER_GUARDED_SQL).bind(
          user.id,
          user.email,
          user.passwordHash,
          user.name,
          user.role,
          user.accountKind,
          user.doorAccessEnabled ? 1 : 0,
          user.guestLimit,
          user.preferredLocale,
          user.createdAt,
          user.venueId,
          actor.id,
          actor.role,
          actor.venueId,
          actor.sessionVersion,
          user.role,
          user.role,
        ),
        d1.prepare(INSERT_INVITATION_AFTER_USER_CREATE_SQL).bind(
          invitation.id,
          invitation.tokenHash,
          invitation.expiresAt,
          user.createdAt,
          user.id,
          user.email,
          user.venueId,
          user.createdAt,
        ),
        d1.prepare(INSERT_CREATE_AUDIT_AFTER_INVITATION_SQL).bind(
          audit.id,
          actor.id,
          JSON.stringify(audit.details),
          user.createdAt,
          invitation.id,
          user.id,
          user.email,
          user.createdAt,
        ),
      ]);
      return hasReturnedId(createResult);
    },

    async deleteUser({
      target,
      actor,
      passwordHash,
      tombstoneEmail,
      deletedAt,
      auditId,
    }) {
      const action = "deleted";
      const details = JSON.stringify({
        previousRole: target.role,
        personalDataRemoved: true,
      });
      const [deleteResult] = await d1.batch([
        d1.prepare(DELETE_USER_CAS_SQL).bind(
          tombstoneEmail,
          passwordHash,
          deletedAt,
          actor.id,
          target.id,
          target.venueId,
          target.email,
          target.name,
          target.role,
          target.accountKind,
          target.doorAccessEnabled ? 1 : 0,
          target.guestLimit,
          actor.id,
          actor.role,
          actor.venueId,
          actor.sessionVersion,
        ),
        d1.prepare(INSERT_DELETE_AUDIT_AFTER_CAS_SQL).bind(
          auditId,
          actor.id,
          details,
          deletedAt,
          target.id,
          deletedAt,
        ),
        d1.prepare(INVALIDATE_RESET_TOKENS_AFTER_USER_AUDIT_SQL).bind(
          target.id,
          auditId,
          actor.id,
          target.id,
          action,
          deletedAt,
        ),
        d1.prepare(CANCEL_RESET_REQUESTS_AFTER_USER_AUDIT_SQL).bind(
          deletedAt,
          target.id,
          auditId,
          actor.id,
          target.id,
          action,
          deletedAt,
        ),
      ]);
      return hasReturnedId(deleteResult);
    },
  };
}
