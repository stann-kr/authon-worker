"use client";

import { useState } from "react";
import Alert from "@/components/Alert";
import Icon from "@/components/Icon";
import ConfirmDialog from "@/components/ConfirmDialog";
import Button from "@/components/Button";
import { useTranslations } from "next-intl";

interface MigrationResult {
  email: string;
  status: "success" | "skipped" | "failed";
  reason?: string;
}

export default function LegacyUserMigration() {
  const t = useTranslations("MigrationAdmin");
  const commonT = useTranslations("Common");
  const [loading, setLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [results, setResults] = useState<MigrationResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runMigration = async () => {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      // 1. local-users.json 데이터 가져오기
      const dataRes = await fetch("/local-users.json");
      if (!dataRes.ok) throw new Error(t("fileLoadFailed"));
      const legacyUsers = await dataRes.json();

      // 2. 마이그레이션 API 호출
      const migrateRes = await fetch("/api/admin/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: legacyUsers }),
      });

      const data = await migrateRes.json();
      if (!migrateRes.ok) throw new Error(t("apiFailed"));

      setResults(data.results);
    } catch (err: unknown) {
      console.error("Migration error:", err);
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setLoading(false);
      setIsConfirmOpen(false);
    }
  };

  return (
    <>
    <div className="app-panel p-6 sm:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center border border-border-strong">
          <Icon name="database" size={22} className="text-text-heading" />
        </div>
        <div>
          <h2 className="type-section-title">{t("title")}</h2>
          <p className="text-text-muted text-xs font-medium">{t("description")}</p>
        </div>
      </div>

      <div className="bg-canvas border border-border-default p-4 mb-8">
        <h3 className="mb-3 text-sm font-semibold text-text-heading">{t("caution")}</h3>
        <ul className="list-inside list-disc space-y-2 text-xs leading-relaxed text-text-muted">
          <li>{t("itemSource")}</li>
          <li>{t("itemExisting")}</li>
          <li>{t("itemEmail")}</li>
          <li>{t("itemEnvironment")}</li>
        </ul>
      </div>

      {error && <div className="mb-6"><Alert type="error" message={error} /></div>}

      <div className="flex justify-center">
        {!results && (
          <Button
            type="button"
            onClick={() => setIsConfirmOpen(true)}
            isLoading={loading}
            size="lg"
            leftIcon={<Icon name="play" size={17} />}
          >
            {t("start")}
          </Button>
        )}
      </div>

      {results && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between border-b border-border-subtle pb-2">
            <h3 className="type-panel-title">{t("results")}</h3>
            <span className="font-mono text-xs text-text-dim">{t("processed", { count: results.length })}</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
            {results.map((res, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 border border-border-default bg-canvas p-3">
                <div className="min-w-0 flex-1">
                  <p className="w-full truncate font-mono text-xs text-text-heading">{res.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {res.status === "success" && <span className="text-text-heading text-xs font-mono font-semibold uppercase border border-border-strong px-2 py-0.5">{t("success")}</span>}
                  {res.status === "skipped" && <span className="text-text-muted text-xs font-mono font-semibold uppercase border border-border-strong px-2 py-0.5">{t("skipped")}</span>}
                  {res.status === "failed" && <span className="border border-status-danger/70 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-status-danger">{t("failedStatus")}</span>}
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            onClick={() => setResults(null)}
            variant="outline"
            fullWidth
          >
            {t("reset")}
          </Button>
        </div>
      )}
    </div>
      <ConfirmDialog
        open={isConfirmOpen}
        title={t("confirmTitle")}
        description={t("confirm")}
        confirmLabel={t("start")}
        cancelLabel={commonT("cancel")}
        onConfirm={runMigration}
        onCancel={() => setIsConfirmOpen(false)}
        isLoading={loading}
        tone="primary"
      />
    </>
  );
}
