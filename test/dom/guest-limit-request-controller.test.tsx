import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import GuestLimitRequestPanel from "@/app/guest/components/GuestLimitRequestPanel";
import useGuestLimitRequestController, {
  type GuestLimitRequestControllerDependencies,
} from "@/app/guest/components/useGuestLimitRequestController";
import type { User } from "@/lib/auth";
import type { GuestLimitRequest, GuestQuota } from "@/lib/guest-limits/types";

const SCOPE_A = "venue-0001:2026-08-23:general";
const SCOPE_B = "venue-0001:2026-08-24:general";

const USER: User = {
  id: "user-0001",
  venue_id: "venue-0001",
  email: "dj@example.com",
  name: "DJ One",
  role: "dj",
  account_kind: "personal",
  door_access_enabled: false,
  guest_limit: 5,
  preferred_locale: "en",
};

const TRANSLATIONS: Record<string, string> = {
  loading: "Loading",
  requestExtra: "Request extra guests",
  requestUnavailable: "Requests unavailable",
  requestNotNeeded: "No request needed",
  requestCount: "Extra guest count",
  requestReasonOptional: "Reason (optional)",
  submitRequest: "Submit request",
  requestAlreadyPending: "A request is already pending",
  requestFailed: "Request failed",
};

function translate(key: string, values?: Record<string, string | number>) {
  if (key === "requestPending") return `Pending: ${values?.count}`;
  return TRANSLATIONS[key] ?? key;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createPendingRequest(count = 3): GuestLimitRequest {
  return {
    id: "request-0001",
    venueId: "venue-0001",
    userId: USER.id,
    date: "2026-08-23",
    eventId: null,
    requestedExtra: count,
    approvedExtra: 0,
    reason: null,
    status: "pending",
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:00.000Z",
  };
}

function createQuota(overrides: Partial<GuestQuota> = {}): GuestQuota {
  return {
    date: "2026-08-23",
    baseLimit: 5,
    approvedExtra: 0,
    effectiveLimit: 5,
    used: 5,
    remaining: 0,
    canRequestExtra: true,
    pendingRequest: null,
    ...overrides,
  };
}

interface HarnessProps {
  scopeKey?: string;
  user?: User | null;
  quota?: GuestQuota | null;
  hasCurrentScopeData?: boolean;
  hasVerifiedCurrentQuota?: boolean;
  isCurrentScopeFetching?: boolean;
  dependencies: GuestLimitRequestControllerDependencies;
  onLoadGuests?: () => Promise<boolean | undefined>;
  onInvalidatePolling?: () => void;
  onController?: (
    controller: ReturnType<typeof useGuestLimitRequestController>,
  ) => void;
  translate?: typeof translate;
}

function GuestLimitRequestHarness({
  scopeKey = SCOPE_A,
  user = USER,
  quota = createQuota(),
  hasCurrentScopeData = true,
  hasVerifiedCurrentQuota = true,
  isCurrentScopeFetching = false,
  dependencies,
  onLoadGuests = async () => true,
  onInvalidatePolling = () => {},
  onController,
  translate: harnessTranslate = translate,
}: HarnessProps) {
  const [error, setError] = useState<string | null>(null);
  const controller = useGuestLimitRequestController({
    user,
    requestScopeKey: scopeKey,
    selectedDate: scopeKey === SCOPE_B ? "2026-08-24" : "2026-08-23",
    selectedEventId: null,
    quota,
    hasCurrentScopeData,
    hasVerifiedCurrentQuota,
    isCurrentScopeFetching,
    invalidatePolling: onInvalidatePolling,
    loadGuests: onLoadGuests,
    setError,
    translate: harnessTranslate,
    commonTranslate: harnessTranslate,
    dependencies,
  });
  onController?.(controller);

  return (
    <>
      <output data-testid="error">{error ?? ""}</output>
      <button type="button" data-testid="external-focus">
        External focus
      </button>
      <GuestLimitRequestPanel
        requestScopeKey={scopeKey}
        pendingRequest={quota?.pendingRequest ?? null}
        translate={harnessTranslate}
        controller={controller}
      />
    </>
  );
}

function GuestLimitRequestTestHarness(props: HarnessProps) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{ Common: { loading: "Loading" } }}
    >
      <GuestLimitRequestHarness {...props} />
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

