import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";
import type { NextRouter } from "next/router";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { RouteTransitionProvider, useRouteLoadingTask, useRouteTransition } from "@/components/RouteTransitionProvider";
import WorkspaceShell from "@/components/WorkspaceShell";
import RouteLoadingShell from "@/components/RouteLoadingShell";
import WorkspaceNavigation from "@/components/workspace/WorkspaceNavigation";
import ViewportProvider from "@/components/viewport/ViewportProvider";
import OperationsScope from "@/components/operations/OperationsScope";
import { getWorkspaceActiveId, getWorkspaceItems, getWorkspacePrimaryItems } from "@/components/workspace/navigation";
import useAdminWorkspaceNavigation from "@/app/admin/useAdminWorkspaceNavigation";
import type { AccessSubject } from "@/lib/users/policy";
import type { AdminTask } from "@/lib/admin-navigation";
import { createLatestRequestGuard } from "@/lib/latest-request";
import { subscribeToRouteTransitionStart } from "@/lib/route-transition-events";
import messages from "@/messages/en.json";

const originalMatchMedia = window.matchMedia;
const admin: AccessSubject = { role: "venue_admin", accountKind: "personal", doorAccessEnabled: false };
Object.defineProperty(globalThis, "self", { configurable: true, value: window });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: window.localStorage });
window.requestAnimationFrame ??= globalThis.requestAnimationFrame;
window.cancelAnimationFrame ??= globalThis.cancelAnimationFrame;

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

function viewport(initialDesktop: boolean) {
  let desktop = initialDesktop;
  const listeners = new Set<() => void>();
  window.matchMedia = (query) => ({
    ...originalMatchMedia(query),
    get matches() { return query === "(min-width: 1000px)" ? desktop : query === "(max-width: 999px)" ? !desktop : false; },
    addEventListener(_type: string, callback: EventListenerOrEventListenerObject) {
      if (["(min-width: 1000px)", "(max-width: 999px)"].includes(query)) listeners.add(callback as () => void);
    },
    removeEventListener(_type: string, callback: EventListenerOrEventListenerObject) {
      listeners.delete(callback as () => void);
    },
  });
  return (next: boolean) => act(() => { desktop = next; listeners.forEach((listener) => listener()); });
}

function Providers({ children, pathname = "/admin", router = null }: { children: ReactNode; pathname?: string; router?: NextRouter | null }) {
  return <RouterContext.Provider value={router}><PathnameContext.Provider value={pathname}>
    <NextIntlClientProvider locale="en" messages={messages}>
      <RouteTransitionProvider>{children}</RouteTransitionProvider>
    </NextIntlClientProvider>
  </PathnameContext.Provider></RouterContext.Provider>;
}

test("workspace destinations respect real role and shared Door access policy", () => {
  const cases: [AccessSubject, string[]][] = [
    [admin, ["door", "events", "users"]],
    [{ ...admin, role: "super_admin" }, ["door", "events", "users", "venues"]],
    [{ ...admin, role: "door_staff" }, ["door"]],
    [{ ...admin, role: "staff" }, []],
    [{ ...admin, role: "dj", doorAccessEnabled: true }, []],
    [{ ...admin, role: "staff", accountKind: "shared", doorAccessEnabled: true }, ["door"]],
    [{ ...admin, role: "staff", accountKind: "shared" }, []],
  ];
  for (const [subject, allowed] of cases) {
    const items = getWorkspaceItems(subject);
    for (const id of ["door", "events", "users", "venues"]) {
      assert.equal(items.some((item) => item.id === id), allowed.includes(id), `${subject.role}/${subject.accountKind}/${id}`);
    }
    assert.ok(items.some((item) => item.href === "/guest"));
    assert.ok(items.some((item) => item.href === "/profile"));
    assert.equal(items.some((item) => ["artists", "bookings", "schedule", "preparation"].includes(item.id)), false);
  }
});

