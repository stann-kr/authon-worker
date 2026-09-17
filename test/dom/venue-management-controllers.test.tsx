import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import type { FormEvent } from "react";
import { NextIntlClientProvider } from "next-intl";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import messages from "@/messages/en.json";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import useVenueDirectoryController, {
  type VenueDirectoryControllerDependencies,
  type VenueDirectoryLoadResult,
  type VenueMutationMessageResolver,
  type VenueUpdateInput,
} from "@/app/admin/components/useVenueDirectoryController";
import useVenueCreateController, {
  type VenueCreateControllerDependencies,
} from "@/app/admin/components/useVenueCreateController";
import type { Venue } from "@/lib/venues/types";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("lib/api/venues")) {
      return { url: "mock:venue-management-actions", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "mock:venue-management-actions") {
      return {
        format: "module",
        source: `
          export const fetchVenues = async () => ({ data: [], error: null });
          export const createVenue = async () => ({ data: null, error: null });
          export const updateVenue = async () => ({ data: null, error: null });
        `,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

afterEach(cleanup);

const VENUE_A: Venue = {
  id: "venue-a",
  name: "Venue A",
  type: "club",
  address: "Seoul",
  description: "Venue A description",
  brandName: "Brand A",
  brandTagline: "Tagline A",
  primaryDomain: "a.example.com",
  defaultLocale: "en",
  timezone: "Asia/Seoul",
  openingTime: "22:00",
  closingTime: "06:00",
  active: true,
};

const VENUE_B: Venue = {
  ...VENUE_A,
  id: "venue-b",
  name: "Venue B",
};

const UPDATED_VENUE_A: Venue = {
  ...VENUE_A,
  name: "Venue A updated",
  brandName: "Brand A updated",
};

let venueManagementModulePromise:
  | ReturnType<typeof importVenueManagementModule>
  | null = null;

function importVenueManagementModule() {
  return import("@/app/admin/components/VenueManagement");
}

function loadVenueManagementModule() {
  venueManagementModulePromise ??= importVenueManagementModule();
  return venueManagementModulePromise;
}

const resolveMutationMessage: VenueMutationMessageResolver = (
  error,
  fallback,
) => {
  if (error === "INVALID_TIMEZONE") {
    return messages.VenueAdmin.invalidTimezone;
  }
  if (error === "INVALID_OPERATING_HOURS") {
    return messages.VenueAdmin.invalidOperatingHours;
  }
  return messages.VenueAdmin[fallback];
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createDirectoryDependencies(
  overrides: Partial<VenueDirectoryControllerDependencies> = {},
): VenueDirectoryControllerDependencies {
  return {
    fetchVenues: async () => ({ data: [], error: null }),
    updateVenue: async () => ({ data: VENUE_A, error: null }),
    ...overrides,
  };
}

type DirectoryController = ReturnType<typeof useVenueDirectoryController>;

function DirectoryHarness({
  dependencies,
  refreshActiveVenues,
  expose,
}: {
  dependencies: VenueDirectoryControllerDependencies;
  refreshActiveVenues: () => Promise<void>;
  expose: (controller: DirectoryController) => void;
}) {
  const controller = useVenueDirectoryController({
    dependencies,
    refreshActiveVenues,
    resolveMutationMessage,
  });
  expose(controller);

  return (
    <>
      <output data-testid="directory-state">{controller.listState}</output>
      <output data-testid="directory-loading">
        {String(controller.isLoading)}
      </output>
      <output data-testid="directory-mutating">
        {String(controller.isMutating)}
      </output>
      <output data-testid="directory-venues">
        {controller.venues.map((venue) => venue.id).join(",")}
      </output>
      <output data-testid="directory-error">{controller.listError}</output>
      <button onClick={() => void controller.refreshAfterMutation()}>Refresh venues</button>
    </>
  );
}

function renderDirectory(
  dependencies: VenueDirectoryControllerDependencies,
  refreshActiveVenues: () => Promise<void> = async () => {},
) {
  let controller: DirectoryController | null = null;
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RouteTransitionProvider>
        <DirectoryHarness
          dependencies={dependencies}
          refreshActiveVenues={refreshActiveVenues}
          expose={(nextController) => {
            controller = nextController;
          }}
        />
      </RouteTransitionProvider>
    </NextIntlClientProvider>,
  );
  return {
    ...view,
    controller: () => {
      assert.ok(controller);
      return controller;
    },
  };
}

type CreateController = ReturnType<typeof useVenueCreateController>;

function CreateHarness({
  dependencies,
  onCreated,
  expose,
}: {
  dependencies: VenueCreateControllerDependencies;
  onCreated: () => Promise<VenueDirectoryLoadResult | void>;
  expose: (controller: CreateController) => void;
}) {
  const controller = useVenueCreateController({
    dependencies,
    onCreated,
    resolveMutationMessage,
  });
  expose(controller);

  return (
    <>
      <output data-testid="create-submitting">
        {String(controller.isSubmitting)}
      </output>
      <output data-testid="create-error">{controller.formError}</output>
      <output data-testid="create-success">{controller.formSuccess}</output>
      <output data-testid="create-name">{controller.formData.name}</output>
      <form data-testid="create-form" onSubmit={controller.handleCreate}>
        <input
          ref={controller.nameInputRef}
          value={controller.formData.name}
          onChange={(event) =>
            controller.setFormData((current) => ({
              ...current,
              name: event.target.value,
            }))
          }
          required
          aria-invalid={controller.hasNameValidationError}
          aria-describedby={
            controller.hasNameValidationError ? "create-name-error" : undefined
          }
          data-testid="create-name-input"
        />
        <button type="submit">submit-create</button>
      </form>
      {controller.hasNameValidationError && (
        <p id="create-name-error">{controller.formError}</p>
      )}
    </>
  );
}

function renderCreate(
  dependencies: VenueCreateControllerDependencies,
  onCreated: () => Promise<VenueDirectoryLoadResult | void> = async () => {},
) {
  let controller: CreateController | null = null;
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CreateHarness
        dependencies={dependencies}
        onCreated={onCreated}
        expose={(nextController) => {
          controller = nextController;
        }}
      />
    </NextIntlClientProvider>,
  );
  return {
    ...view,
    controller: () => {
      assert.ok(controller);
      return controller;
    },
  };
}

type TestMutationResult =
  | { status: "applied"; error: null }
  | { status: "failed"; error: string | null }
  | { status: "busy"; error: null };

async function renderVenueCard({
  venue = VENUE_A,
  actionsDisabled = false,
  onSave = async () => ({ status: "applied", error: null }),
  onToggleActive = async () => ({ status: "applied", error: null }),
}: {
  venue?: Venue;
  actionsDisabled?: boolean;
  onSave?: (
    id: string,
    updates: VenueUpdateInput,
  ) => Promise<TestMutationResult>;
  onToggleActive?: (venue: Venue) => Promise<TestMutationResult>;
} = {}) {
  const { VenueCard } = await loadVenueManagementModule();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VenueCard
        venue={venue}
        actionsDisabled={actionsDisabled}
        onSave={onSave}
        onToggleActive={onToggleActive}
      />
    </NextIntlClientProvider>,
  );
  if (!actionsDisabled) fireEvent.click(screen.getByRole("button", { name: new RegExp(venue.name) }));
  return { ...view, VenueCard };
}

function createSubmitEvent(): FormEvent<HTMLFormElement> {
  return {
    preventDefault() {},
  } as FormEvent<HTMLFormElement>;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("directory loads inactive venues and ignores an older overlapping result", async () => {
  const firstRequest = createDeferred<{
    data: Venue[];
    error: null;
  }>();
  const secondRequest = createDeferred<{
    data: Venue[];
    error: null;
  }>();
  const includeInactiveCalls: boolean[] = [];
  let requestCount = 0;
  const view = renderDirectory(
    createDirectoryDependencies({
      fetchVenues: async (includeInactive) => {
        includeInactiveCalls.push(Boolean(includeInactive));
        requestCount += 1;
        return requestCount === 1 ? firstRequest.promise : secondRequest.promise;
      },
    }),
  );

  assert.deepEqual(includeInactiveCalls, [true]);
  assert.equal(screen.getByTestId("directory-loading").textContent, "true");

  let secondLoad!: ReturnType<DirectoryController["loadVenues"]>;
  await act(async () => {
    secondLoad = view.controller().loadVenues();
    await Promise.resolve();
  });
  assert.deepEqual(includeInactiveCalls, [true, true]);

  await act(async () => {
    secondRequest.resolve({ data: [VENUE_B], error: null });
    await secondLoad;
  });
  assert.equal(screen.getByTestId("directory-venues").textContent, "venue-b");
  assert.equal(screen.getByTestId("directory-loading").textContent, "false");

  await act(async () => {
    firstRequest.resolve({ data: [VENUE_A], error: null });
    await firstRequest.promise;
  });
  assert.equal(screen.getByTestId("directory-venues").textContent, "venue-b");
  assert.equal(screen.getByTestId("directory-loading").textContent, "false");
});

test("directory keeps partial and full failures distinct from an empty success", async () => {
  const partialView = renderDirectory(
    createDirectoryDependencies({
      fetchVenues: async () => ({ data: [VENUE_A], error: "PARTIAL" }),
    }),
  );
  await flushAsyncWork();
  assert.equal(screen.getByTestId("directory-state").textContent, "partial");
  assert.equal(
    screen.getByTestId("directory-error").textContent,
    messages.VenueAdmin.loadFailed,
  );

  partialView.unmount();
  const errorView = renderDirectory(
    createDirectoryDependencies({
      fetchVenues: async () => ({ data: null, error: "FAILED" }),
    }),
  );
  await flushAsyncWork();
  assert.equal(screen.getByTestId("directory-state").textContent, "error");

  errorView.unmount();
  renderDirectory(createDirectoryDependencies());
  await flushAsyncWork();
  assert.equal(
    screen.getByTestId("directory-state").textContent,
    "success-empty",
  );
});

test("one directory refresh clears a failed list and also refreshes the active venue scope", async () => {
  let unavailable = true;
  let activeRefreshes = 0;
  renderDirectory(createDirectoryDependencies({
    fetchVenues: async () => unavailable
      ? { data: null, error: "UNAVAILABLE" }
      : { data: [VENUE_A, VENUE_B], error: null },
  }), async () => { activeRefreshes += 1; });
  await flushAsyncWork();
  assert.equal(screen.getByTestId("directory-state").textContent, "error");
  unavailable = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh venues" }));
  await flushAsyncWork();
  assert.equal(screen.getByTestId("directory-error").textContent, "");
  assert.equal(screen.getByTestId("directory-venues").textContent, "venue-a,venue-b");
  assert.equal(activeRefreshes, 1);
});

test("create validates the name and submits the captured normalized draft", async () => {
  const createRequest = createDeferred<{ data: Venue; error: null }>();
  const submittedInputs: Parameters<
    VenueCreateControllerDependencies["createVenue"]
  >[0][] = [];
  const view = renderCreate({
    createVenue: async (input) => {
      submittedInputs.push(input);
      return createRequest.promise;
    },
  });

  const nameInput = screen.getByTestId(
    "create-name-input",
  ) as HTMLInputElement;
  assert.equal(nameInput.required, true);
  fireEvent.change(nameInput, { target: { value: "   " } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "submit-create" }));
    await Promise.resolve();
  });
  assert.equal(submittedInputs.length, 0);
  assert.equal(
    screen.getByTestId("create-error").textContent,
    messages.VenueAdmin.nameRequired,
  );
  assert.equal(nameInput.getAttribute("aria-invalid"), "true");
  assert.equal(nameInput.getAttribute("aria-describedby"), "create-name-error");
  assert.equal(document.getElementById("create-name-error")?.textContent, messages.VenueAdmin.nameRequired);
  assert.equal(document.activeElement === nameInput, true);

  act(() => {
    view.controller().setFormData({
      name: "  Venue A  ",
      type: "club",
      address: "  ",
      description: "  Description  ",
      brandName: "  Brand A  ",
      brandTagline: "",
      primaryDomain: "  a.example.com  ",
      defaultLocale: "ko",
      timezone: "  Asia/Seoul  ",
      openingTime: "22:00",
      closingTime: "06:00",
    });
  });
  assert.equal(nameInput.getAttribute("aria-invalid"), "false");
  assert.equal(nameInput.getAttribute("aria-describedby"), null);
  assert.equal(screen.getByTestId("create-error").textContent, "");

  let submitPromise!: Promise<void>;
  await act(async () => {
    submitPromise = view.controller().handleCreate(createSubmitEvent());
    await Promise.resolve();
  });
  assert.deepEqual(submittedInputs, [
    {
      name: "Venue A",
      type: "club",
      address: undefined,
      description: "Description",
      brandName: "Brand A",
      brandTagline: undefined,
      primaryDomain: "a.example.com",
      defaultLocale: "ko",
      timezone: "Asia/Seoul",
      openingTime: "22:00",
      closingTime: "06:00",
    },
  ]);

  act(() => {
    view.controller().setFormData((current) => ({
      ...current,
      name: "Later edit",
    }));
  });
  assert.equal(submittedInputs[0]?.name, "Venue A");

  await act(async () => {
    createRequest.resolve({ data: VENUE_A, error: null });
    await submitPromise;
  });
});

