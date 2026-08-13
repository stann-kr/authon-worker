"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasAccess } from "../lib/auth";
import type { AccessScope } from "@/lib/users/policy";
import RouteLoadingFallback from "./RouteLoadingFallback";
import { useAuthSession } from "./AuthSessionProvider";

interface AuthGuardProps {
  children: React.ReactNode;
  requiredAccess: AccessScope[];
}

export default function AuthGuard({
  children,
  requiredAccess,
}: AuthGuardProps) {
  const { user } = useAuthSession();
  const router = useRouter();
  const isAllowed = Boolean(user && hasAccess(user, requiredAccess));

  useEffect(() => {
    if (!user) router.replace("/auth/login");
    else if (!isAllowed) router.replace("/");
  }, [isAllowed, router, user]);

  if (!isAllowed) return <RouteLoadingFallback />;

  return <>{children}</>;
}
