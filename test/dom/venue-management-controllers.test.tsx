import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { FormEvent } from "react";
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, render, screen } from "@testing-library/react";

import messages from "@/messages/en.json";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import useVenueDirectoryController, {
  type VenueDirectoryControllerDependencies,
  type VenueMutationMessageResolver,
} from "@/app/admin/components/useVenueDirectoryController";
import useVenueCreateController, {
  type VenueCreateControllerDependencies,
} from "@/app/admin/components/useVenueCreateController";
import type { Venue } from "@/lib/venues/types";

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
      <output data-testid="directory-venues">
        {controller.venues.map((venue) => venue.id).join(",")}
      </output>
      <output data-testid="directory-error">{controller.listError}</output>
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
  onCreated: () => Promise<void>;
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
    </>
  );
}

function renderCreate(
  dependencies: VenueCreateControllerDependencies,
  onCreated: () => Promise<void> = async () => {},
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

  let secondLoad!: Promise<void>;
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

  await act(async () => {
    await view.controller().handleCreate(createSubmitEvent());
  });
  assert.equal(submittedInputs.length, 0);
  assert.equal(
    screen.getByTestId("create-error").textContent,
    messages.VenueAdmin.nameRequired,
  );

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

test("save returns raw errors and refreshes both venue sources only on success", async () => {
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

  let error: string | null = null;
  await act(async () => {
    error = await view.controller().handleSave("venue-a", {
      openingTime: "22:00",
      closingTime: "22:00",
    });
  });
  assert.equal(error, "INVALID_OPERATING_HOURS");
  assert.equal(directoryLoads, 1);
  assert.equal(activeRefreshes, 0);
  assert.equal(
    screen.getByTestId("directory-error").textContent,
    messages.VenueAdmin.invalidOperatingHours,
  );

  updateResult = { data: VENUE_A, error: null };
  await act(async () => {
    error = await view.controller().handleSave("venue-a", {
      brandName: "Brand A",
    });
  });
  assert.equal(error, null);
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
