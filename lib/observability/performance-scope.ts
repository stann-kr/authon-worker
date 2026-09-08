import { AsyncLocalStorage } from "node:async_hooks";
import { createPerformanceTrace, type PerformanceStage, type PerformanceTrace } from "./performance.ts";

const traces = new AsyncLocalStorage<PerformanceTrace>();

export function currentPerformanceTrace() {
  return traces.getStore();
}

export function measureServerStage<T>(stage: PerformanceStage, task: () => Promise<T>): Promise<T> {
  const trace = traces.getStore();
  return trace ? trace.measure(stage, task) : task();
}

export async function runPerformanceOperation<T>(
  event: string,
  requestId: string,
  task: () => Promise<T>,
  options?: Parameters<typeof createPerformanceTrace>[2],
): Promise<T> {
  const trace = createPerformanceTrace(event, requestId, options);
  return traces.run(trace, async () => {
    let outcome: "success" | "failure" = "failure";
    try {
      const result = await task();
      outcome = result && typeof result === "object" && "error" in result && result.error
        ? "failure" : "success";
      return result;
    } finally {
      await trace.finish(outcome);
    }
  });
}
