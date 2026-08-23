import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import useExternalGuestController, {
  type ExternalGuestControllerDependencies,
} from "@/app/guest/components/useExternalGuestController";
import { externalOwnerStorageKey } from "@/lib/external-links/ownership";
import { announceRouteTransitionStart } from "@/lib/route-transition-events";
import type {
  ExternalDJLink,
  ExternalLinkPublicGuest,
  ExternalLinkPublicValidationData,
} from "@/lib/external-links/types";
import type { Venue } from "@/lib/venues/types";

const TOKEN = "external-token-a";

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
}

const VENUE: Venue = {
  id: "venue-a",
  name: "Venue A",
  type: "club",
  timezone: "Asia/Seoul",
  openingTime: "22:00",
  closingTime: "06:00",
  active: true,
};

const LINK: ExternalDJLink = {
  id: "link-a",
  venueId: VENUE.id,
  token: TOKEN,
  djName: "DJ A",
  event: "Event A",
  date: "2026-08-23",
  maxGuests: 5,
  usedGuests: 0,
  active: true,
  localeMode: "auto",
  kind: "contributor",
};

const GUEST: ExternalLinkPublicGuest = {
  id: "guest-a",
  name: "GUEST A",
  status: "pending",
  checkInTime: null,
  createdAt: "2026-08-23T12:00:00.000Z",
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function validationData(
  overrides: Partial<ExternalLinkPublicValidationData> = {},
): ExternalLinkPublicValidationData {
  return {
    link: LINK,
    venue: VENUE,
    guests: [GUEST],
    ...overrides,
  };
}

function createDependencies(
  overrides: Partial<ExternalGuestControllerDependencies> = {},
): ExternalGuestControllerDependencies {
  return {
    validateExternalToken: async () => ({
      data: validationData(),
      error: null,
    }),
    createGuestViaExternalLink: async () => ({ data: GUEST, error: null }),
    createGuestsViaExternalLink: async () => ({ data: { items: [] }, error: null }),
    deleteGuestViaExternalLink: async () => ({ error: null }),
    updateGuestViaExternalLink: async () => ({ data: GUEST, error: null }),
    ...overrides,
  };
}

interface HarnessProps {
  dependencies: ExternalGuestControllerDependencies;
  token?: string;
  onController?: (
    controller: ReturnType<typeof useExternalGuestController>,
  ) => void;
}

function ExternalGuestControllerHarness({
  dependencies,
  token = TOKEN,
  onController,
}: HarnessProps) {
  const controller = useExternalGuestController({ token, dependencies });
  onController?.(controller);

  return (
    <main id="main-content" tabIndex={-1}>
      <h1 ref={controller.retryHeadingRef} tabIndex={-1}>Retry</h1>
      <h1 ref={controller.reconciliationHeadingRef} tabIndex={-1}>
        Reconcile
      </h1>
      <h1 ref={controller.contentHeadingRef} tabIndex={-1}>Content</h1>
      <output data-testid="validating">{String(controller.isValidating)}</output>
      <output data-testid="invalid">{String(controller.hasValidationError)}</output>
      <output data-testid="retry">{String(controller.showRetryPanel)}</output>
      <output data-testid="reconciling">
        {String(controller.showReconciliationBanner)}
      </output>
      <output data-testid="error">{controller.error ?? ""}</output>
      <output data-testid="loading">{String(controller.isLoading)}</output>
      <output data-testid="name">{controller.guestName}</output>
      <output data-testid="guests">{controller.guests.map((guest) => guest.name).join(",")}</output>
      <output data-testid="bulk-pending">
        {String(controller.isBulkSubmitting)}
      </output>
      <output data-testid="self-rsvp-locked">
        {String(controller.isSelfRsvpLocked)}
      </output>
    </main>
  );
}

function renderHarness(props: HarnessProps) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ Common: { loading: "Loading" } }}>
      <RouteTransitionProvider>
        <ExternalGuestControllerHarness {...props} />
      </RouteTransitionProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

