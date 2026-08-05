import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditGuestLimitRequestDraft,
  canSubmitGuestLimitRequest,
  getScopedGuestLimitRequestDraft,
  getGuestLimitRequestSectionState,
  mergeGuestWorkspaceDisplay,
  resetScopedGuestLimitRequestDraft,
  selectGuestWorkspaceDisplay,
} from "./request-section-state.ts";

const quota = {
  date: "2026-08-05",
  baseLimit: 5,
  approvedExtra: 0,
  effectiveLimit: 5,
  used: 1,
  remaining: 4,
  canRequestExtra: true,
  pendingRequest: null,
};

const liveDisplay = { guests: [], quota };

test("date transition keeps the eligible request section in a loading state", () => {
  assert.equal(
    getGuestLimitRequestSectionState({
      isEligible: true,
      hasCurrentScopeData: false,
      canRequestExtra: false,
      hasPendingRequest: false,
    }),
    "loading",
  );
});

test("an exact-scope cache is displayed while the new request is loading", () => {
  const cachedDisplay = { guests: [], quota: { ...quota, date: "2026-08-06" } };
  const selected = selectGuestWorkspaceDisplay({
    scopeKey: "venue:2026-08-06",
    loadedScopeKey: "venue:2026-08-05",
    liveDisplay,
    cache: new Map([["venue:2026-08-06", cachedDisplay]]),
    preferCachedDisplay: true,
  });

  assert.equal(selected, cachedDisplay);
});

test("a cache from another date is never displayed for the requested date", () => {
  const selected = selectGuestWorkspaceDisplay({
    scopeKey: "venue:2026-08-06",
    loadedScopeKey: "venue:2026-08-05",
    liveDisplay,
    cache: new Map([["venue:2026-08-05", liveDisplay]]),
    preferCachedDisplay: true,
  });

  assert.equal(selected, null);
});

test("a quota section failure preserves the exact-scope quota", () => {
  const merged = mergeGuestWorkspaceDisplay(liveDisplay, {
    guests: [],
    quota: null,
    failedSections: ["quota"],
  });

  assert.equal(merged.quota, quota);
});

test("a request draft is never reused for another date", () => {
  const selected = getScopedGuestLimitRequestDraft(
    {
      "venue:2026-08-05": {
        requestedExtra: "4",
        requestReason: "scope A",
      },
    },
    "venue:2026-08-06",
  );

  assert.deepEqual(selected, { requestedExtra: "1", requestReason: "" });
});

test("an off-screen request success clears only the submitted date draft", () => {
  const drafts = resetScopedGuestLimitRequestDraft(
    {
      "venue:2026-08-05": {
        requestedExtra: "4",
        requestReason: "scope A",
      },
      "venue:2026-08-06": {
        requestedExtra: "2",
        requestReason: "scope B",
      },
    },
    "venue:2026-08-05",
  );

  assert.deepEqual(drafts["venue:2026-08-05"], {
    requestedExtra: "1",
    requestReason: "",
  });
  assert.deepEqual(drafts["venue:2026-08-06"], {
    requestedExtra: "2",
    requestReason: "scope B",
  });
});

test("cached request eligibility cannot submit after quota verification fails", () => {
  assert.equal(
    canSubmitGuestLimitRequest({
      sectionState: "available",
      hasVerifiedQuota: false,
      isScopeFetching: false,
    }),
    false,
  );
});

test("a polling failure keeps an available scoped draft editable", () => {
  assert.equal(canEditGuestLimitRequestDraft("available"), true);
  assert.equal(
    canSubmitGuestLimitRequest({
      sectionState: "available",
      hasVerifiedQuota: false,
      isScopeFetching: false,
    }),
    false,
  );
});

test("pending state takes precedence over the available request form", () => {
  assert.equal(
    getGuestLimitRequestSectionState({
      isEligible: true,
      hasCurrentScopeData: true,
      canRequestExtra: true,
      hasPendingRequest: true,
    }),
    "pending",
  );
});