test("create success waits for refresh and restores the exact default draft", async () => {
  const refreshRequest = createDeferred<void>();
  let refreshCalls = 0;
  const view = renderCreate(
    {
      createVenue: async () => ({ data: VENUE_A, error: null }),
    },
    async () => {
      refreshCalls += 1;
      return refreshRequest.promise;
    },
  );
  act(() => {
    view.controller().setFormData((current) => ({
      ...current,
      name: "Venue A",
      type: "festival",
      defaultLocale: "ko",
    }));
  });

  let submitPromise!: Promise<void>;
  await act(async () => {
    submitPromise = view.controller().handleCreate(createSubmitEvent());
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(refreshCalls, 1);
  assert.equal(screen.getByTestId("create-submitting").textContent, "true");

  await act(async () => {
    refreshRequest.resolve();
    await submitPromise;
  });
  assert.equal(screen.getByTestId("create-submitting").textContent, "false");
  assert.equal(
    screen.getByTestId("create-success").textContent,
    'Venue "Venue A" has been created.',
  );
  assert.deepEqual(view.controller().formData, {
    name: "",
    type: "club",
    address: "",
    description: "",
    brandName: "",
    brandTagline: "",
    primaryDomain: "",
    defaultLocale: "en",
    timezone: "Asia/Seoul",
    openingTime: "22:00",
    closingTime: "06:00",
  });
});

test("create maps known mutation errors without refreshing", async () => {
  let refreshCalls = 0;
  const view = renderCreate(
    {
      createVenue: async () => ({ data: null, error: "INVALID_TIMEZONE" }),
    },
    async () => {
      refreshCalls += 1;
    },
  );
  act(() => {
    view.controller().setFormData((current) => ({
      ...current,
      name: "Venue A",
    }));
  });

  await act(async () => {
    await view.controller().handleCreate(createSubmitEvent());
  });
  assert.equal(refreshCalls, 0);
  assert.equal(
    screen.getByTestId("create-error").textContent,
    messages.VenueAdmin.invalidTimezone,
  );
});

test("save reports outcomes with raw errors and refreshes both venue sources only on success", async () => {
  let updateResult: { data: Venue | null; error: string | null } = {
    data: null,
    error: "INVALID_OPERATING_HOURS",
  };
  const updateCalls: Array<{ id: string; updates: unknown }> = [];
  let directoryLoads = 0;
  let activeRefreshes = 0;
  const view = renderDirectory(
    createDirectoryDependencies({
      fetchVenues: async () => {
        directoryLoads += 1;
        return { data: [VENUE_A], error: null };
      },
      updateVenue: async (id, updates) => {
        updateCalls.push({ id, updates });
        return updateResult;
      },
    }),
    async () => {
      activeRefreshes += 1;
    },
  );
  await flushAsyncWork();

  let result: unknown;
  await act(async () => {
    result = await view.controller().handleSave("venue-a", {
      openingTime: "22:00",
      closingTime: "22:00",
    });
  });
  assert.deepEqual(result, {
    status: "failed",
    error: "INVALID_OPERATING_HOURS",
  });
  assert.equal(directoryLoads, 1);
  assert.equal(activeRefreshes, 0);
  assert.equal(
    screen.getByTestId("directory-error").textContent,
    messages.VenueAdmin.invalidOperatingHours,
  );

  updateResult = { data: VENUE_A, error: null };
  await act(async () => {
    result = await view.controller().handleSave("venue-a", {
      brandName: "Brand A",
    });
  });
  assert.deepEqual(result, { status: "applied", error: null });
  assert.equal(directoryLoads, 2);
  assert.equal(activeRefreshes, 1);
  assert.equal(screen.getByTestId("directory-error").textContent, "");
  assert.deepEqual(updateCalls, [
    {
      id: "venue-a",
      updates: { openingTime: "22:00", closingTime: "22:00" },
    },
    { id: "venue-a", updates: { brandName: "Brand A" } },
  ]);
});

test("toggle sends the inverse active state and refreshes only after success", async () => {
  let updateResult: { data: Venue | null; error: string | null } = {
    data: null,
    error: "FAILED",
  };
  const updateCalls: Array<{ id: string; updates: unknown }> = [];
  let directoryLoads = 0;
  let activeRefreshes = 0;
  const view = renderDirectory(
    createDirectoryDependencies({
      fetchVenues: async () => {
        directoryLoads += 1;
        return { data: [VENUE_A], error: null };
      },
      updateVenue: async (id, updates) => {
        updateCalls.push({ id, updates });
        return updateResult;
      },
    }),
    async () => {
      activeRefreshes += 1;
    },
  );
  await flushAsyncWork();

  await act(async () => {
    await view.controller().handleToggleActive(VENUE_A);
  });
  assert.equal(directoryLoads, 1);
  assert.equal(activeRefreshes, 0);
  assert.equal(
    screen.getByTestId("directory-error").textContent,
    messages.VenueAdmin.updateFailed,
  );

  updateResult = { data: { ...VENUE_A, active: false }, error: null };
  await act(async () => {
    await view.controller().handleToggleActive(VENUE_A);
  });
  assert.equal(directoryLoads, 2);
  assert.equal(activeRefreshes, 1);
  assert.deepEqual(updateCalls, [
    { id: "venue-a", updates: { active: false } },
    { id: "venue-a", updates: { active: false } },
  ]);
});

test("create claims a synchronous operation before same-act duplicate submits", async () => {
  const createRequest = createDeferred<{ data: Venue; error: null }>();
  let createCalls = 0;
  const view = renderCreate({
    createVenue: async () => {
      createCalls += 1;
      return createRequest.promise;
    },
  });
  act(() => {
    view.controller().setFormData((current) => ({
      ...current,
      name: "Venue A",
    }));
  });

  let firstSubmit!: Promise<void>;
  let duplicateSubmit!: Promise<void>;
  await act(async () => {
    firstSubmit = view.controller().handleCreate(createSubmitEvent());
    duplicateSubmit = view.controller().handleCreate(createSubmitEvent());
    await Promise.resolve();
  });
  assert.equal(createCalls, 1);
  assert.equal(screen.getByTestId("create-submitting").textContent, "true");

  await act(async () => {
    createRequest.resolve({ data: VENUE_A, error: null });
    await Promise.all([firstSubmit, duplicateSubmit]);
  });
  assert.equal(screen.getByTestId("create-submitting").textContent, "false");
});

test("one directory mutation owner rejects same-act duplicate and cross-operation work", async () => {
  const updateRequest = createDeferred<{ data: Venue; error: null }>();
  let updateCalls = 0;
  const view = renderDirectory(
    createDirectoryDependencies({
      fetchVenues: async () => ({ data: [VENUE_A], error: null }),
      updateVenue: async () => {
        updateCalls += 1;
        return updateRequest.promise;
      },
    }),
  );
  await flushAsyncWork();

  let activeToggle!: Promise<unknown>;
  let duplicateToggle!: Promise<unknown>;
  let crossOperationSave!: Promise<unknown>;
  await act(async () => {
    activeToggle = view.controller().handleToggleActive(VENUE_A);
    duplicateToggle = view.controller().handleToggleActive(VENUE_A);
    crossOperationSave = view.controller().handleSave("venue-a", {
      name: "Venue A updated",
    });
    await Promise.resolve();
  });
  assert.equal(updateCalls, 1);
  assert.equal(screen.getByTestId("directory-mutating").textContent, "true");

  let results!: unknown[];
  await act(async () => {
    updateRequest.resolve({ data: VENUE_A, error: null });
    results = await Promise.all([
      activeToggle,
      duplicateToggle,
      crossOperationSave,
    ]);
  });
  assert.deepEqual(results, [
    { status: "applied", error: null },
    { status: "busy", error: null },
    { status: "busy", error: null },
  ]);
  assert.equal(screen.getByTestId("directory-mutating").textContent, "false");
});

test("a stale mutation refresh cannot overwrite a newer authoritative directory result", async () => {
  const mutationRefresh = createDeferred<{ data: Venue[]; error: null }>();
  const latestRefresh = createDeferred<{ data: Venue[]; error: null }>();
  let fetchCalls = 0;
  const view = renderDirectory(
    createDirectoryDependencies({
      fetchVenues: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) return { data: [VENUE_A], error: null };
        return fetchCalls === 2
          ? mutationRefresh.promise
          : latestRefresh.promise;
      },
    }),
  );
  await flushAsyncWork();

  let mutationPromise!: ReturnType<DirectoryController["handleSave"]>;
  await act(async () => {
    mutationPromise = view.controller().handleSave("venue-a", {
      name: "Venue A updated",
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(fetchCalls, 2);

  let latestPromise!: ReturnType<DirectoryController["loadVenues"]>;
  await act(async () => {
    latestPromise = view.controller().loadVenues();
    await Promise.resolve();
  });
  assert.equal(fetchCalls, 3);

  await act(async () => {
    latestRefresh.resolve({ data: [VENUE_B], error: null });
    assert.deepEqual(await latestPromise, { status: "applied" });
  });
  assert.equal(screen.getByTestId("directory-venues").textContent, "venue-b");
  assert.equal(screen.getByTestId("directory-error").textContent, "");
  assert.equal(screen.getByTestId("directory-mutating").textContent, "true");

  let mutationResult: unknown;
  await act(async () => {
    mutationRefresh.resolve({ data: [VENUE_A], error: null });
    mutationResult = await mutationPromise;
  });
  assert.deepEqual(mutationResult, { status: "failed", error: null });
  assert.equal(screen.getByTestId("directory-venues").textContent, "venue-b");
  assert.equal(screen.getByTestId("directory-error").textContent, "");
  assert.equal(screen.getByTestId("directory-mutating").textContent, "false");
});

test("thrown update and refresh failures publish feedback and release the directory owner", async () => {
  let shouldThrowUpdate = true;
  let shouldThrowDirectoryRefresh = false;
  let shouldThrowRefresh = false;
  let directoryLoads = 0;
  const view = renderDirectory(
    createDirectoryDependencies({
      fetchVenues: async () => {
        directoryLoads += 1;
        if (shouldThrowDirectoryRefresh) {
          throw new Error("directory refresh rejected");
        }
        return { data: [VENUE_A], error: null };
      },
      updateVenue: async () => {
        if (shouldThrowUpdate) throw new Error("update rejected");
        return { data: VENUE_A, error: null };
      },
    }),
    async () => {
      if (shouldThrowRefresh) throw new Error("refresh rejected");
    },
  );
  await flushAsyncWork();

  let result: unknown;
  await act(async () => {
    result = await view.controller().handleToggleActive(VENUE_A);
  });
  assert.deepEqual(result, { status: "failed", error: null });
  assert.equal(
    screen.getByTestId("directory-error").textContent,
    messages.VenueAdmin.updateFailed,
  );
  assert.equal(screen.getByTestId("directory-mutating").textContent, "false");

  shouldThrowUpdate = false;
  shouldThrowDirectoryRefresh = true;
  await act(async () => {
    result = await view.controller().handleSave("venue-a", {
      brandName: "Brand A updated",
    });
  });
  assert.deepEqual(result, { status: "failed", error: null });
  assert.equal(directoryLoads, 2);
  assert.equal(
    screen.getByTestId("directory-error").textContent,
    messages.VenueAdmin.loadFailed,
  );
  assert.equal(screen.getByTestId("directory-mutating").textContent, "false");

  shouldThrowDirectoryRefresh = false;
  shouldThrowRefresh = true;
  await act(async () => {
    result = await view.controller().handleToggleActive(VENUE_A);
  });
  assert.deepEqual(result, { status: "failed", error: null });
  assert.equal(directoryLoads, 3);
  assert.equal(
    screen.getByTestId("directory-error").textContent,
    messages.VenueAdmin.loadFailed,
  );
  assert.equal(screen.getByTestId("directory-mutating").textContent, "false");
});

test("create refresh outcomes preserve success and report only authoritative failures", async () => {
  const rejectedView = renderCreate(
    {
      createVenue: async () => ({ data: VENUE_A, error: null }),
    },
    async () => {
      throw new Error("refresh rejected");
    },
  );
  act(() => {
    rejectedView.controller().setFormData((current) => ({
      ...current,
      name: "Venue A",
    }));
  });

  await act(async () => {
    await rejectedView.controller().handleCreate(createSubmitEvent());
  });
  assert.equal(screen.getByTestId("create-submitting").textContent, "false");
  assert.equal(
    screen.getByTestId("create-success").textContent,
    'Venue "Venue A" has been created.',
  );
  assert.equal(
    screen.getByTestId("create-error").textContent,
    messages.VenueAdmin.loadFailed,
  );

  rejectedView.unmount();
  const failedView = renderCreate(
    {
      createVenue: async () => ({ data: VENUE_A, error: null }),
    },
    async () => ({ status: "failed" }),
  );
  act(() => {
    failedView.controller().setFormData((current) => ({
      ...current,
      name: "Venue A",
    }));
  });
  await act(async () => {
    await failedView.controller().handleCreate(createSubmitEvent());
  });
  assert.equal(
    screen.getByTestId("create-success").textContent,
    'Venue "Venue A" has been created.',
  );
  assert.equal(
    screen.getByTestId("create-error").textContent,
    messages.VenueAdmin.loadFailed,
  );

  failedView.unmount();
  const staleView = renderCreate(
    {
      createVenue: async () => ({ data: VENUE_A, error: null }),
    },
    async () => ({ status: "stale" }),
  );
  act(() => {
    staleView.controller().setFormData((current) => ({
      ...current,
      name: "Venue A",
    }));
  });
  await act(async () => {
    await staleView.controller().handleCreate(createSubmitEvent());
  });
  assert.equal(
    screen.getByTestId("create-success").textContent,
    'Venue "Venue A" has been created.',
  );
  assert.equal(screen.getByTestId("create-error").textContent, "");
  assert.equal(screen.getByTestId("create-submitting").textContent, "false");
});

test("a keyed card uses the latest venue on edit entry without overwriting an active draft", async () => {
  const onSave = async () =>
    ({ status: "applied", error: null }) as const;
  const onToggleActive = async () =>
    ({ status: "applied", error: null }) as const;
  const view = await renderVenueCard({ onSave, onToggleActive });
  const VenueCard = view.VenueCard;

  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VenueCard
        venue={UPDATED_VENUE_A}
        actionsDisabled={false}
        onSave={onSave}
        onToggleActive={onToggleActive}
      />
    </NextIntlClientProvider>,
  );
  const editButton = screen.getByRole("button", {
    name: messages.VenueAdmin.edit,
  }) as HTMLButtonElement;
  act(() => {
    editButton.click();
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <VenueCard
          venue={UPDATED_VENUE_A}
          actionsDisabled
          onSave={onSave}
          onToggleActive={onToggleActive}
        />
      </NextIntlClientProvider>,
    );
  });
  const nameInput = screen.getByLabelText(
    messages.VenueAdmin.venueName,
  ) as HTMLInputElement;
  assert.equal(nameInput.value, UPDATED_VENUE_A.name);
  assert.equal(nameInput.matches(":disabled"), true);
  assert.equal(document.activeElement === nameInput, false);

  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VenueCard
        venue={UPDATED_VENUE_A}
        actionsDisabled={false}
        onSave={onSave}
        onToggleActive={onToggleActive}
      />
    </NextIntlClientProvider>,
  );
  assert.equal(document.activeElement === nameInput, true);

  fireEvent.change(nameInput, { target: { value: "User draft" } });
  const newestVenue = { ...UPDATED_VENUE_A, name: "Venue A newest" };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VenueCard
        venue={newestVenue}
        actionsDisabled={false}
        onSave={onSave}
        onToggleActive={onToggleActive}
      />
    </NextIntlClientProvider>,
  );
  assert.equal(
    (screen.getByLabelText(messages.VenueAdmin.venueName) as HTMLInputElement)
      .value,
    "User draft",
  );

  fireEvent.click(screen.getByRole("button", { name: messages.Common.cancel }));
  const nextEditButton = screen.getByRole("button", {
    name: messages.VenueAdmin.edit,
  });
  assert.equal(document.activeElement === nextEditButton, true);

  fireEvent.click(nextEditButton);
  assert.equal(
    (screen.getByLabelText(messages.VenueAdmin.venueName) as HTMLInputElement)
      .value,
    newestVenue.name,
  );
});

