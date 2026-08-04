import assert from "node:assert/strict";
import test from "node:test";

import { getExternalLinkDeletionDisposition } from "./domain.ts";

test("unused external links are permanently deleted", () => {
  assert.equal(getExternalLinkDeletionDisposition(false), "hard-delete");
});

test("external links with guest history are archived", () => {
  assert.equal(getExternalLinkDeletionDisposition(true), "archive");
});
