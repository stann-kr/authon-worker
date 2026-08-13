const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const SAFE_EVENT_PATTERN = /^[a-z][a-z0-9._-]{2,95}$/;
const SAFE_ERROR_KINDS = new Set([
  "AbortError",
  "AuthenticationError",
  "AuthorizationError",
  "ConflictError",
  "DatabaseError",
  "MissingConfiguration",
  "NotFoundError",
  "RateLimitError",
  "SyntaxError",
  "TypeError",
  "ValidationError",
]);

export type StructuredLogLevel = "info" | "warn" | "error";
export type StructuredLogOutcome =
  | "success"
  | "failure"
  | "denied"
  | "invalid"
  | "conflict"
  | "unavailable";

export type StructuredLogInput = {
  event: string;
  requestId?: string | null;
  actorId?: string | null;
  venueId?: string | null;
  outcome: StructuredLogOutcome;
  error?: unknown;
  errorKind?: string;
};

export type StructuredLogRecord = {
  event: string;
  requestId: string;
  actor?: string;
  venueId?: string;
  outcome: StructuredLogOutcome;
  errorKind?: string;
};

function safeIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return SAFE_IDENTIFIER_PATTERN.test(trimmed) ? trimmed : null;
}

function classifyError(error: unknown, requestedKind?: string): string | undefined {
  if (requestedKind && SAFE_ERROR_KINDS.has(requestedKind)) return requestedKind;
  if (error instanceof Error && SAFE_ERROR_KINDS.has(error.name)) return error.name;
  if (error !== undefined || requestedKind) return "UnexpectedError";
  return undefined;
}

async function actorSurrogate(actorId: string | null | undefined): Promise<string | undefined> {
  if (!actorId) return undefined;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`authon-actor:${actorId}`),
  );
  const prefix = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${prefix}`;
}

export function getRequestId(request?: Request): string {
  const headerId = request
    ? safeIdentifier(request.headers.get("cf-ray"))
      ?? safeIdentifier(request.headers.get("x-request-id"))
    : null;
  return headerId ?? crypto.randomUUID();
}

export async function createStructuredLogRecord(
  input: StructuredLogInput,
): Promise<StructuredLogRecord> {
  if (!SAFE_EVENT_PATTERN.test(input.event)) {
    throw new TypeError("Structured log event name is invalid.");
  }

  const record: StructuredLogRecord = {
    event: input.event,
    requestId: safeIdentifier(input.requestId) ?? crypto.randomUUID(),
    outcome: input.outcome,
  };
  const actor = await actorSurrogate(input.actorId);
  const venueId = safeIdentifier(input.venueId);
  const errorKind = classifyError(input.error, input.errorKind);
  if (actor) record.actor = actor;
  if (venueId) record.venueId = venueId;
  if (errorKind) record.errorKind = errorKind;
  return record;
}

export async function writeStructuredLog(
  level: StructuredLogLevel,
  input: StructuredLogInput,
  sink?: (serialized: string) => void,
): Promise<StructuredLogRecord> {
  const record = await createStructuredLogRecord(input);
  const serialized = JSON.stringify(record);
  const target = sink ?? ((value: string) => console[level](value));
  target(serialized);
  return record;
}

export async function reportServerError(
  event: string,
  error: unknown,
  context: Pick<StructuredLogInput, "requestId" | "actorId" | "venueId"> = {},
): Promise<void> {
  await writeStructuredLog("error", {
    event,
    outcome: "failure",
    error,
    ...context,
  });
}