test("request panel preserves hidden, loading, available, and pending markup contracts", () => {
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => ({ error: null }),
  };
  const { rerender } = render(
    <GuestLimitRequestTestHarness user={null} dependencies={dependencies} />,
  );

  assert.equal(screen.queryByText("Request extra guests"), null);

  rerender(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      hasCurrentScopeData={false}
      quota={null}
    />,
  );
  const loadingDetails = screen
    .getByText("Request extra guests")
    .closest("details");
  assert.ok(loadingDetails);
  assert.equal(loadingDetails.getAttribute("aria-busy"), "true");
  assert.equal(loadingDetails.getAttribute("aria-disabled"), "true");
  assert.equal(screen.getByText("Loading").textContent, "Loading");

  rerender(<GuestLimitRequestTestHarness dependencies={dependencies} />);
  const availableDetails = screen
    .getByText("Request extra guests")
    .closest("details");
  assert.ok(availableDetails);
  assert.equal(availableDetails.getAttribute("aria-busy"), null);
  assert.equal(availableDetails.getAttribute("aria-disabled"), null);
  assert.equal(
    screen.getByLabelText("Extra guest count").id,
    "extra-guest-count",
  );
  assert.equal(
    screen.getByLabelText("Extra guest count").getAttribute("name"),
    "extra-guest-count",
  );
  assert.equal(
    screen.getByLabelText("Reason (optional)").id,
    "extra-guest-reason",
  );
  assert.equal(
    screen.getByLabelText("Reason (optional)").getAttribute("name"),
    "extra-guest-reason",
  );

  rerender(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      quota={createQuota({ pendingRequest: createPendingRequest(3) })}
    />,
  );
  const pendingDetails = screen
    .getByText("Request extra guests")
    .closest("details");
  assert.ok(pendingDetails);
  assert.equal(pendingDetails.getAttribute("aria-disabled"), "true");
  const pendingStatus = screen.getByText("Pending: 3");
  assert.equal(pendingStatus.getAttribute("role"), "status");
  assert.equal(pendingStatus.getAttribute("aria-live"), "polite");
  assert.equal(pendingStatus.getAttribute("aria-atomic"), "true");
  assert.equal(pendingStatus.getAttribute("tabindex"), "-1");
});

test("off-screen completion resets only its submitted draft without refreshing, erroring, or focusing the active scope", async () => {
  const pending = createDeferred<{ error: string | null }>();
  let loadCount = 0;
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => pending.promise,
  };
  const { rerender } = render(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      onLoadGuests={async () => {
        loadCount += 1;
        return true;
      }}
    />,
  );

  fireEvent.change(screen.getByLabelText("Extra guest count"), {
    target: { value: "4" },
  });
  fireEvent.change(screen.getByLabelText("Reason (optional)"), {
    target: { value: "Scope A" },
  });
  const submitButton = screen.getByRole("button", { name: "Submit request" });
  submitButton.focus();
  fireEvent.click(submitButton);

  rerender(
    <GuestLimitRequestTestHarness
      scopeKey={SCOPE_B}
      dependencies={dependencies}
    />,
  );
  fireEvent.change(screen.getByLabelText("Extra guest count"), {
    target: { value: "2" },
  });
  const activeScopeInput = screen.getByLabelText(
    "Reason (optional)",
  ) as HTMLTextAreaElement;
  fireEvent.change(activeScopeInput, { target: { value: "Scope B" } });
  activeScopeInput.focus();

  pending.resolve({ error: null });

  await waitFor(() => {
    assert.equal(
      (screen.getByLabelText("Extra guest count") as HTMLInputElement).value,
      "2",
    );
    assert.equal(
      (screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value,
      "Scope B",
    );
    assert.equal(screen.getByTestId("error").textContent, "");
    assert.equal(loadCount, 0);
    assert.equal(document.activeElement, activeScopeInput);
  });

  rerender(
    <GuestLimitRequestTestHarness
      scopeKey={SCOPE_A}
      dependencies={dependencies}
    />,
  );
  assert.equal(
    (screen.getByLabelText("Extra guest count") as HTMLInputElement).value,
    "1",
  );
  assert.equal(
    (screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value,
    "",
  );
});

test("active request maps pending failures and does not steal focus after completion", async () => {
  const pending = createDeferred<{ error: string | null }>();
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => pending.promise,
  };
  render(<GuestLimitRequestTestHarness dependencies={dependencies} />);

  const submitButton = screen.getByRole("button", { name: "Submit request" });
  submitButton.focus();
  fireEvent.click(submitButton);
  const reason = screen.getByLabelText("Reason (optional)");
  reason.focus();

  pending.resolve({ error: "PENDING_REQUEST_EXISTS" });

  await waitFor(() => {
    assert.equal(
      screen.getByTestId("error").textContent,
      "A request is already pending",
    );
    assert.equal(document.activeElement, reason);
  });
});

