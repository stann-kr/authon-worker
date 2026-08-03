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
import { useTranslations } from "next-intl";

/**
 * GuestPage Entry Point
 * Handles routing between External DJ flow and Authenticated flow.
 */
export default function GuestPage() {
  const t = useTranslations("GuestOperations");
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] bg-canvas flex flex-col">
          <AdminHeader />
          <div className="flex-1 overflow-x-hidden pt-20 sm:pt-24 flex flex-col">
            <div className="mx-auto flex w-full max-w-[1440px] flex-col px-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:px-10">
              <div className="main-content-panel lg:min-h-0">
                <Spinner mode="inline" text={t("loadingWorkspace")} />
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
