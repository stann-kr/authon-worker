import { writeStructuredLog, type StructuredLogOutcome } from "./structured-log.ts";

export type PerformanceStage = "auth" | "kv" | "d1";
export type PerformanceMetrics = {
  durationMs: number;
  authMs: number;
  authCount: number;
  kvMs: number;
  kvCount: number;
  d1Ms: number;
  d1Count: number;
  d1Statements: number;
  d1Failures: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  d1MetaCount: number;
};

export function createPerformanceTrace(
  event: string,
  requestId: string,
  options: { now?: () => number; sink?: (value: string) => void } = {},
) {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const metrics: PerformanceMetrics = {
    durationMs: 0, authMs: 0, authCount: 0, kvMs: 0, kvCount: 0,
    d1Ms: 0, d1Count: 0, d1Statements: 0, d1Failures: 0,
    d1RowsRead: 0, d1RowsWritten: 0, d1MetaCount: 0,
  };
  let finished = false;

  return {
    async measure<T>(stage: PerformanceStage, task: () => Promise<T>, statements = 0): Promise<T> {
      const start = now();
      metrics[`${stage}Count`] += 1;
      if (stage === "d1") metrics.d1Statements += statements;
      try {
        return await task();
      } catch (error) {
        if (stage === "d1") metrics.d1Failures += 1;
        throw error;
      } finally {
        metrics[`${stage}Ms`] += Math.max(0, now() - start);
      }
    },
    recordD1Result(result: unknown) {
      // raw()/first() omit D1 metadata. Missing metadata is not a zero-row read.
      for (const item of Array.isArray(result) ? result : [result]) {
        if (!item || typeof item !== "object" || !("meta" in item)) continue;
        const meta = item.meta as Record<string, unknown> | null;
        if (!meta || typeof meta !== "object") continue;
        if (typeof meta.rows_read !== "number" || !Number.isFinite(meta.rows_read) || meta.rows_read < 0 ||
            typeof meta.rows_written !== "number" || !Number.isFinite(meta.rows_written) || meta.rows_written < 0) continue;
        metrics.d1MetaCount += 1;
        metrics.d1RowsRead += meta.rows_read;
        metrics.d1RowsWritten += meta.rows_written;
      }
    },
    async finish(outcome: StructuredLogOutcome) {
      if (finished) return;
      finished = true;
      metrics.durationMs = Math.max(0, now() - startedAt);
      try {
        await writeStructuredLog("info", { event, requestId, outcome, performance: metrics }, options.sink);
      } catch {
        // Observability must never turn a committed mutation into a client error.
      }
    },
  };
}

export type PerformanceTrace = ReturnType<typeof createPerformanceTrace>;