test("active success resets its draft, refreshes its scope, and preserves a new focus target", async () => {
  const pending = createDeferred<{ error: string | null }>();
  let loadCount = 0;
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => pending.promise,
  };
  render(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      onLoadGuests={async () => {
        loadCount += 1;
        return true;
      }}
    />,
  );

  fireEvent.change(screen.getByLabelText("Extra guest count"), {
    target: { value: "4" },
  });
  const submitButton = screen.getByRole("button", { name: "Submit request" });
  submitButton.focus();
  fireEvent.click(submitButton);
  const reason = screen.getByLabelText(
    "Reason (optional)",
  ) as HTMLTextAreaElement;
  reason.focus();

  pending.resolve({ error: null });

  await waitFor(() => {
    assert.equal(loadCount, 1);
    assert.equal(
      (screen.getByLabelText("Extra guest count") as HTMLInputElement).value,
      "1",
    );
    assert.equal(document.activeElement, reason);
  });
});

test("same-act duplicate submissions call createRequest once", async () => {
  const pending = createDeferred<{ error: string | null }>();
  let createCount = 0;
  let controller: ReturnType<typeof useGuestLimitRequestController> | null =
    null;
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => {
      createCount += 1;
      return pending.promise;
    },
  };
  render(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      onController={(next) => {
        controller = next;
      }}
    />,
  );

  await act(async () => {
    void controller?.handleExtraRequest();
    void controller?.handleExtraRequest();
  });

  assert.equal(createCount, 1);
  pending.resolve({ error: null });
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "Submit request" })
        .hasAttribute("disabled"),
      false,
    ),
  );
});

