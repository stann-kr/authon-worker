import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { viewLabels, type View } from "../data/types";

type MockRoute = { view: View; externalLinkId: string; authPage: string };
const initialRoute: MockRoute = {
  view: "roster",
  externalLinkId: "rsvp-link",
  authPage: "login",
};
const planningViews = ["artists", "bookings", "schedule", "preparation"];

function readRoute(previous = initialRoute): MockRoute {
  try {
    const [section, ...parts] = window.location.hash
      .slice(1)
      .split("/")
      .map(decodeURIComponent);
    if (section === "planning" && planningViews.includes(parts[0]))
      return { ...previous, view: parts[0] as View };
    if (section === "external" && parts[0])
      return { ...previous, view: "external", externalLinkId: parts[0] };
    if (section === "auth")
      return {
        ...previous,
        view: "auth",
        authPage: parts.join(":") || "login",
      };
    if (
      section === "workspace" &&
      Object.hasOwn(viewLabels, parts[0]) &&
      !["external", "auth"].includes(parts[0])
    )
      return { ...previous, view: parts[0] as View };
  } catch {
    /* An invalid encoded hash falls back to the guest list. */
  }
  return { ...previous, view: "roster" };
}

function routeHash(route: MockRoute) {
  if (route.view === "external")
    return `#external/${encodeURIComponent(route.externalLinkId)}`;
  if (route.view === "auth")
    return `#auth/${route.authPage.split(":").map(encodeURIComponent).join("/")}`;
  return `#${planningViews.includes(route.view) ? "planning" : "workspace"}/${route.view}`;
}

export function useMockRoute() {
  const [route, setRoute] = useState(() => readRoute());
  const current = useRef(route);
  const initialized = useRef(false);
  current.current = route;
  useLayoutEffect(() => {
    const hash = routeHash(route);
    if (window.location.hash !== hash)
      window.history[initialized.current ? "pushState" : "replaceState"](
        null,
        "",
        hash,
      );
    initialized.current = true;
  }, [route]);
  useEffect(() => {
    const followHistory = () => {
      if (window.location.hash === routeHash(current.current)) return;
      // Browser back closes the top sheet first, using its existing dirty/busy guard.
      const dialog = [
        ...document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
      ].at(-1);
      if (dialog) {
        dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        window.history.pushState(null, "", routeHash(current.current));
        return;
      }
      setRoute(readRoute(current.current));
    };
    window.addEventListener("popstate", followHistory);
    window.addEventListener("hashchange", followHistory);
    return () => {
      window.removeEventListener("popstate", followHistory);
      window.removeEventListener("hashchange", followHistory);
    };
  }, []);
  return [route, setRoute] as const;
}
