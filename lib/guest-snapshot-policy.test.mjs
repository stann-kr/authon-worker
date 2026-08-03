import assert from "node:assert/strict";
import test from "node:test";

import { resolveSnapshotVenueId } from "./guest-snapshot-policy.ts";

test("super admin은 명시적으로 요청한 베뉴로 조회 범위를 정한다", () => {
  assert.equal(
    resolveSnapshotVenueId(
      { role: "super_admin", venueId: null },
      "venue-a",
    ),
    "venue-a",
  );
});

test("일반 운영자는 자신의 베뉴만 조회할 수 있다", () => {
  assert.equal(
    resolveSnapshotVenueId(
      { role: "door_staff", venueId: "venue-a" },
      "venue-a",
    ),
    "venue-a",
  );

  assert.throws(
    () =>
      resolveSnapshotVenueId(
        { role: "door_staff", venueId: "venue-a" },
        "venue-b",
      ),
    /Forbidden/,
  );
});

test("스냅샷 조회는 빈 베뉴 범위를 허용하지 않는다", () => {
  assert.throws(
    () =>
      resolveSnapshotVenueId(
        { role: "super_admin", venueId: null },
        "",
      ),
    /Venue is required/,
  );
});
