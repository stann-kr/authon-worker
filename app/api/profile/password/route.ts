import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAuth } from "@/lib/auth/server";
import { shouldUseSecureAuthCookies } from "@/lib/auth/cookie-policy";
import { createProfilePasswordPersistence } from "@/lib/auth/profile-password-persistence";
import { changeProfilePassword } from "@/lib/auth/profile-password-service";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

function getAuthErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "Unauthorized" || error.message === "Session expired") return 401;
  if (error.message === "Forbidden") return 403;
  return null;
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    const { env } = getCloudflareContext();
    const authUser = await requireAuth();
    const { currentPassword, newPassword } = await request.json();
    const sessionId = (request.headers.get("cookie") || "").match(
      /(?:^|;\s*)sessionId=([^;]+)/,
    )?.[1];
    const result = await changeProfilePassword(
      {
        actorUserId: authUser.id,
        currentPassword,
        newPassword,
        sessionId,
      },
      { persistence: createProfilePasswordPersistence(env) },
    );

    if (result.status === "missing") {
      return NextResponse.json({ error: "Passwords are required" }, { status: 400 });
    }
    if (result.status === "policy_error") {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (result.status === "user_not_found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (result.status === "password_mismatch") {
      return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 400 });
    }
    if (result.status === "conflict") {
      return NextResponse.json(
        { error: "계정 상태가 변경되었습니다. 다시 로그인한 뒤 시도해주세요." },
        { status: 409 },
      );
    }

    if (result.sessionCleanupError) {
      await reportServerError(
        "auth.profile_password.session_cleanup",
        result.sessionCleanupError,
        {
          requestId,
          actorId: result.user.id,
          venueId: result.user.venueId,
        },
      );
    }

    const response = NextResponse.json({
      ok: true,
      message: "비밀번호가 변경되어 다시 로그인해야 합니다.",
      reauthRequired: true,
    });
    const secureCookies = shouldUseSecureAuthCookies(request);
    response.cookies.set({
      name: "token",
      value: "",
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    response.cookies.set({
      name: "sessionId",
      value: "",
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    await writeStructuredLog("info", {
      event: "auth.profile_password",
      requestId,
      actorId: result.user.id,
      venueId: result.user.venueId,
      outcome: "success",
    });
    return response;
  } catch (error: unknown) {
    await reportServerError("auth.profile_password", error, { requestId });
    const authStatus = getAuthErrorStatus(error);
    if (authStatus) {
      return NextResponse.json({ error: "Unauthorized" }, { status: authStatus });
    }
    return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
