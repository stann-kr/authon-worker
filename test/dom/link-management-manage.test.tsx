import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import messages from "@/messages/en.json";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import {
  useLinkManageController,
  type LinkManageControllerActions,
} from "@/app/admin/components/useLinkManageController";
import type { ExternalDJLink, ExternalLinkPage } from "@/lib/external-links/types";

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

function page(links: ExternalDJLink[], nextCursor: ExternalLinkPage["nextCursor"] = null): ExternalLinkPage {
  return { links, nextCursor, stats: { total: links.length, active: links.filter((link) => link.active).length, attention: 0 } };
}

function createActions(
  overrides: Partial<LinkManageControllerActions> = {},
): LinkManageControllerActions {
  return {
    fetchPage: async () => ({ data: page([]), error: null }),
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
  eventId = null,
}: {
  actions: LinkManageControllerActions;
  selectedDate?: string;
  eventId?: string | null;
}) {
  const manage = useLinkManageController({
    selectedDate,
    venueId: "venue-a",
    eventId,
    isActive: true,
    locale: "en",
    actions,
  });

  return (
    <>
      <button type="button" onClick={() => manage.setManageScope("date")}>
        By date
      </button>
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
      <button onClick={() => void manage.loadMore()}>More</button>
      <button onClick={() => manage.setManageFilter("active")}>Active filter</button>
      <output data-testid="more-busy">{String(manage.isLoadingMore)}</output>
      <output data-testid="has-more">{String(manage.hasMore)}</output>
      <output data-testid="more-error">{manage.loadMoreError}</output>
      <output data-testid="total">{manage.dashboardStats.total}</output>
      <output data-testid="state">{manage.listState}</output>
      <output data-testid="links">{manage.sortedLinks.length}</output>
      <output data-testid="ordered-ids">{manage.sortedLinks.map((link) => link.id).join(",")}</output>
      <output data-testid="scope">{manage.manageScope}</output>
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

test("management starts with recent links across dates and switches to the explicit date scope", async () => {
  const reads: unknown[] = [];
  const actions = createActions({
    fetchPage: async (...args) => {
      reads.push(args);
      return { data: page(args[1].date ? [LINK] : [
        { ...LINK, id: "newer", createdAt: "2026-08-20T12:00:00Z" },
        { ...LINK, id: "older", createdAt: "2026-08-19T12:00:00Z" },
      ]), error: null };
    },
  });
  render(<NextIntlClientProvider locale="en" messages={messages}>
    <RouteTransitionProvider>
      <ManageHarness actions={actions} eventId="event-a" />
    </RouteTransitionProvider>
  </NextIntlClientProvider>);
  await flushAsyncWork();
  assert.equal(screen.getByTestId("scope").textContent, "recent");
  assert.equal(screen.getByTestId("ordered-ids").textContent, "newer,older");
  assert.deepEqual(reads, [["venue-a", { filter: "all", sort: "newest", cursor: null }]]);

  fireEvent.click(screen.getByRole("button", { name: "By date" }));
  await flushAsyncWork();
  assert.equal(screen.getByTestId("scope").textContent, "date");
  assert.deepEqual(reads.at(-1), ["venue-a", { date: "2026-08-20", eventId: "event-a", filter: "all", sort: "newest", cursor: null }]);
});

test("a stale date-scope response cannot replace the current recent list", async () => {
  const dateRequest = createDeferred<{
    data: ExternalLinkPage;
    error: null;
  }>();
  const recentRequest = createDeferred<{
    data: ExternalLinkPage;
    error: null;
  }>();
  renderHarness(
    createActions({
      fetchPage: async (_venue, options) => options.date ? dateRequest.promise : recentRequest.promise,
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: "By date" }));
  fireEvent.click(screen.getByRole("button", { name: "Recent" }));
  await act(async () => {
    recentRequest.resolve({ data: page([LINK]), error: null });
    await recentRequest.promise;
  });
  assert.equal(screen.getByTestId("links").textContent, "1");

  await act(async () => {
    dateRequest.resolve({ data: page([]), error: null });
    await dateRequest.promise;
  });
  assert.equal(screen.getByTestId("links").textContent, "1");
});

test("failed pages remain distinct from an empty success", async () => {
  const errorView = renderHarness(
    createActions({
      fetchPage: async () => ({ data: null, error: "LOAD_FAILED" }),
    }),
  );
  await flushAsyncWork();
  assert.equal(screen.getByTestId("state").textContent, "error");

  errorView.unmount();
  renderHarness(
    createActions({
      fetchPage: async () => ({ data: page([LINK]), error: "PARTIAL" }),
    }),
  );
  await flushAsyncWork();
  assert.equal(screen.getByTestId("state").textContent, "error");
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
    data: ExternalLinkPage;
    error: null;
  }>();
  const activation = createDeferred<{ error: null }>();
  let fetchCalls = 0;
  renderHarness(
    createActions({
      fetchPage: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1)
          return { data: page([{ ...LINK, active: false }]), error: null };
        if (fetchCalls === 2) return staleRefresh.promise;
        return { data: page([{ ...LINK, active: true }]), error: null };
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
      data: page([{ ...LINK, active: false }]),
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

  fireEvent.click(screen.getByRole("button", { name: "By date" }));
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

test("ten-item pagination deduplicates requests, retains previous rows on failure, and retries the same cursor", async () => {
  const links = Array.from({ length: 10 }, (_, i) => ({ ...LINK, id: `link-${i}` }));
  const cursor = { value: "2026-09-18", id: "link-9" };
  const pending = createDeferred<{ data: ExternalLinkPage | null; error: string | null }>();
  const reads: unknown[] = [];
  renderHarness(createActions({ fetchPage: async (_venue, options) => {
    reads.push(options.cursor);
    if (!options.cursor) return { data: { ...page(links, cursor), stats: { total: 11, active: 11, attention: 0 } }, error: null };
    if (reads.length === 2) return pending.promise;
    return { data: page([links[9], { ...LINK, id: "last" }]), error: null };
  } }));
  await flushAsyncWork();
  assert.equal(screen.getByTestId("links").textContent, "10");
  assert.equal(screen.getByTestId("total").textContent, "11");
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  assert.equal(reads.length, 2);
  assert.equal(screen.getByTestId("more-busy").textContent, "true");
  await act(async () => { pending.resolve({ data: null, error: "NETWORK" }); });
  assert.equal(screen.getByTestId("links").textContent, "10");
  assert.equal(screen.getByTestId("more-busy").textContent, "false");
  assert.equal(screen.getByTestId("more-error").textContent, messages.LinkAdmin.loadMoreFailed);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  await flushAsyncWork();
  assert.deepEqual(reads, [null, cursor, cursor]);
  assert.equal(screen.getByTestId("links").textContent, "11");
  assert.equal(screen.getByTestId("has-more").textContent, "false");
});

test("an old next page cannot append after a filter change or a refresh", async () => {
  for (const nextAction of ["Active filter", "Refresh"]) {
    const pending = createDeferred<{ data: ExternalLinkPage; error: null }>();
    let initialCalls = 0;
    const view = renderHarness(createActions({ fetchPage: async (_venue, options) => {
      if (options.cursor) return pending.promise;
      initialCalls++;
      return { data: page([{ ...LINK, id: initialCalls === 1 ? "old" : "current" }], initialCalls === 1 ? { value: "date", id: "old" } : null), error: null };
    } }));
    await flushAsyncWork();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: nextAction }));
    await flushAsyncWork();
    await act(async () => { pending.resolve({ data: page([{ ...LINK, id: "stale" }]), error: null }); });
    assert.equal(screen.getByTestId("ordered-ids").textContent, "current");
    assert.equal(screen.getByTestId("has-more").textContent, "false");
    view.unmount();
  }
});

test("rendered link management loads ten more at the scroll boundary and retains its inline detail", async () => {
  const runtime = globalThis as typeof globalThis & { __linkPage?: LinkManageControllerActions["fetchPage"] };
  const first = createDeferred<{ data: ExternalLinkPage; error: null }>();
  const next = createDeferred<{ data: ExternalLinkPage; error: null }>();
  const links = Array.from({ length: 10 }, (_, i) => ({ ...LINK, id: `visible-${i}`, djName: `DJ ${i}`, guestUrl: "https://example.com/guest" }));
  let calls = 0;
  runtime.__linkPage = async () => { calls++; return calls === 1 ? first.promise : next.promise; };
  let intersect: (() => void) | undefined;
  const previousObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) { intersect = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const suffix = ["lib/api/external-links", "components/VenueSelector"].find((value) => specifier.endsWith(value));
      return suffix ? { url: `mock:link-scroll:${suffix}`, shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (!url.startsWith("mock:link-scroll:")) return nextLoad(url, context);
      const source = url.endsWith("components/VenueSelector")
        ? 'export const useVenueSelector = () => ({ venueId: "venue-a", venues: [], selectedVenueId: "venue-a", currentVenue: {}, isSuperAdmin: false }); export default function VenueSelector() { return null; }'
        : 'export const fetchExternalLinkPage = (...args) => globalThis.__linkPage(...args); export const fetchExternalLinkGuests = async () => ({data:{guests:[{id:"linked-guest",name:"Linked guest",status:"checked",createdAt:"2026-09-18T09:00:00Z",checkInTime:"2026-09-18T10:00:00Z"}],nextCursor:null},error:null}); export const fetchExternalLinkCreateSuggestions = async () => ({data:null,error:null}); export const createExternalLink = fetchExternalLinkCreateSuggestions; export const deleteExternalLink = async () => ({error:null}); export const deactivateExternalLink = deleteExternalLink; export const activateExternalLink = deleteExternalLink;';
      return { format: "module", shortCircuit: true, source };
    },
  });
  try {
    const { default: LinkManagement } = await import("@/app/admin/components/LinkManagement");
    render(<NextIntlClientProvider locale="en" messages={messages}><RouteTransitionProvider>
      <LinkManagement selectedDate="2026-08-20" businessDate="2026-08-20" onDateChange={() => {}} activeSection="manage" />
    </RouteTransitionProvider></NextIntlClientProvider>);
    assert.ok(screen.getByRole("status", { name: messages.Common.loadingContent }));
    await act(async () => { first.resolve({ data: page(links, { id: "visible-9", value: "2026" }), error: null }); });
    const opener = screen.getByRole("button", { name: /^DJ 0/ });
    fireEvent.click(opener);
    const detail = screen.getByRole("region", { name: "DJ 0" });
    assert.ok(await within(detail).findByText("Linked guest"));
    assert.equal(detail.closest("article")?.contains(opener), true);
    assert.equal(detail.hasAttribute("aria-modal"), false);
    act(() => { intersect?.(); intersect?.(); });
    assert.equal(calls, 2);
    assert.ok(screen.getByRole("status", { name: messages.Common.loadingContent }));
    assert.equal(detail.isConnected, true);
    await act(async () => { next.resolve({ data: page([{ ...LINK, id: "last", djName: "Last DJ" }]), error: null }); });
    await waitFor(() => assert.ok(screen.getByRole("button", { name: /^Last DJ/ })));
    assert.equal(screen.queryByRole("button", { name: messages.LinkAdmin.loadMore }) === null, true);
    fireEvent.click(within(detail).getByRole("button", { name: messages.LinkAdmin.delete }));
    assert.ok(screen.getByRole("group", { name: messages.LinkAdmin.deleteTitle }));
    fireEvent.click(opener);
    assert.equal(screen.queryByRole("region", { name: "DJ 0" }) === null, true);
    assert.equal(screen.queryByRole("group", { name: messages.LinkAdmin.deleteTitle }) === null, true);
  } finally {
    cleanup(); hooks.deregister(); delete runtime.__linkPage;
    if (previousObserver) globalThis.IntersectionObserver = previousObserver;
    else Reflect.deleteProperty(globalThis, "IntersectionObserver");
  }
});