test("bootstraps the per-token owner key and publishes validated external data", async () => {
  const calls: Array<{ token: string; ownerKey?: string | null }> = [];
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async (token, ownerKey) => {
        calls.push({ token, ownerKey });
        return { data: validationData(), error: null };
      },
    }),
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("validating").textContent, "false");
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.token, TOKEN);
  assert.ok(calls[0]?.ownerKey);
  assert.equal(
    window.localStorage.getItem(externalOwnerStorageKey(TOKEN)),
    calls[0]?.ownerKey,
  );
  assert.equal(screen.getByTestId("guests").textContent, "GUEST A");
});

test("keeps invalid links separate from retryable validation failures and focuses retry", async () => {
  const invalid = renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => ({
        data: null,
        error: "INVALID_EXTERNAL_LINK",
      }),
    }),
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("invalid").textContent, "true");
  });
  assert.equal(screen.getByTestId("retry").textContent, "false");
  invalid.unmount();

  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => ({
        data: null,
        error: "EXTERNAL_LINK_UNAVAILABLE",
      }),
    }),
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("retry").textContent, "true");
    assert.equal(
      document.activeElement === screen.getByRole("heading", { name: "Retry" }),
      true,
    );
    assert.equal(
      screen.getByRole("heading", { name: "Retry" }).closest("[inert]") === null,
      true,
    );
    assert.equal(document.querySelector(".route-transition-overlay") === null, true);
  });
  assert.equal(screen.getByTestId("invalid").textContent, "false");
  assert.equal(screen.getByTestId("error").textContent, "refreshFailed");
});

test("retry success focuses Content only after the overlay and inert ancestor are removed", async () => {
  const retry = createDeferred<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>();
  let validationCalls = 0;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        return validationCalls === 1
          ? { data: null, error: "EXTERNAL_LINK_UNAVAILABLE" }
          : retry.promise;
      },
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("retry").textContent, "true");
  });
  const content = screen.getByText("Content");
  let operation: Promise<void> | undefined;
  await act(async () => {
    operation = controller?.handleInitialRetry();
    await Promise.resolve();
  });
  await act(async () => {
    retry.resolve({ data: validationData({ guests: [] }), error: null });
    await operation;
  });

  await waitFor(() => {
    assert.equal(document.activeElement === content, true);
    assert.equal(content.closest("[inert]") === null, true);
    assert.equal(document.querySelector(".route-transition-overlay") === null, true);
  });
});

test("create feedback is published only after its authoritative refresh completes", async () => {
  const refresh = createDeferred<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>();
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  let validationCalls = 0;
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        return validationCalls === 1
          ? { data: validationData({ guests: [] }), error: null }
          : refresh.promise;
      },
      createGuestViaExternalLink: async () => ({
        data: null,
        error: "RATE_LIMITED",
      }),
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("validating").textContent, "false");
  });
  await act(async () => {
    controller?.handleGuestNameChange("Guest A");
  });
  let save: Promise<void> | undefined;
  await act(async () => {
    save = controller?.handleSave();
    await Promise.resolve();
  });

  assert.equal(validationCalls, 2);
  assert.equal(screen.getByTestId("error").textContent, "");
  assert.equal(screen.getByTestId("loading").textContent, "true");
  await act(async () => {
    refresh.resolve({ data: validationData({ guests: [] }), error: null });
    await save;
  });
  assert.equal(screen.getByTestId("error").textContent, "rateLimited");
  assert.equal(screen.getByTestId("loading").textContent, "false");
});

test("a self RSVP refresh preserves a draft edited while the refresh is pending", async () => {
  const refresh = createDeferred<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>();
  let validationCalls = 0;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  const selfRsvpData = validationData({
    link: { ...LINK, kind: "self_rsvp" },
    guests: [{ ...GUEST, name: "INITIAL NAME" }],
  });
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        return validationCalls === 1
          ? { data: selfRsvpData, error: null }
          : refresh.promise;
      },
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("name").textContent, "INITIAL NAME");
  });

  let retry!: Promise<void>;
  await act(async () => {
    retry = controller?.handleInitialRetry() ?? Promise.resolve();
    controller?.handleGuestNameChange("EDITED NAME");
  });
  await act(async () => {
    refresh.resolve({ data: selfRsvpData, error: null });
    await retry;
  });

  assert.equal(screen.getByTestId("name").textContent, "EDITED NAME");
});

