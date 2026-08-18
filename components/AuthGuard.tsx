"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasAccess } from "../lib/auth";
import { createAuthGuardRecoveryGate } from "@/lib/auth/client-session";
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
  const [recoveryGate] = useState(createAuthGuardRecoveryGate);

  useEffect(() => {
    if (recoveryGate.shouldRefresh(isAllowed)) router.refresh();
  }, [isAllowed, recoveryGate, router]);

  if (!isAllowed) return <RouteLoadingFallback />;

  return <>{children}</>;
}
