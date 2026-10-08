import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/server";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { reportServerError } from "@/lib/observability/structured-log";
import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@/i18n/config";

export async function POST(request: Request) {
  // The saved preference rides on the session cookie, so only this origin may change it.
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json({ code: "FORBIDDEN_ORIGIN" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  if (!isLocale(body?.locale)) {
    return NextResponse.json({ code: "INVALID_LOCALE" }, { status: 400 });
  }

  try {
    const user = await getCurrentUser();
    if (user) {
      const db = getDb();
      await db
        .update(users)
        .set({ preferredLocale: body.locale })
        .where(eq(users.id, user.id));
    }
  } catch (error) {
    // The account language outranks the cookie, so a cookie alone would not switch the next page.
    await reportServerError("locale.update", error);
    return NextResponse.json({ code: "LOCALE_UPDATE_FAILED" }, { status: 503 });
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
