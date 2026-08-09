import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedMutationOrigin } from "./request-origin.ts";

function makeRequest(headers = {}) {
  return new Request("https://venue.example.com/api/auth/claim-account", {
    method: "POST",
    headers,
  });
}

test("동일 origin mutation을 허용한다", () => {
  assert.equal(
    isTrustedMutationOrigin(
      makeRequest({ origin: "https://venue.example.com" }),
    ),
    true,
  );
  assert.equal(
    isTrustedMutationOrigin(makeRequest({ "sec-fetch-site": "same-origin" })),
    true,
  );
  assert.equal(
    isTrustedMutationOrigin(
      new Request("http://internal:3000/api/auth/claim-account", {
        method: "POST",
        headers: {
          host: "venue.example.com",
          origin: "https://venue.example.com",
          "x-forwarded-proto": "https",
        },
      }),
    ),
    true,
  );
});

test("sibling·cross-site·null origin mutation을 거부한다", () => {
  assert.equal(
    isTrustedMutationOrigin(makeRequest({ origin: "https://evil.example.com" })),
    false,
  );
  assert.equal(
    isTrustedMutationOrigin(makeRequest({ origin: "null" })),
    false,
  );
  assert.equal(
    isTrustedMutationOrigin(makeRequest({ "sec-fetch-site": "cross-site" })),
    false,
  );
  assert.equal(
    isTrustedMutationOrigin(makeRequest({ "sec-fetch-site": "same-site" })),
    false,
  );
});

test("브라우저 metadata가 없는 server client는 허용한다", () => {
  assert.equal(isTrustedMutationOrigin(makeRequest()), true);
});
