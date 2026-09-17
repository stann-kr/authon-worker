import type { ApiResponse } from "./response";

type ReadParams = Record<string, unknown>;

export function readString(params: ReadParams, key: string): string | null {
  const value = params[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 256) {
    throw new TypeError("INVALID_READ_REQUEST");
  }
  return value;
}

export function readBoolean(params: ReadParams, key: string): boolean {
  const value = params[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new TypeError("INVALID_READ_REQUEST");
  return value;
}

// The supplied reader must enforce its own auth, role and tenant boundaries.
// POST keeps scope/device identifiers out of URLs; this handler performs no writes.
export function createReadHandler<T>(
  read: (params: ReadParams) => Promise<ApiResponse<T>>,
) {
  return async (request: Request): Promise<Response> => {
    const headers = { "Cache-Control": "private, no-store" };
    let params: ReadParams;
    try {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new TypeError("INVALID_READ_REQUEST");
      }
      params = body as ReadParams;
    } catch {
      return Response.json({ data: null, error: "INVALID_READ_REQUEST" }, { status: 400, headers });
    }
    try {
      return Response.json(await read(params), { headers });
    } catch (error) {
      const invalid = error instanceof TypeError && error.message === "INVALID_READ_REQUEST";
      return Response.json(
        { data: null, error: invalid ? "INVALID_READ_REQUEST" : "READ_REQUEST_FAILED" },
        { status: invalid ? 400 : 500, headers },
      );
    }
  };
}
