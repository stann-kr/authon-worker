import { createClient } from "./supabase/client";

export interface User {
  id: string;
  auth_user_id: string | null;
  venue_id?: string;
  email: string;
  name: string;
  role: "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
  guest_limit: number;
}

// lib/auth.ts에서는 필요한 곳에서만 supabase를 초기화하여 사용합니다.

export const login = async (
  email: string,
  password: string,
): Promise<{ success: boolean; message?: string }> => {
  const supabase = createClient();
  try {
    const {
      data: { user },
      error: signInError,
    } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error("Sign in error:", signInError);
      return { success: false, message: "Invalid email or password." };
    }

    if (!user) {
      return {
        success: false,
        message: "Login failed: unable to load user information.",
      };
    }

    // 사용자 상세 정보 조회 (public.users 테이블)
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (userError || !userData) {
      console.error("User data fetch error:", userError);
      // Auth에는 있지만 public.users에 없는 경우 로그아웃 처리
      await supabase.auth.signOut();
      return { success: false, message: "User profile could not be found." };
    }

    // 타입 단언 사용 (userData가 any로 추론되지 않도록)
    const activeUser = userData as any;

    if (!activeUser.active) {
      await supabase.auth.signOut();
      return { success: false, message: "This account is inactive." };
    }

    // [호환성 유지] 기존 앱 로직이 localStorage 'user' 키를 동기적으로 참조하는 경우가 많으므로
    // Supabase 세션 외에도 편의상 캐싱해둘 수 있지만,
    // 원칙적으로는 Supabase Session을 사용하는 것이 맞음.
    // 하지만 리팩토링 범위를 줄이기 위해 localStorage에도 저장합니다.
    const userInfo: User = {
      id: activeUser.id,
      auth_user_id: activeUser.auth_user_id,
      venue_id: activeUser.venue_id,
      email: activeUser.email,
      name: activeUser.name,
      role: activeUser.role as
        | "super_admin"
        | "venue_admin"
        | "door_staff"
        | "staff"
        | "dj",
      guest_limit: activeUser.guest_limit,
    };

    localStorage.setItem("user", JSON.stringify(userInfo));

    return { success: true };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, message: "An error occurred during login." };
  }
};

export const logout = async () => {
  const supabase = createClient();
  await supabase.auth.signOut();
  if (typeof window !== "undefined") {
    localStorage.removeItem("user");
  }
  if (typeof window !== "undefined") {
    window.location.href = "/auth/login";
  }
};

/**
 * @deprecated Use useAuth hook or supabase.auth.getUser() instead for source of truth.
 * This function relies on localStorage which might be out of sync.
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
