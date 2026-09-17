import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, afterEach, before, test } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import type { User } from "@/lib/auth";
import messages from "@/messages/en.json";

type CountResult = { data: number | null; error: string | null };
const runtime = globalThis as typeof globalThis & {
  __homeCounts: Record<"guests" | "passwords", () => Promise<CountResult>>;
};
const zero = async (): Promise<CountResult> => ({ data: 0, error: null });
const originalFetch = globalThis.fetch;
runtime.__homeCounts = { guests: zero, passwords: zero };
Object.defineProperty(globalThis, "self", { configurable: true, value: window });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: window.localStorage });
document.getElementById("main-content")?.remove();

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const id = specifier.endsWith("lib/api/guest-limits") ? "guests"
      : specifier.endsWith("lib/api/password-reset-requests") ? "passwords" : null;
    return id ? { url: `mock:home-count:${id}`, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("mock:home-count:")) return nextLoad(url, context);
    const id = url.replace("mock:home-count:", "");
    const name = id === "guests" ? "fetchMyVenuePendingGuestLimitRequestCount" : "fetchPendingPasswordResetRequestCount";
    return { format: "module", shortCircuit: true,
      source: `export const ${name} = () => globalThis.__homeCounts.${id}();` };
  },
});

let Home: typeof import("@/app/page").default;
before(async () => { Home = (await import("@/app/page")).default; });
after(() => { hooks.deregister(); });
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  refreshCount = 0;
  runtime.__homeCounts = { guests: zero, passwords: zero };
  window.localStorage.clear();
});

const navigation: string[] = [];
let refreshCount = 0;
const router = {
  back() {}, forward() {}, refresh() { refreshCount += 1; }, hmrRefresh() {},
  push(href: string) { navigation.push(href); },
  replace() {}, prefetch() {},
};
const baseUser: User = {
  id: "home-operator", name: "Operator", email: "operator@example.test", role: "venue_admin",
  venue_id: "venue-a", account_kind: "personal", door_access_enabled: false, guest_limit: 20,
};

function frame(user: User | null) {
  return <AppRouterContext.Provider value={router}>
    <PathnameContext.Provider value="/">
      <NextIntlClientProvider locale="en" messages={messages}>
        <AuthSessionProvider initialUser={user}><RouteTransitionProvider><Home /></RouteTransitionProvider></AuthSessionProvider>
      </NextIntlClientProvider>
    </PathnameContext.Provider>
  </AppRouterContext.Provider>;
}

test("home recovers pending logout only while the missing identity is still current", async () => {
  for (const outcome of ["pending", "restored", "unmounted"] as const) {
    let finish!: (response: Response) => void;
    let logoutRequests = 0;
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "/api/auth/logout");
      assert.equal(init?.method, "POST");
      logoutRequests += 1;
      return new Promise<Response>((resolve) => { finish = resolve; });
    };
    const view = render(frame(null));
    assert.equal(logoutRequests, 1);
    if (outcome === "restored") view.rerender(frame(baseUser));
    if (outcome === "unmounted") view.unmount();

    await act(async () => finish(new Response(JSON.stringify({
      ok: false, code: "SESSION_REVOCATION_PENDING", revocationPending: true,
    }), { status: 503, headers: { "Content-Type": "application/json" } })));

    assert.equal(refreshCount, outcome === "pending" ? 1 : 0);
    assert.equal(logoutRequests, 1);
    cleanup();
    refreshCount = 0;
  }
});

test("home prioritizes the role's task and keeps admin shortcuts and count reads scoped", async () => {
  const cases: [User["role"], User["account_kind"], boolean, "door" | "guest"][] = [
    ["super_admin", "personal", false, "door"], ["venue_admin", "personal", false, "door"],
    ["door_staff", "personal", false, "door"], ["staff", "personal", false, "guest"],
    ["dj", "personal", false, "guest"], ["staff", "shared", true, "door"],
  ];
  for (const [role, account_kind, door_access_enabled, primary] of cases) {
    const reads: string[] = [];
    runtime.__homeCounts = {
      guests: async () => { reads.push("guests"); return zero(); },
      passwords: async () => { reads.push("passwords"); return zero(); },
    };
    render(frame({ ...baseUser, role, account_kind, door_access_enabled }));
    const tasks = screen.getByRole("navigation", { name: messages.Home.availableWorkspaces });
    const links = within(tasks).getAllByRole("link");
    assert.equal(links.some((link) => link.getAttribute("href")?.includes("tab=guests")), false);
    assert.equal(links.filter((link) => link.getAttribute("href") === "/door").length, primary === "door" ? 1 : 0);
    assert.equal(links[0].getAttribute("href"), `/${primary}`);
    assert.equal(Boolean(screen.queryByRole("navigation", { name: messages.Home.quickLinks })), role === "super_admin" || role === "venue_admin");
    await act(async () => {});
    assert.deepEqual(reads, role === "venue_admin" ? ["guests", "passwords"] : role === "super_admin" ? ["passwords"] : []);
    cleanup();
  }
});

test("home count failures stay distinct from zero and refresh recovers each request list", async () => {
  let finish!: (value: CountResult) => void;
  runtime.__homeCounts = {
    guests: () => new Promise((resolve) => { finish = resolve; }),
    passwords: async () => ({ data: 2, error: null }),
  };
  render(frame(baseUser));
  const queue = screen.getByRole("region", { name: messages.Home.requestsTitle });
  assert.equal(within(queue).queryByText("0 pending"), null);
  assert.equal(within(queue).queryByText(messages.Home.requestsEmpty), null);
  await act(async () => finish({ data: null, error: "UNAVAILABLE" }));
  assert.ok(within(queue).getByText(messages.Home.requestsUnavailable));
  assert.ok(within(queue).getByText("2 pending"));
  runtime.__homeCounts = { guests: zero, passwords: zero };
  fireEvent.click(within(queue).getByRole("button", { name: messages.Home.refreshRequests }));
  await waitFor(() => assert.ok(within(queue).getByText(messages.Home.requestsEmpty)));
  assert.equal(within(queue).queryByText(messages.Home.requestsUnavailable), null);
});

test("a previous account or venue's late counts cannot overwrite the current home", async () => {
  for (const change of [{ id: "another-operator" }, { venue_id: "venue-b" }]) {
    let finish!: (value: CountResult) => void;
    const previous = new Promise<CountResult>((resolve) => { finish = resolve; });
    runtime.__homeCounts = { guests: () => previous, passwords: () => previous };
    const view = render(frame(baseUser));
    runtime.__homeCounts = { guests: zero, passwords: zero };
    view.rerender(frame({ ...baseUser, ...change }));
    const queue = screen.getByRole("region", { name: messages.Home.requestsTitle });
    await waitFor(() => assert.ok(within(queue).getByText(messages.Home.requestsEmpty)));
    await act(async () => finish({ data: 7, error: null }));
    assert.equal(within(queue).queryByText("7 pending"), null);
    assert.ok(within(queue).getByText(messages.Home.requestsEmpty));
    cleanup();
  }
});

test("the existing guest shortcut stays available and ignores editable targets", async () => {
  render(frame({ ...baseUser, role: "dj" }));
  navigation.length = 0;
  const editor = document.createElement("input");
  document.body.append(editor);
  fireEvent.keyDown(editor, { key: "1" });
  assert.deepEqual(navigation, []);
  editor.remove();
  fireEvent.keyDown(window, { key: "1" });
  assert.deepEqual(navigation, ["/guest"]);
});
