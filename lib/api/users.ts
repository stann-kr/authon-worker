"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq, asc } from "drizzle-orm";
import { users, passwordResetTokens } from "../db/schema";
import { type User, type ApiResponse } from "./types";
import { hashPassword } from "../auth/password";
import { requireAuth, requireRole, type Role } from "../auth/server";
import { getDb } from "../db/client";
import { escapeHtml, isEmailConfigured, sendEmail } from "./email";
import { generateResetToken, hashResetToken } from "../auth/token";
import { getPasswordPolicyError } from "../auth/password-policy";
import { getVenueDeliveryContext } from "../tenant/server";
import { isLocale, type Locale } from "@/i18n/config";
import { getTranslations } from "next-intl/server";

export async function fetchUsersByVenue(venueId?: string | null): Promise<ApiResponse<User[]>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin", "door_staff", "staff", "dj"]);
    const db = getDb();
    const effectiveVenueId = actor.role === "super_admin" ? venueId : actor.venueId;

    if (actor.role !== "super_admin" && !effectiveVenueId) {
      throw new Error("Forbidden");
    }

    let query = db.select().from(users).$dynamic();

    if (effectiveVenueId) {
      query = query.where(eq(users.venueId, effectiveVenueId));
    }

    const result = await query.orderBy(asc(users.name));
    return {
      data: result.map((user) => ({
        ...user,
        role: user.role as User["role"],
        migrationStatus: user.migrationStatus as User["migrationStatus"],
        preferredLocale: isLocale(user.preferredLocale) ? user.preferredLocale : null,
      })),
      error: null,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch users:", error);
    return { data: null, error: "Unable to load users right now." };
  }
}

export async function updateUserProfile(
  userId: string,
  updates: {
    name?: string;
    guestLimit?: number | null;
    active?: boolean;
    role?: string;
  },
): Promise<ApiResponse<User>> {
  try {
    const actor = await requireAuth();
    const isSelfUpdate = actor.id === userId;
    const isSuperAdmin = actor.role === "super_admin";
    const isVenueAdmin = actor.role === "venue_admin";

    if (!isSelfUpdate && !isSuperAdmin && !isVenueAdmin) {
      throw new Error("Forbidden");
    }

    const db = getDb();

    // venue_admin은 자신의 venue 소속 유저만 관리 가능 (venue 간 권한 침범 방지)
    if (!isSelfUpdate && isVenueAdmin) {
      const targetResult = await db.select({ venueId: users.venueId }).from(users).where(eq(users.id, userId)).limit(1);
      if (targetResult[0]?.venueId !== actor.venueId) {
        throw new Error("Forbidden");
      }
    }

    const dbUpdates: Partial<typeof users.$inferInsert> = {};

    if (updates.name !== undefined) dbUpdates.name = updates.name;

    if (isSuperAdmin || isVenueAdmin) {
      if (updates.guestLimit !== undefined) dbUpdates.guestLimit = updates.guestLimit;
      if (updates.active !== undefined) dbUpdates.active = updates.active;
    }

    // role 승격은 super_admin만 가능 (venue_admin의 권한 상승 방지)
    if (updates.role !== undefined) {
      if (!isSuperAdmin) throw new Error("Forbidden");
      dbUpdates.role = updates.role;
    }

    await db.update(users).set(dbUpdates).where(eq(users.id, userId));
    const result = await db.select().from(users).where(eq(users.id, userId));
    return {
      data: result[0]
        ? {
            ...result[0],
            role: result[0].role as User["role"],
            migrationStatus: result[0].migrationStatus as User["migrationStatus"],
            preferredLocale: isLocale(result[0].preferredLocale) ? result[0].preferredLocale : null,
          }
        : null,
      error: null,
    };
  } catch (error: unknown) {
    console.error("Failed to update user:", error);
    return { data: null, error: "Unable to update user right now." };
  }
}

export async function createUserViaEdge(params: {
  email: string;
  name: string;
  role: Role;
  venueId?: string | null;
  guestLimit?: number;
  password?: string;
  preferredLocale?: Locale | null;
}): Promise<ApiResponse<{ id: string }>> {
  try {
    const actor = await requireRole(["super_admin", "venue_admin"]);

    if (!params.password) {
      return { data: null, error: "비밀번호를 입력해주세요." };
    }

    const passwordPolicyError = getPasswordPolicyError(params.password);
    if (passwordPolicyError) {
      return { data: null, error: passwordPolicyError };
    }

    const venueId = actor.role === "super_admin" ? params.venueId || null : actor.venueId;
    if (!venueId) {
      throw new Error("Forbidden");
    }

    if (actor.role !== "super_admin" && (params.role === "super_admin" || params.role === "venue_admin")) {
      throw new Error("Forbidden");
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(params.password);

    await db.insert(users).values({
      id,
      email: params.email,
      name: params.name,
      role: params.role,
      venueId,
      guestLimit: params.guestLimit || null,
      passwordHash,
      active: true,
      preferredLocale: isLocale(params.preferredLocale) ? params.preferredLocale : null,
      createdAt: new Date().toISOString(),
    });

    return { data: { id }, error: null };
  } catch (error: unknown) {
    console.error("Failed to create user:", error);
    return { data: null, error: "Unable to create user right now." };
  }
}

export async function deleteUserViaEdge(userId: string): Promise<{ error: string | null }> {
  try {
    await requireRole(["super_admin"]);
    const db = getDb();
    await db.delete(users).where(eq(users.id, userId));
    return { error: null };
  } catch (error: unknown) {
    console.error("Failed to delete user:", error);
    return { error: "Unable to delete user right now." };
  }
}

export async function resendInvitationViaEdge(userId: string): Promise<{ error: string | null }> {
  try {
    const { env } = getCloudflareContext();
    const actor = await requireRole(["super_admin", "venue_admin"]);

    if (!isEmailConfigured(env)) {
      return {
        error:
          "Email invitations are unavailable until the mail service is configured.",
      };
    }

    const db = getDb();

    const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userResult[0];

    if (!user) return { error: "User not found." };
    if (actor.role !== "super_admin" && user.venueId !== actor.venueId) {
      throw new Error("Forbidden");
    }

    const token = generateResetToken();
    const tokenHash = await hashResetToken(token);
    const resetTokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    await db.insert(passwordResetTokens).values({
      id: resetTokenId,
      userId,
      token: tokenHash,
      expiresAt,
      used: false,
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

    return { error: null };
  } catch (error: unknown) {
    console.error("Resend invitation error:", error);
    return { error: "Unable to resend invitation right now." };
  }
}
