"use client";

import { useState, useEffect } from "react";
import { useLocalStorage } from "@/lib/hooks";
import Footer from "@/components/Footer";
import StatGrid from "@/components/StatGrid";
import PanelHeader from "@/components/PanelHeader";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import { BRAND_NAME } from "@/lib/brand";
import GuestListCard from "@/components/GuestListCard";
import GuestSearchInput from "@/components/GuestSearchInput";
import Icon from "@/components/Icon";
import { formatDateDisplay } from "@/lib/date";
import {
  validateExternalToken,
  createGuestViaExternalLink,
  deleteGuestViaExternalLink,
} from "@/lib/api/external-links";
import type { Guest, ExternalDJLink, Venue } from "@/lib/api/types";

interface ExternalDJGuestViewProps {
  token: string;
}

export default function ExternalDJGuestView({ token }: ExternalDJGuestViewProps) {
  const [linkInfo, setLinkInfo] = useState<ExternalDJLink | null>(null);
  const [venueInfo, setVenueInfo] = useState<Venue | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useLocalStorage<"default" | "alpha">(
    "guest:sortMode",
    "default",
  );

  useEffect(() => {
    const validate = async () => {
      setIsValidating(true);
      const { data, error } = await validateExternalToken(token);
      if (error) {
        setValidationError(error || "Invalid link.");
      } else if (data) {
        setLinkInfo(data.link);
        setVenueInfo(data.venue);
        if (data.guests && data.guests.length > 0) {
          setGuests(data.guests);
        }
      }
      setIsValidating(false);
    };
    validate();
  }, [token]);

  const handleSave = async () => {
    if (!guestName.trim() || !linkInfo) return;
    setIsLoading(true);
    setError(null);

    const { data, error: createError } = await createGuestViaExternalLink({
      token,
      guestName: guestName.trim().toUpperCase(),
      date: linkInfo.date || "",
    });

    if (createError) {
      setError(createError || "Failed to register guest.");
    } else if (data) {
      setGuests((prev) => [...prev, data]);
      setGuestName("");
      setLinkInfo((prev) =>
        prev ? { ...prev, usedGuests: prev.usedGuests + 1 } : prev,
      );
    }
    setIsLoading(false);
  };

  const handleDelete = async (guestId: string) => {
    setDeletingId(guestId);
    setError(null);

    const { error: deleteError } = await deleteGuestViaExternalLink({
      token,
      guestId,
    });

    if (deleteError) {
      setError(deleteError || "Failed to delete guest.");
    } else {
      setGuests((prev) => prev.filter((g) => g.id !== guestId));
      setLinkInfo((prev) =>
        prev ? { ...prev, usedGuests: Math.max(0, prev.usedGuests - 1) } : prev,
      );
    }
    setDeletingId(null);
  };

  const sortGuestsByName = (list: Guest[]) => {
    return [...list].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "ko-KR", {
        sensitivity: "base",
      }),
    );
  };

  const sortGuestsByCreatedAt = (list: Guest[]) => {
    return [...list].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
  };

  const externalHeader = (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-border-default bg-canvas">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center border border-border-strong bg-surface font-mono text-xs font-semibold text-text-heading">A</div>
          <span className="text-sm font-semibold text-text-heading">
            {BRAND_NAME}
          </span>
        </div>
        <span className="operational-label">
          Guest access
        </span>
      </div>
    </div>
  );

  if (isValidating) {
    return (
      <div className="min-h-[100dvh] bg-canvas flex flex-col">
        {externalHeader}
        <div className="flex-1 overflow-x-hidden pt-16 sm:pt-20 flex flex-col">
          <div className="page-container">
            <div className="main-content-panel">
              <Spinner mode="inline" text="Validating guest access" />
            </div>
          </div>
          <Footer />
        </div>
      </div>
    );
  }

  if (validationError) {
    return (
      <div className="min-h-[100dvh] bg-canvas flex items-center justify-center px-4">
        <div className="app-panel max-w-sm p-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-status-danger/70 bg-status-danger/10">
            <Icon name="warning" size={24} className="text-status-danger" />
          </div>
          <h1 className="mb-2 text-xl font-semibold text-text-heading">
            Invalid link
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-text-muted">
            {validationError}
          </p>
          <Footer compact />
        </div>
      </div>
    );
  }

  const remaining = linkInfo ? linkInfo.maxGuests - linkInfo.usedGuests : 0;
  const isAtLimit = remaining <= 0;
  const sortedGuests =
    sortMode === "alpha"
      ? sortGuestsByName(guests)
      : sortGuestsByCreatedAt(guests);
  const displayGuests = searchQuery
    ? sortedGuests.filter((g) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedGuests;

  return (
    <div className="min-h-[100dvh] bg-canvas flex flex-col">
      {externalHeader}
      <div className="flex-1 overflow-x-hidden pt-16 sm:pt-20 flex flex-col">
        <div className="page-container">
          <div className="context-bar mb-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="type-context-title">Guest owner</div>
              <div className="text-sm font-medium text-text-heading">
                {linkInfo?.djName}
              </div>
            </div>
            <div>
              <div className="type-context-title">Event</div>
              <div className="text-sm text-text-body">{linkInfo?.event}</div>
            </div>
            <div>
              <div className="type-context-title">Venue</div>
              <div className="text-sm text-text-body">
                {venueInfo?.name ?? "-"}
              </div>
            </div>
            <div>
              <div className="type-context-title">Operational date</div>
              <div className="font-mono text-sm text-text-body">
                {linkInfo ? formatDateDisplay(linkInfo.date || "") : "-"}
              </div>
            </div>
          </div>

          {error && <Alert type="error" message={error} className="mb-4" />}

          <section className="main-content-panel lg:min-h-0 lg:max-h-[calc(100dvh-10.5rem)]">
            <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <h1 className="type-panel-title">
                    Add guest
                  </h1>
                  <p className="mt-1 text-sm text-text-muted">
                    Add one full name at a time.
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg tabular-nums text-text-heading">
                    {remaining}
                  </div>
                  <div className="text-xs text-text-muted">Remaining</div>
                </div>
              </div>

              {!isAtLimit ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="external-guest-name" className="app-label">
                      Guest name
                    </label>
                    <input
                      id="external-guest-name"
                      type="text"
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      placeholder="Enter full name"
                      className="app-field min-h-11"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleSave();
                      }}
                    />
                  </div>
                  <Button
                    onClick={handleSave}
                    disabled={!guestName.trim()}
                    isLoading={isLoading}
                    size="lg"
                    className="sm:min-w-32"
                  >
                    ADD GUEST
                  </Button>
                </div>
              ) : (
                <div className="border-l-2 border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
                  Guest limit reached ({linkInfo?.maxGuests}/{linkInfo?.maxGuests})
                </div>
              )}
            </div>

            <StatGrid
              items={[
                { label: "REGISTERED", value: guests.length, color: "default" },
                { label: "REMAINING", value: remaining, color: "default" },
                {
                  label: "MAX",
                  value: linkInfo?.maxGuests ?? 0,
                  color: "default",
                },
              ]}
            />

            <PanelHeader
              title="Guest list"
              count={displayGuests.length}
              sortMode={sortMode}
              onSortToggle={() =>
                setSortMode((prev) =>
                  prev === "default" ? "alpha" : "default",
                )
              }
            />

            <GuestSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
            />

            {displayGuests.length === 0 ? (
              <EmptyState
                icon="user-add"
                message={
                  searchQuery
                    ? "No guests match this search"
                    : "No guests registered yet"
                }
              />
            ) : (
              <div className="divide-y divide-border-subtle overflow-y-auto">
                {displayGuests.map((guest, index) => (
                  <GuestListCard
                    key={guest.id}
                    guest={guest}
                    index={index}
                    mode="registration"
                    onDelete={
                      guest.status === "pending"
                        ? () => handleDelete(guest.id)
                        : undefined
                    }
                    isDeleteLoading={deletingId === guest.id}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
        <Footer />
      </div>
    </div>
  );
}
