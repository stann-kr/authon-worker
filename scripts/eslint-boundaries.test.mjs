import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiTypesPath = path.join(projectRoot, "lib/api/types.ts");
const facadeExists = existsSync(apiTypesPath);
const waitForFacadeRemoval = facadeExists
  ? "legacy facade must be removed before tombstone behavior can be tested"
  : false;
const eslint = new ESLint({ cwd: projectRoot });
const noApiTypesRule = "authon-boundaries/no-api-types-facade";
const noComponentsAppRule =
  "authon-boundaries/no-app-imports-from-components";

async function lint(code, relativeFilePath) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(projectRoot, relativeFilePath),
  });
  return result.messages;
}

function messagesForRule(messages, ruleId) {
  return messages.filter((message) => message.ruleId === ruleId);
}

test("the legacy lib/api/types facade is absent", () => {
  assert.equal(
    facadeExists,
    false,
    "remove lib/api/types.ts after all consumers use capability owners",
  );
});

test(
  "the real ESLint config rejects every legacy facade import form in repo TypeScript",
  { skip: waitForFacadeRemoval },
  async () => {
    const forbiddenCases = [
      {
        name: "alias extensionless static import",
        filePath: "lib/users/legacy-static-import.ts",
        code: 'import legacy from "@/lib/api/types"; export default legacy;',
      },
      {
        name: "alias explicit .ts type import",
        filePath: "lib/users/legacy-type-import.ts",
        code: 'import type { User } from "@/lib/api/types.ts"; export type Legacy = User;',
      },
      {
        name: "relative .js named re-export from app TSX",
        filePath: "app/admin/legacy-named-export.tsx",
        code: 'export { User } from "../../lib/api/types.js";',
      },
      {
        name: "relative extensionless export all",
        filePath: "lib/users/legacy-export-all.ts",
        code: 'export * from "../api/types";',
      },
      {
        name: "normalized dynamic import",
        filePath: "lib/users/legacy-dynamic-import.ts",
        code: 'export const legacy = import("@/lib/api/../api/types");',
      },
      {
        name: "relative require call",
        filePath: "lib/users/legacy-require.ts",
        code: 'export const legacy = require("../api/types");',
      },
      {
        name: "TypeScript import type expression",
        filePath: "lib/users/legacy-import-type-expression.ts",
        code: 'export type Legacy = import("@/lib/api/types").User;',
      },
      {
        name: "TypeScript import equals declaration",
        filePath: "lib/users/legacy-import-equals.ts",
        code: 'import legacy = require("@/lib/api/types.js"); export { legacy };',
      },
    ];

    for (const boundaryCase of forbiddenCases) {
      const messages = await lint(boundaryCase.code, boundaryCase.filePath);
      assert.equal(
        messagesForRule(messages, noApiTypesRule).length,
        1,
        `${boundaryCase.name}: ${JSON.stringify(messages)}`,
      );
    }
  },
);

test(
  "the tombstone matches only the deleted facade and preserves other boundaries",
  { skip: waitForFacadeRemoval },
  async () => {
    const allowedCases = [
      {
        name: "lookalike API module",
        filePath: "lib/users/types-lookalike.ts",
        code: 'export type Legacy = import("@/lib/api/types-extra").User;',
      },
      {
        name: "capability-owned type module",
        filePath: "lib/users/capability-owner.ts",
        code: 'import type { User } from "@/lib/users/types"; export type Current = User;',
      },
      {
        name: "live Server Action module",
        filePath: "lib/users/server-action.ts",
        code: 'export { fetchManagedUsersByVenue } from "@/lib/api/users";',
      },
    ];

    for (const boundaryCase of allowedCases) {
      const messages = await lint(boundaryCase.code, boundaryCase.filePath);
      assert.equal(
        messagesForRule(messages, noApiTypesRule).length,
        0,
        `${boundaryCase.name}: ${JSON.stringify(messages)}`,
      );
    }

    const componentMessages = await lint(
      'export { default } from "@/app/admin/components/UserManagement";',
      "components/app-import-boundary-probe.tsx",
    );
    assert.equal(
      messagesForRule(componentMessages, noComponentsAppRule).length,
      1,
      JSON.stringify(componentMessages),
    );
  },
);
