import assert from "node:assert/strict";
import test from "node:test";
import {
  extractDocumentedLocalTestPassword,
  resolveLocalTestPassword,
} from "./local-test-password.mjs";

const documentedPassword = "Documented!123";
const differentPassword = "Different!456";

function localAccountDocument(password = documentedPassword, newline = "\n") {
  return [
    "# 로컬 테스트 계정",
    "",
    `- 공통 비밀번호: \`${password}\``,
    "",
    "| 역할 | 이메일 | 비밀번호 |",
    "|---|---|---|",
    "| Venue Admin | `venue@example.test` | `same as above` |",
    "",
    "```bash",
    "npm run db:seed:local",
    "```",
    "",
  ].join(newline);
}

test("문서의 단일 공통 비밀번호 항목만 해석한다", () => {
  assert.equal(
    extractDocumentedLocalTestPassword(localAccountDocument()),
    documentedPassword,
  );
  assert.equal(
    extractDocumentedLocalTestPassword(localAccountDocument(documentedPassword, "\r\n")),
    documentedPassword,
  );
});

test("공통 비밀번호 항목이 없거나 중복되면 실패한다", () => {
  assert.throws(
    () => extractDocumentedLocalTestPassword("# 로컬 테스트 계정\n"),
    /정확히 하나/,
  );
  assert.throws(
    () => extractDocumentedLocalTestPassword(
      `${localAccountDocument()}- 공통 비밀번호: \`${differentPassword}\`\n`,
    ),
    /정확히 하나/,
  );
  assert.throws(
    () => extractDocumentedLocalTestPassword("- 공통 비밀번호: ``\n"),
    /정확히 하나/,
  );
});

test("환경 변수가 없거나 문서와 정확히 같으면 문서 값을 사용한다", async () => {
  const readDocument = async () => localAccountDocument();

  assert.equal(
    await resolveLocalTestPassword({
      documentPath: "/private/local-accounts.md",
      environmentPassword: undefined,
      readDocument,
    }),
    documentedPassword,
  );
  assert.equal(
    await resolveLocalTestPassword({
      documentPath: "/private/local-accounts.md",
      environmentPassword: documentedPassword,
      readDocument,
    }),
    documentedPassword,
  );
});

test("환경 변수가 문서와 다르면 값을 노출하지 않고 실패한다", async () => {
  const readDocument = async () => localAccountDocument();

  for (const environmentPassword of [differentPassword, "", ` ${documentedPassword}`]) {
    await assert.rejects(
      resolveLocalTestPassword({
        documentPath: "/private/local-accounts.md",
        environmentPassword,
        readDocument,
      }),
      (error) => {
        assert.match(error.message, /일치하지 않습니다/);
        assert.equal(error.message.includes(documentedPassword), false);
        assert.equal(error.message.includes(differentPassword), false);
        return true;
      },
    );
  }
});

test("문서를 읽지 못하면 환경 변수가 있어도 실패한다", async () => {
  await assert.rejects(
    resolveLocalTestPassword({
      documentPath: "/private/missing-local-accounts.md",
      environmentPassword: documentedPassword,
      readDocument: async () => {
        throw new Error("missing");
      },
    }),
    /문서를 읽을 수 없습니다/,
  );
});
