import assert from "node:assert/strict";
import test from "node:test";

import {
  getBusinessDate,
  isValidTimeValue,
  isValidTimeZone,
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

test("time and IANA timezone validation rejects malformed settings", () => {
  assert.equal(isValidTimeValue("05:30"), true);
  assert.equal(isValidTimeValue("25:00"), false);
  assert.equal(isValidTimeZone("Asia/Seoul"), true);
  assert.equal(isValidTimeZone("Seoul"), false);
});
