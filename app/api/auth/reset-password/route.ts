import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createPasswordResetTokenPersistence } from "@/lib/auth/password-reset-token-persistence";
import {
  prepareTokenPasswordReset,
  resetPasswordWithToken,
} from "@/lib/auth/password-reset-token-service";
import {
  consumeRateLimitOrDeny,
  getRequestIp,
} from "@/lib/auth/rate-limit";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";
import { getTenantContextForRequest } from "@/lib/tenant/server";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "@/lib/observability/structured-log";

/**
 * 자가 이메일 요청 차단 (POST) 및 이미 발급된 token 재설정 실행 (PUT)
 */

export async function POST() {
  return NextResponse.json(
    {
      code: "EMAIL_RESET_DISABLED",
      error: "Email password reset is disabled. Request help from an administrator.",
    },
    { status: 410, headers: { Allow: "PUT" } },
  );
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    if (!isTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
        { status: 403 },
      );
    }
    const { env } = getCloudflareContext();
    const body: unknown = await request.json().catch(() => null);
    const token = body && typeof body === "object" && "token" in body
      ? (body as { token?: unknown }).token
      : undefined;
    const newPassword = body && typeof body === "object" && "newPassword" in body
      ? (body as { newPassword?: unknown }).newPassword
      : undefined;

    const prepared = prepareTokenPasswordReset({ token, newPassword });
    if (prepared.status === "missing") {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }
    if (prepared.status === "policy_error") {
      return NextResponse.json({ error: prepared.error }, { status: 400 });
    }
    if (prepared.status === "invalid_token") {
      return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
    }
    const operationNow = new Date();

    const rateLimit = await consumeRateLimitOrDeny({
      namespace: "password-reset-token",
      identifier: getRequestIp(request),
      limit: 20,
      windowSeconds: 60 * 15,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          code: "RATE_LIMITED",
          error: "Too many password reset attempts. Please try again later.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const tenant = await getTenantContextForRequest(request);
    const expectedVenueId = tenant.scope === "venue" ? tenant.venueId : null;

    if (!tenant.resolved) {
      return NextResponse.json({ error: "Unknown venue." }, { status: 404 });
    }

    const result = await resetPasswordWithToken(
      {
        token: prepared.token,
        newPassword: prepared.newPassword,
        expectedVenueId,
      },
      {
        persistence: createPasswordResetTokenPersistence(env.DB),
        now: () => operationNow,
      },
    );
    if (result.status === "invalid_token") {
      return NextResponse.json({ error: "유효하지 않거나 만료된 토큰입니다." }, { status: 400 });
    }

    await writeStructuredLog("info", {
      event: result.isInitialSetup ? "auth.account_invitation" : "auth.password_reset",
      requestId,
      actorId: result.userId,
      venueId: expectedVenueId,
      outcome: "success",
    });
    return NextResponse.json({ ok: true, message: "비밀번호가 성공적으로 변경되었습니다." });
  } catch (error) {
    await reportServerError("auth.password_reset", error, { requestId });
    return NextResponse.json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
