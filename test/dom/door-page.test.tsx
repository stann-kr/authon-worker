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

const runtime = globalThis as typeof globalThis & {
  __doorPageTest: {
    venueReady: boolean; deleted: boolean; deleteCalls: number; deleteError: boolean; summaryError: boolean;
    reads: Array<{ date: string; venueId: string; eventId: string | null }>;
  };
};
const reset = () => { runtime.__doorPageTest = { venueReady: true, deleted: false, deleteCalls: 0, deleteError: false, summaryError: false, reads: [] }; };
reset();
Object.defineProperty(globalThis, "self", { configurable: true, value: window });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: window.localStorage });
document.getElementById("main-content")?.remove();

const sources: Record<string, string> = {
  "lib/guest-snapshots/client": `export const fetchGuestOperationsSnapshot = async (date, venueId, eventId) => {
    globalThis.__doorPageTest.reads.push({ date, venueId, eventId });
    return { data: { guests: globalThis.__doorPageTest.deleted ? [] : [{ id: 'g1', name: 'Roster guest', status: 'pending', createdAt: '2026-09-15T10:00:00Z' }],
      users: [], externalLinks: [], failedSections: [], offlineRosterStatus: 'unavailable' }, error: null };
  };`,
  "lib/guests/client": "export const fetchGuestsByDate = async () => ({ data: [], error: null });",
  "lib/api/guests": `export const updateGuestStatus = async () => ({ data: null, error: 'UNEXPECTED_MUTATION' });
    export const deleteGuest = async () => { const state = globalThis.__doorPageTest; state.deleteCalls++;
      if (state.deleteError) return { data: null, error: 'UNAVAILABLE' };
      state.deleted = true; return { data: { id: 'g1', name: 'Roster guest', status: 'deleted' }, error: null }; };`,
  "lib/attendance/client": `export const fetchDoorAttendanceSummary = async ({scope}) => globalThis.__doorPageTest.summaryError
    ? { data: null, error: 'UNAVAILABLE' } : { data: { ...scope, checkedInGuests: 0, walkIns: 0, totalAttendance: 0,
      sourceActivityCount: 0, isFinalized: scope.eventId === 'finalized', finalizedAt: null,
      canFinalize: scope.eventId === 'closed' || !scope.eventId, canRecord: false, lastUndoableIdempotencyKey: null,
      unavailableReason: scope.eventId === 'draft' ? 'event_inactive' : 'past_date', serverUpdatedAt: '2026-09-15T10:00:00Z' }, error: null };`,
  "lib/api/attendance": "export const reconcileDoorAttendance = async () => ({data: null, error: 'UNEXPECTED_MUTATION'}); export const syncDoorAttendanceMutations = reconcileDoorAttendance;",
  "lib/api/offline-door": "export const findDoorGuestByCode = async () => ({data: null, error: null}); export const syncOfflineDoorMutations = async () => ({ data: [], error: null });",
  "lib/door/client": "export const fetchOfflineDoorRoster = async () => ({data: [], error: null});",
  "lib/door/offline-store": `export const listOfflineDoorMutations = async () => []; export const loadOfflineDoorRoster = async () => null;
    export const clearResolvedOfflineDoorMutations = async () => {}; export const enqueueOfflineDoorMutation = async () => { throw new Error('Unexpected enqueue'); };
    export const removeOfflineDoorRoster = async () => {}; export const resolveOfflineDoorMutation = async () => {}; export const saveOfflineDoorRoster = async () => {};`,
  "lib/attendance/offline-store": `export const listAttendanceMutations = async () => []; export const getAttendanceDeviceId = async () => 'device-1';
    export const groupAttendanceMutationsByDevice = () => []; export const clearResolvedAttendanceMutations = async () => {};
    export const enqueueAttendanceMutation = async () => { throw new Error('Unexpected enqueue'); };
    export const removeAttendanceMutations = async () => {}; export const resolveAttendanceMutation = async () => {};`,
  "lib/events/client": `export const fetchEvents = async () => ({ data: ['active', 'draft', 'closed', 'finalized'].map(id => ({
    id, name: id, state: id === 'finalized' ? 'closed' : id === 'active' ? 'open' : id, compatibilityKey: null })), error: null });`,
  "lib/api/password-reset-requests": "export const fetchPendingPasswordResetRequestCount = async () => ({data: 0, error: null});",
  "components/VenueSelector": `const currentVenue = { id: 'venue-1', name: 'Test venue', timezone: 'Asia/Seoul' };
    export const useVenueSelector = () => ({ currentVenue: globalThis.__doorPageTest.venueReady ? currentVenue : null, venueId: 'venue-1', venues: [], selectedVenueId: 'venue-1', isSuperAdmin: false });
    export default function VenueSelector() { return null; }`,
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const key = Object.keys(sources).find(key => specifier.endsWith(key));
    return key ? { url: `mock:door-page:${key}`, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url.startsWith("mock:door-page:")
      ? { format: "module", shortCircuit: true, source: sources[url.replace("mock:door-page:", "")] }
      : nextLoad(url, context);
  },
});
let DoorPage: typeof import("@/app/door/page").default;
let AdminPage: typeof import("@/app/admin/page").default;
before(async () => {
  DoorPage = (await import("@/app/door/page")).default;
  AdminPage = (await import("@/app/admin/page")).default;
});
after(() => hooks.deregister());
afterEach(() => { cleanup(); reset(); window.localStorage.clear(); destinations.length = 0; });
const destinations: string[] = [];
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace(href: string) { destinations.push(href); }, prefetch() {} };
const user: User = { id: "admin-1", name: "Admin", email: "admin@example.test", role: "venue_admin", account_kind: "personal", door_access_enabled: false, venue_id: "venue-1", guest_limit: null };
function frame(account: User = user, admin = false) {
  return <AppRouterContext.Provider value={router}><PathnameContext.Provider value={admin ? "/admin" : "/door"}>
    <NextIntlClientProvider locale="en" messages={messages}><AuthSessionProvider initialUser={account}>
      <RouteTransitionProvider>{admin ? <AdminPage /> : <DoorPage />}</RouteTransitionProvider>
    </AuthSessionProvider></NextIntlClientProvider>
  </PathnameContext.Provider></AppRouterContext.Provider>;
}
function location(eventId: string | null = null) {
  window.history.replaceState(null, "", `/door?venue=venue-1&date=2026-09-15${eventId ? `&eventId=${eventId}` : ""}`);
}
async function openGuest() {
  const row = await screen.findByRole("button", { name: "Roster guest" });
  await act(async () => {});
  fireEvent.click(row);
  return screen.getByRole("region", { name: "Roster guest" });
}

