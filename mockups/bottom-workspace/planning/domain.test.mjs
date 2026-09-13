import assert from "node:assert/strict";
import test from "node:test";
import { initialData } from "../data/fixtures.ts";
import { newBooking } from "./fixtures.ts";
import {
  artistError,
  bookingError,
  conflictsFor,
  connectGuestLink,
  holdExpired,
  saveBooking,
  guestImpact,
  respondToBooking,
  reviewMaterials,
  transitionBooking,
} from "./domain.ts";
import { bookingIssues } from "./pipeline.ts";

test("overnight intervals allow adjacency but reject reversed and partial times", () => {
  const data = initialData();
  const b = data.planning.bookings.find((b) => b.id === "booking-milo");
  assert.equal(bookingError(b), "");
  const adjacent = {
    ...b,
    id: "adjacent",
    start: b.end,
    end: "2026-09-19T02:00",
    arrival: "",
    soundcheck: "",
  };
  assert.deepEqual(conflictsFor(adjacent, [b]), []);
  assert.match(bookingError({ ...b, end: "2026-09-18T00:30" }), /終了|종료/);
  assert.match(bookingError({ ...b, end: "" }), /모두/);
  assert.match(bookingError({ ...b, arrival: "2026-09-19T02:00" }), /도착/);
});

test("conflicts match artists across events and stages within events, never other teams", () => {
  const data = initialData();
  const b = data.planning.bookings.find((b) => b.id === "booking-milo");
  assert.equal(
    conflictsFor(
      { ...b, id: "same-artist", eventId: "showcase", stage: "Hall" },
      [b],
    ).length,
    1,
  );
  assert.equal(
    conflictsFor(
      { ...b, id: "same-stage", artistId: "artist-wave", stage: " main " },
      [b],
    ).length,
    1,
  );
  assert.equal(
    conflictsFor({ ...b, id: "other-team", scopeId: "studio" }, [b]).length,
    0,
  );
  assert.equal(
    conflictsFor(
      { ...b, id: "other-stage", artistId: "artist-wave", stage: "Second" },
      [b],
    ).length,
    0,
  );
});

test("availability responses and expired holds do not confirm bookings", () => {
  const data = initialData();
  const b = data.planning.bookings.find((b) => b.id === "booking-wave");
  assert.ok(holdExpired(b));
  assert.throws(
    () =>
      transitionBooking(data, b.id, "faust", "admin", b.revision, "confirmed"),
    /가능 여부/,
  );
  b.availability = "available";
  assert.throws(
    () =>
      transitionBooking(data, b.id, "faust", "admin", b.revision, "confirmed"),
    /홀드 기한/,
  );
  assert.equal(b.status, "hold");
});

test("confirmation resolves against current state so competing confirmed bookings cannot both win", () => {
  const data = initialData();
  const first = newBooking("faust", "showcase", data.planning.artists[0]);
  Object.assign(first, {
    owner: "Owner",
    availability: "available",
    stage: "Hall",
    start: "2026-09-20T19:00",
    end: "2026-09-20T20:00",
  });
  const second = { ...structuredClone(first), id: "second" };
  saveBooking(data, first, "admin");
  saveBooking(data, second, "admin");
  transitionBooking(data, first.id, "faust", "admin", 1, "confirmed");
  assert.throws(
    () => transitionBooking(data, second.id, "faust", "admin", 1, "confirmed"),
    /겹칩니다/,
  );
  assert.equal(
    data.planning.bookings.find((b) => b.id === second.id).status,
    "inquiry",
  );
  assert.throws(
    () => transitionBooking(data, first.id, "faust", "admin", 2, "completed"),
    /종료 이후/,
  );
});

test("artist profiles and saved event materials are independent; schedule edits need a fresh acknowledgement", () => {
  const data = initialData();
  const b = data.planning.bookings.find((b) => b.id === "booking-sora");
  const originalMaterial = b.materials.pressUrl;
  data.planning.artists.find((a) => a.id === b.artistId).pressUrl =
    "https://example.com/new";
  assert.equal(b.materials.pressUrl, originalMaterial);
  const internal = { ...structuredClone(b), notes: "Internal update" };
  saveBooking(data, internal, "admin");
  const next = data.planning.bookings.find((item) => item.id === b.id);
  assert.equal(next.acknowledgedRevision, next.revision);
  const changed = { ...structuredClone(next), end: "2026-09-13T03:00" };
  saveBooking(data, changed, "admin");
  const latest = data.planning.bookings.find((item) => item.id === b.id);
  assert.equal(latest.acknowledgedRevision, null);
  assert.equal(latest.materials.pressUrl, originalMaterial);
  assert.throws(() => saveBooking(data, changed, "admin"), /변경되었습니다/);
});

