import { useEffect, type RefObject } from "react";

const MOBILE_VIEWPORT_QUERY = "(max-width: 767px)";
const MOBILE_DOCK_INSET_PROPERTY = "--door-mobile-dock-height";

export default function useMobileDockInset(
  dockRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const dock = dockRef.current;
    const pageScroll = dock?.closest<HTMLElement>(".page-scroll");
    if (!dock || !pageScroll) return;

    const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const updateInset = () => {
      if (!mediaQuery.matches) {
        pageScroll.style.removeProperty(MOBILE_DOCK_INSET_PROPERTY);
        return;
      }

      const height = Math.ceil(dock.getBoundingClientRect().height);
      if (height > 0) {
        pageScroll.style.setProperty(
          MOBILE_DOCK_INSET_PROPERTY,
          `${height}px`,
        );
      }
    };

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateInset);
    observer?.observe(dock);
    mediaQuery.addEventListener("change", updateInset);
    updateInset();

    return () => {
      observer?.disconnect();
      mediaQuery.removeEventListener("change", updateInset);
      pageScroll.style.removeProperty(MOBILE_DOCK_INSET_PROPERTY);
    };
  }, [dockRef]);
}
