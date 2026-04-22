"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, hasAccess, User } from "../lib/auth";
import { createClient } from "../lib/supabase/client";

interface AuthGuardProps {
  children: React.ReactNode;
  requiredAccess: string[];
}

export default function AuthGuard({
  children,
  requiredAccess,
}: AuthGuardProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const checkAuth = async () => {
      // 1. Check Supabase Session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        // 세션이 없으면 로그인 페이지로
        router.push("/auth/login");
        return;
      }

      // 2. Fallback to localStorage for compatibility (getUser)
      // 이상적으로는 여기서 Supabase DB에서 유저 정보를 다시 가져와야 하지만,
      // 성능상 로그인 시 저장한 localStorage 정보를 우선 활용하고,
      // 추후 Context API로 전역 상태 관리하는 것이 좋음.
      const currentUser = getUser();

      if (!currentUser) {
        // 세션은 있는데 로컬 데이터가 날라간 경우 -> 다시 로그인 유도 혹은 프로필 재조회 필요
        // 여기서는 간단히 재로그인 유도
        await supabase.auth.signOut();
        router.push("/auth/login");
        return;
      }

      // Check if user is active and sync latest info (guest_limit, role, venue_id)
      try {
        const { data: userData, error: userError } = await supabase
          .from("users")
          .select("role, guest_limit, active, venue_id")
          .eq("auth_user_id", session.user.id)
          .single();

        if (!userError && userData) {
          const typedUserData = userData as {
            role: string;
            guest_limit: number;
            active: boolean;
            venue_id: string | null;
          };

          if (!typedUserData.active) {
            await supabase.auth.signOut();
            localStorage.removeItem("user");
            router.push("/auth/login");
            return;
          }

          currentUser.role = typedUserData.role as any;
          currentUser.guest_limit = typedUserData.guest_limit;
          currentUser.venue_id = typedUserData.venue_id || undefined;

          localStorage.setItem("user", JSON.stringify(currentUser));
        }
      } catch (err) {
        console.warn("Failed to sync user profile", err);
      }

      // 3. Check Role Access
      if (!hasAccess(currentUser.role, requiredAccess)) {
        router.push("/");
        return;
      }

      setUser(currentUser);
      setIsLoading(false);
    };

    checkAuth();

    // Listen for auth state changes (e.g. sign out from another tab)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: any, session: any) => {
      if (event === "SIGNED_OUT" || !session) {
        router.push("/auth/login");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router, requiredAccess]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white font-mono text-sm tracking-wider uppercase">
            LOADING...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