test("unified check-in exposes deletion only to admins and only inside details", async () => {
  for (const account of [user, { ...user, role: "door_staff" as const }, { ...user, role: "staff" as const, account_kind: "shared" as const, door_access_enabled: true }]) {
    location();
    render(frame(account));
    await screen.findByRole("button", { name: "Roster guest" });
    assert.equal(screen.queryByRole("button", { name: messages.Common.deleteGuest }) === null, true);
    const detail = await openGuest();
    assert.equal(Boolean(within(detail).queryByRole("button", { name: messages.Common.deleteGuest })), account.role === "venue_admin");
    assert.equal(screen.queryByRole("link", { name: messages.Workspace.roster }) === null, true);
    cleanup();
  }
});

test("unified details retain finalized locks, draft deletion, and past-date correction", async () => {
  for (const [eventId, entryLocked, deletionLocked] of [["finalized", true, true], ["closed", true, true], ["draft", true, false], [null, false, false]] as const) {
    location(eventId);
    render(frame());
    const detail = await openGuest();
    await waitFor(() => {
      assert.equal(screen.getByRole("button", { name: messages.Common.checkIn }).hasAttribute("disabled"), entryLocked);
      assert.equal(within(detail).getByRole("button", { name: messages.Common.deleteGuest }).hasAttribute("disabled"), deletionLocked);
    });
    assert.deepEqual(runtime.__doorPageTest.reads.at(-1), { date: "2026-09-15", venueId: "venue-1", eventId });
    cleanup();
  }
});

