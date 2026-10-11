import type { ApiResponse } from "./response";
import { notifySessionExpired } from "../auth/client-session.ts";

// Ordinary fetches can run alongside mutations; Server Actions share a client queue.
export async function readApi<T>(
  endpoint: string,
  params: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    // Never follow a redirect; middleware redirects reads only when the session is no longer valid.
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    notifySessionExpired();
    throw new Error("SESSION_EXPIRED");
  }
  if (!response.ok) throw new Error("READ_REQUEST_FAILED");
  return response.json() as Promise<ApiResponse<T>>;
}