test("all existing admin tasks select a real destination, including create and legacy tasks", () => {
  const items = getWorkspaceItems({ ...admin, role: "super_admin" });
  const cases: [AdminTask, string][] = [
    ["guest-list", "door"], ["guest-requests", "requests"], ["event-manage", "events"],
    ["link-create", "links"], ["link-manage", "links"], ["user-create", "users"],
    ["user-list", "users"], ["password-requests", "password-requests"],
    ["analytics", "analytics"], ["venue-create", "venues"], ["venue-list", "venues"],
  ];
  for (const [task, id] of cases) {
    assert.equal(getWorkspaceActiveId("/admin", task, items), id);
    assert.equal(getWorkspacePrimaryItems(items, id).some((item) => item.id === id), id !== "events");
  }
  assert.equal(getWorkspaceActiveId("/admin", undefined, items), undefined);
  assert.equal(getWorkspaceActiveId("/admin", null, items), undefined);
  assert.equal(getWorkspaceActiveId("/guest", undefined, items), "guest");
  assert.equal(getWorkspaceActiveId("/profile", undefined, items), "profile");
});

function MenuHarness({ subject = admin, initial = "events", disabled = false }: {
  subject?: AccessSubject; initial?: string; disabled?: boolean;
}) {
  const [activeId, setActiveId] = useState(initial);
  return <div className="workspace-shell"><div className="page-scroll">
    <input aria-label="Unsubmitted name" defaultValue="Keep this name" />
    <WorkspaceNavigation items={getWorkspaceItems(subject)} activeId={activeId}
      actions={<button type="button">Add guest</button>}
      brandName="Authon" accountName="Operator" accountRole="Venue admin" disabled={disabled}
      counts={{ "password-requests": 3 }} onSelect={(item, event) => {
        event.preventDefault();
        setActiveId(item.id);
      }} />
  </div></div>;
}

test("the mobile dock leaves text entry clear and returns when the software keyboard closes", async () => {
  viewport(false);
  const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const visual = Object.assign(new window.EventTarget(), { height: window.innerHeight, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: visual });
  try {
    const view = render(<Providers><ViewportProvider><MenuHarness /></ViewportProvider></Providers>);
    const input = screen.getByLabelText("Unsubmitted name") as HTMLInputElement;
    const navigation = () => screen.queryByRole("navigation", { name: "Main navigation" });
    const resize = (height: number, scale = 1) => act(() => {
      Object.assign(visual, { height, scale });
      visual.dispatchEvent(new window.Event("resize"));
    });
    act(() => input.focus());
    assert.ok(navigation(), "hardware-keyboard focus alone keeps navigation available");
    resize(window.innerHeight - 70);
    assert.ok(navigation(), "browser toolbar changes are not a keyboard");
    resize(window.innerHeight / 2, 2);
    assert.ok(navigation(), "pinch zoom is not a keyboard");
    resize(window.innerHeight - 330);
    assert.equal(navigation(), null);
    assert.equal(screen.queryByRole("button", { name: "Add guest" }), null);
    assert.equal(document.activeElement, input);
    assert.equal(input.value, "Keep this name");
    resize(window.innerHeight - 100);
    assert.equal(navigation(), null, "do not reveal the dock midway through keyboard dismissal");
    act(() => input.blur());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    assert.equal(navigation(), null, "keep the dock hidden during keyboard dismissal");
    resize(window.innerHeight);
    assert.ok(navigation());
    resize(window.innerHeight - 330);
    assert.ok(navigation(), "a shrunken viewport without text entry is not a keyboard");
    view.unmount();
    assert.equal(document.documentElement.hasAttribute("data-keyboard-open"), false);
    resize(window.innerHeight);
    assert.equal(document.documentElement.hasAttribute("data-keyboard-open"), false, "viewport listeners are removed");
  } finally {
    cleanup();
    if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
    else Reflect.deleteProperty(window, "visualViewport");
  }
});

