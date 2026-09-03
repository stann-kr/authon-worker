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

import useDoorCodeLookup, {
  type DoorCodeLookupDependencies,
} from "@/app/door/useDoorCodeLookup";
import type { OfflineDoorScope } from "@/lib/door/offline-domain";

afterEach(() => {
  cleanup();
  Object.defineProperty(globalThis.navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

const SCOPE_A: OfflineDoorScope = {
  venueId: "venue-aaaa:part",
  eventId: "event-bbbb",
  businessDate: "2026-08-23",
};
const SCOPE_B: OfflineDoorScope = {
  venueId: "venue-aaaa",
  eventId: "part:event-bbbb",
  businessDate: "2026-08-23",
};
const GUEST_A = {
  id: "guest-0001",
  name: "Guest Alpha",
  status: "pending" as const,
  checkInTime: null,
};
const GUEST_B = {
  id: "guest-0002",
  name: "Guest Beta",
  status: "checked" as const,
  checkInTime: "2026-08-23T10:00:00.000Z",
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createDependencies(
  findDoorGuestByCode: DoorCodeLookupDependencies["findDoorGuestByCode"] =
    async () => ({ data: null, error: "DOOR_GUEST_CODE_NOT_FOUND" }),
): DoorCodeLookupDependencies {
  return { findDoorGuestByCode };
}

const DEFAULT_DEPENDENCIES = createDependencies();

function DoorCodeLookupHarness({
  scope = SCOPE_A,
  guests = [],
  isOfflineMode = false,
  dependencies = DEFAULT_DEPENDENCIES,
}: {
  scope?: OfflineDoorScope | null;
  guests?: Array<{ id: string; name: string }>;
  isOfflineMode?: boolean;
  dependencies?: DoorCodeLookupDependencies;
}) {
  const [foundName, setFoundName] = useState("");
  const lookup = useDoorCodeLookup({
    scope,
    guests,
    isOfflineMode,
    onGuestFound: setFoundName,
    dependencies,
  });

  return (
    <form onSubmit={lookup.submit}>
      <label htmlFor="test-door-code">Guest code</label>
      <input
        id="test-door-code"
        value={lookup.code}
        onChange={(event) => lookup.change(event.target.value)}
      />
      <button type="submit" aria-busy={lookup.busy}>
        Lookup
      </button>
      <output data-testid="feedback">{lookup.feedback ?? ""}</output>
      <output data-testid="found-name">{foundName}</output>
    </form>
  );
}

function enterAndSubmit(code: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Guest code" }), {
    target: { value: code },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Lookup" }).closest("form")!);
}

test("online lookup publishes the matched guest", async () => {
  const calls: unknown[] = [];
  render(
    <DoorCodeLookupHarness
      dependencies={createDependencies(async (params) => {
        calls.push(params);
        return { data: GUEST_A, error: null };
      })}
    />,
  );

  enterAndSubmit("AUTHON:guest-0001");

  await waitFor(() =>
    assert.equal(screen.getByTestId("feedback").textContent, "found"),
  );
  assert.deepEqual(calls, [
    { ...SCOPE_A, code: "AUTHON:guest-0001" },
  ]);
  assert.equal(screen.getByTestId("found-name").textContent, "Guest Alpha");
});

test("offline lookup finds a cached guest without calling the API", async () => {
  let calls = 0;
  render(
    <DoorCodeLookupHarness
      guests={[GUEST_A]}
      isOfflineMode
      dependencies={createDependencies(async () => {
        calls += 1;
        return { data: null, error: "DOOR_GUEST_CODE_LOOKUP_FAILED" };
      })}
    />,
  );

  enterAndSubmit("AUTHON:guest-0001");

  await waitFor(() =>
    assert.equal(screen.getByTestId("feedback").textContent, "found"),
  );
  assert.equal(calls, 0);
  assert.equal(screen.getByTestId("found-name").textContent, "Guest Alpha");
});

test("offline lookup reports a cache miss without calling the API", async () => {
  let calls = 0;
  render(
    <DoorCodeLookupHarness
      guests={[GUEST_A]}
      isOfflineMode
      dependencies={createDependencies(async () => {
        calls += 1;
        return { data: GUEST_B, error: null };
      })}
    />,
  );

  enterAndSubmit("AUTHON:guest-9999");

  await waitFor(() =>
    assert.equal(screen.getByTestId("feedback").textContent, "notFound"),
  );
  assert.equal(calls, 0);
  assert.equal(screen.getByTestId("found-name").textContent, "");
});

test("a delayed colliding-scope result cannot replace the newer result", async () => {
  const resultA = createDeferred<{ data: typeof GUEST_A; error: null }>();
  const resultB = createDeferred<{ data: typeof GUEST_B; error: null }>();
  const dependencies = createDependencies((params) =>
    params.venueId === SCOPE_A.venueId ? resultA.promise : resultB.promise,
  );
  const view = render(
    <DoorCodeLookupHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  enterAndSubmit("AUTHON:guest-0001");

  view.rerender(
    <DoorCodeLookupHarness scope={SCOPE_B} dependencies={dependencies} />,
  );
  enterAndSubmit("AUTHON:guest-0002");
  await act(async () => {
    resultB.resolve({ data: GUEST_B, error: null });
    await resultB.promise;
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("found-name").textContent, "Guest Beta"),
  );

  await act(async () => {
    resultA.resolve({ data: GUEST_A, error: null });
    await resultA.promise;
  });
  await waitFor(() => {
    assert.equal(screen.getByTestId("feedback").textContent, "found");
    assert.equal(screen.getByTestId("found-name").textContent, "Guest Beta");
  });
});

test("same-tick duplicate submits start only one lookup", async () => {
  const result = createDeferred<{ data: typeof GUEST_A; error: null }>();
  let calls = 0;
  render(
    <DoorCodeLookupHarness
      dependencies={createDependencies(async () => {
        calls += 1;
        return result.promise;
      })}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Guest code" }), {
    target: { value: "AUTHON:guest-0001" },
  });
  const form = screen.getByRole("button", { name: "Lookup" }).closest("form")!;

  fireEvent.submit(form);
  fireEvent.submit(form);

  assert.equal(calls, 1);
  await act(async () => {
    result.resolve({ data: GUEST_A, error: null });
    await result.promise;
  });
  await waitFor(() =>
    assert.equal(screen.getByTestId("feedback").textContent, "found"),
  );
});

test("a stale request finally cannot clear the newer scope's busy state", async () => {
  const resultA = createDeferred<{ data: typeof GUEST_A; error: null }>();
  const resultB = createDeferred<{ data: typeof GUEST_B; error: null }>();
  const dependencies = createDependencies((params) =>
    params.venueId === SCOPE_A.venueId ? resultA.promise : resultB.promise,
  );
  const view = render(
    <DoorCodeLookupHarness scope={SCOPE_A} dependencies={dependencies} />,
  );
  enterAndSubmit("AUTHON:guest-0001");

  view.rerender(
    <DoorCodeLookupHarness scope={SCOPE_B} dependencies={dependencies} />,
  );
  enterAndSubmit("AUTHON:guest-0002");
  assert.equal(
    screen.getByRole("button", { name: "Lookup" }).getAttribute("aria-busy"),
    "true",
  );

  await act(async () => {
    resultA.resolve({ data: GUEST_A, error: null });
    await resultA.promise;
  });
  assert.equal(
    screen.getByRole("button", { name: "Lookup" }).getAttribute("aria-busy"),
    "true",
  );

  await act(async () => {
    resultB.resolve({ data: GUEST_B, error: null });
    await resultB.promise;
  });
  await waitFor(() =>
    assert.equal(
      screen.getByRole("button", { name: "Lookup" }).getAttribute("aria-busy"),
      "false",
    ),
  );
});
