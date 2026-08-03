"use client";

import AdminHeader from "@/app/admin/components/AdminHeader";
import Footer from "@/components/Footer";
import { useRouteTransition } from "@/components/RouteTransitionProvider";
import Spinner from "@/components/Spinner";
import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("Common");
  const { isRouteTransitionActive } = useRouteTransition();

  if (!isRouteTransitionActive) {
    return <Spinner mode="fullscreen" text={t("loading")} />;
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <AdminHeader />
      <main
        className="flex-1 pt-[var(--app-header-height)]"
        aria-hidden="true"
      />
      <Footer />
    </div>
  );
}
