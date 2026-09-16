import WorkspaceShell from "./WorkspaceShell";

/**
 * 로그인 후 route 전환 중 현재 앱 chrome을 유지하는 빈 loading shell.
 * 실제 진행 상태는 RouteTransitionProvider의 content overlay가 한 번만 표시한다.
 */
export default function RouteLoadingShell() {
  return (
    <WorkspaceShell><div aria-hidden="true" /></WorkspaceShell>
  );
}
