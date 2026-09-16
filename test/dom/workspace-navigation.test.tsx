import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import WorkspaceShell from "@/components/WorkspaceShell";
import RouteLoadingShell from "@/components/RouteLoadingShell";
import WorkspaceNavigation from "@/components/workspace/WorkspaceNavigation";
import { getWorkspaceActiveId, getWorkspaceItems, getWorkspacePrimaryItems } from "@/components/workspace/navigation";
import useAdminWorkspaceNavigation from "@/app/admin/useAdminWorkspaceNavigation";
import type { AccessSubject } from "@/lib/users/policy";
import type { AdminTask } from "@/lib/admin-navigation";
import messages from "@/messages/en.json";

const originalMatchMedia = window.matchMedia;
const admin: AccessSubject = { role: "venue_admin", accountKind: "personal", doorAccessEnabled: false };
Object.defineProperty(globalThis, "self", { configurable: true, value: window });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: window.localStorage });

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
    get matches() { return query === "(min-width: 1000px)" ? desktop : false; },
    addEventListener(_type: string, callback: EventListenerOrEventListenerObject) {
      if (query === "(min-width: 1000px)") listeners.add(callback as () => void);
    },
    removeEventListener(_type: string, callback: EventListenerOrEventListenerObject) {
      listeners.delete(callback as () => void);
    },
  });
  return (next: boolean) => act(() => { desktop = next; listeners.forEach((listener) => listener()); });
}

function Providers({ children, pathname = "/admin" }: { children: ReactNode; pathname?: string }) {
  return <PathnameContext.Provider value={pathname}>
    <NextIntlClientProvider locale="en" messages={messages}>
      <RouteTransitionProvider>{children}</RouteTransitionProvider>
    </NextIntlClientProvider>
  </PathnameContext.Provider>;
}

test("workspace destinations respect real role and shared Door access policy", () => {
  const cases: [AccessSubject, string[]][] = [
    [admin, ["roster", "door", "events", "users"]],
    [{ ...admin, role: "super_admin" }, ["roster", "door", "events", "users", "venues"]],
    [{ ...admin, role: "door_staff" }, ["door"]],
    [{ ...admin, role: "staff" }, []],
    [{ ...admin, role: "dj", doorAccessEnabled: true }, []],
    [{ ...admin, role: "staff", accountKind: "shared", doorAccessEnabled: true }, ["door"]],
    [{ ...admin, role: "staff", accountKind: "shared" }, []],
  ];
  for (const [subject, allowed] of cases) {
    const items = getWorkspaceItems(subject);
    for (const id of ["roster", "door", "events", "users", "venues"]) {
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
    ["guest-list", "roster"], ["guest-requests", "requests"], ["event-manage", "events"],
    ["link-create", "links"], ["link-manage", "links"], ["user-create", "users"],
    ["user-list", "users"], ["password-requests", "password-requests"],
    ["analytics", "analytics"], ["venue-create", "venues"], ["venue-list", "venues"],
  ];
  for (const [task, id] of cases) {
    assert.equal(getWorkspaceActiveId("/admin", task, items), id);
    assert.ok(getWorkspacePrimaryItems(items, id).some((item) => item.id === id));
  }
  assert.equal(getWorkspaceActiveId("/guest", undefined, items), "guest");
  assert.equal(getWorkspaceActiveId("/profile", undefined, items), "profile");
});

function MenuHarness({ subject = admin, initial = "roster", disabled = false }: {
  subject?: AccessSubject; initial?: string; disabled?: boolean;
}) {
  const [activeId, setActiveId] = useState(initial);
  return <div className="workspace-shell"><div className="page-scroll">
    <input aria-label="Unsubmitted name" defaultValue="Keep this name" />
    <WorkspaceNavigation items={getWorkspaceItems(subject)} activeId={activeId}
      brandName="Authon" accountName="Operator" accountRole="Venue admin" disabled={disabled}
      counts={{ "password-requests": 3 }} onSelect={(item, event) => {
        event.preventDefault();
        setActiveId(item.id);
      }} />
  </div></div>;
}

test("mobile all-menu traps focus, restores its trigger, preserves input and exposes every permitted task", () => {
  viewport(false);
  render(<Providers><MenuHarness /></Providers>);
  const trigger = screen.getByRole("button", { name: "All menus" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "All menus" });
  const close = within(dialog).getByRole("button", { name: "Close" });
  assert.equal(document.activeElement, close);
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), true);
  assert.ok(within(dialog).getByRole("link", { name: "Accounts" }));
  assert.equal(within(dialog).queryByRole("link", { name: "Venues" }), null);
  const profile = within(dialog).getByRole("link", { name: "My account" });
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  assert.equal(document.activeElement, profile);
  fireEvent.keyDown(profile, { key: "Tab" });
  assert.equal(document.activeElement, close);
  fireEvent.keyDown(close, { key: "Escape" });
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, trigger);
  assert.equal(document.querySelector(".workspace-shell")?.hasAttribute("inert"), false);
  assert.equal((screen.getByRole("textbox") as HTMLInputElement).value, "Keep this name");
});