test("deletion fails closed without an attendance summary", async () => {
  runtime.__doorPageTest.summaryError = true;
  location(); render(frame());
  const detail = await openGuest();
  assert.equal(within(detail).getByRole("button", { name: messages.Common.deleteGuest }).hasAttribute("disabled"), true);
});

test("a failed deletion keeps the detail available and a confirmed retry removes the guest", async () => {
  location(); render(frame());
  const detail = await openGuest();
  runtime.__doorPageTest.deleteError = true;
  for (const succeeds of [false, true]) {
    runtime.__doorPageTest.deleteError = !succeeds;
    const trigger = within(detail).getByRole("button", { name: messages.Common.deleteGuest });
    await waitFor(() => assert.equal(trigger.hasAttribute("disabled"), false));
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("group", { name: messages.Common.deleteGuestConfirm.replace("{name}", "Roster guest") })).getByRole("button", { name: messages.Common.delete }));
    if (!succeeds) {
      await waitFor(() => assert.equal(runtime.__doorPageTest.deleteCalls, 1));
      await waitFor(() => assert.equal(trigger.hasAttribute("disabled"), false));
      assert.ok(screen.getByRole("region", { name: "Roster guest" }));
      assert.equal(within(detail).getByRole("alert").textContent, messages.Door.updateFailed);
    }
  }
  await waitFor(() => assert.equal(screen.queryByRole("region", { name: "Roster guest" }) === null, true));
  assert.equal(screen.queryByRole("button", { name: "Roster guest" }) === null, true);
  assert.equal(runtime.__doorPageTest.deleteCalls, 2);
  assert.notEqual(document.body.style.overflow, "hidden");
});

test("legacy admin roster URLs forward a saved or explicit valid scope to check-in", async () => {
  for (const query of ["", "?tab=guests&view=list", "?tab=guests&view=list&venue=venue-1&date=2026-09-15&eventId=active"]) {
    window.localStorage.setItem("admin:selectedDate", JSON.stringify({ venueId: "venue-1", date: "2026-09-12" }));
    window.history.replaceState(null, "", `/admin${query}`);
    render(frame(user, true));
    await waitFor(() => assert.ok(destinations.length));
    const target = new URL(destinations.at(-1)!, "https://example.test");
    assert.equal(target.pathname, "/door");
    assert.equal(target.searchParams.get("venue"), "venue-1");
    assert.equal(target.searchParams.get("date"), query.includes("eventId") ? "2026-09-15" : "2026-09-12");
    assert.equal(target.searchParams.get("eventId"), query.includes("eventId") ? "active" : null);
    cleanup(); destinations.length = 0;
  }
});


test("the unified roster retains its operating date after returning home and rejects foreign URL scope", async () => {
  location("active");
  const first = render(frame());
  await openGuest();
  first.unmount();
  window.history.replaceState(null, "", "/door");
  render(frame());
  await openGuest();
  assert.equal(runtime.__doorPageTest.reads.at(-1)?.date, "2026-09-15");
  cleanup();
  window.history.replaceState(null, "", "/door?venue=other-venue&date=2026-09-10&eventId=closed");
  render(frame());
  await openGuest();
  assert.deepEqual(runtime.__doorPageTest.reads.at(-1), { date: "2026-09-15", venueId: "venue-1", eventId: null });
});


test("an explicit roster URL wins over a legacy saved date when the venue loads later", async () => {
  runtime.__doorPageTest.venueReady = false;
  window.localStorage.setItem("door:selectedDate", JSON.stringify("2026-09-10"));
  location("active");
  const view = render(frame());
  await act(async () => {});
  runtime.__doorPageTest.venueReady = true;
  view.rerender(frame());
  await openGuest();
  assert.deepEqual(runtime.__doorPageTest.reads.at(-1), { date: "2026-09-15", venueId: "venue-1", eventId: "active" });
});
