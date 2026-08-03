"use client";

import RouteLoadingShell from "@/components/RouteLoadingShell";
import { useRouteTransition } from "@/components/RouteTransitionProvider";
import Spinner from "@/components/Spinner";
import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("Common");
  const { isRouteTransitionActive } = useRouteTransition();

  if (!isRouteTransitionActive) {
    return <Spinner mode="fullscreen" text={t("loading")} />;
  }

  return <RouteLoadingShell />;
}
