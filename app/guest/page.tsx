"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getUser } from "@/lib/auth";
import ExternalDJGuestView from "./components/ExternalDJGuestView";
import AuthenticatedGuestView from "./components/AuthenticatedGuestView";

/**
 * GuestPage Entry Point
 * Handles routing between External DJ flow and Authenticated flow.
 */
export default function GuestPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
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