test("a self RSVP edit during a deferred save survives action and authoritative refresh", async () => {
  const update = createDeferred<{ data: ExternalLinkPublicGuest | null; error: string | null }>();
  const refresh = createDeferred<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>();
  const selfLink = { ...LINK, kind: "self_rsvp" as const };
  const initialGuest = { ...GUEST, name: "INITIAL NAME" };
  const refreshedGuest = { ...GUEST, name: "SERVER NAME" };
  let validationCalls = 0;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        return validationCalls === 1
          ? {
            data: validationData({ link: selfLink, guests: [initialGuest] }),
            error: null,
          }
          : refresh.promise;
      },
      updateGuestViaExternalLink: async () => update.promise,
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("name").textContent, "INITIAL NAME");
  });
  await act(async () => {
    controller?.handleGuestNameChange("SUBMITTED NAME");
  });
  let save: Promise<void> | undefined;
  await act(async () => {
    save = controller?.handleSave();
    await Promise.resolve();
  });
  await act(async () => {
    controller?.handleGuestNameChange("NEWER DRAFT");
  });
  await act(async () => {
    update.resolve({ data: { ...initialGuest, name: "ACTION NAME" }, error: null });
    await Promise.resolve();
  });
  await act(async () => {
    refresh.resolve({
      data: validationData({ link: selfLink, guests: [refreshedGuest] }),
      error: null,
    });
    await save;
  });

  assert.equal(screen.getByTestId("name").textContent, "NEWER DRAFT");
  assert.equal(screen.getByTestId("guests").textContent, "SERVER NAME");
});

test("a synchronous controller lease rejects duplicate and cross-operation writes", async () => {
  const create = createDeferred<{ data: ExternalLinkPublicGuest | null; error: string | null }>();
  let createCalls = 0;
  let deleteCalls = 0;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => ({
        data: validationData({ guests: [] }),
        error: null,
      }),
      createGuestViaExternalLink: async () => {
        createCalls += 1;
        return create.promise;
      },
      deleteGuestViaExternalLink: async () => {
        deleteCalls += 1;
        return { error: null };
      },
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("validating").textContent, "false");
  });
  let operation: Promise<void> | undefined;
  await act(async () => {
    controller?.handleGuestNameChange("Guest A");
  });
  await act(async () => {
    operation = controller?.handleSave();
    void controller?.handleSave();
    void controller?.handleDelete("guest-other");
    await Promise.resolve();
  });

  assert.equal(createCalls, 1);
  assert.equal(deleteCalls, 0);
  await act(async () => {
    create.resolve({ data: null, error: "RATE_LIMITED" });
    await operation;
  });
  assert.equal(screen.getByTestId("loading").textContent, "false");
});

test("delete, retry, and bulk each reject same-tick duplicates through the controller lease", async () => {
  const retry = createDeferred<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>();
  const bulk = createDeferred<{
    data: { items: [] } | null;
    error: string | null;
  }>();
  const remove = createDeferred<{ error: string | null }>();
  let validationCalls = 0;
  let bulkCalls = 0;
  let deleteCalls = 0;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        if (validationCalls === 1) return { data: validationData(), error: null };
        if (validationCalls === 2) return retry.promise;
        return { data: validationData(), error: null };
      },
      createGuestsViaExternalLink: async () => {
        bulkCalls += 1;
        return bulk.promise;
      },
      deleteGuestViaExternalLink: async () => {
        deleteCalls += 1;
        return remove.promise;
      },
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("validating").textContent, "false");
  });
  let retryOne: Promise<void> | undefined;
  await act(async () => {
    retryOne = controller?.handleInitialRetry();
    void controller?.handleInitialRetry();
    await Promise.resolve();
  });
  assert.equal(validationCalls, 2);
  await act(async () => {
    retry.resolve({ data: validationData(), error: null });
    await retryOne;
  });

  let bulkOne: Promise<unknown> | undefined;
  await act(async () => {
    bulkOne = controller?.handleBulkSave([]);
    void controller?.handleBulkSave([]);
    await Promise.resolve();
  });
  assert.equal(bulkCalls, 1);
  await act(async () => {
    bulk.resolve({ data: { items: [] }, error: null });
    await bulkOne;
  });

  let deleteOne: Promise<void> | undefined;
  await act(async () => {
    deleteOne = controller?.handleDelete("guest-a");
    void controller?.handleDelete("guest-b");
    await Promise.resolve();
  });
  assert.equal(deleteCalls, 1);
  await act(async () => {
    remove.resolve({ error: null });
    await deleteOne;
  });
});