test("touch browsers that resize the layout viewport also restore the dock without losing input focus", () => {
  viewport(false);
  const media = window.matchMedia;
  window.matchMedia = (query) => ({ ...media(query), matches: query === "(any-pointer: coarse)" || media(query).matches });
  const initialHeight = window.innerHeight;
  const originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight")!;
  const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  try {
    render(<Providers><ViewportProvider><MenuHarness /></ViewportProvider></Providers>);
    const input = screen.getByLabelText("Unsubmitted name");
    act(() => input.focus());
    act(() => {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: initialHeight - 300 });
      window.dispatchEvent(new window.Event("resize"));
    });
    assert.equal(screen.queryByRole("navigation", { name: "Main navigation" }) === null, true);
    act(() => {
      Object.defineProperty(window, "innerHeight", originalHeight);
      window.dispatchEvent(new window.Event("resize"));
    });
    assert.ok(screen.getByRole("navigation", { name: "Main navigation" }));
    assert.equal(document.activeElement, input);
  } finally {
    cleanup();
    Object.defineProperty(window, "innerHeight", originalHeight);
    if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
    else Reflect.deleteProperty(window, "visualViewport");
    window.matchMedia = media;
  }
});

test("mobile all-menu traps focus, preserves input and exposes every permitted task", async () => {
  viewport(false);
  render(<Providers><MenuHarness /></Providers>);
  const action = screen.getByRole("button", { name: "Add guest" });
  const navigation = screen.getByRole("navigation", { name: "Main navigation" });
  assert.ok(action.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING);
  const trigger = screen.getByRole("button", { name: "All menus" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "All menus" });
  const close = within(dialog).getByRole("button", { name: "Close" });
  assert.equal(document.activeElement === close, true);
  assert.ok(document.querySelector(".workspace-shell")?.closest("[inert]"));
  assert.ok(within(dialog).getByRole("link", { name: "Accounts" }));
  assert.equal(within(dialog).queryByRole("link", { name: "Venues" }), null);
  const profile = within(dialog).getByRole("link", { name: "My account" });
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  assert.equal(document.activeElement === profile, true);
  profile.focus();
  fireEvent.keyDown(profile, { key: "Tab" });
  assert.equal(document.activeElement === close, true);
  fireEvent.keyDown(close, { key: "Escape" });
  assert.equal(screen.queryByRole("dialog", { name: "All menus" }) === null, true);
  await act(async () => {});
  assert.equal(document.activeElement === trigger, true);
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
  assert.equal((screen.getByRole("textbox") as HTMLInputElement).value, "Keep this name");
});

test("desktop categories remain expanded across task changes and expose pending work on its destination", () => {
  viewport(true);
  render(<Providers><MenuHarness initial="users" /></Providers>);
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  assert.ok(within(nav).getByRole("heading", { name: "Management" }));
  assert.ok(within(nav).getByRole("heading", { name: "Event preparation" }));
  assert.equal(within(nav).queryByRole("button", { name: "Management" }), null);
  const accounts = within(nav).getByRole("link", { name: "Accounts" });
  accounts.focus();
  assert.ok(within(nav).getByRole("link", { name: "Analytics" }));
  assert.ok(within(nav).getByLabelText("3 pending"));
  fireEvent.click(within(nav).getByRole("link", { name: "Events" }));
  assert.equal(within(nav).getByRole("link", { name: "Events" }).getAttribute("aria-current"), "page");
  assert.equal(within(nav).getByRole("link", { name: "Accounts" }), accounts);
  assert.ok(within(nav).getByRole("link", { name: "Analytics" }));
});

test("changing navigation viewport retains the same body input and recovers focus from an open menu", () => {
  const resize = viewport(false);
  render(<Providers><MenuHarness initial="door" /></Providers>);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Still typing" } });
  fireEvent.click(screen.getByRole("button", { name: "All menus" }));
  resize(true);
  assert.equal(screen.queryByRole("dialog", { name: "All menus" }) === null, true);
  const door = screen.getByRole("link", { name: messages.Workspace.door });
  assert.equal(document.activeElement === door, true);
  assert.equal(screen.getByRole("textbox"), input);
  resize(false);
  assert.equal(document.activeElement === screen.getByRole("link", { name: messages.Workspace.door }), true);
  assert.equal((input as HTMLInputElement).value, "Still typing");
});

