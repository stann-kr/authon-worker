import AdminHeader from "@/app/admin/components/AdminHeader";
import Footer from "./Footer";

/**
 * 로그인 후 route 전환 중 현재 앱 chrome을 유지하는 빈 loading shell.
 * 실제 진행 상태는 RouteTransitionProvider의 content overlay가 한 번만 표시한다.
 */
export default function RouteLoadingShell() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <AdminHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 pt-[var(--app-header-height)]"
        aria-hidden="true"
      />
      <Footer />
    </div>
  );
}
