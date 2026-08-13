export type ConnectorReadiness =
  | "ready"
  | "disabled"
  | "official_access_required"
  | "written_permission_required";

export interface ConnectorPolicyInput {
  provider: string;
  enabled: boolean;
  officialApiAccess: boolean;
  writtenPermission: boolean;
}

export interface ConnectorPolicyDecision {
  provider: string;
  readiness: ConnectorReadiness;
  canConnect: boolean;
}

function isProviderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 64 &&
    /^[a-z0-9][a-z0-9_-]*$/.test(value)
  );
}

export function evaluateConnectorPolicy(
  input: ConnectorPolicyInput,
): ConnectorPolicyDecision {
  if (!isProviderId(input.provider)) throw new Error("INVALID_CONNECTOR_PROVIDER");
  if (!input.enabled) {
    return { provider: input.provider, readiness: "disabled", canConnect: false };
  }
  if (!input.officialApiAccess) {
    return {
      provider: input.provider,
      readiness: "official_access_required",
      canConnect: false,
    };
  }
  if (!input.writtenPermission) {
    return {
      provider: input.provider,
      readiness: "written_permission_required",
      canConnect: false,
    };
  }
  return { provider: input.provider, readiness: "ready", canConnect: true };
}

export function parseConnectorPolicyConfig(raw: unknown): ConnectorPolicyDecision[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INVALID_CONNECTOR_POLICY_CONFIG");
  }
  if (!Array.isArray(parsed) || parsed.length > 10) {
    throw new Error("INVALID_CONNECTOR_POLICY_CONFIG");
  }
  const providers = new Set<string>();
  return parsed.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("INVALID_CONNECTOR_POLICY_CONFIG");
    }
    const candidate = value as Record<string, unknown>;
    if (
      !isProviderId(candidate.provider) ||
      typeof candidate.enabled !== "boolean" ||
      typeof candidate.officialApiAccess !== "boolean" ||
      typeof candidate.writtenPermission !== "boolean" ||
      providers.has(candidate.provider)
    ) {
      throw new Error("INVALID_CONNECTOR_POLICY_CONFIG");
    }
    providers.add(candidate.provider);
    return evaluateConnectorPolicy({
      provider: candidate.provider,
      enabled: candidate.enabled,
      officialApiAccess: candidate.officialApiAccess,
      writtenPermission: candidate.writtenPermission,
    });
  });
}

export function requireConnectorPermission(
  decision: ConnectorPolicyDecision,
): void {
  if (!decision.canConnect) throw new Error(`CONNECTOR_BLOCKED:${decision.readiness}`);
}