test("mobile scope choices retain their owner state when the controls move between sheet and desktop", async () => {
  const resize = viewport(false);
  function ScopeHarness() {
    const [event, setEvent] = useState("General roster");
    return <div className="workspace-shell"><OperationsScope venueName="Test venue" date="2026-09-17" label={event}>
      <label htmlFor="test-event">Event</label>
      <select id="test-event" value={event} onChange={(e) => setEvent(e.target.value)}>
        <option>General roster</option><option>Night event</option>
      </select>
    </OperationsScope><output>{event}</output></div>;
  }
  render(<Providers><ScopeHarness /></Providers>);
  const trigger = screen.getByRole("button", { name: messages.Workspace.chooseScope });
  assert.equal(screen.queryByRole("combobox") === null, true);
  trigger.focus(); fireEvent.click(trigger);
  const selector = screen.getByRole("combobox", { name: "Event" });
  fireEvent.change(selector, { target: { value: "Night event" } });
  fireEvent.click(screen.getByRole("button", { name: messages.Workspace.applyScope }));
  await waitFor(() => assert.equal(document.activeElement === trigger, true));
  assert.match(trigger.textContent ?? "", /Night event/);
  fireEvent.click(trigger);
  screen.getByRole("combobox").focus();
  resize(true);
  assert.equal(screen.queryByRole("dialog", { name: "All menus" }) === null, true);
  assert.equal((screen.getByRole("combobox") as HTMLSelectElement).value, "Night event");
  assert.equal(document.activeElement === screen.getByRole("combobox"), true);
  resize(false);
  assert.ok(screen.getByRole("dialog", { name: messages.Workspace.chooseScope }));
  assert.equal((screen.getByRole("combobox") as HTMLSelectElement).value, "Night event");
});