test("card edit validation is associated, focused, and does not call save", async () => {
  let saveCalls = 0;
  const view = await renderVenueCard({
    onSave: async () => {
      saveCalls += 1;
      return { status: "applied", error: null };
    },
  });
  fireEvent.click(screen.getByRole("button", { name: messages.VenueAdmin.edit }));
  const nameInput = screen.getByLabelText(
    messages.VenueAdmin.venueName,
  ) as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: messages.VenueAdmin.save }));

  assert.equal(saveCalls, 0);
  assert.equal(nameInput.getAttribute("aria-invalid"), "true");
  assert.equal(
    nameInput.getAttribute("aria-describedby"),
    `venue-name-error-${VENUE_A.id}`,
  );
  assert.match(
    document.getElementById(`venue-name-error-${VENUE_A.id}`)?.textContent ?? "",
    new RegExp(messages.VenueAdmin.nameRequired.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(document.activeElement === nameInput, true);
  view.unmount();
});

test("card save keeps busy work open, latches duplicates, and restores focus after success", async () => {
  const saveRequest = createDeferred<TestMutationResult>();
  let saveCalls = 0;
  const onSave = async () => {
    saveCalls += 1;
    if (saveCalls === 1) {
      return { status: "busy", error: null } as const;
    }
    return saveRequest.promise;
  };
  const onToggleActive = async () =>
    ({ status: "applied", error: null }) as const;
  const view = await renderVenueCard({ onSave, onToggleActive });
  const VenueCard = view.VenueCard;
  fireEvent.click(screen.getByRole("button", { name: messages.VenueAdmin.edit }));
  const saveButton = screen.getByRole("button", {
    name: messages.VenueAdmin.save,
  }) as HTMLButtonElement;

  await act(async () => {
    saveButton.click();
    await Promise.resolve();
  });
  assert.equal(saveCalls, 1);
  assert.equal(
    screen.queryByLabelText(messages.VenueAdmin.venueName) !== null,
    true,
  );

  act(() => {
    saveButton.click();
    saveButton.click();
  });
  assert.equal(saveCalls, 2);

  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VenueCard
        venue={VENUE_A}
        actionsDisabled
        onSave={onSave}
        onToggleActive={onToggleActive}
      />
    </NextIntlClientProvider>,
  );
  await act(async () => {
    saveRequest.resolve({ status: "applied", error: null });
    await saveRequest.promise;
  });
  let editButton = screen.getByRole("button", {
    name: messages.VenueAdmin.edit,
  }) as HTMLButtonElement;
  assert.equal(editButton.disabled, true);
  assert.equal(document.activeElement === editButton, false);

  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VenueCard
        venue={VENUE_A}
        actionsDisabled={false}
        onSave={onSave}
        onToggleActive={onToggleActive}
      />
    </NextIntlClientProvider>,
  );
  editButton = screen.getByRole("button", {
    name: messages.VenueAdmin.edit,
  }) as HTMLButtonElement;
  assert.equal(document.activeElement === editButton, true);
});

