#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const baseUrl = "https://authon-worker-dev.ilsny7.workers.dev";
const bootstrapKeychainService = "authon-worker-dev-bootstrap";
const loginKeychainService = "authon-worker-dev-login";
const superAdminEmail = "super-admin@dev.authon.invalid";
const resetTargetEmail = "reset-target@dev.authon.invalid";
const serverReferenceManifestPath =
  ".open-next/server-functions/default/.next/server/server-reference-manifest.json";

const rscClient = await import(
  "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js"
);
const encodeReply = rscClient.encodeReply ?? rscClient.default?.encodeReply;

if (typeof encodeReply !== "function") {
  throw new Error("Next Server Action encoder를 불러올 수 없습니다.");
}

class CookieJar {
  #cookies = new Map();

  capture(response) {
    const values = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);

    for (const value of values) {
      const [pair, ...attributes] = value.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const cookieValue = pair.slice(separator + 1).trim();
      const shouldDelete = attributes.some((attribute) =>
        attribute.trim().toLowerCase() === "max-age=0"
      );
      if (shouldDelete) this.#cookies.delete(name);
      else this.#cookies.set(name, cookieValue);
    }
  }

  header() {
    return [...this.#cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  get(name) {
    return this.#cookies.get(name) ?? null;
  }
}

function getKeychainCredential(service, account) {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", service, "-a", account],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    throw new Error(`Keychain credential을 찾을 수 없습니다: ${service}/${account}`);
  }
}

