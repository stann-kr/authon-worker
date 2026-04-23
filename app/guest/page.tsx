"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getUser } from "@/lib/auth";
import ExternalDJGuestView from "./components/ExternalDJGuestView";
import AuthenticatedGuestView from "./components/AuthenticatedGuestView";

import AdminHeader from "@/app/admin/components/AdminHeader";
import Footer from "@/components/Footer";
import Spinner from "@/components/Spinner";

/**
 * GuestPage Entry Point
 * Handles routing between External DJ flow and Authenticated flow.
 */
export default function GuestPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black flex flex-col">
          <AdminHeader />
          <div className="flex-1 overflow-x-hidden pt-20 sm:pt-24 flex flex-col">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 w-full lg:flex-1 lg:min-h-0 flex flex-col">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
                <div className="lg:col-span-1 space-y-4">
                  <div className="bg-surface border border-border-subtle p-4 sm:p-5 min-h-[200px]">
                    <Spinner mode="inline" text="LOADING..." />
                  </div>
                </div>
                <div className="lg:col-span-3 flex flex-col lg:min-h-0">
                  <div className="main-content-panel lg:min-h-0 lg:max-h-full">
                    <Spinner mode="inline" text="LOADING..." />
                  </div>
                </div>
              </div>
            </div>
            <Footer />
          </div>
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
