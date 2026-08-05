"use client";

import { useTranslations } from "next-intl";
import RouteLoadingShell from "./RouteLoadingShell";
import Spinner from "./Spinner";
import {
  useRouteLoadingTask,
  useRouteTransition,
} from "./RouteTransitionProvider";

/**
 * 앱 화면의 초기 진입과 client route 전환에서 같은 로딩 문구를 사용합니다.
 * route 전환 중에는 overlay가 유일한 progress indicator가 되도록 shell만 렌더링합니다.
 */
export default function RouteLoadingFallback() {
  const t = useTranslations("Common");
  const { isRouteTransitionActive } = useRouteTransition();
  useRouteLoadingTask(true);

  if (isRouteTransitionActive) {
    return <RouteLoadingShell />;
  }

  return (
    <main id="main-content" tabIndex={-1}>
      <Spinner mode="fullscreen" text={t("loading")} />
    </main>
  );
}
