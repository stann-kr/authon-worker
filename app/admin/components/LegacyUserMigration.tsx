"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";
import Alert from "@/components/Alert";

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
    } catch (err: any) {
      console.error("Migration error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-700 p-6 sm:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 border border-cyan-500 flex items-center justify-center">
          <i className="ri-database-2-line text-cyan-500 text-xl"></i>
        </div>
        <div>
          <h2 className="font-mono text-lg tracking-wider text-white uppercase">LEGACY USER MIGRATION</h2>
          <p className="text-gray-400 font-mono text-xs tracking-wider uppercase">이전 시스템 유저를 D1 데이터베이스로 이관합니다.</p>
        </div>
      </div>

      <div className="bg-black/50 border border-gray-800 p-4 mb-8">
        <h3 className="font-mono text-xs text-gray-500 uppercase mb-3 tracking-widest">주의사항</h3>
        <ul className="text-gray-400 font-mono text-[11px] space-y-2 list-inside list-disc tracking-tight">
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
            className="px-8 py-4 bg-cyan-600 hover:bg-cyan-700 text-white font-mono text-sm tracking-wider uppercase transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : <><i className="ri-play-fill"></i> START MIGRATION</>}
          </button>
        )}
      </div>

      {results && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-800 pb-2">
            <h3 className="font-mono text-sm text-white uppercase tracking-wider">MIGRATION RESULTS</h3>
            <span className="font-mono text-[10px] text-gray-500">{results.length} USERS PROCESSED</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
            {results.map((res, idx) => (
              <div key={idx} className="bg-black/30 border border-gray-800 p-3 flex items-center justify-between">
                <div>
                  <p className="text-white font-mono text-[11px] truncate w-40">{res.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {res.status === "success" && <span className="text-green-500 text-[10px] font-mono font-bold uppercase border border-green-500 px-2 py-0.5">SUCCESS</span>}
                  {res.status === "skipped" && <span className="text-yellow-500 text-[10px] font-mono font-bold uppercase border border-yellow-500 px-2 py-0.5">SKIPPED</span>}
                  {res.status === "failed" && <span className="text-red-500 text-[10px] font-mono font-bold uppercase border border-red-500 px-2 py-0.5">FAILED</span>}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setResults(null)}
            className="w-full py-3 border border-gray-700 text-gray-500 font-mono text-xs uppercase hover:text-white hover:border-white transition-colors"
          >
            RESET
          </button>
        </div>
      )}
    </div>
  );
}
