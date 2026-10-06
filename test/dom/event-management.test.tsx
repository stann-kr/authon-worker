import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, before, test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import messages from "@/messages/en.json";
import { ToastProvider } from "@/components/feedback/ToastProvider";
import type { Event } from "@/lib/events/types";

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
}

const runtime = globalThis as typeof globalThis & {
  eventAdminView: { events: Partial<Event>[]; transitions: string[] };
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