test("confirmed booking links reuse their identity without granting an account or touching existing guests", () => {
  const data = initialData();
  const guestSnapshot = structuredClone(data.guests);
  const userCount = data.users.length;
  connectGuestLink(data, "booking-sora", "faust", "admin", 12);
  const b = data.planning.bookings.find((b) => b.id === "booking-sora");
  const first = b.guestLinkId;
  connectGuestLink(data, b.id, "faust", "admin", 15);
  assert.equal(b.guestLinkId, first);
  assert.equal(data.links.filter((l) => l.id === first).length, 1);
  assert.equal(data.links.find((l) => l.id === first).active, false);
  assert.equal(data.links.find((l) => l.id === first).limit, 12);
  assert.equal(data.users.length, userCount);
  transitionBooking(data, b.id, "faust", "admin", b.revision, "cancelled", { reason: "Schedule changed", linkAction: "keep" });
  assert.deepEqual(data.guests, guestSnapshot);
  assert.equal(data.links.find((l) => l.id === first).deleted, false);
  assert.throws(
    () => connectGuestLink(data, b.id, "faust", "admin", 15),
    /확정된/,
  );
});

test("new booking retries are idempotent and cross-team artist/event writes are refused", () => {
  const data = initialData();
  const b = newBooking("faust", "next", data.planning.artists[0]);
  saveBooking(data, b, "admin");
  saveBooking(data, b, "admin");
  assert.equal(
    data.planning.bookings.filter((item) => item.id === b.id).length,
    1,
  );
  assert.throws(
    () =>
      saveBooking(
        data,
        newBooking("faust", "next", data.planning.artists[0]),
        "door",
      ),
    /권한/,
  );
  assert.throws(
    () =>
      saveBooking(
        data,
        newBooking(
          "faust",
          "next",
          data.planning.artists.find((a) => a.scopeId === "studio"),
        ),
        "admin",
      ),
    /아티스트/,
  );
  assert.throws(
    () => connectGuestLink(data, "booking-sora", "faust", "studio-admin", 10),
    /권한/,
  );
  assert.throws(
    () =>
      saveBooking(
        data,
        { ...structuredClone(b), status: "confirmed", revision: 2 },
        "admin",
      ),
    /상세 화면/,
  );
});

test("material URLs and invalid contact details are rejected", () => {
  const artist = initialData().planning.artists[0];
  assert.match(
    artistError({ ...artist, pressUrl: "javascript:alert(1)" }),
    /http/,
  );
  assert.match(artistError({ ...artist, email: "not-an-email" }), /이메일/);
  assert.equal(artistError(artist), "");
});

test("buffers block adjacent stage slots and artist travel, including separate events at the same venue", () => {
  const b = initialData().planning.bookings.find((b) => b.id === "booking-milo");
  const next = { ...structuredClone(b), id: "next-slot", artistId: "artist-wave", start: b.end, end: "2026-09-19T02:00" };
  assert.equal(conflictsFor(next, [{ ...b, changeoverMinutes: 15 }]).length, 1);
  next.start = "2026-09-19T00:45";
  assert.equal(conflictsFor(next, [{ ...b, changeoverMinutes: 15 }]).length, 0);
  Object.assign(next, { eventId: "showcase", start: b.start });
  assert.equal(conflictsFor(next, [b]).length, 1);
  Object.assign(next, { artistId: b.artistId, stage: "Hall B", start: "2026-09-19T00:45" });
  assert.equal(conflictsFor(next, [{ ...b, travelMinutes: 30 }]).length, 1);
  next.start = "2026-09-19T01:00";
  assert.equal(conflictsFor(next, [{ ...b, travelMinutes: 30 }]).length, 0);
  assert.match(bookingError({ ...b, changeoverMinutes: -1 }), /0~240/);
});

test("a schedule edit expires availability and requires a new response before confirmation", () => {
  const data = initialData();
  const b = data.planning.bookings.find((b) => b.id === "booking-wave");
  Object.assign(b, { availability: "available", status: "negotiating", holdUntil: "" });
  saveBooking(data, { ...structuredClone(b), stage: "Second" }, "admin");
  const latest = data.planning.bookings.find((item) => item.id === b.id);
  assert.equal(latest.availability, "unknown");
  assert.throws(() => transitionBooking(data, b.id, "faust", "admin", latest.revision, "confirmed"), /가능 여부/);
  const oldRevision = latest.revision;
  respondToBooking(data, b.id, "faust", "admin", latest.revision, "available", false, latest.materials.riderUrl);
  assert.throws(() => respondToBooking(data, b.id, "faust", "admin", oldRevision, "unavailable", false, ""), /변경되었습니다/);
  transitionBooking(data, b.id, "faust", "admin", latest.revision, "confirmed");
  assert.equal(latest.status, "confirmed");
});

