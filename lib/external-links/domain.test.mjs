import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_EXTERNAL_LINK_DJ_NAME_LENGTH,
  MAX_EXTERNAL_LINK_EVENT_LENGTH,
  getExternalLinkValidationDisposition,
  getExternalLinkDeletionDisposition,
  isExternalLinkShareCancellation,
  prepareExternalLinkCreateInput,
  shareExternalLink,
  toExternalLinkShareData,
  toExternalLinkTemplateDraft,
} from "./domain.ts";

test("external link validation separates invalid credentials from retryable failures", () => {
  assert.equal(getExternalLinkValidationDisposition(null), "valid");
  assert.equal(
    getExternalLinkValidationDisposition("INVALID_EXTERNAL_LINK"),
    "invalid",
  );
  assert.equal(
    getExternalLinkValidationDisposition("EXTERNAL_LINK_UNAVAILABLE"),
    "unavailable",
  );
  assert.equal(
    getExternalLinkValidationDisposition("UNEXPECTED_FAILURE"),
    "unavailable",
  );
});

test("unused external links are permanently deleted", () => {
  assert.equal(getExternalLinkDeletionDisposition(false), "hard-delete");
});

test("external links with guest history are archived", () => {
  assert.equal(getExternalLinkDeletionDisposition(true), "archive");
});

test("external link create input is normalized into a credential-free draft", () => {
  const result = prepareExternalLinkCreateInput({
    date: "2026-08-05",
    djName: "  ＤＪ\tＮＡＭＥ  ",
    event: "  FRIDAY\n  NIGHT  ",
    maxGuests: 25,
    localeMode: "ko",
    token: "must-not-pass-through",
    createdBy: "must-not-pass-through",
    expiresAt: "must-not-pass-through",
  });

  assert.deepEqual(result, {
    draft: {
      date: "2026-08-05",
      djName: "DJ NAME",
      contributorId: null,
      event: "FRIDAY NIGHT",
      maxGuests: 25,
      localeMode: "ko",
      kind: "contributor",
    },
    error: null,
  });
});

test("external link create input defaults a missing locale to auto", () => {
  const result = prepareExternalLinkCreateInput({
    date: "2026-08-05",
    djName: "DJ NAME",
    event: "FRIDAY NIGHT",
    maxGuests: 25,
  });

  assert.equal(result.error, null);
  assert.equal(result.draft?.localeMode, "auto");
  assert.equal(result.draft?.kind, "contributor");
  assert.equal(result.draft?.contributorId, null);
});

test("external link create input rejects invalid values with typed errors", () => {
  const valid = {
    date: "2026-08-05",
    djName: "DJ NAME",
    event: "FRIDAY NIGHT",
    maxGuests: 25,
    localeMode: "auto",
  };
  const cases = [
    [null, "INVALID_INPUT"],
    [{ ...valid, date: "2026-02-30" }, "INVALID_DATE"],
    [{ ...valid, djName: " \t " }, "INVALID_DJ_NAME"],
    [{ ...valid, djName: "DJ\u202eNAME" }, "INVALID_DJ_NAME"],
    [
      { ...valid, djName: "D".repeat(MAX_EXTERNAL_LINK_DJ_NAME_LENGTH + 1) },
      "DJ_NAME_TOO_LONG",
    ],
    [{ ...valid, djName: "D".repeat(10_000) }, "DJ_NAME_TOO_LONG"],
    [{ ...valid, event: "" }, "INVALID_EVENT"],
    [{ ...valid, event: "EVENT\u200bNAME" }, "INVALID_EVENT"],
    [
      { ...valid, event: "E".repeat(MAX_EXTERNAL_LINK_EVENT_LENGTH + 1) },
      "EVENT_TOO_LONG",
    ],
    [{ ...valid, event: "E".repeat(10_000) }, "EVENT_TOO_LONG"],
    [{ ...valid, maxGuests: 1.5 }, "INVALID_MAX_GUESTS"],
    [{ ...valid, maxGuests: 0 }, "INVALID_MAX_GUESTS"],
    [{ ...valid, maxGuests: 1000 }, "INVALID_MAX_GUESTS"],
    [{ ...valid, localeMode: "fr" }, "INVALID_LOCALE_MODE"],
    [{ ...valid, kind: "public_roster" }, "INVALID_LINK_KIND"],
    [{ ...valid, contributorId: "bad id" }, "INVALID_CONTRIBUTOR"],
    [
      { ...valid, kind: "self_rsvp", contributorId: "contributor-a" },
      "INVALID_CONTRIBUTOR",
    ],
  ];

  for (const [input, expectedError] of cases) {
    assert.deepEqual(prepareExternalLinkCreateInput(input), {
      draft: null,
      error: expectedError,
    });
  }
});