test("workspace menu and navigation respect the busy lock", () => {
  viewport(false);
  render(<Providers><MenuHarness initial="door" disabled /></Providers>);
  assert.equal((screen.getByRole("button", { name: "All menus" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByRole("link", { name: messages.Workspace.myRoster }));
  assert.equal(screen.getByRole("link", { name: messages.Workspace.door }).getAttribute("aria-current"), "page");
});

function AdminShellHarness({ loading = false, capture }: {
  loading?: boolean; capture?: (transition: ReturnType<typeof useRouteTransition>) => void;
}) {
  useRouteLoadingTask(loading);
  const transition = useRouteTransition();
  capture?.(transition);
  const navigation = useAdminWorkspaceNavigation({
    businessDate: "2026-09-16", hasCurrentVenue: true, isSuperAdmin: true,
    isRouteTransitionActive: false, venueId: "venue-a",
  });
  return <AuthSessionProvider initialUser={{
    id: "operator", name: "Operator", email: "operator@example.test", role: "super_admin",
    account_kind: "personal", door_access_enabled: false, guest_limit: null,
  }}>
    <WorkspaceShell actions={<button type="button">Workspace action</button>}
      adminNavigation={{ activeTask: navigation.activeTask, onTaskChange: navigation.changeTask }}>
      <input aria-label="Workspace draft" defaultValue="Keep draft" />
      <output data-testid="task">{navigation.activeTask}</output>
      <output data-testid="event">{navigation.selectedEventId}</output>
      <output data-testid="date">{navigation.selectedDate}</output>
    </WorkspaceShell>
  </AuthSessionProvider>;
}

test("sidebar collapse exposes named destinations and preserves the workspace across viewport changes", () => {
  const resize = viewport(true);
  render(<Providers><AdminShellHarness /></Providers>);
  const draft = screen.getByRole("textbox", { name: "Workspace draft" });
  fireEvent.change(draft, { target: { value: "Still editing" } });
  const collapse = screen.getByRole("button", { name: messages.Workspace.collapseSidebar });
  collapse.focus();
  fireEvent.click(collapse);
  const expand = screen.getByRole("button", { name: messages.Workspace.expandSidebar });
  assert.equal(expand.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement === expand, true);
  assert.equal(window.localStorage.getItem("workspace:sidebarCollapsed"), "true");
  assert.ok(screen.getByRole("link", { name: "Accounts" }));
  assert.ok(screen.getByRole("link", { name: "Venues" }));
  resize(false);
  assert.equal(screen.queryByRole("button", { name: messages.Workspace.expandSidebar }) === null, true);
  assert.ok(screen.getByRole("button", { name: "All menus" }));
  assert.equal(screen.getByRole("textbox", { name: "Workspace draft" }), draft);
  resize(true);
  fireEvent.click(screen.getByRole("button", { name: messages.Workspace.expandSidebar }));
  assert.equal(screen.getByRole("button", { name: messages.Workspace.collapseSidebar }).getAttribute("aria-expanded"), "true");
  assert.equal((draft as HTMLInputElement).value, "Still editing");
  assert.equal(window.localStorage.getItem("workspace:sidebarCollapsed"), "false");
});

test("real product shell drives the existing admin hook and restores event scope through browser history", () => {
  viewport(true);
  window.history.replaceState(null, "", "/admin?tab=events&venue=venue-a&eventId=event-a&date=2026-09-15");
  render(<Providers><AdminShellHarness /></Providers>);
  assert.equal(screen.getByTestId("task").textContent, "event-manage");
  assert.equal(screen.getByTestId("event").textContent, "event-a");
  fireEvent.click(screen.getByRole("link", { name: "Analytics" }));
  assert.equal(screen.getByTestId("task").textContent, "analytics");
  assert.equal(window.location.search, "?tab=analytics");
  assert.equal(screen.getByRole("link", { name: "Analytics" }).getAttribute("aria-current"), "page");
  window.history.replaceState(null, "", "/admin?tab=events&venue=venue-a&eventId=event-a&date=2026-09-15");
  act(() => window.dispatchEvent(new Event("popstate")));
  assert.equal(screen.getByTestId("task").textContent, "event-manage");
  assert.equal(screen.getByTestId("event").textContent, "event-a");
  assert.equal(screen.getByTestId("date").textContent, "2026-09-15");
  assert.equal(screen.getByRole("link", { name: "Events" }).getAttribute("aria-current"), "page");
});

test("loading and loaded workspaces share one footer and the same role-filtered navigation", () => {
  viewport(true);
  function Harness({ loading }: { loading: boolean }) {
    return <Providers pathname="/door"><AuthSessionProvider initialUser={{
      id: "door", name: "Door operator", email: "door@example.test", role: "door_staff",
      account_kind: "personal", door_access_enabled: false, guest_limit: null,
    }}>
      {loading ? <RouteLoadingShell /> : <WorkspaceShell><p>Roster content</p></WorkspaceShell>}
    </AuthSessionProvider></Providers>;
  }
  const view = render(<Harness loading={false} />);
  const links = within(screen.getByRole("navigation", { name: "Main navigation" }))
    .getAllByRole("link").map((link) => link.getAttribute("href"));
  const footer = screen.getByRole("contentinfo").textContent;
  view.rerender(<Harness loading />);
  assert.equal(screen.getAllByRole("contentinfo").length, 1);
  assert.equal(screen.getByRole("contentinfo").textContent, footer);
  assert.equal(within(view.container).getAllByRole("main").length, 1);
  assert.deepEqual(within(screen.getByRole("navigation", { name: "Main navigation" }))
    .getAllByRole("link").map((link) => link.getAttribute("href")), links);
  assert.equal(screen.queryByRole("link", { name: "Accounts" }) === null, true);
});

function routerRecorder(destinations: string[]): NextRouter {
  return {
    pathname: "/admin", route: "/admin", asPath: "/admin", query: {},
    push: async (href: string) => { destinations.push(href); return true; },
    prefetch: async () => {},
  } as unknown as NextRouter;
}

for (const desktop of [true, false]) {
  test(`${desktop ? "desktop" : "mobile"} navigation stays usable during loading and retains focus after the latest route finishes`, async () => {
    viewport(desktop);
    window.history.replaceState(null, "", "/admin");
    const destinations: string[] = [];
    const router = routerRecorder(destinations);
    let transition!: ReturnType<typeof useRouteTransition>;
    const frame = (pathname: string, loading: boolean) => <Providers pathname={pathname} router={router}>
      <AdminShellHarness loading={loading} capture={(value) => { transition = value; }} />
    </Providers>;
    const view = render(frame("/admin", true));
    const main = within(view.container).getByRole("main");
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    assert.equal(main.hasAttribute("inert"), true);
    assert.equal(main.getAttribute("aria-busy"), "true");
    assert.equal(nav.closest("[inert]") === null, true);
    const pageActions = view.container.querySelectorAll(".workspace-header-actions, .workspace-context-actions");
    assert.ok(pageActions.length > 0);
    for (const actions of pageActions) assert.equal(actions.hasAttribute("inert"), true);
    const restoreFromOldRoute = transition.requestFocusRestore;
    let finishOldRoute!: () => void;
    act(() => { finishOldRoute = transition.registerRouteLoadingTask(); });

    fireEvent.click(screen.getByRole("button", { name: messages.Workspace.profile }));
    const account = screen.getByRole(desktop ? "region" : "dialog", { name: "Operator" });
    assert.equal(account.closest(".product-sheet-layer")?.hasAttribute("inert"), false);
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    assert.equal(screen.queryByRole("dialog", { name: "All menus" }) === null, true);

    if (desktop) {
      fireEvent.click(screen.getByRole("button", { name: messages.Workspace.collapseSidebar }));
      fireEvent.click(screen.getByRole("button", { name: messages.Workspace.expandSidebar }));
    }
    const door = within(nav).getByRole("link", { name: messages.Workspace.door });
    door.focus();
    fireEvent.click(door);
    assert.notEqual(door.getAttribute("aria-disabled"), "true");
    if (!desktop) fireEvent.click(screen.getByRole("button", { name: "All menus" }));
    const profile = (desktop ? nav : screen.getByRole("dialog", { name: "All menus" }))
      .querySelector<HTMLAnchorElement>('a[href="/profile"]')!;
    profile.focus();
    fireEvent.click(profile);
    assert.deepEqual(destinations, ["/door", "/profile"]);

    // Keep using navigation while the content underneath it finishes.
    if (!desktop) fireEvent.click(screen.getByRole("button", { name: "All menus" }));
    const focused = document.activeElement;
    window.history.replaceState(null, "", "/profile");
    view.rerender(frame("/profile", false));
    await waitFor(() => assert.equal(document.querySelector(".route-transition-overlay") === null, true));
    await act(async () => { await new Promise((resolve) => window.requestAnimationFrame(resolve)); });
    assert.equal(document.activeElement === focused, true);
    assert.equal(main.hasAttribute("inert"), false);
    assert.equal(main.hasAttribute("aria-busy"), false);
    for (const actions of pageActions) assert.equal(actions.hasAttribute("inert"), false);

    act(() => {
      finishOldRoute();
      restoreFromOldRoute({ current: main });
    });
    await act(async () => { await new Promise((resolve) => window.requestAnimationFrame(resolve)); });
    assert.equal(document.querySelector(".route-transition-overlay") === null, true);
    assert.equal(document.activeElement === focused, true);
    if (!desktop) {
      fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
      assert.equal(nav.closest("[inert]") === null, true);
    }
  });
}

test("choosing the current admin task cancels a pending route without abandoning its data request", async () => {
  viewport(true);
  window.history.replaceState(null, "", "/admin?tab=events&view=manage");
  const destinations: string[] = [];
  const router = routerRecorder(destinations);
  const guard = createLatestRequestGuard();
  const unsubscribe = subscribeToRouteTransitionStart(guard.invalidateRequests);
  try {
    const frame = (pathname: string) => <Providers pathname={pathname} router={router}><AdminShellHarness /></Providers>;
    const view = render(frame("/admin"));
    const isLatestRead = guard.beginRequest();
    fireEvent.click(screen.getByRole("link", { name: messages.Workspace.door }));
    fireEvent.click(screen.getByRole("link", { name: messages.Workspace.events }));
    assert.deepEqual(destinations, ["/door", "/admin?tab=events&view=manage"]);
    assert.equal(isLatestRead(), true);
    await waitFor(() => assert.equal(document.querySelector(".route-transition-overlay")?.getAttribute("data-state"), "leaving"));
    fireEvent.click(screen.getByRole("link", { name: messages.Workspace.events }));
    await waitFor(() => assert.equal(document.querySelector(".route-transition-overlay") === null, true));

    fireEvent.click(screen.getByRole("link", { name: messages.Workspace.door }));
    window.history.replaceState(null, "", "/door");
    view.rerender(frame("/door"));
    assert.equal(isLatestRead(), false);
  } finally { unsubscribe(); }
});


test("authenticated server output stays on loading until home and the matching navigation hydrate together", async () => {
  for (const desktop of [true, false]) {
    viewport(desktop);
    window.localStorage.setItem("workspace:sidebarCollapsed", "true");
    const commits: { sidebar: boolean; dock: boolean; collapsed: boolean }[] = [];
    function ContentProbe() {
      useLayoutEffect(() => {
        // Record the frame at the first animation opportunity, after layout effects.
        const frame = requestAnimationFrame(() => commits.push({
          sidebar: Boolean(document.querySelector(".workspace-sidebar")),
          dock: Boolean(document.querySelector(".workspace-dock")),
          collapsed: document.querySelector(".workspace-shell")?.getAttribute("data-sidebar-collapsed") === "true",
        }));
        return () => cancelAnimationFrame(frame);
      }, []);
      return <h1>Home ready</h1>;
    }
    const frame = <Providers pathname="/"><AuthSessionProvider initialUser={{
      id: "operator", name: "Operator", email: "operator@example.test", role: "venue_admin",
      account_kind: "personal", door_access_enabled: false, guest_limit: null,
    }}><WorkspaceShell><ContentProbe /></WorkspaceShell></AuthSessionProvider></Providers>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(frame);
    document.body.append(container);
    assert.equal(within(container).getByRole("status").textContent, messages.Common.loading);
    assert.equal(within(container).queryByRole("heading", { name: "Home ready" }) === null, true);
    assert.equal(within(container).queryByRole("navigation") === null, true);
    assert.equal(within(container).getByRole("main").getAttribute("aria-busy"), "true");
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, frame, { onRecoverableError: error => errors.push(error) }); });
      await waitFor(() => assert.equal(commits.length, 1));
      assert.deepEqual(commits, [{ sidebar: desktop, dock: !desktop, collapsed: true }]);
      assert.deepEqual(errors, []);
      assert.ok(within(container).getByRole("heading", { name: "Home ready" }));
      assert.ok(within(container).getByRole("navigation", { name: messages.Workspace.navigation }));
      assert.equal(within(container).queryByRole("status") === null, true);
      assert.equal(within(container).getAllByRole("main").length, 1);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  }
});