function storeKeychainCredential(service, account, credential) {
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-U",
      "-s",
      service,
      "-a",
      account,
      "-w",
      credential,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

function createPassword() {
  return `Dev${crypto.randomBytes(24).toString("base64url")}9`;
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}`);
  }
}

async function requestJson(path, {
  method = "GET",
  body,
  jar,
} = {}) {
  const headers = new Headers({
    Accept: "application/json",
    Origin: baseUrl,
  });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const cookie = jar?.header();
  if (cookie) headers.set("Cookie", cookie);

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  jar?.capture(response);
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function getServerActionId(exportedName) {
  const manifest = JSON.parse(
    await readFile(serverReferenceManifestPath, "utf8"),
  );
  const match = Object.entries(manifest.node ?? {}).find(([, value]) =>
    value?.exportedName === exportedName
  );
  if (!match) throw new Error(`Server Action manifest entry가 없습니다: ${exportedName}`);
  return match[0];
}

async function invokeServerAction(actionId, args, jar) {
  const body = await encodeReply(args);
  const headers = new Headers({
    Accept: "text/x-component",
    Origin: baseUrl,
    "Next-Action": actionId,
  });
  const cookie = jar.header();
  if (cookie) headers.set("Cookie", cookie);

  const response = await fetch(`${baseUrl}/admin`, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
  });
  jar.capture(response);
  await response.arrayBuffer();
  return response;
}

const bootstrapCode = getKeychainCredential(
  bootstrapKeychainService,
  superAdminEmail,
);
const adminPassword = createPassword();
const targetPassword = createPassword();
const adminJar = new CookieJar();
const targetJar = new CookieJar();

const pageResponse = await fetch(`${baseUrl}/auth/reset-password`, {
  headers: { Origin: baseUrl },
});
assertStatus(pageResponse, 200, "reset page");
console.log("PASS: dev Worker reset page");

const initialLogin = await requestJson("/api/auth/login", {
  method: "POST",
  body: { email: superAdminEmail, password: bootstrapCode },
});
assertStatus(initialLogin.response, 409, "bootstrap login");
if (initialLogin.payload?.code !== "PASSWORD_SETUP_REQUIRED") {
  throw new Error("bootstrap login이 최초 설정 상태를 반환하지 않았습니다.");
}
console.log("PASS: super admin bootstrap challenge");

const adminClaim = await requestJson("/api/auth/claim-account", {
  method: "POST",
  body: {
    email: superAdminEmail,
    setupCode: bootstrapCode,
    newPassword: adminPassword,
  },
});
assertStatus(adminClaim.response, 200, "super admin claim");
if (adminClaim.payload?.ok !== true) {
  throw new Error("super admin 최초 비밀번호 설정이 완료되지 않았습니다.");
}
console.log("PASS: super admin initial password setup");

await new Promise((resolve) => setTimeout(resolve, 1_200));

const adminLogin = await requestJson("/api/auth/login", {
  method: "POST",
  body: { email: superAdminEmail, password: adminPassword },
  jar: adminJar,
});
assertStatus(adminLogin.response, 200, "super admin login");
if (adminLogin.payload?.user?.role !== "super_admin") {
  throw new Error("super admin session이 생성되지 않았습니다.");
}
storeKeychainCredential(loginKeychainService, superAdminEmail, adminPassword);
console.log("PASS: super admin authenticated session");

const resetRequest = await requestJson("/api/auth/password-reset-requests", {
  method: "POST",
  body: { email: resetTargetEmail },
  jar: targetJar,
});
assertStatus(resetRequest.response, 202, "password reset request");
const challenge = resetRequest.payload?.challenge;
const receipt = targetJar.get("authon-password-reset-receipt");
if (
  typeof challenge !== "string" ||
  !/^REQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(challenge) ||
  typeof receipt !== "string"
) {
  throw new Error("request challenge 또는 browser receipt가 발급되지 않았습니다.");
}
const requestId = receipt.split(".", 1)[0];
console.log("PASS: browser-bound reset request");

const actionId = await getServerActionId("startManagedPasswordReset");
const approveResponse = await invokeServerAction(
  actionId,
  [{
    requestId,
    setupMethod: "admin_approved",
    verificationMethod: "in_person",
    verificationChallenge: challenge,
    verificationAttested: true,
  }],
  adminJar,
);
if (approveResponse.status >= 500) {
  throw new Error(`password reset approval Server Action failed: HTTP ${approveResponse.status}`);
}

const approvedStatus = await requestJson(
  "/api/auth/password-reset-requests/status",
  { jar: targetJar },
);
assertStatus(approvedStatus.response, 200, "approved status");
if (approvedStatus.payload?.state !== "approved") {
  throw new Error("관리자 승인 상태가 browser receipt에 반영되지 않았습니다.");
}
console.log("PASS: challenge-bound administrator approval");

const targetClaim = await requestJson("/api/auth/claim-account", {
  method: "POST",
  body: { recoveryReceipt: true, newPassword: targetPassword },
  jar: targetJar,
});
assertStatus(targetClaim.response, 200, "browser receipt claim");
if (targetClaim.payload?.ok !== true) {
  throw new Error("browser receipt 비밀번호 설정이 완료되지 않았습니다.");
}
console.log("PASS: one-time browser receipt claim");

const targetLogin = await requestJson("/api/auth/login", {
  method: "POST",
  body: { email: resetTargetEmail, password: targetPassword },
});
assertStatus(targetLogin.response, 200, "reset target login");
if (targetLogin.payload?.user?.role !== "staff") {
  throw new Error("재설정된 대상 계정으로 로그인할 수 없습니다.");
}
storeKeychainCredential(loginKeychainService, resetTargetEmail, targetPassword);
console.log("PASS: reset target login with new password");

const reusedClaim = await requestJson("/api/auth/claim-account", {
  method: "POST",
  body: { recoveryReceipt: true, newPassword: createPassword() },
  jar: targetJar,
});
assertStatus(reusedClaim.response, 400, "reused browser receipt");
if (reusedClaim.payload?.code !== "ACCOUNT_NOT_ELIGIBLE") {
  throw new Error("소비된 browser receipt가 예상한 거부 상태를 반환하지 않았습니다.");
}
console.log("PASS: consumed browser receipt rejected");