test("link template draft copies only editable business fields", () => {
  const source = {
    id: "source-id",
    venueId: "venue-id",
    token: "source-token",
    djName: "DJ NAME",
    contributorId: "contributor-a",
    event: "FRIDAY NIGHT",
    date: "2026-08-01",
    maxGuests: 20,
    usedGuests: 17,
    active: false,
    expiresAt: "2026-08-02T23:59:59.999Z",
    createdBy: "source-actor",
    createdAt: "2026-07-01T00:00:00.000Z",
    guestUrl: "https://example.com/guest?token=source-token",
    localeMode: "en",
    kind: "self_rsvp",
  };

  const draft = toExternalLinkTemplateDraft(source, "2026-08-08");

  assert.deepEqual(draft, {
    date: "2026-08-08",
    djName: "DJ NAME",
    contributorId: null,
    event: "FRIDAY NIGHT",
    maxGuests: 20,
    localeMode: "en",
    kind: "self_rsvp",
  });
  assert.equal(Object.hasOwn(draft, "id"), false);
  assert.equal(Object.hasOwn(draft, "token"), false);
  assert.equal(Object.hasOwn(draft, "usedGuests"), false);
  assert.equal(Object.hasOwn(draft, "createdBy"), false);
  assert.equal(Object.hasOwn(draft, "expiresAt"), false);
  assert.equal(Object.hasOwn(draft, "guestUrl"), false);
});

test("self RSVP kind survives a new credential template", () => {
  const result = prepareExternalLinkCreateInput({
    date: "2026-08-08",
    djName: "PUBLIC RSVP",
    event: "FRIDAY NIGHT",
    maxGuests: 50,
    localeMode: "auto",
    kind: "self_rsvp",
  });
  assert.equal(result.error, null);
  assert.equal(result.draft?.kind, "self_rsvp");
  assert.equal(result.draft?.contributorId, null);
});

test("share data exposes only the URL", () => {
  assert.deepEqual(
    toExternalLinkShareData("https://guest.example/guest?token=test-token"),
    {
      url: "https://guest.example/guest?token=test-token",
    },
  );
});

test("native share receives only the URL and does not copy", async () => {
  const calls = [];
  const result = await shareExternalLink(
    toExternalLinkShareData("https://example.com/guest"),
    {
      canShare: () => true,
      share: async (data) => calls.push(["share", data]),
      copy: async () => calls.push("copy"),
    },
  );

  assert.equal(result, "shared");
  assert.deepEqual(calls, [["share", { url: "https://example.com/guest" }]]);
});

test("unsupported or failed native share falls back to copying the URL", async () => {
  const data = toExternalLinkShareData("https://example.com/guest?token=test");
  const unsupportedCopies = [];
  const unsupportedResult = await shareExternalLink(data, {
    copy: async (url) => unsupportedCopies.push(url),
  });
  assert.equal(unsupportedResult, "copied");
  assert.deepEqual(unsupportedCopies, [data.url]);

  const failedShareCalls = [];
  const failedShareResult = await shareExternalLink(data, {
    canShare: () => true,
    share: async () => {
      failedShareCalls.push("share");
      throw { name: "NotAllowedError" };
    },
    copy: async (url) => failedShareCalls.push(`copy:${url}`),
  });
  assert.equal(failedShareResult, "copied");
  assert.deepEqual(failedShareCalls, ["share", `copy:${data.url}`]);
});

test("native share cancellation is silent and never copies", async () => {
  const calls = [];
  const result = await shareExternalLink(
    toExternalLinkShareData("https://example.com/guest"),
    {
      share: async () => {
        calls.push("share");
        throw { name: "AbortError" };
      },
      copy: async () => calls.push("copy"),
    },
  );

  assert.equal(result, "cancelled");
  assert.deepEqual(calls, ["share"]);
  assert.equal(isExternalLinkShareCancellation({ name: "AbortError" }), true);
  assert.equal(isExternalLinkShareCancellation({ name: "NotAllowedError" }), false);
});

test("share returns failed when clipboard fallback also fails", async () => {
  const result = await shareExternalLink(
    toExternalLinkShareData("https://example.com/guest"),
    {
      canShare: () => false,
      share: async () => undefined,
      copy: async () => {
        throw new Error("clipboard unavailable");
      },
    },
  );

  assert.equal(result, "failed");
});
