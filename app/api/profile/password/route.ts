import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { users } from "@/lib/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";

export async function PUT(request: Request) {
  try {
    const { env } = getCloudflareContext();

    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map((c) => {
        const parts = c.trim().split("=");
        return [parts[0], parts.slice(1).join("=")];
      })
    );
    const token = cookies.token;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!env.JWT_SECRET) {
      return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.sub;

    if (!userId) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Passwords are required" }, { status: 400 });
    }

    const db = drizzle(env.DB);
    const result = await db.select().from(users).where(eq(users.id, userId as string)).limit(1);
    const user = result[0];

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const isMatch = await verifyPassword(currentPassword, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 400 });
    }

    const hashedPassword = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash: hashedPassword }).where(eq(users.id, userId as string));

    return NextResponse.json({ ok: true, message: "Password updated successfully" });
  } catch (error: unknown) {
    console.error("Update password error:", error);
    return NextResponse.json(
      { error: "비밀번호 변경 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
