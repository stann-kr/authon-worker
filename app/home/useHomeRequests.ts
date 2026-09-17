"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@/lib/auth";
import { fetchMyVenuePendingGuestLimitRequestCount } from "@/lib/api/guest-limits";
import { fetchPendingPasswordResetRequestCount } from "@/lib/api/password-reset-requests";

type RequestId = "guests" | "passwords";
type CountState =
  | { status: "loading" | "error" }
  | { status: "ready"; count: number };

export type HomeRequest = { id: RequestId; href: string } & CountState;

async function readCount(load: typeof fetchPendingPasswordResetRequestCount): Promise<CountState> {
  try {
    const result = await load();
    return result.error || result.data === null
      ? { status: "error" }
      : { status: "ready", count: result.data };
  } catch {
    return { status: "error" };
  }
}

export default function useHomeRequests(user: User | null) {
  const role = user?.role;
  const definitions = useMemo(() => [
    ...(role === "venue_admin" ? [{
      id: "guests" as const,
      href: "/admin?tab=guests&view=requests",
      load: fetchMyVenuePendingGuestLimitRequestCount,
    }] : []),
    ...(role === "venue_admin" || role === "super_admin" ? [{
      id: "passwords" as const,
      href: "/admin?tab=users&view=password-requests",
      load: fetchPendingPasswordResetRequestCount,
    }] : []),
  ], [role]);
  const [revision, setRevision] = useState(0);
  const requestKey = `${user?.id ?? ""}:${role ?? ""}:${user?.venue_id ?? ""}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    counts: Partial<Record<RequestId, CountState>>;
  } | null>(null);

  useEffect(() => {
    if (definitions.length === 0) return;
    let active = true;
    void Promise.all(definitions.map(async ({ id, load }) => [id, await readCount(load)] as const))
      .then((entries) => {
        if (active) setResult({ key: requestKey, counts: Object.fromEntries(entries) });
      });
    return () => { active = false; };
  }, [definitions, requestKey]);

  const requests: HomeRequest[] = definitions.map(({ id, href }) => ({
    id,
    href,
    ...((result?.key === requestKey ? result.counts[id] : undefined) ?? { status: "loading" }),
  }));

  return {
    requests,
    isLoading: requests.some((request) => request.status === "loading"),
    refresh: () => setRevision((value) => value + 1),
  };
}
