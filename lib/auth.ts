export interface User {
  id: string;
  auth_user_id: string | null;
  venue_id?: string;
  email: string;
  name: string;
  role: "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
  guest_limit: number;
}

export const login = async (
  email: string,
  password: string,
): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return { success: false, message: errorData.error || "Login failed." };
    }

    const { user } = await res.json();

    const userInfo: User = {
      id: user.id,
      auth_user_id: user.id, // For compatibility
      venue_id: user.venueId || undefined,
      email: user.email,
      name: user.name,
      role: user.role,
      guest_limit: user.guestLimit || 0,
    };

    localStorage.setItem("user", JSON.stringify(userInfo));

    return { success: true };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, message: "An error occurred during login." };
  }
};

export const logout = async () => {
  try {
    // 만약 /api/auth/logout 엔드포인트가 있다면 호출하여 HTTP-Only 쿠키도 삭제
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  } finally {
    if (typeof window !== "undefined") {
      localStorage.removeItem("user");
      window.location.href = "/auth/login";
    }
  }
};

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
