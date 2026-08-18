/**
 * lib/auth.ts — 클라이언트 사이드 인증 유틸리티
 *
 * JWT 검증 및 세션 관리는 서버(middleware.ts, API routes)에서 수행.
 * 이 파일은 클라이언트(localStorage) 기반 유저 정보 접근 및 로그인/로그아웃 유틸리티 제공.
 */

import {
  hasAccess as hasPolicyAccess,
  type AccessScope,
} from "@/lib/users/policy";
import {
  isFirstLoginSetupMethod,
  type FirstLoginSetupMethod,
} from "@/lib/auth/first-login-policy";
import {
  normalizeCachedUser,
  type User,
} from "@/lib/auth/user-profile";

export type { User } from "@/lib/auth/user-profile";

export type LoginResult =
  | { success: true; user: User }
  | {
      success: false;
      message?: string;
      code?: string;
      requiresSetup?: boolean;
      setupMethod?: FirstLoginSetupMethod;
    };

export type LogoutResult =
  | { success: true }
  | {
      success: false;
      code:
        | "SESSION_REVOCATION_PENDING"
        | "LOGOUT_REQUEST_FAILED"
        | "LOGOUT_NETWORK_ERROR";
      revocationPending: boolean;
      status?: number;
    };

export const cacheUser = (user: User | null): void => {
  if (typeof window === "undefined") return;
  if (user) localStorage.setItem("user", JSON.stringify(user));
  else localStorage.removeItem("user");
};

/**
 * 이메일/비밀번호로 로그인 요청
 * - 성공 시 서버가 HTTP-Only JWT 쿠키 발급
 * - 클라이언트는 유저 프로필만 localStorage에 저장
 */
export const login = async (
  email: string,
  password: string,
  keepSignedIn = false,
): Promise<LoginResult> => {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, keepSignedIn }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return {
        success: false,
        message: errorData.error || "Login failed.",
        code: errorData.code,
        requiresSetup: errorData.code === "PASSWORD_SETUP_REQUIRED",
        setupMethod: isFirstLoginSetupMethod(errorData.setupMethod)
          ? errorData.setupMethod
          : undefined,
      };
    }

    const { user } = await res.json();

    const userInfo: User = {
      id: user.id,
      venue_id: user.venueId || null,
      email: user.email,
      name: user.name,
      role: user.role,
      account_kind: user.accountKind === "shared" ? "shared" : "personal",
      door_access_enabled: user.doorAccessEnabled === true,
      guest_limit: typeof user.guestLimit === "number" ? user.guestLimit : null,
      preferred_locale: user.preferredLocale || null,
    };

    cacheUser(userInfo);

    return { success: true, user: userInfo };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, message: "An error occurred during login." };
  }
};

export const claimMigratedAccount = async (
  email: string,
  setupCode: string,
  newPassword: string,
): Promise<{ success: boolean; message?: string; code?: string }> => {
  try {
    const res = await fetch("/api/auth/claim-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, setupCode, newPassword }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        message: data.error || "First-time setup failed.",
        code: data.code,
      };
    }

    return { success: true, message: data.message };
  } catch (error) {
    console.error("Account claim error:", error);
    return {
      success: false,
      message: "An error occurred during first-time setup.",
    };
  }
};

/**
 * 로그아웃
 * - 서버가 durable revocation과 쿠키 삭제를 확인한 경우에만 client state 정리
 * - 실패 시 기존 credential과 client state를 유지해 안전하게 재시도
 */
export const logout = async (): Promise<LogoutResult> => {
  let response: Response;
  let body: unknown;

  try {
    response = await fetch("/api/auth/logout", { method: "POST" });
    body = await response.json().catch(() => null);
  } catch {
    return {
      success: false,
      code: "LOGOUT_NETWORK_ERROR",
      revocationPending: false,
    };
  }

  const resultBody =
    body && typeof body === "object"
      ? (body as { ok?: unknown; code?: unknown; revocationPending?: unknown })
      : null;
  if (!response.ok || resultBody?.ok !== true) {
    const revocationPending =
      resultBody?.revocationPending === true ||
      resultBody?.code === "SESSION_REVOCATION_PENDING";
    return {
      success: false,
      code:
        revocationPending
          ? "SESSION_REVOCATION_PENDING"
          : "LOGOUT_REQUEST_FAILED",
      revocationPending,
      status: response.status,
    };
  }

  if (typeof window !== "undefined") {
    try {
      cacheUser(null);
    } catch {
      // Server revocation already succeeded; stale client cache is best-effort.
    }
    try {
      for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith("shared-operator:")) window.sessionStorage.removeItem(key);
      }
    } catch {
      // Server revocation already succeeded; stale client cache is best-effort.
    }
    window.location.href = "/auth/login";
  }

  return { success: true };
};

/**
 * localStorage에서 현재 로그인한 유저 정보 반환
 * @returns User 객체 또는 null
 */
export const getUser = (): User | null => {
  if (typeof window === "undefined") return null;

  const userStr = localStorage.getItem("user");
  if (!userStr || userStr === "undefined" || userStr === "null") return null;

  try {
    return normalizeCachedUser(JSON.parse(userStr));
  } catch (e) {
    console.error("Failed to parse user from localStorage", e);
    return null;
  }
};

/**
 * 유저 역할이 필요한 접근 스코프를 가지고 있는지 확인
 * @param userRole - 유저의 역할
 * @param requiredAccess - 필요한 접근 스코프 배열
 */
export const hasAccess = (
  user: Pick<User, "role" | "account_kind" | "door_access_enabled">,
  requiredAccess: AccessScope[],
): boolean => {
  return hasPolicyAccess(
    {
      role: user.role,
      accountKind: user.account_kind,
      doorAccessEnabled: user.door_access_enabled,
    },
    requiredAccess,
  );
};
