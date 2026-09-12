import type { ApiResponse } from "./response";

// Ordinary fetches can run alongside mutations; Server Actions share a client queue.
export async function readApi<T>(
  endpoint: string,
  params: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error("READ_REQUEST_FAILED");
  return response.json() as Promise<ApiResponse<T>>;
}
