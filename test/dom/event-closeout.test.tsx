import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/en.json";

afterEach(cleanup);

test("closeout shows venue-local peak time and refreshes when its event closes", async () => {
  const report = {
    eventId: "event-1", registered: 3, checkedIn: 1, noShow: 2,
    entryRatePercent: 33.3, guestRemovals: 0, checkInCancellations: 0,
    reEntries: 0, onSiteAdds: 0,
    peak15Minutes: { startedAt: "2026-09-16T12:15:00.000Z", entries: 1 },
    contributors: [],
    ledger: { sourceActivityCount: 4, coveredGuestCount: 3, untrackedGuestCount: 0, invariantMismatchCount: 0 },
    timing: { preparationSeconds: 7, confirmationSeconds: null },
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === "@/lib/api/closeout"
        ? { url: "mock:closeout-lifecycle", shortCircuit: true }
        : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url !== "mock:closeout-lifecycle") return nextLoad(url, context);
      return { format: "module", shortCircuit: true, source: `
        let calls = 0;
        export const fetchEventCloseout = async () => ({
          data: { report: { ...${JSON.stringify(report)}, status: ++calls === 1 ? 'provisional' : 'ready' } }, error: null
        });
        export const confirmEventCloseout = fetchEventCloseout;
      ` };
    },
  });
  try {
    const { default: EventCloseout } = await import("@/app/admin/components/EventCloseout");
    const view = (eventState: "open" | "closed", timeZone: string) =>
      <NextIntlClientProvider locale="en" messages={messages}>
        <EventCloseout eventId="event-1" eventState={eventState} timeZone={timeZone} />
      </NextIntlClientProvider>;
    const rendered = render(view("open", "Asia/Seoul"));
    await screen.findByText("1 at 21:15");
    assert.equal(screen.getByRole("button", { name: messages.EventCloseout.confirm }).hasAttribute("disabled"), true);
    rendered.rerender(view("closed", "America/New_York"));
    await screen.findByText("1 at 08:15");
    await waitFor(() => assert.equal(screen.getByRole("button", { name: messages.EventCloseout.confirm }).hasAttribute("disabled"), false));
    assert.equal(screen.queryByText(messages.EventCloseout.provisional), null);
  } finally { hooks.deregister(); }
});
