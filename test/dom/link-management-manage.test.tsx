import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import messages from "@/messages/en.json";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import {
  useLinkManageController,
  type LinkManageControllerActions,
} from "@/app/admin/components/useLinkManageController";
import type { ExternalDJLink } from "@/lib/external-links/types";

afterEach(cleanup);

const LINK: ExternalDJLink = {
  id: "link-a",
  venueId: "venue-a",
  token: "token-a",
  djName: "DJ A",
  event: "EVENT A",
  date: "2026-08-20",
  maxGuests: 5,
  usedGuests: 0,
  active: true,
  localeMode: "auto",
  kind: "contributor",
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createActions(
  overrides: Partial<LinkManageControllerActions> = {},
): LinkManageControllerActions {
  return {
    fetchByDate: async () => ({ data: [], error: null }),
    fetchRecent: async () => ({ data: [], error: null }),
    deleteLink: async () => ({ error: null }),
    deactivateLink: async () => ({ error: null }),
    activateLink: async () => ({ error: null }),
    shareLink: async () => "copied",
    ...overrides,
  };
}

function ManageHarness({
  actions,
  selectedDate = "2026-08-20",
}: {
  actions: LinkManageControllerActions;
  selectedDate?: string;
}) {
  const manage = useLinkManageController({
    selectedDate,
    venueId: "venue-a",
    eventId: null,
    isActive: true,
    locale: "en",
    actions,
  });

  return (
    <>
      <button type="button" onClick={() => manage.setManageScope("recent")}>
        Recent
      </button>
      <button
        type="button"
        disabled={Boolean(manage.lifecycleBusyIds["link-a"])}
        onClick={() => manage.handleDeactivateLink("link-a")}
      >
        Deactivate
      </button>
      <button
        type="button"
        disabled={Boolean(manage.lifecycleBusyIds["link-a"])}
        onClick={() => manage.handleActivateLink("link-a")}
      >
        Activate
      </button>
      <button
        type="button"
        disabled={Boolean(manage.lifecycleBusyIds["link-a"])}
        onClick={() => manage.handleDeleteLink("link-a")}
      >
        Delete now
      </button>
      <button
        type="button"
        onClick={() => {
          void manage.handleDeactivateLink("link-a");
          void manage.handleDeleteLink("link-a");
        }}
      >
        Race lifecycle
      </button>
      <button type="button" onClick={() => void manage.loadLinks()}>
        Refresh
      </button>
      <button
        type="button"
        onClick={() =>
          manage.shareOrCopyManagedLink("https://example.com/guest", "link-a")
        }
      >
        Share
      </button>
      <button
        type="button"
        onClick={manage.clearFeedbackForTemplateHandoff}
      >
        Template
      </button>
      <output data-testid="state">{manage.listState}</output>
      <output data-testid="links">{manage.sortedLinks.length}</output>
      <output data-testid="active">
        {String(manage.sortedLinks[0]?.active ?? false)}
      </output>
      <output data-testid="pending">
        {String(Boolean(manage.lifecycleBusyIds["link-a"]))}
      </output>
      <output data-testid="toast">{manage.linkActionToast ?? ""}</output>
    </>
  );
}

function renderHarness(
  actions: LinkManageControllerActions,
  selectedDate = "2026-08-20",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RouteTransitionProvider>
        <ManageHarness actions={actions} selectedDate={selectedDate} />
      </RouteTransitionProvider>
    </NextIntlClientProvider>,
  );
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
}