test("blocked preference storage cannot keep the authenticated workspace on the loading screen", () => {
  viewport(true);
  const original = window.Storage.prototype.getItem;
  window.Storage.prototype.getItem = () => { throw new Error("Storage unavailable"); };
  try {
    render(<Providers pathname="/"><AuthSessionProvider initialUser={{
      id: "operator", name: "Operator", email: "operator@example.test", role: "door_staff",
      account_kind: "personal", door_access_enabled: false, guest_limit: null,
    }}><WorkspaceShell><h1>Home ready</h1></WorkspaceShell></AuthSessionProvider></Providers>);
    assert.ok(screen.getByRole("heading", { name: "Home ready" }));
    assert.ok(screen.getByRole("navigation", { name: messages.Workspace.navigation }));
    assert.equal(screen.queryByRole("status") === null, true);
  } finally { window.Storage.prototype.getItem = original; }
});


test("Events stays out of the mobile dock even while active and remains in the full menu", () => {
  viewport(false);
  render(<Providers><MenuHarness initial="events" /></Providers>);
  const dock = screen.getByRole("navigation", { name: messages.Workspace.navigation });
  assert.equal(within(dock).queryByRole("link", { name: messages.Workspace.events }) === null, true);
  fireEvent.click(screen.getByRole("button", { name: messages.Workspace.allMenu }));
  const events = within(screen.getByRole("dialog", { name: "All menus" })).getByRole("link", { name: messages.Workspace.events });
  assert.equal(events.getAttribute("aria-current"), "page");
  fireEvent.click(events);
  assert.equal(screen.queryByRole("dialog", { name: "All menus" }) === null, true);
  assert.equal(screen.queryByRole("link", { name: messages.Workspace.events }) === null, true);
});

