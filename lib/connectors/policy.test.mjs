import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateConnectorPolicy,
  parseConnectorPolicyConfig,
  requireConnectorPermission,
} from "./policy.ts";

test("connector access requires both official API access and written permission", () => {
  assert.equal(evaluateConnectorPolicy({
    provider: "resident_advisor",
    enabled: true,
    officialApiAccess: false,
    writtenPermission: true,
  }).readiness, "official_access_required");
  assert.equal(evaluateConnectorPolicy({
    provider: "resident_advisor",
    enabled: true,
    officialApiAccess: true,
    writtenPermission: false,
  }).readiness, "written_permission_required");
  assert.deepEqual(evaluateConnectorPolicy({
    provider: "resident_advisor",
    enabled: true,
    officialApiAccess: true,
    writtenPermission: true,
  }), {
    provider: "resident_advisor",
    readiness: "ready",
    canConnect: true,
  });
});

test("disabled or unofficial connectors fail closed", () => {
  const disabled = evaluateConnectorPolicy({
    provider: "example",
    enabled: false,
    officialApiAccess: true,
    writtenPermission: true,
  });
  assert.equal(disabled.canConnect, false);
  assert.throws(() => requireConnectorPermission(disabled), /CONNECTOR_BLOCKED/);
});

test("connector policy config rejects duplicates and incomplete attestations", () => {
  assert.deepEqual(parseConnectorPolicyConfig(undefined), []);
  assert.throws(() => parseConnectorPolicyConfig("not-json"));
  assert.throws(() => parseConnectorPolicyConfig(JSON.stringify([
    { provider: "ra", enabled: true, officialApiAccess: true },
  ])));
  assert.throws(() => parseConnectorPolicyConfig(JSON.stringify([
    { provider: "ra", enabled: true, officialApiAccess: true, writtenPermission: true },
    { provider: "ra", enabled: false, officialApiAccess: true, writtenPermission: true },
  ])));
});
