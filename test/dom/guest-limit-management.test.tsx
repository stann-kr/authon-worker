import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, before, beforeEach, test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GuestLimitRequestView } from "@/lib/guest-limits/types";
import messages from "@/messages/en.json";

type Result = { data: GuestLimitRequestView[]; error: null };
const runtime = globalThis as typeof globalThis & {
  guestLimitAdminActions: {
    fetch: (venue: string, event: string | null, date: string) => Promise<Result>;
    decide: (input: { requestId: string; decision: string; approvedExtra?: number }) => Promise<{ error: string | null }>;
  };
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = ["lib/api/guest-limits", "components/VenueSelector"].find(path => specifier.endsWith(path));
    return target ? { url: `mock:guest-limit-admin:${target}`, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("mock:guest-limit-admin:")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: url.endsWith("components/VenueSelector")
      ? `export const useVenueSelector = () => ({ venueId: 'venue-1', venues: [], selectedVenueId: 'venue-1', isSuperAdmin: false }); export default function VenueSelector() { return null; }`
      : `export const fetchGuestLimitRequests = (...args) => globalThis.guestLimitAdminActions.fetch(...args);
         export const decideGuestLimitRequest = (...args) => globalThis.guestLimitAdminActions.decide(...args);` };
  },
});
let GuestLimitRequestManagement: typeof import("@/app/admin/components/GuestLimitRequestManagement").default;
before(async () => { ({ default: GuestLimitRequestManagement } = await import("@/app/admin/components/GuestLimitRequestManagement")); });
const request: GuestLimitRequestView = {
  id: "request-1", venueId: "venue-1", userId: "staff-1", userName: "Staff One", userRole: "staff",
  date: "2026-09-18", eventId: null, requestedExtra: 3, approvedExtra: 0, reason: "Extra guests",
  status: "pending", decidedByUserId: null, decidedAt: null, decisionNote: null,
  createdAt: "2026-09-18T00:00:00Z", updatedAt: "2026-09-18T00:00:00Z",
};
function view(date = request.date) {
  return <NextIntlClientProvider locale="en" messages={messages}>
    <GuestLimitRequestManagement eventId={null} selectedDate={date} onDateChange={() => {}} businessDate={request.date} />
  </NextIntlClientProvider>;
}
beforeEach(() => {
  runtime.guestLimitAdminActions = {
    fetch: async () => ({ data: [request], error: null }),
    decide: async () => ({ error: null }),
  };
});
afterEach(cleanup);

test("approval preserves raw input and accepts only whole counts within the request", async () => {
  render(view());
  const input = await screen.findByRole("spinbutton", { name: messages.GuestLimitAdmin.approvedCount }) as HTMLInputElement;
  const approve = screen.getByRole("button", { name: messages.GuestLimitAdmin.approve }) as HTMLButtonElement;
  for (const value of ["", "1.5", "0", "4"]) {
    fireEvent.change(input, { target: { value } });
    assert.equal(input.value, value);
    assert.equal(approve.disabled, true);
  }
  fireEvent.change(input, { target: { value: "2" } });
  assert.equal(approve.disabled, false);
});

test("a decision holds all request controls and recovers after a transport failure", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<{ error: null }>((_, fail) => { reject = fail; });
  let calls = 0;
  runtime.guestLimitAdminActions.fetch = async () => ({ data: [request, { ...request, id: "request-2", userName: "Staff Two" }], error: null });
  runtime.guestLimitAdminActions.decide = async () => { calls++; return pending; };
  render(view());
  await screen.findByText("Staff One");
  const approvals = screen.getAllByRole("button", { name: messages.GuestLimitAdmin.approve });
  act(() => { fireEvent.click(approvals[0]); fireEvent.click(approvals[1]); });
  assert.equal(calls, 1);
  assert.ok(approvals.every(button => (button as HTMLButtonElement).disabled));
  await act(async () => reject(new Error("offline")));
  assert.ok(screen.getByRole("alert"));
  assert.equal(approvals.some(button => (button as HTMLButtonElement).disabled), false);
  runtime.guestLimitAdminActions.decide = async () => { calls++; return { error: null }; };
  await act(async () => fireEvent.click(approvals[0]));
  assert.equal(calls, 2);
  assert.ok(screen.getByText(messages.GuestLimitAdmin.approved));
});

test("a date switch hides old requests and does not publish the previous decision into the new scope", async () => {
  let resolve!: (value: { error: null }) => void;
  const decision = new Promise<{ error: null }>(done => { resolve = done; });
  let resolveList!: (value: Result) => void;
  const nextList = new Promise<Result>(done => { resolveList = done; });
  runtime.guestLimitAdminActions.decide = () => decision;
  runtime.guestLimitAdminActions.fetch = async (_venue, _event, date) => date === request.date ? { data: [request], error: null } : nextList;
  const rendered = render(view());
  fireEvent.click(await screen.findByRole("button", { name: messages.GuestLimitAdmin.approve }));
  rendered.rerender(view("2026-09-19"));
  assert.equal(screen.queryByText("Staff One"), null);
  await act(async () => resolve({ error: null }));
  assert.equal(screen.queryByText(messages.GuestLimitAdmin.approved), null);
  await act(async () => resolveList({ data: [{ ...request, id: "next", userName: "Next day staff", date: "2026-09-19" }], error: null }));
  await waitFor(() => assert.ok(screen.getByText("Next day staff")));
  assert.equal(within(screen.getByText("Next day staff").closest("article")!).getByRole("button", { name: messages.GuestLimitAdmin.approve }).hasAttribute("disabled"), false);
});

test("background refresh receives incoming work without replacing an approval draft or losing rows on failure", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  render(view());
  const input = await screen.findByRole("spinbutton", { name: messages.GuestLimitAdmin.approvedCount }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "2" } });
  runtime.guestLimitAdminActions.fetch = async () => ({ data: [request, { ...request, id: "incoming", userName: "Incoming staff" }], error: null });
  await act(async () => { window.dispatchEvent(new Event("online")); });
  assert.ok(screen.getByText("Incoming staff"));
  assert.equal(input.value, "2");
  runtime.guestLimitAdminActions.fetch = async () => { throw new Error("offline"); };
  await act(async () => { window.dispatchEvent(new Event("online")); });
  assert.ok(screen.getByText(messages.GuestLimitAdmin.loadFailed));
  assert.ok(screen.getByText("Incoming staff"));
  assert.equal(input.value, "2");
});
