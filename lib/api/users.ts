"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  passwordResetRequests,
  passwordResetTokens,
  userAuditEvents,
  users,
} from "../db/schema";
import {
  type User,
  type UserAuditEvent,
  type UserDirectoryEntry,
  type ApiResponse,
} from "./types";
import { hashPassword } from "../auth/password";
import { requireAuth, requireRole, type Role } from "../auth/server";
import { getDb } from "../db/client";
import { escapeHtml, isEmailConfigured, sendEmail } from "./email";
import { generateResetToken, hashResetToken } from "../auth/token";
import { getPasswordPolicyError } from "../auth/password-policy";
import { getVenueDeliveryContext } from "../tenant/server";
import { isLocale, type Locale } from "@/i18n/config";
import { getTranslations } from "next-intl/server";
import {
  canManageTargetAccount,
  canManageTargetRole,
  isAccountKind,
  isRole,
  isVenueManagedRole,
  VENUE_MANAGED_ROLES,
  type AccountKind,
} from "@/lib/users/policy";

type UserActionErrorCode =
  | "CANNOT_MANAGE_SELF"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_ROLE"
  | "LAST_SUPER_ADMIN"
  | "USER_DELETED"
  | "USER_INACTIVE"
  | "USER_MUST_BE_INACTIVE"
  | "USER_NOT_FOUND"
  | "UPDATE_FAILED";

class UserActionError extends Error {
  constructor(readonly code: UserActionErrorCode) {
    super(code);
  }
}

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
  if (!isRole(row.role)) throw new UserActionError("INVALID_ROLE");
  if (!isAccountKind(row.accountKind)) throw new UserActionError("INVALID_INPUT");
  if (
    row.migrationStatus !== "native" &&
    row.migrationStatus !== "pending_reset" &&
    row.migrationStatus !== "active"
  ) {
    throw new UserActionError("INVALID_INPUT");
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

function getUserActionError(error: unknown, fallback: UserActionErrorCode): string {
  return error instanceof UserActionError ? error.code : fallback;
}

async function getTargetUser(userId: string) {
  const db = getDb();
  const [target] = await db
    .select(managedUserFields)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) throw new UserActionError("USER_NOT_FOUND");
  return toUser(target);
}

function assertManagedTarget(
  actor: Awaited<ReturnType<typeof requireAuth>>,
  target: User,
): void {
  if (actor.id === target.id) throw new UserActionError("CANNOT_MANAGE_SELF");
  if (target.deletedAt) throw new UserActionError("USER_DELETED");
  if (!canManageTargetAccount(actor, target)) {
    throw new UserActionError("FORBIDDEN");
  }
}

async function assertAnotherActiveSuperAdmin(targetId: string): Promise<void> {
  const db = getDb();
  const [remaining] = await db
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

  if (!remaining) throw new UserActionError("LAST_SUPER_ADMIN");
}

export async function fetchUsersByVenue(
  venueId?: string | null,
): Promise<ApiResponse<UserDirectoryEntry[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
    const db = getDb();
    const effectiveVenueId = actor.role === "super_admin" ? venueId : actor.venueId;

    if (actor.role !== "super_admin" && !effectiveVenueId) {
      throw new UserActionError("FORBIDDEN");
    }

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

    if (actor.role === "super_admin") {
      if (effectiveVenueId) query = query.where(eq(users.venueId, effectiveVenueId));
    } else {
      query = query.where(
        and(eq(users.venueId, effectiveVenueId!), ne(users.role, "super_admin")),
      );
    }

    const result = await query.orderBy(asc(users.name));
    return {
      data: result.map((user) => {
        if (!isRole(user.role) || !isAccountKind(user.accountKind)) {
          throw new UserActionError("INVALID_ROLE");
        }
        return { ...user, role: user.role, accountKind: user.accountKind };
      }),
      error: null,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch user directory:", error);
    return { data: null, error: "Unable to load users right now." };
  }
}

export async function fetchManagedUsersByVenue(
  venueId?: string | null,
): Promise<ApiResponse<User[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const db = getDb();
    const effectiveVenueId = actor.role === "super_admin" ? venueId : actor.venueId;

    if (actor.role !== "super_admin" && !effectiveVenueId) {
      throw new UserActionError("FORBIDDEN");
    }

    let query = db.select(managedUserFields).from(users).$dynamic();
    if (actor.role === "super_admin") {
      if (effectiveVenueId) query = query.where(eq(users.venueId, effectiveVenueId));
    } else {
      query = query.where(
        and(
          eq(users.venueId, effectiveVenueId!),
          inArray(users.role, VENUE_MANAGED_ROLES),
        ),
      );
    }

    const result = await query.orderBy(asc(users.name));
    return { data: result.map(toUser), error: null };
  } catch (error: unknown) {
    console.error("Failed to fetch managed users:", error);
    return { data: null, error: "Unable to load users right now." };
  }
}

