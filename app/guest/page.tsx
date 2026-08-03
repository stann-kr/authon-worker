"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getUser } from "@/lib/auth";
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
  const token = searchParams.get("token");

  // Case 1: External DJ flow (token-based)
  if (token) {
    return <ExternalDJGuestView token={token} />;
  }

  // Case 2: Authenticated DJ flow
  const user = getUser();

  return (
    <AuthGuard requiredAccess={["guest"]}>
      <AuthenticatedGuestView user={user} />
    </AuthGuard>
  );
}
