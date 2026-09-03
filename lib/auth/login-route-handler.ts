import { NextResponse } from "next/server";

import {
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "../../i18n/config.ts";
import type { TenantContext } from "../tenant/types.ts";
import {
  getRequestId,
  reportServerError,
  writeStructuredLog,
} from "../observability/structured-log.ts";
import { shouldUseSecureAuthCookies } from "./cookie-policy.ts";
import type { LoginResult } from "./login-service.ts";
import { isTrustedMutationOrigin } from "./request-origin.ts";
import {
  getRequestIp,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rate-limit.ts";

export interface LoginRouteHandlerDependencies<Environment> {
  getEnvironment(): Environment;
  consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult>;
  getTenant(
    request: Request,
  ): Promise<Pick<TenantContext, "resolved" | "scope" | "venueId">>;
  login(
    input: {
      email: string;
      password: string;
      keepSignedIn: boolean;
      tenant: Pick<TenantContext, "resolved" | "scope" | "venueId">;
    },
    environment: Environment,
  ): Promise<LoginResult>;
  getRequestId?: typeof getRequestId;
  reportServerError?: typeof reportServerError;
  writeStructuredLog?: typeof writeStructuredLog;
}

export function createLoginPostHandler<Environment>(
  dependencies: LoginRouteHandlerDependencies<Environment>,
) {
  const identifyRequest = dependencies.getRequestId ?? getRequestId;
  const reportError = dependencies.reportServerError ?? reportServerError;
  const writeLog = dependencies.writeStructuredLog ?? writeStructuredLog;

  return async function POST(request: Request) {
    const requestId = identifyRequest(request);
    try {
      if (!isTrustedMutationOrigin(request)) {
        return NextResponse.json(
          { code: "FORBIDDEN_ORIGIN", error: "Request origin is not allowed." },
          { status: 403 },
        );
      }

      const environment = dependencies.getEnvironment();
      const { email, password, keepSignedIn } = await request.json() as {
        email?: unknown;
        password?: unknown;
        keepSignedIn?: unknown;
      };
      if (
        typeof email !== "string" ||
        !email.trim() ||
        typeof password !== "string" ||
        !password
      ) {
        return NextResponse.json(
          { code: "MISSING_CREDENTIALS", error: "Email and password are required." },
          { status: 400 },
        );
      }

      const normalizedEmail = email.trim().toLowerCase();
      const credentialRateLimit = await dependencies.consumeRateLimit({
        namespace: "login",
        identifier: `${getRequestIp(request)}:${normalizedEmail}`,
        limit: 5,
        windowSeconds: 60 * 15,
      });
      if (!credentialRateLimit.allowed) {
        return NextResponse.json(
          { code: "RATE_LIMITED", error: "Too many login attempts. Please try again later." },
          {
            status: 429,
            headers: { "Retry-After": String(credentialRateLimit.retryAfterSeconds) },
          },
        );
      }

      const result = await dependencies.login(
        {
          email: normalizedEmail,
          password,
          keepSignedIn: keepSignedIn === true,
          tenant: await dependencies.getTenant(request),
        },
        environment,
      );
      if (result.status === "invalid_credentials") {
        return NextResponse.json(
          { code: "INVALID_CREDENTIALS", error: "Invalid email or password." },
          { status: 401 },
        );
      }
      if (result.status === "setup_required") {
        return NextResponse.json(
          {
            error: "First-time password setup is required.",
            code: "PASSWORD_SETUP_REQUIRED",
            setupMethod: "setup_code",
          },
          { status: 409 },
        );
      }
      if (result.status === "unavailable") {
        await writeLog("error", {
          event: "auth.login",
          requestId,
          actorId: result.user.id,
          venueId: result.user.venueId,
          outcome: "unavailable",
          errorKind: "MissingConfiguration",
        });
        return NextResponse.json(
          { code: "SERVER_ERROR", error: "Unable to sign in right now." },
          { status: 500 },
        );
      }

      const response = NextResponse.json({
        ok: true,
        user: {
          id: result.user.id,
          email: result.user.email,
          role: result.user.role,
          accountKind: result.user.accountKind,
          doorAccessEnabled: result.user.doorAccessEnabled,
          name: result.user.name,
          venueId: result.user.venueId ?? null,
          guestLimit: result.user.guestLimit ?? null,
          preferredLocale: isLocale(result.user.preferredLocale)
            ? result.user.preferredLocale
            : null,
        },
      });
      const secureCookies = shouldUseSecureAuthCookies(request);
      for (const [name, value] of [
        ["token", result.session.token],
        ["sessionId", result.session.sessionId],
      ] as const) {
        response.cookies.set({
          name,
          value,
          httpOnly: true,
          secure: secureCookies,
          sameSite: "lax",
          maxAge: result.session.lifetime.ttlSeconds,
          path: "/",
        });
      }
      if (isLocale(result.user.preferredLocale)) {
        response.cookies.set({
          name: LOCALE_COOKIE_NAME,
          value: result.user.preferredLocale,
          sameSite: "lax",
          secure: secureCookies,
          maxAge: LOCALE_COOKIE_MAX_AGE,
          path: "/",
        });
      }

      await writeLog("info", {
        event: "auth.login",
        requestId,
        actorId: result.user.id,
        venueId: result.user.venueId,
        outcome: "success",
      });
      return response;
    } catch (error) {
      await reportError("auth.login", error, { requestId });
      return NextResponse.json(
        { code: "SERVER_ERROR", error: "Unable to sign in right now." },
        { status: 500 },
      );
    }
  };
}
