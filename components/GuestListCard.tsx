import React from "react";
import Button from "./Button";

export interface Guest {
  id: string;
  name: string;
  status: "pending" | "checked" | "deleted";
  checkInTime?: string | null;
  createdAt?: string | null;
  djId?: string | null;
  date?: string | null;
}

const formatTime = (timeStr: string) => {
  const date = new Date(timeStr);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

interface GuestListCardProps {
  guest: Guest;
  index: number;
  variant?: "user" | "admin";
  djName?: string;
  onCheck?: () => void;
  onDelete?: () => void;
  isCheckLoading?: boolean;
  isDeleteLoading?: boolean;
}

const GuestListCard: React.FC<GuestListCardProps> = ({
  guest,
  index,
  variant = "user",
  djName,
  onCheck,
  onDelete,
  isCheckLoading = false,
  isDeleteLoading = false,
}) => {
  const handleCheck = () => {
    if (!onCheck) return;
    if (!confirm("Mark this guest as checked in?")) return;
    onCheck();
  };

  return (
    <div
      className={`p-4 overflow-hidden ${index % 2 === 1 ? "bg-surface-hover/30" : ""} ${guest.status === "checked" ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
          <div
            className={`w-8 h-8 sm:w-10 sm:h-10 border flex items-center justify-center shrink-0 mt-0.5 ${guest.status === "checked" ? "border-brand-green/50" : "border-border-default"}`}
          >
            <span className="text-xs sm:text-sm font-mono text-text-muted">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>
          <div className="min-w-0">
            <p className="font-mono font-semibold text-sm sm:text-base tracking-widest text-white uppercase">
              {guest.name}
            </p>
            {(djName || guest.checkInTime || guest.createdAt) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                {djName && (
                  <span className="text-xs font-mono text-text-muted">
                    BY: {djName}
                  </span>
                )}
                {guest.createdAt && (
                  <span className="text-xs font-mono text-text-dim">
                    {formatTime(guest.createdAt)}
                  </span>
                )}
                {guest.checkInTime && (
                  <span className="text-xs font-mono text-brand-green">
                    IN: {formatTime(guest.checkInTime)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2 flex-shrink-0">
          {guest.status === "pending" && (
            <>
              {variant === "admin" && onCheck && (
                <Button
                  onClick={handleCheck}
                  isLoading={isCheckLoading}
                  variant="outline"
                  size="md"
                  className="px-4 sm:px-6"
                >
                  CHECK
                </Button>
              )}

              {variant === "user" && onDelete && (
                <Button
                  onClick={onDelete}
                  isLoading={isDeleteLoading}
                  variant="danger"
                  className="bg-red-600 text-white border-none hover:bg-red-700 px-3 sm:px-4"
                >
                  DELETE
                </Button>
              )}

              {variant === "admin" && onDelete && (
                <Button
                  onClick={onDelete}
                  isLoading={isDeleteLoading}
                  variant="ghost"
                  className="px-3 sm:px-4 border border-border-default text-text-muted"
                  aria-label="Delete Guest"
                >
                  <i className="ri-close-line" aria-hidden="true"></i>
                </Button>
              )}
            </>
          )}

          {guest.status === "checked" && (
            <div className="flex items-center gap-2">
              <span className="px-4 sm:px-6 py-2 sm:py-3 bg-brand-green/20 border border-brand-green text-brand-green font-mono text-xs tracking-wider uppercase">
                ACTIVE
              </span>
              {variant === "admin" && onDelete && (
                <Button
                  onClick={onDelete}
                  isLoading={isDeleteLoading}
                  variant="ghost"
                  className="w-8 h-8 sm:w-10 sm:h-10 p-0 border border-border-default text-text-muted"
                  aria-label="Remove Guest"
                >
                  <i className="ri-close-line text-sm" aria-hidden="true"></i>
                </Button>
              )}
            </div>
          )}

          {guest.status === "deleted" && (
            <span className="px-4 sm:px-6 py-2 sm:py-3 bg-surface-hover text-text-dim font-mono text-xs tracking-wider uppercase">
              REMOVED
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default GuestListCard;
