import { readFile } from "node:fs/promises";

const DOCUMENTED_PASSWORD_PATTERN =
  /^[\t ]*-[\t ]*공통 비밀번호:[\t ]*`([^`\r\n]+)`[\t ]*$/gmu;

export function extractDocumentedLocalTestPassword(markdown) {
  const matches = [...markdown.matchAll(DOCUMENTED_PASSWORD_PATTERN)];
  if (matches.length !== 1) {
    throw new Error("로컬 테스트 계정 문서에 공통 비밀번호 항목이 정확히 하나 있어야 합니다.");
  }

  const password = matches[0][1];
  if (!password || password.trim() !== password) {
    throw new Error("로컬 테스트 계정 문서의 공통 비밀번호 형식이 올바르지 않습니다.");
  }

  return password;
}

export async function resolveLocalTestPassword({
  documentPath,
  environmentPassword = process.env.LOCAL_TEST_PASSWORD,
  readDocument = readFile,
}) {
  if (!documentPath) {
    throw new Error("로컬 테스트 계정 문서 경로가 필요합니다.");
  }

  let markdown;
  try {
    markdown = await readDocument(documentPath, "utf8");
  } catch (error) {
    throw new Error(`로컬 테스트 계정 문서를 읽을 수 없습니다: ${documentPath}`, {
      cause: error,
    });
  }

  const documentedPassword = extractDocumentedLocalTestPassword(markdown);
  if (environmentPassword !== undefined && environmentPassword !== documentedPassword) {
    throw new Error(
      "LOCAL_TEST_PASSWORD가 로컬 테스트 계정 문서의 공통 비밀번호와 일치하지 않습니다.",
    );
  }

  return documentedPassword;
}
