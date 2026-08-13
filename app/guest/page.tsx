"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { useAuthSession } from "@/components/AuthSessionProvider";
import ExternalDJGuestView from "./components/ExternalDJGuestView";
import AuthenticatedGuestView from "./components/AuthenticatedGuestView";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";

/**
 * GuestPage Entry Point
 * Handles routing between External DJ flow and Authenticated flow.
 */
export default function GuestPage() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <GuestPageRouter />
    </Suspense>
  );
}

function GuestPageRouter() {
  const searchParams = useSearchParams();
  const { user } = useAuthSession();
  const token = searchParams.get("token");

  // Case 1: External DJ flow (token-based)
  if (token) {
    return <ExternalDJGuestView key={token} token={token} />;
  }

  return (
    <AuthGuard requiredAccess={["guest"]}>
      <AuthenticatedGuestView user={user} />
    </AuthGuard>
  );
}
