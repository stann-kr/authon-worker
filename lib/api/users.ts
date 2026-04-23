"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq, asc } from "drizzle-orm";
import * as schema from "../db/schema";
import { users, passwordResetTokens } from "../db/schema";
import { type User, type ApiResponse } from "./types";
import bcrypt from "bcryptjs";
import { sendEmail } from "./email";

// Helper to get Drizzle instance
async function getDb() {
  const { env } = getCloudflareContext() as unknown as { env: { DB: any } };
  return drizzle(env.DB, { schema });
}

export async function fetchUsersByVenue(venueId?: string | null): Promise<ApiResponse<User[]>> {
  try {
    const db = await getDb();
    let query = db.select().from(users).$dynamic();
    
    if (venueId) {
      query = query.where(eq(users.venueId, venueId));
    }
    
    const result = await query.orderBy(asc(users.name));
    return { data: result.map(u => ({ ...u, role: u.role as User["role"] })), error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to fetch users" };
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
    const db = await getDb();
    const dbUpdates: Partial<typeof users.$inferInsert> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.guestLimit !== undefined) dbUpdates.guestLimit = updates.guestLimit;
    if (updates.active !== undefined) dbUpdates.active = updates.active;
    if (updates.role !== undefined) dbUpdates.role = updates.role;

    await db.update(users).set(dbUpdates).where(eq(users.id, userId));
    const result = await db.select().from(users).where(eq(users.id, userId));
    return { data: result[0] ? { ...result[0], role: result[0].role as User["role"] } : null, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to update user" };
  }
}

export async function createUserViaEdge(params: {
  email: string;
  name: string;
  role: "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
  venueId?: string | null;
  guestLimit?: number;
  password?: string;
}): Promise<ApiResponse<{ id: string }>> {
  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    const passwordHash = params.password ? await bcrypt.hash(params.password, 10) : await bcrypt.hash("123456", 10);
    
    await db.insert(users).values({
      id,
      email: params.email,
      name: params.name,
      role: params.role,
      venueId: params.venueId || null,
      guestLimit: params.guestLimit || null,
      passwordHash,
      active: true,
      createdAt: new Date().toISOString(),
    });

    // Send invitation email
    await resendInvitationViaEdge(id);

    return { data: { id }, error: null };
  } catch (error: unknown) {
    return { data: null, error: error instanceof Error ? error.message : "Failed to create user" };
  }
}

export async function deleteUserViaEdge(userId: string): Promise<{ error: string | null }> {
  try {
    const db = await getDb();
    await db.delete(users).where(eq(users.id, userId));
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Failed to delete user" };
  }
}

export async function resendInvitationViaEdge(userId: string): Promise<{ error: string | null }> {
  try {
    const { env } = getCloudflareContext() as unknown as { env: { DB: any, NEXT_PUBLIC_APP_URL: string } };
    const db = await getDb();
    
    const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userResult[0];
    
    if (!user) return { error: "User not found." };

    // Create reset token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    await db.insert(passwordResetTokens).values({
      id: crypto.randomUUID(),
      userId: userId,
      token,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString(),
    });

    // Send email
    const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetLink = `${appUrl}/auth/reset-password?token=${token}`;

    await sendEmail({
      to: user.email,
      subject: "[Authon] 계정 초기 비밀번호 설정 안내",
      body: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>계정 초기 비밀번호 설정 안내</h2>
          <p>안녕하세요, ${user.name}님.</p>
          <p>관리자에 의해 귀하의 계정이 생성되었습니다. 아래 링크를 클릭하여 비밀번호를 설정하고 로그인을 완료해주세요.</p>
          <div style="margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px;">비밀번호 설정하기</a>
          </div>
          <p>이 링크는 7일 동안 유효합니다.</p>
          <p style="color: #666; font-size: 12px; margin-top: 40px;">본 메일은 발송 전용입니다.</p>
        </div>
      `,
    });

    return { error: null };
  } catch (error: unknown) {
    console.error("Resend invitation error:", error);
    return { error: error instanceof Error ? error.message : "Failed to resend invitation" };
  }
}