test("a route-invalidated post-write refresh locks reconciliation instead of publishing feedback", async () => {
  const refresh = createDeferred<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>();
  let validationCalls = 0;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        return validationCalls === 1
          ? { data: validationData({ guests: [] }), error: null }
          : refresh.promise;
      },
      createGuestViaExternalLink: async () => ({
        data: null,
        error: "RATE_LIMITED",
      }),
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("validating").textContent, "false");
  });
  let save: Promise<void> | undefined;
  await act(async () => {
    controller?.handleGuestNameChange("Guest A");
  });
  await act(async () => {
    save = controller?.handleSave();
    await Promise.resolve();
  });
  announceRouteTransitionStart();
  await act(async () => {
    refresh.resolve({ data: validationData({ guests: [] }), error: null });
    await save;
  });

  assert.equal(screen.getByTestId("error").textContent, "");
  assert.equal(screen.getByTestId("reconciling").textContent, "true");
});

test("bulk lifecycle remains controller-owned through reconciliation failure", async () => {
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  let validationCalls = 0;
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        return validationCalls === 1
          ? { data: validationData(), error: null }
          : { data: null, error: "EXTERNAL_LINK_UNAVAILABLE" };
      },
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("validating").textContent, "false");
  });
  await act(async () => {
    await controller?.handleBulkSave([]);
  });

  assert.equal(screen.getByTestId("reconciling").textContent, "true");
});

test("a throwing bulk action refreshes once, rejects duplicates, and releases its lease", async () => {
  let rejectBulk!: (error: Error) => void;
  const bulk = new Promise<never>((_resolve, reject) => {
    rejectBulk = reject;
  });
  let validationCalls = 0;
  let bulkCalls = 0;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;
  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        return { data: validationData({ guests: [] }), error: null };
      },
      createGuestsViaExternalLink: async () => {
        bulkCalls += 1;
        return bulkCalls === 1 ? bulk : { data: { items: [] }, error: null };
      },
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("validating").textContent, "false");
  });
  let firstBulk: Promise<unknown> | undefined;
  await act(async () => {
    firstBulk = controller?.handleBulkSave([]);
    void controller?.handleBulkSave([]);
    await Promise.resolve();
  });
  assert.equal(bulkCalls, 1);
  let rejection: unknown;
  await act(async () => {
    rejectBulk(new Error("bulk failed"));
    try {
      await firstBulk;
    } catch (error) {
      rejection = error;
    }
  });
  assert.match(String(rejection), /bulk failed/);
  assert.equal(validationCalls, 2);
  assert.equal(screen.getByTestId("bulk-pending").textContent, "false");

  await act(async () => {
    await controller?.handleBulkSave([]);
  });
  assert.equal(bulkCalls, 2);
});

