import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
}: HarnessProps) {
  const [error, setError] = useState<string | null>(null);
  const currentScopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    currentScopeKeyRef.current = scopeKey;
  }, [scopeKey]);
  const controller = useGuestLimitRequestController({
    user,
    requestScopeKey: scopeKey,
    selectedDate: scopeKey === SCOPE_B ? "2026-08-24" : "2026-08-23",
    selectedEventId: null,
    quota,
    hasCurrentScopeData,
    hasVerifiedCurrentQuota,
    isCurrentScopeFetching,
    currentScopeKeyRef,
    invalidatePolling: onInvalidatePolling,
    loadGuests: onLoadGuests,
    setError,
    translate,
    commonTranslate: translate,
    dependencies,
  });

  return (
    <>
      <output data-testid="error">{error ?? ""}</output>
      <GuestLimitRequestPanel
        requestScopeKey={scopeKey}
        pendingRequest={quota?.pendingRequest ?? null}
        translate={translate}
        controller={controller}
      />
    </>
  );
}

function GuestLimitRequestTestHarness(props: HarnessProps) {
  return (
    <NextIntlClientProvider locale="en" messages={{ Common: { loading: "Loading" } }}>
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
  const loadingDetails = screen.getByText("Request extra guests").closest("details");
  assert.ok(loadingDetails);
  assert.equal(loadingDetails.getAttribute("aria-busy"), "true");
  assert.equal(loadingDetails.getAttribute("aria-disabled"), "true");
  assert.equal(screen.getByText("Loading").textContent, "Loading");

  rerender(<GuestLimitRequestTestHarness dependencies={dependencies} />);
  const availableDetails = screen.getByText("Request extra guests").closest("details");
  assert.ok(availableDetails);
  assert.equal(availableDetails.getAttribute("aria-busy"), null);
  assert.equal(availableDetails.getAttribute("aria-disabled"), null);
  assert.equal(screen.getByLabelText("Extra guest count").id, "extra-guest-count");
  assert.equal(screen.getByLabelText("Extra guest count").getAttribute("name"), "extra-guest-count");
  assert.equal(screen.getByLabelText("Reason (optional)").id, "extra-guest-reason");
  assert.equal(screen.getByLabelText("Reason (optional)").getAttribute("name"), "extra-guest-reason");

  rerender(
    <GuestLimitRequestTestHarness
      dependencies={dependencies}
      quota={createQuota({ pendingRequest: createPendingRequest(3) })}
    />,
  );
  const pendingDetails = screen.getByText("Request extra guests").closest("details");
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

  rerender(<GuestLimitRequestTestHarness scopeKey={SCOPE_B} dependencies={dependencies} />);
  fireEvent.change(screen.getByLabelText("Extra guest count"), {
    target: { value: "2" },
  });
  const activeScopeInput = screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement;
  fireEvent.change(activeScopeInput, { target: { value: "Scope B" } });
  activeScopeInput.focus();

  pending.resolve({ error: null });

  await waitFor(() => {
    assert.equal((screen.getByLabelText("Extra guest count") as HTMLInputElement).value, "2");
    assert.equal((screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value, "Scope B");
    assert.equal(screen.getByTestId("error").textContent, "");
    assert.equal(loadCount, 0);
    assert.equal(document.activeElement, activeScopeInput);
  });

  rerender(<GuestLimitRequestTestHarness scopeKey={SCOPE_A} dependencies={dependencies} />);
  assert.equal((screen.getByLabelText("Extra guest count") as HTMLInputElement).value, "1");
  assert.equal((screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement).value, "");
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
    assert.equal(screen.getByTestId("error").textContent, "A request is already pending");
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
  const reason = screen.getByLabelText("Reason (optional)") as HTMLTextAreaElement;
  reason.focus();

  pending.resolve({ error: null });

  await waitFor(() => {
    assert.equal(loadCount, 1);
    assert.equal((screen.getByLabelText("Extra guest count") as HTMLInputElement).value, "1");
    assert.equal(document.activeElement, reason);
  });
});
