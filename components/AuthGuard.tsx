"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, hasAccess, User } from "../lib/auth";
import { useTranslations } from "next-intl";

interface AuthGuardProps {
  children: React.ReactNode;
  requiredAccess: string[];
}

export default function AuthGuard({
  children,
  requiredAccess,
}: AuthGuardProps) {
  const t = useTranslations("Common");
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
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-canvas">
        <div className="text-center" role="status" aria-live="polite">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-action-primary border-t-transparent" aria-hidden="true"></div>
          <p className="text-sm text-text-muted">
            {t("verifyingAccess")}
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
