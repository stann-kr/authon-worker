import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, before, test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import messages from "@/messages/en.json";
import { ToastProvider } from "@/components/feedback/ToastProvider";
import type { Event } from "@/lib/events/types";

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
}

const runtime = globalThis as typeof globalThis & {
  eventAdminView: {
    events: Partial<Event>[];
    transitions: string[];
    updates?: Array<Record<string, unknown>>;
    updateError?: string;
  };
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = ["lib/events/client", "lib/api/events", "lib/api/closeout", "components/VenueSelector"]
      .find((path) => specifier.endsWith(path));
    return target ? { url: `mock:event-admin:${target}`, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("mock:event-admin:")) return nextLoad(url, context);
    const sources: Record<string, string> = {
      "lib/events/client": "export const fetchEvents = async () => ({ data: globalThis.eventAdminView.events, error: null });",
      "lib/api/events": `export const createEvent = async () => ({ data: null, error: "UNAVAILABLE" });
        export const transitionEventState = async (id, state) => {
          globalThis.eventAdminView.transitions.push(state);
          globalThis.eventAdminView.events = globalThis.eventAdminView.events.map((event) => event.id === id ? { ...event, state } : event);
          return { data: { id, state }, error: null };
        };
        export const updateEvent = async (id, updates) => {
          const view = globalThis.eventAdminView;
          (view.updates ??= []).push({ id, ...updates });
          if (view.updateError) return { data: null, error: view.updateError };
          view.events = view.events.map((event) => event.id === id ? { ...event, ...updates } : event);
          return { data: view.events.find((event) => event.id === id), error: null };
        };`,
      "lib/api/closeout": 'export const fetchEventCloseout = async () => ({ data: null, error: "UNAVAILABLE" }); export const confirmEventCloseout = fetchEventCloseout;',
      "components/VenueSelector": 'export const useVenueSelector = () => ({ venueId: "venue-1", venues: [], selectedVenueId: "venue-1", currentVenue: {}, isSuperAdmin: false }); export default function VenueSelector() { return null; }',
    };
    return { format: "module", shortCircuit: true, source: sources[url.replace("mock:event-admin:", "")] };
  },
});

let EventManagement: typeof import("@/app/admin/components/EventManagement").default;
before(async () => { ({ default: EventManagement } = await import("@/app/admin/components/EventManagement")); });
afterEach(cleanup);

const baseEvent = { venueId: "venue-1", businessDate: "2026-09-16", capacity: 100, targetGuests: 30 };

function view() {
  return <NextIntlClientProvider locale="en" messages={messages}>
    <ToastProvider>
      <EventManagement selectedDate="2026-09-16" businessDate="2026-09-16" onDateChange={() => {}}
        selectedEventId={null} onSelectedEventChange={() => {}} onEventsChanged={() => {}} />
    </ToastProvider>
  </NextIntlClientProvider>;
}

test("a date with only compatibility events shows the empty state", async () => {
  runtime.eventAdminView = {
    events: [{ ...baseEvent, id: "legacy", name: "Legacy night", state: "open", compatibilityKey: "venue-1:2026-09-16" }],
    transitions: [],
  };
  render(view());
  assert.ok(await screen.findByText(messages.EventAdmin.empty));
  assert.equal(screen.queryByText("Legacy night"), null);
});

test("closing an event waits for confirmation", async () => {
  runtime.eventAdminView = {
    events: [{ ...baseEvent, id: "event-1", name: "Test night", state: "open", compatibilityKey: null }],
    transitions: [],
  };
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: /Test night/ }));
  const details = screen.getByRole("region", { name: "Test night" });
  fireEvent.click(within(details).getByRole("button", { name: messages.EventAdmin.transition.closed }));
  assert.deepEqual(runtime.eventAdminView.transitions, []);
  const confirmation = within(details).getByRole("group", { name: messages.EventAdmin.transition.closed });
  await act(async () => fireEvent.click(within(confirmation).getByRole("button", { name: messages.EventAdmin.transition.closed })));
  assert.deepEqual(runtime.eventAdminView.transitions, ["closed"]);
  assert.ok(screen.getByText(messages.EventAdmin.stateChanged).closest('[role="status"]'));
  assert.equal(within(details).queryByRole("group", { name: messages.EventAdmin.transition.closed }), null);
});

