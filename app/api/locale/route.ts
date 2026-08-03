import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isDemoDeployment } from "@/lib/demo/deployment";
import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@/i18n/config";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  if (!isLocale(body?.locale)) {
    return NextResponse.json({ code: "INVALID_LOCALE" }, { status: 400 });
  }

  const { env } = getCloudflareContext();
  const user = isDemoDeployment(env.AUTHON_DEPLOYMENT_MODE)
    ? null
    : await getCurrentUser();
  if (user) {
    const db = getDb();
    await db
      .update(users)
      .set({ preferredLocale: body.locale })
      .where(eq(users.id, user.id));
  }

  const response = NextResponse.json({ ok: true, locale: body.locale });
  response.cookies.set({
    name: LOCALE_COOKIE_NAME,
    value: body.locale,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}