test("mobile menu closes from its own control and restores the dock trigger", async () => {
  viewport(false);
  render(<Providers><MenuHarness initial="door" /></Providers>);
  const trigger = screen.getByRole("button", { name: messages.Workspace.allMenu });
  trigger.focus(); fireEvent.click(trigger);
  const panel = screen.getByRole("dialog", { name: "All menus" });
  assert.equal(panel.getAttribute("aria-modal"), "true");
  assert.ok(document.querySelector(".workspace-shell")?.closest("[inert]"));
  fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
  assert.equal(panel.isConnected, false);
  await act(async () => {});
  assert.equal(document.activeElement === trigger, true);
  fireEvent.click(trigger);
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  await act(async () => {});
  assert.equal(screen.queryByRole("dialog", { name: "All menus" }) === null, true);
  assert.equal(document.activeElement === trigger, true);
});

test("menu reduced-motion dismissal releases focus and scroll immediately", async () => {
  viewport(false);
  const media = window.matchMedia;
  window.matchMedia = query => query === "(prefers-reduced-motion: reduce)" ? { ...media(query), matches: true } : media(query);
  render(<Providers><MenuHarness /></Providers>);
  const trigger = screen.getByRole("button", { name: messages.Workspace.allMenu });
  trigger.focus(); fireEvent.click(trigger, { detail: 1 });
  fireEvent.click(within(screen.getByRole("dialog", { name: "All menus" })).getByRole("button", { name: messages.Workspace.close }), { detail: 1 });
  assert.equal(screen.queryByRole("dialog", { name: "All menus" }) === null, true);
  assert.equal(document.querySelector(".workspace-menu-panel") === null, true);
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
  await act(async () => {});
  assert.equal(document.activeElement === trigger, true);
});