test("event details can be corrected, with field errors before and after the server check", async () => {
  runtime.eventAdminView = {
    events: [{ ...baseEvent, id: "event-1", name: "Test night", state: "open", compatibilityKey: null }],
    transitions: [],
    updateError: "INVALID_EVENT_NAME",
  };
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: /Test night/ }));
  const details = screen.getByRole("region", { name: "Test night" });
  fireEvent.click(within(details).getByRole("button", { name: messages.EventAdmin.editDetails }));
  const form = within(details).getByRole("form", { name: messages.EventAdmin.editTitle });
  const name = within(form).getByLabelText(messages.EventAdmin.name) as HTMLInputElement;
  const target = within(form).getByLabelText(messages.EventAdmin.target) as HTMLInputElement;
  assert.equal(document.activeElement, name);

  // A target above capacity is caught before any request and points at its field.
  fireEvent.change(target, { target: { value: "150" } });
  fireEvent.submit(form);
  assert.ok(within(form).getByText(messages.EventAdmin.targetExceedsCapacity));
  assert.equal(target.getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, target);
  assert.equal(runtime.eventAdminView.updates?.length ?? 0, 0);

  fireEvent.change(target, { target: { value: "80" } });
  fireEvent.change(name, { target: { value: "Late night" } });
  await act(async () => fireEvent.submit(form));
  await waitFor(() => assert.ok(within(form).getByText(messages.EventAdmin.invalidName)));
  assert.equal(name.getAttribute("aria-invalid"), "true");

  runtime.eventAdminView.updateError = undefined;
  await act(async () => fireEvent.submit(form));
  assert.deepEqual(runtime.eventAdminView.updates?.at(-1), { id: "event-1", name: "Late night", capacity: 100, targetGuests: 80 });
  assert.ok(await screen.findByText(messages.EventAdmin.updated));
  assert.ok(await screen.findByRole("button", { name: /Late night/ }));
  assert.equal(within(details).queryByRole("form", { name: messages.EventAdmin.editTitle }), null);
});

test("a save that loses a race says why: a newer save keeps the draft, an archive closes the form", async () => {
  runtime.eventAdminView = {
    events: [{ ...baseEvent, id: "event-1", name: "Test night", state: "closed", compatibilityKey: null }],
    transitions: [],
    updateError: "EVENT_CHANGED",
  };
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: /Test night/ }));
  const details = screen.getByRole("region", { name: "Test night" });
  fireEvent.click(within(details).getByRole("button", { name: messages.EventAdmin.editDetails }));
  const form = within(details).getByRole("form", { name: messages.EventAdmin.editTitle });
  const name = within(form).getByLabelText(messages.EventAdmin.name) as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Late night" } });

  // Another admin saved first: the draft stays so it can be checked against the latest values.
  await act(async () => fireEvent.submit(form));
  await waitFor(() => assert.ok(within(form).getByText(messages.EventAdmin.eventChanged)));
  assert.equal(name.value, "Late night");

  // Archived meanwhile: the form closes and the event itself explains why.
  runtime.eventAdminView.updateError = "EVENT_LOCKED";
  runtime.eventAdminView.events = runtime.eventAdminView.events.map((event) => ({ ...event, state: "archived" }));
  await act(async () => fireEvent.submit(form));
  await waitFor(() => assert.ok(within(details).getByText(messages.EventAdmin.eventLocked)));
  assert.equal(within(details).queryByRole("form", { name: messages.EventAdmin.editTitle }), null);
});

test("archived events stay read-only", async () => {
  runtime.eventAdminView = {
    events: [{ ...baseEvent, id: "event-2", name: "Old night", state: "archived", compatibilityKey: null }],
    transitions: [],
  };
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: /Old night/ }));
  const details = screen.getByRole("region", { name: "Old night" });
  assert.equal(within(details).queryByRole("button", { name: messages.EventAdmin.editDetails }), null);
});