test("a stale date-scope response cannot replace the current recent list", async () => {
  const dateRequest = createDeferred<{
    data: ExternalDJLink[];
    error: null;
  }>();
  const recentRequest = createDeferred<{
    data: ExternalDJLink[];
    error: null;
  }>();
  renderHarness(
    createActions({
      fetchByDate: async () => dateRequest.promise,
      fetchRecent: async () => recentRequest.promise,
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Recent" }));
  await act(async () => {
    recentRequest.resolve({ data: [LINK], error: null });
    await recentRequest.promise;
  });
  assert.equal(screen.getByTestId("links").textContent, "1");

  await act(async () => {
    dateRequest.resolve({ data: [], error: null });
    await dateRequest.promise;
  });
  assert.equal(screen.getByTestId("links").textContent, "1");
});

test("full and partial failures remain distinct from an empty success", async () => {
  const errorView = renderHarness(
    createActions({
      fetchByDate: async () => ({ data: null, error: "LOAD_FAILED" }),
    }),
  );
  await flushAsyncWork();
  assert.equal(screen.getByTestId("state").textContent, "error");

  errorView.unmount();
  renderHarness(
    createActions({
      fetchByDate: async () => ({ data: [LINK], error: "PARTIAL" }),
    }),
  );
  await flushAsyncWork();
  assert.equal(screen.getByTestId("state").textContent, "partial");
});

test("the rendered pending lock prevents a duplicate lifecycle mutation", async () => {
  const mutation = createDeferred<{ error: null }>();
  let mutationCalls = 0;
  renderHarness(
    createActions({
      deactivateLink: async () => {
        mutationCalls += 1;
        return mutation.promise;
      },
    }),
  );
  await flushAsyncWork();

  const deactivateButton = screen.getByRole("button", {
    name: "Deactivate",
  });
  fireEvent.click(deactivateButton);
  assert.equal(screen.getByTestId("pending").textContent, "true");
  fireEvent.click(deactivateButton);
  assert.equal(mutationCalls, 1);

  await act(async () => {
    mutation.resolve({ error: null });
    await mutation.promise;
  });
  assert.equal(screen.getByTestId("pending").textContent, "false");
});

test("one per-link lease rejects contradictory lifecycle writes in the same act", async () => {
  const mutation = createDeferred<{ error: null }>();
  let deactivateCalls = 0;
  let deleteCalls = 0;
  renderHarness(
    createActions({
      deactivateLink: async () => {
        deactivateCalls += 1;
        return mutation.promise;
      },
      deleteLink: async () => {
        deleteCalls += 1;
        return { error: null };
      },
    }),
  );
  await flushAsyncWork();

  fireEvent.click(screen.getByRole("button", { name: "Race lifecycle" }));
  assert.equal(deactivateCalls, 1);
  assert.equal(deleteCalls, 0);
  assert.equal(screen.getByTestId("pending").textContent, "true");
  assert.equal(
    screen.getByRole("button", { name: "Delete now" }).hasAttribute("disabled"),
    true,
  );

  await act(async () => {
    mutation.resolve({ error: null });
    await mutation.promise;
  });
  assert.equal(screen.getByTestId("pending").textContent, "false");
});

test("a late pre-commit refresh cannot overwrite the authoritative lifecycle reload", async () => {
  const staleRefresh = createDeferred<{
    data: ExternalDJLink[];
    error: null;
  }>();
  const activation = createDeferred<{ error: null }>();
  let fetchCalls = 0;
  renderHarness(
    createActions({
      fetchByDate: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1)
          return { data: [{ ...LINK, active: false }], error: null };
        if (fetchCalls === 2) return staleRefresh.promise;
        return { data: [{ ...LINK, active: true }], error: null };
      },
      activateLink: async () => activation.promise,
    }),
  );
  await flushAsyncWork();
  assert.equal(screen.getByTestId("active").textContent, "false");

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  fireEvent.click(screen.getByRole("button", { name: "Activate" }));
  await act(async () => {
    activation.resolve({ error: null });
    await activation.promise;
  });
  assert.equal(fetchCalls, 3);
  assert.equal(screen.getByTestId("active").textContent, "true");

  await act(async () => {
    staleRefresh.resolve({
      data: [{ ...LINK, active: false }],
      error: null,
    });
    await staleRefresh.promise;
  });
  assert.equal(screen.getByTestId("active").textContent, "true");
});

test("template handoff clears managed share feedback", async () => {
  renderHarness(createActions());
  await flushAsyncWork();

  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  await flushAsyncWork();
  assert.ok(screen.getByTestId("toast").textContent);

  fireEvent.click(screen.getByRole("button", { name: "Template" }));
  assert.equal(screen.getByTestId("toast").textContent, "");
});

test("a stale managed share cannot publish feedback in a new scope", async () => {
  const shareRequest = createDeferred<"copied">();
  const actions = createActions({
    shareLink: async () => shareRequest.promise,
  });
  const view = renderHarness(actions);
  await flushAsyncWork();

  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RouteTransitionProvider>
        <ManageHarness
          actions={actions}
          selectedDate="2026-08-21"
        />
      </RouteTransitionProvider>
    </NextIntlClientProvider>,
  );
  await act(async () => {
    shareRequest.resolve("copied");
    await shareRequest.promise;
  });
  assert.equal(screen.getByTestId("toast").textContent, "");
});
