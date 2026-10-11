import assert from "node:assert/strict";
import test from "node:test";

import {
  formatVenueDateTime,
  getBusinessDate,
  isValidTimeValue,
  isValidTimeZone,
  restoreOperatingDate,
} from "./date.ts";

const seoulClub = {
  timezone: "Asia/Seoul",
  openingTime: "22:00",
  closingTime: "05:00",
};

test("an overnight venue keeps the opening calendar date before closing", () => {
  assert.equal(getBusinessDate(seoulClub, new Date("2026-08-11T13:00:00.000Z")), "2026-08-11");
  assert.equal(getBusinessDate(seoulClub, new Date("2026-08-11T18:00:00.000Z")), "2026-08-11");
  assert.equal(getBusinessDate(seoulClub, new Date("2026-08-11T20:00:00.000Z")), "2026-08-12");
});

test("the same instant resolves independently in each venue timezone", () => {
  const instant = new Date("2026-08-12T03:00:00.000Z");
  assert.equal(getBusinessDate(seoulClub, instant), "2026-08-12");
  assert.equal(
    getBusinessDate({ ...seoulClub, timezone: "America/New_York" }, instant),
    "2026-08-11",
  );
});

test("same-day opening hours do not move pre-opening time to yesterday", () => {
  assert.equal(
    getBusinessDate(
      { timezone: "Asia/Seoul", openingTime: "10:00", closingTime: "18:00" },
      new Date("2026-08-11T00:00:00.000Z"),
    ),
    "2026-08-11",
  );
});

test("a chosen operating date lasts only for the business day it was chosen in", () => {
  // 23:00 KST belongs to the 2026-08-11 business day of a venue closing at 05:00.
  const saved = { venueId: "venue-1", date: "2026-08-05", selectedAt: Date.parse("2026-08-11T14:00:00.000Z") };
  assert.equal(restoreOperatingDate(saved, "venue-1", seoulClub, new Date("2026-08-11T19:30:00.000Z")), "2026-08-05");
  assert.equal(restoreOperatingDate(saved, "venue-1", seoulClub, new Date("2026-08-11T20:30:00.000Z")), null);
  assert.equal(restoreOperatingDate(saved, "venue-2", seoulClub, new Date("2026-08-11T15:00:00.000Z")), null);
  for (const unrestorable of ["2026-08-05", { venueId: "venue-1", date: "2026-08-05" }, { ...saved, date: "2026-02-30" }, null]) {
    assert.equal(restoreOperatingDate(unrestorable, "venue-1", seoulClub, new Date("2026-08-11T15:00:00.000Z")), null);
  }
});

test("a fresh operating date choice survives venue settings that load after it", () => {
  // 05:30 KST is the previous business day under the default 06:00 closing but not under a 05:00 closing.
  const selectedAt = Date.parse("2026-08-11T20:30:00.000Z");
  const now = new Date(selectedAt + 60_000);
  assert.notEqual(getBusinessDate({}, now), getBusinessDate(seoulClub, now));
  for (const settings of [{}, seoulClub]) {
    assert.equal(restoreOperatingDate({ venueId: "venue-1", date: "2026-08-05", selectedAt }, "venue-1", settings, now), "2026-08-05");
  }
});

test("time and IANA timezone validation rejects malformed settings", () => {
  assert.equal(isValidTimeValue("05:30"), true);
  assert.equal(isValidTimeValue("25:00"), false);
  assert.equal(isValidTimeZone("Asia/Seoul"), true);
  assert.equal(isValidTimeZone("Seoul"), false);
});

test("date-time display uses the venue timezone instead of the host timezone", () => {
  const instant = "2026-08-12T03:30:00.000Z";
  const seoul = formatVenueDateTime(instant, {
    locale: "en-US",
    timeZone: "Asia/Seoul",
  });
  const newYork = formatVenueDateTime(instant, {
    locale: "en-US",
    timeZone: "America/New_York",
  });

  assert.match(seoul, /Aug 12, 2026/);
  assert.match(newYork, /Aug 11, 2026/);
  assert.equal(formatVenueDateTime("not-a-date"), null);
});
