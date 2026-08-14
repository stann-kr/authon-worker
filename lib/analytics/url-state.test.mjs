import assert from "node:assert/strict";
import test from "node:test";

import {
  getAdminAnalyticsSearch,
  parseAdminAnalyticsUrlState,
} from "./url-state.ts";

test("analytics URL state round-trips month, quarter, and year deep links", () => {
  const fixtures = [
    ["month", "2026-08-14", "2026-08"],
    ["quarter", "2026-08-14", "2026-Q3"],
    ["year", "2026-08-14", "2026"],
  ];
  for (const [granularity, anchorDate, period] of fixtures) {
    const search = getAdminAnalyticsSearch({ granularity, anchorDate });
    assert.equal(new URLSearchParams(search).get("period"), period);
    assert.deepEqual(
      parseAdminAnalyticsUrlState(
        new URLSearchParams(search),
        "2027-01-01",
      ),
      {
        granularity,
        anchorDate:
          granularity === "month"
            ? "2026-08-01"
            : granularity === "quarter"
              ? "2026-07-01"
              : "2026-01-01",
      },
    );
  }
});

test("invalid analytics URL values fall back without accepting an invalid date", () => {
  assert.deepEqual(
    parseAdminAnalyticsUrlState(
      new URLSearchParams("grain=week&period=2026-99"),
      "2026-08-14",
    ),
    { granularity: "month", anchorDate: "2026-08-14" },
  );
  assert.throws(() =>
    parseAdminAnalyticsUrlState(new URLSearchParams(), "2026-02-30"),
  );
});