test("desktop groups follow selection, report pending work and recover focus when a group is hidden", () => {
  viewport(true);
  render(<Providers><MenuHarness initial="users" /></Providers>);
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  const management = within(nav).getByRole("button", { name: "Management" });
  assert.equal(management.getAttribute("aria-expanded"), "true");
  const accounts = within(nav).getByRole("link", { name: "Accounts" });
  accounts.focus();
  const preparation = within(nav).getByRole("button", { name: "Event preparation" });
  fireEvent.click(preparation);
  const managementClosed = within(nav).getByRole("button", { name: /Management/ });
  assert.equal(managementClosed.getAttribute("aria-expanded"), "false");
  assert.ok(within(managementClosed).getByLabelText("3 pending"));
  fireEvent.click(within(nav).getByRole("link", { name: "Events" }));
  assert.equal(within(nav).getByRole("link", { name: "Events" }).getAttribute("aria-current"), "page");
});

test("changing navigation viewport retains the same body input and recovers focus from an open menu", () => {
  const resize = viewport(false);
  render(<Providers><MenuHarness initial="door" /></Providers>);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Still typing" } });
  fireEvent.click(screen.getByRole("button", { name: "All menus" }));
  resize(true);
  assert.equal(screen.queryByRole("dialog"), null);
  const door = screen.getByRole("link", { name: "Door" });
  assert.equal(document.activeElement, door);
  assert.equal(screen.getByRole("textbox"), input);
  resize(false);
  assert.equal(document.activeElement, screen.getByRole("link", { name: "Door" }));
  assert.equal((input as HTMLInputElement).value, "Still typing");
});

test("workspace menu and navigation respect the busy lock", () => {
  viewport(false);
  render(<Providers><MenuHarness disabled /></Providers>);
  assert.equal((screen.getByRole("button", { name: "All menus" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByRole("link", { name: "Door" }));
  assert.equal(screen.getByRole("link", { name: "Roster" }).getAttribute("aria-current"), "page");
});

function AdminShellHarness() {
  const navigation = useAdminWorkspaceNavigation({
    businessDate: "2026-09-16", hasCurrentVenue: true, isSuperAdmin: true,
    isRouteTransitionActive: false, venueId: "venue-a",
  });
  return <AuthSessionProvider initialUser={{
    id: "operator", name: "Operator", email: "operator@example.test", role: "super_admin",
    account_kind: "personal", door_access_enabled: false, guest_limit: null,
  }}>
    <WorkspaceShell adminNavigation={{ activeTask: navigation.activeTask, onTaskChange: navigation.changeTask }}>
      <output data-testid="task">{navigation.activeTask}</output>
      <output data-testid="event">{navigation.selectedEventId}</output>
      <output data-testid="date">{navigation.selectedDate}</output>
    </WorkspaceShell>
  </AuthSessionProvider>;
}

test("real product shell drives the existing admin hook and restores event scope through browser history", () => {
  viewport(true);
  window.history.replaceState(null, "", "/admin?tab=events&venue=venue-a&eventId=event-a&date=2026-09-15");
  render(<Providers><AdminShellHarness /></Providers>);
  assert.equal(screen.getByTestId("task").textContent, "event-manage");
  assert.equal(screen.getByTestId("event").textContent, "event-a");
  fireEvent.click(screen.getByRole("button", { name: "Reports" }));
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
  assert.equal(screen.queryByRole("link", { name: "Accounts" }), null);
});
