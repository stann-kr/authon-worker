import { headers } from "next/headers";
import { getRequestId } from "./structured-log";
import { runPerformanceOperation } from "./performance-scope";

/** Measures the operation body, excluding middleware, serialization and transport. */
export async function measureServerOperation<T>(event: string, task: () => Promise<T>): Promise<T> {
  let requestId: string;
  try {
    const requestHeaders = await headers();
    requestId = getRequestId({ headers: requestHeaders });
  } catch {
    requestId = crypto.randomUUID();
  }
  return runPerformanceOperation(event, requestId, task);
}
