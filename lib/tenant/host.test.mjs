import assert from "node:assert/strict";
import test from "node:test";
import { baseUrlForHostname } from "./host.ts";

test("local delivery URLs keep the dev server port and configured venue hostname", () => {
  for (const requestHost of ["faust.localhost:3000", "localhost:3000", "127.0.0.1:3000"]) {
    assert.equal(baseUrlForHostname("faust.localhost", requestHost), "http://faust.localhost:3000");
  }
  assert.equal(baseUrlForHostname("::1", "[::1]:3000"), "http://[::1]:3000");
  assert.equal(baseUrlForHostname("faust.localhost"), "http://faust.localhost");
});

test("delivery URLs never replace a venue hostname or inherit a nonlocal port", () => {
  assert.equal(baseUrlForHostname("guest.example.com", "localhost:3000"), "https://guest.example.com");
  assert.equal(baseUrlForHostname("faust.localhost", "evil.example:3000"), "http://faust.localhost");
  assert.equal(baseUrlForHostname("faust.localhost", "localhost:bad"), "http://faust.localhost");
  assert.equal(baseUrlForHostname("faust.localhost", "localhost@evil.example:3000"), "http://faust.localhost");
});
