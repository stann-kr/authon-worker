"use client";

import type { CSSProperties } from "react";

/**
 * root layout까지 실패한 경우의 마지막 화면입니다.
 * provider·전역 CSS·번역을 사용할 수 없으므로 최소한의 정적 이중 언어 문구와 inline 스타일만 둡니다.
 */
const styles = {
  body: {
    margin: 0,
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    boxSizing: "border-box",
    background: "#0a0a0b",
    color: "#e5e5e7",
    fontFamily: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Segoe UI", Roboto, sans-serif',
    textAlign: "center",
  },
  panel: {
    width: "100%",
    maxWidth: "28rem",
    padding: "32px",
    boxSizing: "border-box",
    borderRadius: "12px",
    background: "#161618",
  },
  title: { margin: 0, fontSize: "22px", fontWeight: 600, letterSpacing: "-0.02em", color: "#f5f5f7" },
  description: { margin: "12px 0 0", fontSize: "14px", lineHeight: 1.6, color: "#8e8e93" },
  actions: { display: "grid", gap: "12px", marginTop: "28px" },
  primary: {
    minHeight: "44px",
    border: "1px solid rgb(255 181 71)",
    borderRadius: "10px",
    background: "rgb(255 181 71)",
    color: "#241906",
    font: "inherit",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "44px",
    border: "1px solid transparent",
    borderRadius: "10px",
    background: "#1c1c1e",
    color: "#f5f5f7",
    fontSize: "14px",
    fontWeight: 500,
    textDecoration: "none",
  },
} satisfies Record<string, CSSProperties>;

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body style={styles.body}>
        <main style={styles.panel} role="alert">
          <h1 style={styles.title}>문제가 발생했습니다</h1>
          <p style={styles.description} lang="en">Something went wrong.</p>
          <p style={styles.description}>
            잠시 후 다시 시도해주세요. <span lang="en">Please try again in a moment.</span>
          </p>
          <div style={styles.actions}>
            <button type="button" style={styles.primary} onClick={reset}>
              다시 시도 · <span lang="en">Retry</span>
            </button>
            {/* The root layout failed, so leave the client router behind with a full document load. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={styles.secondary}>
              홈으로 이동 · <span lang="en">Go home</span>
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