test("a linked guest list rejects stale scopes and retries a failed next page without losing names", async () => {
  const { default: LinkRegisteredGuests } = await import("@/app/admin/components/LinkRegisteredGuests");
  const stale = createDeferred<{ data: { guests: []; nextCursor: null }; error: null }>();
  const guest = { id: "guest-b", name: "Current guest", status: "pending" as const, createdAt: "2026-09-18", checkInTime: null };
  const cursor = { id: guest.id, value: guest.createdAt };
  const calls: unknown[] = [];
  let fail = true;
  const fetchPage = async (_venue: string, linkId: string, nextCursor?: typeof cursor | null) => {
    calls.push([linkId, nextCursor]);
    if (linkId === "a") return stale.promise;
    if (nextCursor && fail) return { data: null, error: "offline" };
    return { data: { guests: [nextCursor ? { ...guest, id: "last", name: "Last guest" } : guest], nextCursor: nextCursor ? null : cursor }, error: null };
  };
  const frame = (id: string) => <NextIntlClientProvider locale="en" messages={messages}>
    <LinkRegisteredGuests venueId="venue-a" linkId={id} registeredCount={2} fetchPage={fetchPage} />
  </NextIntlClientProvider>;
  const view = render(frame("a"));
  view.rerender(frame("b"));
  assert.ok(await screen.findByText("Current guest"));
  await act(async () => { stale.resolve({ data: { guests: [], nextCursor: null }, error: null }); });
  assert.ok(screen.getByText("Current guest"));
  fireEvent.click(screen.getByRole("button", { name: messages.LinkAdmin.loadMore }));
  assert.ok(await screen.findByRole("alert"));
  assert.ok(screen.getByText("Current guest"));
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: messages.Common.retry }));
  assert.ok(await screen.findByText("Last guest"));
  assert.deepEqual(calls.slice(-2), [["b", cursor], ["b", cursor]]);
  assert.equal(screen.queryByRole("button", { name: messages.LinkAdmin.loadMore }), null);
});