export async function fetchUserAuditEvents(
  venueId?: string | null,
): Promise<ApiResponse<UserAuditEvent[]>> {
  try {
    await requireRole(["super_admin"]);
    const db = getDb();

    let query = db.select().from(userAuditEvents).$dynamic();
    if (venueId) {
      query = query.where(eq(userAuditEvents.venueId, venueId));
    }

    const result = await query.orderBy(desc(userAuditEvents.createdAt)).limit(50);
    return {
      data: result.map((event) => ({
        ...event,
        details: parseAuditDetails(event.details),
      })),
      error: null,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch user audit events:", error);
    return { data: null, error: "Unable to load user activity right now." };
  }
}

export async function updateUserProfile(
  userId: string,
  updates: {
    name?: string;
    guestLimit?: number | null;
    active?: boolean;
    role?: Role;
    accountKind?: AccountKind;
    doorAccessEnabled?: boolean;
  },
): Promise<ApiResponse<User>> {
  try {
    const actor = await requireAuth();
    const isSelfUpdate = actor.id === userId;
    const db = getDb();
    const target = await getTargetUser(userId);

    if (isSelfUpdate) {
      if (
        updates.guestLimit !== undefined ||
        updates.active !== undefined ||
        updates.role !== undefined ||
        updates.accountKind !== undefined ||
        updates.doorAccessEnabled !== undefined
      ) {
        throw new UserActionError("CANNOT_MANAGE_SELF");
      }
    } else {
      assertManagedTarget(actor, target);
    }

    const dbUpdates: Partial<Omit<typeof users.$inferInsert, "sessionVersion">> & {
      sessionVersion?: number | SQL;
    } = {};
    const changedFields: string[] = [];

    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name || name.length > 100) throw new UserActionError("INVALID_INPUT");
      if (name !== target.name) {
        dbUpdates.name = name;
        changedFields.push("name");
      }
    }

    if (updates.guestLimit !== undefined) {
      if (isSelfUpdate) throw new UserActionError("CANNOT_MANAGE_SELF");
      if (
        updates.guestLimit !== null &&
        (!Number.isInteger(updates.guestLimit) || updates.guestLimit < 0 || updates.guestLimit > 999)
      ) {
        throw new UserActionError("INVALID_INPUT");
      }
      if (updates.guestLimit !== target.guestLimit) {
        dbUpdates.guestLimit = updates.guestLimit;
        changedFields.push("guestLimit");
      }
    }

    if (updates.role !== undefined) {
      if (!isRole(updates.role) || !canManageTargetRole(actor.role, target.role, updates.role)) {
        throw new UserActionError("INVALID_ROLE");
      }
      if (updates.role !== target.role) {
        dbUpdates.role = updates.role;
        dbUpdates.sessionVersion = sql`${users.sessionVersion} + 1`;
        changedFields.push("role");
      }
    }

    const nextRole = updates.role ?? target.role;
    const nextAccountKind = updates.accountKind ?? target.accountKind;
    const nextDoorAccessEnabled = updates.doorAccessEnabled ?? target.doorAccessEnabled;

    if (!isAccountKind(nextAccountKind)) throw new UserActionError("INVALID_INPUT");
    if (nextAccountKind === "shared" && nextRole !== "staff") {
      throw new UserActionError("INVALID_ROLE");
    }
    if (nextAccountKind === "personal" && nextDoorAccessEnabled) {
      throw new UserActionError("INVALID_INPUT");
    }

    if (updates.accountKind !== undefined && updates.accountKind !== target.accountKind) {
      dbUpdates.accountKind = updates.accountKind;
      dbUpdates.sessionVersion = sql`${users.sessionVersion} + 1`;
      changedFields.push("accountKind");
    }

    if (
      updates.doorAccessEnabled !== undefined &&
      updates.doorAccessEnabled !== target.doorAccessEnabled
    ) {
      dbUpdates.doorAccessEnabled = updates.doorAccessEnabled;
      dbUpdates.sessionVersion = sql`${users.sessionVersion} + 1`;
      changedFields.push("doorAccessEnabled");
    }

    if (updates.active !== undefined && updates.active !== target.active) {
      if (isSelfUpdate) throw new UserActionError("CANNOT_MANAGE_SELF");
      if (!updates.active && target.role === "super_admin") {
        await assertAnotherActiveSuperAdmin(target.id);
      }
      dbUpdates.active = updates.active;
      dbUpdates.sessionVersion = sql`${users.sessionVersion} + 1`;
      changedFields.push("active");
    }

    if (changedFields.length === 0) return { data: target, error: null };

    const updateStatement = db.update(users).set(dbUpdates).where(eq(users.id, userId));

    if (!isSelfUpdate) {
      const nowIso = new Date().toISOString();
      const action =
        changedFields.length === 1 && changedFields[0] === "role"
          ? "role_changed"
          : changedFields.length === 1 && changedFields[0] === "active"
            ? updates.active
              ? "reactivated"
              : "deactivated"
            : "user_updated";
      const details = JSON.stringify({
        fields: changedFields,
        ...(changedFields.includes("role")
          ? { previousRole: target.role, nextRole: updates.role }
          : {}),
        ...(changedFields.includes("accountKind")
          ? { previousAccountKind: target.accountKind, nextAccountKind: updates.accountKind }
          : {}),
      });

      const auditStatement = db.insert(userAuditEvents).values({
        id: crypto.randomUUID(),
        venueId: target.venueId,
        actorUserId: actor.id,
        targetUserId: target.id,
        action,
        details,
        createdAt: nowIso,
      });
      const invalidatesResetGrants =
        changedFields.includes("role") ||
        changedFields.includes("accountKind") ||
        (changedFields.includes("active") && updates.active === false);
      if (invalidatesResetGrants) {
        await db.batch([
          updateStatement,
          db
            .update(passwordResetRequests)
            .set({ status: "cancelled", updatedAt: nowIso })
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
      } else {
        await db.batch([updateStatement, auditStatement]);
      }
    } else {
      await updateStatement;
    }

    return { data: await getTargetUser(userId), error: null };
  } catch (error: unknown) {
    console.error("Failed to update user:", error);
    return { data: null, error: getUserActionError(error, "UPDATE_FAILED") };
  }
}

export async function createUserViaEdge(params: {
  email: string;
  name: string;
  role: Role;
  venueId?: string | null;
  guestLimit?: number | null;
  password?: string;
  preferredLocale?: Locale | null;
  accountKind?: AccountKind;
  doorAccessEnabled?: boolean;
}): Promise<ApiResponse<{ id: string }>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);

    if (!params.password) return { data: null, error: "INVALID_INPUT" };

    const passwordPolicyError = getPasswordPolicyError(params.password);
    if (passwordPolicyError) {
      return { data: null, error: "INVALID_INPUT" };
    }

    const venueId = actor.role === "super_admin" ? params.venueId || null : actor.venueId;
    if (!venueId) {
      throw new UserActionError("FORBIDDEN");
    }

    if (
      !isRole(params.role) ||
      params.role === "super_admin" ||
      (actor.role !== "super_admin" && !isVenueManagedRole(params.role))
    ) {
      throw new UserActionError("INVALID_ROLE");
    }

    const accountKind = params.accountKind ?? "personal";
    const doorAccessEnabled = params.doorAccessEnabled ?? false;
    if (!isAccountKind(accountKind)) throw new UserActionError("INVALID_INPUT");
    if (accountKind === "shared" && params.role !== "staff") {
      throw new UserActionError("INVALID_ROLE");
    }
    if (accountKind === "personal" && doorAccessEnabled) {
      throw new UserActionError("INVALID_INPUT");
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(params.password);
    const normalizedEmail = params.email.trim().toLowerCase();
    const name = params.name.trim();
    if (!normalizedEmail || !name || name.length > 100) {
      throw new UserActionError("INVALID_INPUT");
    }
    if (
      params.guestLimit !== undefined &&
      params.guestLimit !== null &&
      (!Number.isInteger(params.guestLimit) || params.guestLimit < 0 || params.guestLimit > 999)
    ) {
      throw new UserActionError("INVALID_INPUT");
    }
    const nowIso = new Date().toISOString();

    await db.batch([
      db.insert(users).values({
        id,
        email: normalizedEmail,
        name,
        role: params.role,
        accountKind,
        doorAccessEnabled,
        venueId,
        guestLimit: params.guestLimit ?? null,
        passwordHash,
        active: true,
        migrationStatus: "pending_reset",
        passwordSetAt: null,
        preferredLocale: isLocale(params.preferredLocale) ? params.preferredLocale : null,
        createdAt: nowIso,
      }),
      db.insert(userAuditEvents).values({
        id: crypto.randomUUID(),
        venueId,
        actorUserId: actor.id,
        targetUserId: id,
        action: "created",
        details: JSON.stringify({ role: params.role, accountKind, doorAccessEnabled }),
        createdAt: nowIso,
      }),
    ]);

    return { data: { id }, error: null };
  } catch (error: unknown) {
    console.error("Failed to create user:", error);
    return { data: null, error: getUserActionError(error, "UPDATE_FAILED") };
  }
}

