"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, hasAccess, User } from "../lib/auth";
import Spinner from "./Spinner";

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

  useEffect(() => {
    const checkAuth = () => {
      // 1. Get user from localStorage
      // Note: Actual route protection is handled by middleware.ts via JWT.
      // AuthGuard is mainly for UI-level rendering and client-side redirects 
      // if local state is out of sync.
      const currentUser = getUser();

      if (!currentUser) {
        router.push("/auth/login");
        return;
      }

      // 2. Check Role Access
      if (!hasAccess(currentUser.role, requiredAccess)) {
        router.push("/");
        return;
      }

      setUser(currentUser);
      setIsLoading(false);
    };

    checkAuth();
  }, [router, requiredAccess]);

  if (isLoading) {
    return <Spinner mode="fullscreen" text="Loading workspace" />;
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