test("card toggle preserves busy confirmation and exposes deferred dialog state", async () => {
  const toggleRequest = createDeferred<TestMutationResult>();
  let toggleCalls = 0;
  const onToggleActive = async (): Promise<TestMutationResult> => {
    toggleCalls += 1;
    if (toggleCalls === 1) return { status: "busy", error: null };
    return toggleRequest.promise;
  };
  const onSave = async () => ({ status: "applied", error: null }) as const;
  const view = await renderVenueCard({ onSave, onToggleActive });
  const VenueCard = view.VenueCard;
  const deactivateButton = screen.getByRole("button", {
    name: messages.VenueAdmin.deactivate,
  }) as HTMLButtonElement;
  deactivateButton.focus();
  fireEvent.click(deactivateButton);
  let dialog = screen.getByRole("alertdialog");

  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VenueCard
        venue={VENUE_A}
        actionsDisabled
        onSave={onSave}
        onToggleActive={onToggleActive}
      />
    </NextIntlClientProvider>,
  );
  let confirmButton = within(dialog).getByRole("button", {
    name: messages.VenueAdmin.deactivate,
  }) as HTMLButtonElement;
  assert.equal(confirmButton.disabled, true);

  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VenueCard
        venue={VENUE_A}
        actionsDisabled={false}
        onSave={onSave}
        onToggleActive={onToggleActive}
      />
    </NextIntlClientProvider>,
  );
  dialog = screen.getByRole("alertdialog");
  confirmButton = within(dialog).getByRole("button", {
    name: messages.VenueAdmin.deactivate,
  }) as HTMLButtonElement;

  await act(async () => {
    confirmButton.click();
    await Promise.resolve();
  });
  assert.equal(toggleCalls, 1);
  dialog = screen.getByRole("alertdialog");
  assert.equal(dialog.getAttribute("aria-busy"), "false");
  confirmButton = within(dialog).getByRole("button", {
    name: messages.VenueAdmin.deactivate,
  }) as HTMLButtonElement;
  assert.equal(confirmButton.disabled, false);

  act(() => {
    confirmButton.click();
    confirmButton.click();
  });
  assert.equal(toggleCalls, 2);
  dialog = screen.getByRole("alertdialog");
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  confirmButton = within(dialog).getByRole("button", {
    name: messages.VenueAdmin.deactivate,
  }) as HTMLButtonElement;
  const cancelButton = within(dialog).getByRole("button", {
    name: messages.Common.cancel,
  }) as HTMLButtonElement;
  assert.equal(confirmButton.disabled, true);
  assert.equal(cancelButton.disabled, true);

  await act(async () => {
    toggleRequest.resolve({ status: "failed", error: null });
    await toggleRequest.promise;
  });
  assert.equal(screen.queryByRole("alertdialog"), null);
  assert.equal(document.activeElement === deactivateButton, true);
  assert.equal(deactivateButton.disabled, false);
});

test("disabled directory state removes card actions from keyboard activation", async () => {
  await renderVenueCard({ actionsDisabled: true });
  const openButton = screen.getByRole("button", { name: /Venue A/ }) as HTMLButtonElement;
  assert.equal(openButton.disabled, true);
  fireEvent.click(openButton);
  assert.equal(screen.queryByRole("dialog"), null);
});
