"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";
import Icon from "@/components/Icon";

interface MigrationResult {
  email: string;
  status: "success" | "skipped" | "failed";
  reason?: string;
}

export default function LegacyUserMigration() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MigrationResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runMigration = async () => {
    if (!confirm("레거시 유저 마이그레이션을 시작하시겠습니까? 이 작업은 public/local-users.json 파일을 기반으로 새 유저를 생성하고 안내 메일을 발송합니다.")) {
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      // 1. local-users.json 데이터 가져오기
      const dataRes = await fetch("/local-users.json");
      if (!dataRes.ok) throw new Error("local-users.json 파일을 불러오지 못했습니다.");
      const legacyUsers = await dataRes.json();

      // 2. 마이그레이션 API 호출
      const migrateRes = await fetch("/api/admin/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: legacyUsers }),
      });

      const data = await migrateRes.json();
      if (!migrateRes.ok) throw new Error(data.error || "마이그레이션 API 오류");

      setResults(data.results);
    } catch (err: unknown) {
      console.error("Migration error:", err);
      setError(err instanceof Error ? err.message : "마이그레이션 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-panel p-6 sm:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center border border-border-strong">
          <Icon name="database" size={22} className="text-text-heading" />
        </div>
        <div>
          <h2 className="type-section-title">LEGACY USER MIGRATION</h2>
          <p className="text-text-muted text-xs font-medium">이전 시스템 유저를 D1 데이터베이스로 이관합니다.</p>
        </div>
      </div>

      <div className="bg-canvas border border-border-default p-4 mb-8">
        <h3 className="font-mono text-xs text-text-dim uppercase mb-3 tracking-widest">주의사항</h3>
        <ul className="text-text-muted font-mono text-xs space-y-2 list-inside list-disc tracking-tight">
          <li>`public/local-users.json` 파일의 데이터를 기반으로 처리됩니다.</li>
          <li>이미 존재하는 이메일은 마이그레이션 되지 않습니다.</li>
          <li>이관된 유저에게는 초기 비밀번호 설정을 위한 AWS SES 메일이 즉시 발송됩니다.</li>
          <li>실행 전 AWS SES 환경 변수가 올바르게 설정되어 있는지 확인하십시오.</li>
        </ul>
      </div>

      {error && <div className="mb-6"><Alert type="error" message={error} /></div>}

      <div className="flex justify-center">
        {!results && (
          <button
            onClick={runMigration}
            disabled={loading}
            className="flex items-center gap-2 bg-action-primary px-8 py-4 text-sm font-semibold text-action-text transition-colors hover:bg-action-hover disabled:opacity-50"
          >
            {loading ? <Spinner mode="button" /> : <><Icon name="play" size={17} /> START MIGRATION</>}
          </button>
        )}
      </div>

      {results && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between border-b border-border-subtle pb-2">
            <h3 className="type-panel-title font-mono uppercase tracking-wider">MIGRATION RESULTS</h3>
            <span className="font-mono text-xs text-text-dim">{results.length} USERS PROCESSED</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
            {results.map((res, idx) => (
              <div key={idx} className="bg-canvas border border-border-default p-3 flex items-center justify-between">
                <div>
                  <p className="text-text-heading font-mono text-xs truncate w-40">{res.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {res.status === "success" && <span className="text-text-heading text-xs font-mono font-semibold uppercase border border-border-strong px-2 py-0.5">SUCCESS</span>}
                  {res.status === "skipped" && <span className="text-text-muted text-xs font-mono font-semibold uppercase border border-border-strong px-2 py-0.5">SKIPPED</span>}
                  {res.status === "failed" && <span className="border border-status-danger/70 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-status-danger">FAILED</span>}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setResults(null)}
            className="w-full border border-border-default py-3 font-mono text-xs uppercase text-text-dim transition-colors hover:border-border-strong hover:text-text-heading"
          >
            RESET
          </button>
        </div>
      )}
    </div>
  );
}
