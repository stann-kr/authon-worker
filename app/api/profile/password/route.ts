import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { requireAuth } from "@/lib/auth/server";
import { getPasswordPolicyError } from "@/lib/auth/password-policy";

function getAuthErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "Unauthorized" || error.message === "Session expired") return 401;
  if (error.message === "Forbidden") return 403;
  return null;
}

export async function PUT(request: Request) {
  try {
    const { env } = getCloudflareContext();
    const authUser = await requireAuth();
    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Passwords are required" }, { status: 400 });
    }

    const policyError = getPasswordPolicyError(newPassword);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const db = drizzle(env.DB);
    const result = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
    const user = result[0];

    if (!user || !user.active) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const isMatch = await verifyPassword(currentPassword, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 400 });
    }

    const hashedPassword = await hashPassword(newPassword);
    await db.update(users).set({
      passwordHash: hashedPassword,
      sessionVersion: sql`${users.sessionVersion} + 1`,
    }).where(eq(users.id, authUser.id));

    const cookieHeader = request.headers.get("cookie") || "";
    const sessionId = cookieHeader.match(/(?:^|;\s*)sessionId=([^;]+)/)?.[1];
    if (sessionId) {
      await env.SESSIONS.delete(`session:${sessionId}`);
    }

    const response = NextResponse.json({
      ok: true,
      message: "비밀번호가 변경되어 다시 로그인해야 합니다.",
      reauthRequired: true,
    });
    response.cookies.set({ name: "token", value: "", httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/" });
    response.cookies.set({ name: "sessionId", value: "", httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/" });

    return response;
  } catch (error: unknown) {
    console.error("Update password error:", error);
    const authStatus = getAuthErrorStatus(error);
    if (authStatus) {
      return NextResponse.json({ error: "Unauthorized" }, { status: authStatus });
    }
    return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
