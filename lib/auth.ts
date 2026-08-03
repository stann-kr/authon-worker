/**
 * lib/auth.ts — 클라이언트 사이드 인증 유틸리티
 *
 * JWT 검증 및 세션 관리는 서버(middleware.ts, API routes)에서 수행.
 * 이 파일은 클라이언트(localStorage) 기반 유저 정보 접근 및 로그인/로그아웃 유틸리티 제공.
 */

export interface User {
  id: string;
  venue_id?: string | null;
  email: string;
  name: string;
  role: "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
  guest_limit: number;
  preferred_locale?: "en" | "ko" | null;
}

/**
 * 이메일/비밀번호로 로그인 요청
 * - 성공 시 서버가 HTTP-Only JWT 쿠키 발급
 * - 클라이언트는 유저 프로필만 localStorage에 저장
 */
export const login = async (
  email: string,
  password: string,
): Promise<{ success: boolean; message?: string; code?: string; requiresSetup?: boolean }> => {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return {
        success: false,
        message: errorData.error || "Login failed.",
        code: errorData.code,
        requiresSetup: errorData.code === "PASSWORD_SETUP_REQUIRED",
      };
    }

    const { user } = await res.json();

    const userInfo: User = {
      id: user.id,
      venue_id: user.venueId || null,
      email: user.email,
      name: user.name,
      role: user.role,
      guest_limit: user.guestLimit || 0,
      preferred_locale: user.preferredLocale || null,
    };

    localStorage.setItem("user", JSON.stringify(userInfo));

    return { success: true };
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
 * - 서버에 로그아웃 요청하여 HTTP-Only 쿠키 삭제
 * - 클라이언트 localStorage 정리
 */
export const logout = async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  } finally {
    if (typeof window !== "undefined") {
      localStorage.removeItem("user");
      window.location.href = "/auth/login";
    }
  }
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
    return JSON.parse(userStr);
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
  userRole: string,
  requiredAccess: string[],
): boolean => {
  const accessMap: Record<string, string[]> = {
    super_admin: ["guest", "door", "admin", "venue"],
    venue_admin: ["guest", "door", "admin"],
    door_staff: ["door", "guest"],
    staff: ["guest"],
    dj: ["guest"],
  };

  return requiredAccess.some((access) => accessMap[userRole]?.includes(access));
};
