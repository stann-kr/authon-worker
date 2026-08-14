"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAccess } from "@/lib/auth/server";
import type { ApiResponse } from "@/lib/api/types";
import {
  parseConnectorPolicyConfig,
  type ConnectorPolicyDecision,
} from "@/lib/connectors/policy";
import { reportServerError } from "@/lib/observability/structured-log";

export async function getConnectorReadiness(): Promise<
  ApiResponse<ConnectorPolicyDecision[]>
> {
  try {
    await requireAccess("admin");
    const { env } = getCloudflareContext();
    const raw = (env as CloudflareEnv & {
      OFFICIAL_CONNECTORS_JSON?: string;
    }).OFFICIAL_CONNECTORS_JSON;
    return { data: parseConnectorPolicyConfig(raw), error: null };
  } catch (error: unknown) {
    await reportServerError("connector.readiness", error);
    return { data: null, error: "CONNECTOR_POLICY_UNAVAILABLE" };
  }
}
