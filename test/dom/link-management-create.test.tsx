import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import messages from "@/messages/en.json";
import {
  useLinkCreateController,
  type LinkCreateControllerActions,
} from "@/app/admin/components/useLinkCreateController";
import type { ExternalDJLink } from "@/lib/external-links/types";

afterEach(cleanup);

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
}

const GENERATED_LINK: ExternalDJLink = {
  id: "link-1",
  venueId: "venue-a",
  token: "token-1",
  djName: "DJ TEST",
  contributorId: null,
  event: "TEST EVENT",
  date: "2026-08-20",
  maxGuests: 5,
  usedGuests: 0,
  active: true,
  localeMode: "auto",
  kind: "contributor",
};

function createActions(
  createLink: LinkCreateControllerActions["createLink"] = async () => ({
    data: null,
    error: null,
  }),
): LinkCreateControllerActions {
  return {
    fetchSuggestions: async () => ({
      data: { djs: [], events: [] },
      error: null,
    }),
    createLink,
    shareLink: async () => "copied",
  };
}

const DEFAULT_ACTIONS = createActions();

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function CreateHarness({
  selectedDate = "2026-08-20",
  isActive = true,
  actions = DEFAULT_ACTIONS,
}: {
  selectedDate?: string;
  isActive?: boolean;
  actions?: LinkCreateControllerActions;
}) {
  const create = useLinkCreateController({
    selectedDate,
    venueId: "venue-a",
    eventId: null,
    isActive,
    actions,
  });

  return (
    <form onSubmit={create.handleSubmit}>
      <input
        ref={create.linkDateInputRef}
        data-testid="date"
        value={create.formData.date}
        onChange={(event) =>
          create.setFormData({ ...create.formData, date: event.target.value })
        }
      />
      <input
        ref={create.linkDjInputRef}
        data-testid="dj"
        value={create.formData.dj}
        onChange={(event) => create.handleDjChange(event.target.value, null)}
      />
      <input
        ref={create.linkEventInputRef}
        data-testid="event"
        value={create.formData.event}
        onChange={(event) =>
          create.setFormData({ ...create.formData, event: event.target.value })
        }
      />
      <input ref={create.linkMaxGuestsInputRef} data-testid="max-guests" />
      <button ref={create.linkLocaleInputRef} type="button">Locale</button>
      <input ref={create.linkKindInputRef} data-testid="kind" />
      <button type="submit">Submit</button>
      <button
        type="button"
        onClick={() =>
          create.applyTemplate({
            date: selectedDate,
            djName: "DJ TEMPLATE",
            contributorId: null,
            event: "TEMPLATE EVENT",
            maxGuests: 8,
            localeMode: "ko",
            kind: "contributor",
          })
        }
      >
        Template
      </button>
      {create.scopedGeneratedLink && (
        <div ref={create.generatedLinkPanelRef} role="region" tabIndex={-1}>
          Generated {create.scopedGeneratedLink.id}
        </div>
      )}
    </form>
  );
}

function renderHarness(props: Parameters<typeof CreateHarness>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CreateHarness {...props} />
    </NextIntlClientProvider>,
  );
}

test("create validation focuses the invalid DJ field", async () => {
  renderHarness({});

  fireEvent.submit(screen.getByRole("button", { name: "Submit" }).closest("form")!);

  await act(
    () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
  );
  assert.equal(document.activeElement, screen.getByTestId("dj"));
});

test("create ignores a double submit while its request is pending", async () => {
  const deferredCreate = createDeferred<{ data: ExternalDJLink; error: null }>();
  let createCalls = 0;
  const actions = createActions(async () => {
    createCalls += 1;
    return deferredCreate.promise;
  });
  renderHarness({ actions });

  fireEvent.change(screen.getByTestId("dj"), { target: { value: "DJ TEST" } });
  fireEvent.change(screen.getByTestId("event"), { target: { value: "TEST EVENT" } });
  const form = screen.getByRole("button", { name: "Submit" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);

  assert.equal(createCalls, 1);
  await act(async () => {
    deferredCreate.resolve({ data: GENERATED_LINK, error: null });
    await deferredCreate.promise;
  });
  assert.ok(screen.getByRole("region"));
});

test("a stale create result cannot publish a generated credential after a scope switch", async () => {
  const deferredCreate = createDeferred<{ data: ExternalDJLink; error: null }>();
  const actions = createActions(
    async () => deferredCreate.promise,
  );
  const view = renderHarness({ actions });

  fireEvent.change(screen.getByTestId("dj"), { target: { value: "DJ TEST" } });
  fireEvent.change(screen.getByTestId("event"), { target: { value: "TEST EVENT" } });
  fireEvent.submit(screen.getByRole("button", { name: "Submit" }).closest("form")!);
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CreateHarness selectedDate="2026-08-21" actions={actions} />
    </NextIntlClientProvider>,
  );
  await act(async () => {});
  assert.equal((screen.getByTestId("date") as HTMLInputElement).value, "2026-08-21");

  deferredCreate.resolve({ data: GENERATED_LINK, error: null });
  await act(
    () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
  );
  assert.equal(screen.queryByRole("region"), null);
});

test("generated credentials move focus to the generated region", async () => {
  const deferredCreate = createDeferred<{ data: ExternalDJLink; error: null }>();
  const actions = createActions(async () => deferredCreate.promise);
  renderHarness({ actions });

  fireEvent.change(screen.getByTestId("dj"), { target: { value: "DJ TEST" } });
  fireEvent.change(screen.getByTestId("event"), { target: { value: "TEST EVENT" } });
  fireEvent.submit(screen.getByRole("button", { name: "Submit" }).closest("form")!);

  await act(async () => {
    deferredCreate.resolve({ data: GENERATED_LINK, error: null });
    await deferredCreate.promise;
  });
  await act(
    () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
  );
  assert.equal(document.activeElement, screen.getByRole("region"));
});

test("template drafts move focus to the target date", async () => {
  renderHarness({});
  fireEvent.click(screen.getByRole("button", { name: "Template" }));
  await act(
    () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
  );
  assert.equal(document.activeElement, screen.getByTestId("date"));
});