test("header measurements follow viewport changes without requiring ResizeObserver", () => {
  viewport(false);
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  let height = 74;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains("workspace-header")
      ? { ...originalRect.call(this), height } as DOMRect : originalRect.call(this);
  };
  try {
    render(<Providers><AdminShellHarness /></Providers>);
    const shell = document.querySelector<HTMLElement>(".workspace-shell")!;
    assert.equal(shell.style.getPropertyValue("--app-header-height"), "74px");
    height = 106;
    act(() => window.dispatchEvent(new Event("resize")));
    assert.equal(shell.style.getPropertyValue("--app-header-height"), "106px");
  } finally { HTMLElement.prototype.getBoundingClientRect = originalRect; }
});


test("revealing a mobile destination scrolls only the pill row", () => {
  viewport(false);
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalScroll = HTMLElement.prototype.scrollIntoView;
  let pageScrolls = 0;
  HTMLElement.prototype.scrollIntoView = () => { pageScrolls++; };
  HTMLElement.prototype.getBoundingClientRect = function () {
    const rect = originalRect.call(this);
    if (this.classList.contains("workspace-primary-scroll")) return { ...rect, left: 10, right: 210 } as DOMRect;
    if (this.getAttribute("aria-current") === "page") return { ...rect, left: 180, right: 260 } as DOMRect;
    return rect;
  };
  try {
    render(<Providers><MenuHarness initial="guest" /></Providers>);
    assert.equal(document.querySelector<HTMLElement>(".workspace-primary-scroll")!.scrollLeft, 50);
    assert.equal(pageScrolls, 0);
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    HTMLElement.prototype.scrollIntoView = originalScroll;
  }
});
