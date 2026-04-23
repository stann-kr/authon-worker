"use client";

import { useState, useEffect, useRef } from "react";
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
import { formatDateDisplay } from "@/lib/date";
import {
  validateExternalToken,
  createGuestViaExternalLink,
  deleteGuestViaExternalLink,
  type Guest,
  type ExternalDJLink,
  type Venue,
} from "@/lib/api/guests";

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
        setValidationError(
          typeof error === "string" ? error : error.message || "Invalid link.",
        );
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
      date: linkInfo.date,
    });

    if (createError) {
      setError(
        typeof createError === "string"
          ? createError
          : createError.message || "Failed to register guest.",
      );
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
      setError(
        typeof deleteError === "string"
          ? deleteError
          : deleteError.message || "Failed to delete guest.",
      );
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

  if (isValidating) {
    return <Spinner mode="fullscreen" text="VALIDATING LINK..." />;
  }

  if (validationError) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 border-2 border-red-600 mx-auto mb-4 flex items-center justify-center">
            <i className="ri-error-warning-line text-red-400 text-2xl"></i>
          </div>
          <h1 className="font-mono text-xl tracking-wider text-white uppercase mb-2">
            INVALID LINK
          </h1>
          <p className="text-text-muted font-mono text-xs tracking-wider mb-6">
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

  const externalHeader = (
    <div className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-border-subtle">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-white"></div>
          <span className="font-mono text-sm tracking-wider text-white uppercase">
            {BRAND_NAME}
          </span>
        </div>
        <span className="font-mono text-xs tracking-wider text-text-muted uppercase">
          GUEST ACCESS
        </span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {externalHeader}
      <div className="flex-1 overflow-x-hidden pt-16 sm:pt-20 flex flex-col">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 w-full lg:flex-1 lg:min-h-0 flex flex-col">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
            <div className="lg:col-span-1 space-y-4 lg:overflow-y-auto">
              <div className="bg-surface border border-border-subtle p-4 sm:p-5">
                <div className="mb-4">
                  <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1 break-words">
                    {linkInfo?.djName}
                  </h2>
                  <p className="text-text-muted font-mono text-xs tracking-wider mb-1 break-words">
                    {linkInfo?.event}
                  </p>
                  {venueInfo && (
                    <p className="text-text-dim font-mono text-xs tracking-wider mb-1 break-words">
                      {venueInfo.name}
                    </p>
                  )}
                  <p className="text-text-muted font-mono text-xs tracking-wider break-words">
                    {linkInfo ? formatDateDisplay(linkInfo.date) : ""}
                  </p>
                </div>
                <div className="text-center mb-4">
                  <div className="text-white font-mono text-3xl sm:text-4xl tracking-wider">
                    {guests.length}
                  </div>
                  <div className="text-brand-cyan text-xs font-mono tracking-wider uppercase">
                    REGISTERED
                  </div>
                </div>

                <StatGrid
                  items={[
                    { label: "REMAINING", value: remaining, color: "cyan" },
                    {
                      label: "MAX",
                      value: linkInfo?.maxGuests ?? 0,
                      color: "blue",
                    },
                  ]}
                />
              </div>
            </div>

            <div className="lg:col-span-3 flex flex-col lg:min-h-0">
              {error && <Alert type="error" message={error} className="mb-4" />}

              <div className="main-content-panel lg:min-h-0 lg:max-h-full">
                <PanelHeader
                  title="GUEST LIST"
                  count={guests.length}
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

                {guests.length === 0 ? (
                  <EmptyState
                    icon="ri-user-add-line"
                    message="ADD YOUR GUESTS BELOW"
                  />
                ) : (
                  <div className="divide-y divide-border-subtle lg:overflow-y-auto">
                    {displayGuests.map((guest, index) => (
                      <GuestListCard
                        key={guest.id}
                        guest={guest}
                        index={index}
                        variant="user"
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

                {!isAtLimit && (
                  <div className="p-4 border-t-2 border-border-default">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 border border-border-default flex items-center justify-center">
                        <span className="text-xs sm:text-sm font-mono text-text-muted">
                          {String(guests.length + 1).padStart(2, "0")}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Enter guest full name"
                        className="flex-1 min-w-0 bg-transparent border-none outline-none text-white font-mono text-sm tracking-wider placeholder-text-dim"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave();
                        }}
                      />

                      <Button
                        onClick={handleSave}
                        disabled={!guestName.trim()}
                        isLoading={isLoading}
                        size="md"
                      >
                        SAVE
                      </Button>
                    </div>
                  </div>
                )}

                {isAtLimit && (
                  <div className="p-4 border-t-2 border-border-default text-center">
                    <p className="text-brand-yellow font-mono text-xs tracking-wider uppercase">
                      GUEST LIMIT REACHED ({linkInfo?.maxGuests}/
                      {linkInfo?.maxGuests})
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}
