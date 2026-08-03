export const ROUTE_TRANSITION_START_EVENT = "authon:route-transition-start";

function getBrowserEventTarget(): EventTarget | null {
  return typeof window === "undefined" ? null : window;
}

/**
 * 화면 전환 직전 현재 화면의 비동기 작업이 결과 반영을 중단하도록 알립니다.
 */
export function announceRouteTransitionStart(
  target: EventTarget | null = getBrowserEventTarget(),
): void {
  target?.dispatchEvent(new Event(ROUTE_TRANSITION_START_EVENT));
}

/**
 * 화면 전환 시작을 구독합니다. 반환 함수는 등록한 listener를 해제합니다.
 */
export function subscribeToRouteTransitionStart(
  listener: EventListener,
  target: EventTarget | null = getBrowserEventTarget(),
): () => void {
  if (!target) return () => {};

  target.addEventListener(ROUTE_TRANSITION_START_EVENT, listener);
  return () => target.removeEventListener(ROUTE_TRANSITION_START_EVENT, listener);
}