test("operations review and artist acknowledgement remain separate and invalidate only on relevant edits", () => {
  const data = initialData();
  let b = data.planning.bookings.find((b) => b.id === "booking-sora");
  reviewMaterials(data, b.id, "faust", "admin", b.revision);
  assert.equal(b.materialsReviewedRevision, b.revision);
  assert.equal(b.acknowledgedRevision, b.revision);
  saveBooking(data, { ...structuredClone(b), end: "2026-09-13T03:00" }, "admin");
  b = data.planning.bookings.find((b) => b.id === "booking-sora");
  assert.equal(b.status, "confirmed");
  assert.equal(b.availability, "unknown");
  assert.equal(b.acknowledgedRevision, null);
  assert.equal(b.materialsReviewedRevision, b.revision);
  respondToBooking(data, b.id, "faust", "admin", b.revision, "available", true, "https://example.com/revised-rider");
  assert.equal(b.materialsReviewedRevision, null);
  assert.equal(b.acknowledgedRevision, null);
  respondToBooking(data, b.id, "faust", "admin", b.revision, "available", true, b.materials.riderUrl);
  assert.equal(b.acknowledgedRevision, b.revision);
  assert.equal(b.materialsReviewedRevision, null);
  assert.throws(() => reviewMaterials(data, b.id, "faust", "door", b.revision), /권한/);
  assert.throws(() => reviewMaterials(data, b.id, "faust", "admin", b.revision - 1), /변경되었습니다/);
});

test("attention derives from deadlines, incomplete tasks, material review and link state", () => {
  const data = initialData();
  const b = data.planning.bookings.find((b) => b.id === "booking-sora");
  b.nextAction = "Call artist";
  b.due = "2026-09-13";
  const keys = () => bookingIssues(data, b).map((i) => i.key);
  assert.ok(keys().includes("followup"));
  assert.ok(keys().includes("tasks"));
  assert.ok(keys().includes("materials-review"));
  connectGuestLink(data, b.id, "faust", "admin", 10);
  assert.ok(keys().includes("link"));
  data.links.find((l) => l.id === b.guestLinkId).deleted = true;
  assert.ok(keys().includes("link-deleted"));
  b.status = "cancelled";
  assert.deepEqual(keys(), []);
});

test("cancellation requires a reason, can pause registrations, and retains guest and check-in history", () => {
  const data = initialData();
  const b = data.planning.bookings.find((b) => b.id === "booking-sora");
  connectGuestLink(data, b.id, "faust", "admin", 10);
  const link = data.links.find((l) => l.id === b.guestLinkId);
  link.active = true;
  const guest = { ...structuredClone(data.guests[0]), id: "booking-guest", externalLinkId: link.id, status: "checked" };
  data.guests.push(guest);
  const snapshot = structuredClone(data.guests);
  assert.equal(guestImpact(data, b).registered, 1);
  assert.equal(guestImpact(data, b).checked, 1);
  assert.throws(() => transitionBooking(data, b.id, "faust", "admin", b.revision, "cancelled"), /취소 사유/);
  transitionBooking(data, b.id, "faust", "admin", b.revision, "cancelled", { reason: "Artist unavailable", linkAction: "pause" });
  assert.equal(link.active, false);
  assert.equal(link.deleted, false);
  assert.equal(b.cancellation.reason, "Artist unavailable");
  assert.deepEqual(data.guests, snapshot);
});

test("cancelling one set cannot pause the same artist's shared link used by another confirmed set", () => {
  const data = initialData();
  const b = data.planning.bookings.find((b) => b.id === "booking-sora");
  connectGuestLink(data, b.id, "faust", "admin", 10);
  const link = data.links.find((l) => l.id === b.guestLinkId);
  link.active = true;
  data.planning.bookings.push({ ...structuredClone(b), id: "encore", guestLinkId: null });
  assert.equal(guestImpact(data, b).sharedBookings.length, 1);
  assert.throws(() => transitionBooking(data, b.id, "faust", "admin", b.revision, "cancelled", { reason: "First set cancelled", linkAction: "pause" }), /다른 확정/);
  assert.equal(b.status, "confirmed");
  assert.equal(link.active, true);
  transitionBooking(data, b.id, "faust", "admin", b.revision, "cancelled", { reason: "First set cancelled", linkAction: "keep" });
  assert.equal(link.active, true);
});
