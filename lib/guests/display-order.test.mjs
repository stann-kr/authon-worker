import assert from "node:assert/strict";
import test from "node:test";
import { orderGuestDisplayList } from "./display-order.ts";

const guests = [
  {
    id: "checked-early",
    name: "BETA",
    status: "checked",
    createdAt: "2026-08-05T09:00:00.000Z",
  },
  {
    id: "pending-late",
    name: "ALPHA",
    status: "pending",
    createdAt: "2026-08-05T09:10:00.000Z",
  },
];

test("waiting priority moves pending guests before checked guests", () => {
  const ordered = orderGuestDisplayList(guests, {
    sortMode: "default",
    locale: "ko-KR",
    prioritizeWaiting: true,
  });

  assert.deepEqual(ordered.map((guest) => guest.id), [
    "pending-late",
    "checked-early",
  ]);
});

test("turning waiting priority off preserves registration order after check-in", () => {
  const checkedVersion = guests.map((guest) => ({
    ...guest,
    status: "checked",
  }));
  const ordered = orderGuestDisplayList(checkedVersion, {
    sortMode: "default",
    locale: "ko-KR",
    prioritizeWaiting: false,
  });

  assert.deepEqual(ordered.map((guest) => guest.id), [
    "checked-early",
    "pending-late",
  ]);
});

test("alphabetical order works independently from waiting priority", () => {
  const ordered = orderGuestDisplayList(guests, {
    sortMode: "alpha",
    locale: "en-US",
    prioritizeWaiting: false,
  });

  assert.deepEqual(ordered.map((guest) => guest.name), ["ALPHA", "BETA"]);
});

test("sorting does not mutate the source list", () => {
  const source = [...guests];
  orderGuestDisplayList(source, {
    sortMode: "default",
    locale: "en-US",
    prioritizeWaiting: true,
  });

  assert.deepEqual(source, guests);
});
