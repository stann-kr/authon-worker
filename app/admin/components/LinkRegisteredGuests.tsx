"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { fetchExternalLinkGuests } from "@/lib/api/external-links";
import type { ExternalLinkGuestPage } from "@/lib/external-links/types";
import type { LinkListCursor } from "@/lib/external-links/list-types";
import { useLatestRequestGuard } from "@/lib/hooks";
import { formatVenueTime } from "@/lib/date";
import Button from "@/components/Button";
import Skeleton from "@/components/Skeleton";

interface Props {
  venueId: string;
  linkId: string;
  registeredCount: number;
  timeZone?: string | null;
  fetchPage?: typeof fetchExternalLinkGuests;
}

export default function LinkRegisteredGuests({ venueId, linkId, registeredCount, timeZone,
  fetchPage = fetchExternalLinkGuests }: Props) {
  const t = useTranslations("LinkAdmin");
  const commonT = useTranslations("Common");
  const rosterT = useTranslations("Roster");
  const guard = useLatestRequestGuard();
  const scope = `${venueId}:${linkId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const busy = useRef<symbol | null>(null);
  const retryCursor = useRef<LinkListCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<ExternalLinkGuestPage & { scope: string; loaded: boolean; error: boolean }>({
    scope: "", guests: [], nextCursor: null, loaded: false, error: false,
  });
  const current = state.scope === scope;
  const load = useCallback(async (cursor: LinkListCursor | null = null) => {
    if (busy.current) return;
    const owner = Symbol("link-guest-read");
    busy.current = owner;
    setLoading(true);
    setState((previous) => previous.scope === scope ? { ...previous, error: false }
      : { scope, guests: [], nextCursor: null, loaded: false, error: false });
    const latest = guard.beginRequest();
    const isCurrent = () => latest() && scopeRef.current === scope;
    try {
      const result = await fetchPage(venueId, linkId, cursor);
      if (!isCurrent()) return;
      if (!result.data || result.error) throw new Error("LINK_GUESTS_UNAVAILABLE");
      const page = result.data;
      setState((previous) => {
        const existing = cursor && previous.scope === scope ? previous.guests : [];
        const ids = new Set(existing.map((guest) => guest.id));
        return { scope, guests: [...existing, ...page.guests.filter((guest) => !ids.has(guest.id))],
          nextCursor: page.nextCursor, loaded: true, error: false };
      });
    } catch {
      if (isCurrent()) { retryCursor.current = cursor; setState((previous) => ({ ...previous, error: true })); }
    } finally {
      if (busy.current === owner) { busy.current = null; setLoading(false); }
    }
  }, [fetchPage, guard, linkId, scope, venueId]);
  useEffect(() => {
    void load();
    return () => { guard.invalidateRequests(); busy.current = null; };
  }, [guard, load, registeredCount]);

  const guests = current ? state.guests : [];
  const error = current && state.error;
  const nextCursor = current ? state.nextCursor : null;
  const loaded = current && state.loaded;
  return <section className="min-w-0 border-t border-border-subtle pt-4" aria-label={t("registeredGuests")}>
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="text-sm font-medium text-text-heading">{t("registeredGuests")}
        <span className="ml-2 text-xs tabular-nums text-text-muted">{registeredCount}</span>
      </h3>
      <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label={t("refreshGuests")}>{commonT("refresh")}</Button>
    </div>
    {error && <p className="mb-2 text-xs text-status-danger" role="alert">{t("guestLoadFailed")}</p>}
    {!loaded && !error ? <Skeleton compact rows={3} /> : <>
      {loaded && guests.length === 0 && !error && <p className="py-3 text-xs text-text-muted">{t("noRegisteredGuests")}</p>}
      {guests.length > 0 && <ul className="max-h-64 overflow-y-auto overscroll-contain divide-y divide-border-subtle" aria-busy={loading}>
        {guests.map((guest) => <li key={guest.id} className="flex min-w-0 items-center justify-between gap-4 py-2 text-xs">
          <span className="min-w-0 break-words text-text-body">{guest.name}</span>
          <span className="shrink-0 text-right text-text-muted">
            {guest.status === "checked" ? commonT("checkedIn") : rosterT("pending")}
            {guest.status === "checked" && guest.checkInTime && <time className="ml-2 tabular-nums" dateTime={guest.checkInTime}>
              {formatVenueTime(guest.checkInTime, timeZone) ?? "—"}
            </time>}
          </span>
        </li>)}
      </ul>}
      {loading && <Skeleton compact rows={2} />}
    </>}
    {(error || nextCursor) && <Button variant="outline" size="sm" className="mt-3" disabled={loading}
      onClick={() => void load(error ? retryCursor.current : nextCursor)}>{error ? commonT("retry") : t("loadMore")}</Button>}
  </section>;
}