export async function deleteUserViaEdge(userId: string): Promise<{ error: string | null }> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const target = await getTargetUser(userId);
    assertManagedTarget(actor, target);
    if (target.active) throw new UserActionError("USER_MUST_BE_INACTIVE");
    if (target.role === "super_admin") await assertAnotherActiveSuperAdmin(target.id);

    const db = getDb();
    const deletedAt = new Date().toISOString();
    const passwordHash = await hashPassword(crypto.randomUUID());
    const tombstoneEmail = `deleted+${target.id}@deleted.invalid`;

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
          deletedBy: actor.id,
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
        id: crypto.randomUUID(),
        venueId: target.venueId,
        actorUserId: actor.id,
        targetUserId: target.id,
        action: "deleted",
        details: JSON.stringify({ previousRole: target.role, personalDataRemoved: true }),
        createdAt: deletedAt,
      }),
    ]);

    return { error: null };
  } catch (error: unknown) {
    console.error("Failed to delete user:", error);
    return { error: getUserActionError(error, "UPDATE_FAILED") };
  }
}

export async function resendInvitationViaEdge(userId: string): Promise<{ error: string | null }> {
  try {
    const { env } = getCloudflareContext();
    const actor = await requireRole(["super_admin", "venue_admin"]);
    const user = await getTargetUser(userId);
    assertManagedTarget(actor, user);
    if (!user.active) throw new UserActionError("USER_INACTIVE");

    if (!isEmailConfigured(env)) {
      return {
        error:
          "Email invitations are unavailable until the mail service is configured.",
      };
    }

    const db = getDb();

    const token = generateResetToken();
    const tokenHash = await hashResetToken(token);
    const resetTokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    await db.insert(passwordResetTokens).values({
      id: resetTokenId,
      userId,
      token: tokenHash,
      expiresAt,
      // 이메일 전송이 성공하기 전에는 새 링크를 활성화하지 않는다.
      used: true,
      createdAt: new Date().toISOString(),
    });

    const delivery = await getVenueDeliveryContext(user.venueId, env.NEXT_PUBLIC_APP_URL);
    const emailLocale = isLocale(user.preferredLocale)
      ? user.preferredLocale
      : delivery.defaultLocale;
    const t = await getTranslations({ locale: emailLocale, namespace: "Email" });
    const resetLink = `${delivery.baseUrl}/auth/reset-password?token=${token}&lang=${emailLocale}`;
    const safeResetLink = escapeHtml(resetLink);

    try {
      await sendEmail({
        to: user.email,
        subject: t("inviteSubject", { brand: delivery.brand.name }),
        body: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>${escapeHtml(t("inviteHeading"))}</h2>
          <p>${escapeHtml(t("greeting", { name: user.name }))}</p>
          <p>${escapeHtml(t("inviteInstructions"))}</p>
          <div style="margin: 30px 0;">
            <a href="${safeResetLink}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px;">${escapeHtml(t("setPasswordButton"))}</a>
          </div>
          <p>${escapeHtml(t("inviteExpiry"))}</p>
          <p style="color: #666; font-size: 12px; margin-top: 40px;">${escapeHtml(t("noReply"))}</p>
        </div>
        `,
      });
    } catch (error) {
      await db
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.id, resetTokenId));
      throw error;
    }

    // 재발송이 성공하면 이전 링크를 모두 폐기하고 방금 보낸 링크 하나만
    // 활성화한다. D1 batch 실패 시 두 변경은 함께 rollback된다.
    await db.batch([
      db
        .update(passwordResetTokens)
        .set({ used: true })
        .where(eq(passwordResetTokens.userId, userId)),
      db
        .update(passwordResetTokens)
        .set({ used: false })
        .where(eq(passwordResetTokens.id, resetTokenId)),
    ]);

    return { error: null };
  } catch (error: unknown) {
    console.error("Resend invitation error:", error);
    return { error: "Unable to resend invitation right now." };
  }
}