test("success preserves a newer same-scope draft revision", async () => {
  const pending = createDeferred<{ error: string | null }>();
  let loadCount = 0;
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => pending.promise,
  };
  render(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      onLoadGuests={async () => {
        loadCount += 1;
        return true;
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  fireEvent.change(screen.getByLabelText("Extra guest count"), {
    target: { value: "6" },
  });
  fireEvent.change(screen.getByLabelText("Reason (optional)"), {
    target: { value: "Edited while submitting" },
  });
  pending.resolve({ error: null });

  await waitFor(() => {
    assert.equal(loadCount, 1);
    assert.equal(
      (screen.getByLabelText("Extra guest count") as HTMLInputElement).value,
      "6",
    );
    assert.equal(
      (screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value,
      "Edited while submitting",
    );
  });
});

test("current PENDING_REQUEST_EXISTS refreshes once and reveals authoritative pending status", async () => {
  const refresh = createDeferred<boolean | undefined>();
  let loadCount = 0;
  const loadGuests = () => {
    loadCount += 1;
    return refresh.promise;
  };
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => ({ error: "PENDING_REQUEST_EXISTS" }),
  };
  let controller: ReturnType<typeof useGuestLimitRequestController> | null =
    null;
  const { rerender } = render(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      onLoadGuests={loadGuests}
      onController={(next) => {
        controller = next;
      }}
    />,
  );

  fireEvent.click(screen.getByText("Request extra guests"));
  const submitButton = screen.getByRole("button", { name: "Submit request" });
  submitButton.focus();
  let operation!: Promise<void>;
  act(() => {
    operation = controller!.handleExtraRequest();
  });

  await waitFor(() => assert.equal(loadCount, 1));
  rerender(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      quota={createQuota({ pendingRequest: createPendingRequest(4) })}
      onLoadGuests={loadGuests}
    />,
  );
  await act(async () => {
    refresh.resolve(true);
    await operation;
  });
  assert.equal(
    screen.getByTestId("error").textContent,
    "A request is already pending",
  );
  const pendingStatus = screen.getByText("Pending: 4");
  assert.equal(document.activeElement === pendingStatus, true);
});

test("a failed pending refresh preserves the authoritative pending feedback", async () => {
  const refresh = createDeferred<boolean | undefined>();
  let loadCount = 0;
  let controller: ReturnType<typeof useGuestLimitRequestController> | null =
    null;
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => ({ error: "PENDING_REQUEST_EXISTS" }),
  };
  render(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      onLoadGuests={() => {
        loadCount += 1;
        return refresh.promise;
      }}
      onController={(next) => {
        controller = next;
      }}
    />,
  );

  let operation!: Promise<void>;
  act(() => {
    operation = controller!.handleExtraRequest();
  });
  await waitFor(() => assert.equal(loadCount, 1));
  await act(async () => {
    refresh.reject(new Error("GUEST_SNAPSHOT_UNAVAILABLE"));
    await operation;
  });

  assert.equal(
    screen.getByTestId("error").textContent,
    "A request is already pending",
  );
});

test("an old A epoch cannot publish into a later A epoch or start a duplicate request", async () => {
  const pending = createDeferred<{ error: string | null }>();
  let createCount = 0;
  let loadCount = 0;
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => {
      createCount += 1;
      return pending.promise;
    },
  };
  const { rerender } = render(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      onLoadGuests={async () => {
        loadCount += 1;
        return true;
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  rerender(
    <GuestLimitRequestTestHarness
      scopeKey={SCOPE_B}
      dependencies={dependencies}
    />,
  );
  rerender(
    <GuestLimitRequestTestHarness
      scopeKey={SCOPE_A}
      dependencies={dependencies}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  assert.equal(createCount, 1);

  (screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).blur();
  pending.resolve({ error: "REQUEST_FAILED" });

  await act(async () => {
    await pending.promise;
    await Promise.resolve();
  });
  await waitFor(() => {
    assert.equal(screen.getByTestId("error").textContent, "");
    assert.equal(loadCount, 0);
    assert.equal(document.activeElement, document.body);
  });
});

test("pending completion uses the latest translator after a locale change", async () => {
  const pending = createDeferred<{ error: string | null }>();
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => pending.promise,
  };
  const { rerender } = render(
    <GuestLimitRequestTestHarness dependencies={dependencies} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  const translated = (key: string, values?: Record<string, string | number>) =>
    key === "requestFailed" ? "요청에 실패했습니다" : translate(key, values);
  rerender(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      translate={translated}
    />,
  );
  pending.resolve({ error: "REQUEST_FAILED" });

  await waitFor(() => {
    assert.equal(
      screen.getByTestId("error").textContent,
      "요청에 실패했습니다",
    );
  });
});

test("external focus is not stolen after an authoritative pending refresh", async () => {
  const refresh = createDeferred<boolean | undefined>();
  let loadCount = 0;
  const loadGuests = () => {
    loadCount += 1;
    return refresh.promise;
  };
  const dependencies: GuestLimitRequestControllerDependencies = {
    createRequest: async () => ({ error: "PENDING_REQUEST_EXISTS" }),
  };
  let controller: ReturnType<typeof useGuestLimitRequestController> | null =
    null;
  const { rerender } = render(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      onLoadGuests={loadGuests}
      onController={(next) => {
        controller = next;
      }}
    />,
  );

  let operation!: Promise<void>;
  act(() => {
    operation = controller!.handleExtraRequest();
  });
  await waitFor(() => assert.equal(loadCount, 1));
  const externalFocus = screen.getByTestId("external-focus");
  externalFocus.focus();
  rerender(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      quota={createQuota({ pendingRequest: createPendingRequest(2) })}
      onLoadGuests={loadGuests}
    />,
  );
  await act(async () => {
    refresh.resolve(true);
    await operation;
  });

  assert.equal(document.activeElement === externalFocus, true);
});