test("contributor mutations preserve payloads, optimistic state, and mandatory refreshes", async () => {
  const refreshedGuest = { ...GUEST, id: "guest-server", name: "SERVER GUEST" };
  const createdGuest = { ...GUEST, id: "guest-created", name: "CREATED GUEST" };
  const refreshAfterCreate = createDeferred<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>();
  let validationCalls = 0;
  let createPayload: Parameters<
    ExternalGuestControllerDependencies["createGuestViaExternalLink"]
  >[0] | undefined;
  let deletePayload: Parameters<
    ExternalGuestControllerDependencies["deleteGuestViaExternalLink"]
  >[0] | undefined;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;

  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        if (validationCalls === 1) return { data: validationData({ guests: [] }), error: null };
        if (validationCalls === 2) return refreshAfterCreate.promise;
        return { data: validationData({ guests: [] }), error: null };
      },
      createGuestViaExternalLink: async (payload) => {
        createPayload = payload;
        return { data: createdGuest, error: null };
      },
      deleteGuestViaExternalLink: async (payload) => {
        deletePayload = payload;
        return { error: null };
      },
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("validating").textContent, "false");
  });
  const ownerKey = window.localStorage.getItem(externalOwnerStorageKey(TOKEN));
  assert.ok(ownerKey);

  await act(async () => {
    controller?.handleGuestNameChange("guest a");
  });
  let save: Promise<void> | undefined;
  await act(async () => {
    save = controller?.handleSave();
    await Promise.resolve();
  });
  await waitFor(() => {
    assert.equal(screen.getByTestId("guests").textContent, "CREATED GUEST");
  });
  assert.deepEqual(createPayload, {
    token: TOKEN,
    ownerKey,
    guestName: "GUEST A",
    date: LINK.date,
  });

  await act(async () => {
    refreshAfterCreate.resolve({
      data: validationData({ guests: [refreshedGuest] }),
      error: null,
    });
    await save;
  });
  assert.equal(screen.getByTestId("guests").textContent, "SERVER GUEST");

  await act(async () => {
    await controller?.handleDelete(refreshedGuest.id);
  });
  assert.deepEqual(deletePayload, {
    token: TOKEN,
    guestId: refreshedGuest.id,
    ownerKey,
  });
  assert.equal(validationCalls, 3);
  assert.equal(screen.getByTestId("guests").textContent, "");
});

test("self RSVP update preserves its owner payload, locks checked entries, and serializes retries", async () => {
  const initialGuest = { ...GUEST, name: "INITIAL NAME" };
  const checkedGuest = { ...GUEST, name: "CHECKED NAME", status: "checked" as const };
  const staleRefresh = createDeferred<{
    data: ExternalLinkPublicValidationData | null;
    error: string | null;
  }>();
  const selfLink = { ...LINK, kind: "self_rsvp" as const };
  const initial = validationData({ link: selfLink, guests: [initialGuest] });
  const checked = validationData({ link: selfLink, guests: [checkedGuest] });
  const latest = validationData({
    link: selfLink,
    guests: [{ ...initialGuest, name: "LATEST NAME" }],
  });
  let validationCalls = 0;
  let updateCalls = 0;
  let updatePayload: Parameters<
    ExternalGuestControllerDependencies["updateGuestViaExternalLink"]
  >[0] | undefined;
  let controller: ReturnType<typeof useExternalGuestController> | undefined;

  renderHarness({
    dependencies: createDependencies({
      validateExternalToken: async () => {
        validationCalls += 1;
        if (validationCalls === 1) return { data: initial, error: null };
        if (validationCalls === 2) return { data: checked, error: null };
        return staleRefresh.promise;
      },
      updateGuestViaExternalLink: async (payload) => {
        updateCalls += 1;
        updatePayload = payload;
        return { data: { ...initialGuest, name: "EDITED NAME" }, error: null };
      },
    }),
    onController: (next) => {
      controller = next;
    },
  });

  await waitFor(() => {
    assert.equal(screen.getByTestId("name").textContent, "INITIAL NAME");
  });
  const ownerKey = window.localStorage.getItem(externalOwnerStorageKey(TOKEN));
  assert.ok(ownerKey);

  await act(async () => {
    controller?.handleGuestNameChange("edited name");
  });
  await act(async () => {
    await controller?.handleSave();
  });
  assert.deepEqual(updatePayload, {
    token: TOKEN,
    ownerKey,
    guestId: initialGuest.id,
    guestName: "EDITED NAME",
  });
  assert.equal(screen.getByTestId("self-rsvp-locked").textContent, "true");

  await act(async () => {
    controller?.handleGuestNameChange("NOT SAVED");
    await controller?.handleSave();
  });
  assert.equal(updateCalls, 1);

  let firstRetry: Promise<void> | undefined;
  let secondRetry: Promise<void> | undefined;
  await act(async () => {
    firstRetry = controller?.handleInitialRetry();
    secondRetry = controller?.handleInitialRetry();
    await Promise.resolve();
  });
  assert.equal(validationCalls, 3);
  await act(async () => {
    staleRefresh.resolve({
      data: latest,
      error: null,
    });
    await firstRetry;
    await secondRetry;
  });

  assert.equal(screen.getByTestId("guests").textContent, "LATEST NAME");
});
