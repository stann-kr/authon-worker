import React from "react";
import Button from "./Button";
import Icon from "./Icon";
import StatusLabel from "./StatusLabel";

export interface Guest {
  id: string;
  name: string;
  status: "pending" | "checked" | "deleted";
  checkInTime?: string | null;
  createdAt?: string | null;
  date?: string | null;
}

const formatTime = (timeStr: string) => {
  const date = new Date(timeStr);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

interface GuestListCardProps {
  guest: Guest;
  index: number;
  mode?: "registration" | "operations";
  djName?: string;
  showRegisteredAt?: boolean;
  onCheck?: () => void;
  onUndo?: () => void;
  onDelete?: () => void;
  isCheckLoading?: boolean;
  isUndoLoading?: boolean;
  isDeleteLoading?: boolean;
}

const GuestListCard: React.FC<GuestListCardProps> = ({
  guest,
  index,
  mode = "registration",
  djName,
  showRegisteredAt = false,
  onCheck,
  onUndo,
  onDelete,
  isCheckLoading = false,
  isUndoLoading = false,
  isDeleteLoading = false,
}) => {
  const rowTone = index % 2 === 0 ? "bg-surface" : "bg-surface-raised";
  const indicatorTone =
    guest.status === "checked"
      ? "before:bg-status-checked"
      : guest.status === "deleted"
        ? "before:bg-border-strong"
        : "before:bg-status-waiting";
  const handleDelete = () => {
    if (!onDelete || !window.confirm("Remove this guest from the list?")) return;
    onDelete();
  };

  return (
    <article
      className={`guest-list-row relative overflow-hidden px-4 py-3 before:absolute before:inset-y-0 before:left-0 before:w-0.5 sm:px-5 ${rowTone} ${indicatorTone} ${
        guest.status === "deleted" ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <span className="mt-0.5 w-7 shrink-0 font-mono text-xs tabular-nums text-text-dim">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <p className="type-row-title break-words">
              {guest.name}
            </p>
            {djName && (
              <p className="mt-0.5 text-xs text-text-muted">
                By {djName}
              </p>
            )}

            {((showRegisteredAt && guest.createdAt) || guest.checkInTime) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
                {showRegisteredAt && guest.createdAt && (
                  <span className="flex items-baseline gap-2 text-xs text-text-dim">
                    <span>REGISTERED</span>
                    <time
                      dateTime={guest.createdAt}
                      className="font-mono tabular-nums text-text-muted"
                    >
                      {formatTime(guest.createdAt)}
                    </time>
                  </span>
                )}
                {guest.checkInTime && (
                  <span className="flex items-baseline gap-2 text-xs text-status-checked">
                    <span>CHECKED IN</span>
                    <time
                      dateTime={guest.checkInTime}
                      className="font-mono tabular-nums"
                    >
                      {formatTime(guest.checkInTime)}
                    </time>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {guest.status === "pending" && (
            <>
              <span className="sr-only">Status: waiting.</span>
              {onCheck && (
                <Button
                  onClick={onCheck}
                  isLoading={isCheckLoading}
                  variant="confirm"
                  size="md"
                  className="w-32 px-2 sm:w-36 sm:px-4"
                >
                  CHECK IN
                </Button>
              )}

              {mode === "registration" && onDelete && (
                <Button
                  onClick={handleDelete}
                  isLoading={isDeleteLoading}
                  variant="danger"
                  className="px-3 sm:px-4"
                >
                  DELETE
                </Button>
              )}

              {mode === "operations" && onDelete && (
                <Button
                  onClick={handleDelete}
                  isLoading={isDeleteLoading}
                  variant="ghost"
                  className="px-3 sm:px-4 border border-border-default text-text-muted"
                  aria-label="Delete Guest"
                >
                  <Icon name="close" size={16} />
                </Button>
              )}
            </>
          )}

          {guest.status === "checked" && (
            <>
              <span className="sr-only">Status: checked in.</span>
              {onUndo && (
                <Button
                  onClick={onUndo}
                  isLoading={isUndoLoading}
                  variant="outline"
                  size="md"
                  leftIcon={<Icon name="undo" size={16} />}
                  className="w-32 px-2 sm:w-36 sm:px-4"
                  aria-label={`Undo check-in for ${guest.name}`}
                >
                  UNDO
                </Button>
              )}
              {!onUndo && (
                <StatusLabel
                  tone="checked"
                  appearance="inline"
                  className="whitespace-nowrap"
                >
                  CHECKED IN
                </StatusLabel>
              )}
              {mode === "operations" && onDelete && (
                <Button
                  onClick={handleDelete}
                  isLoading={isDeleteLoading}
                  variant="ghost"
                  className="w-8 h-8 sm:w-10 sm:h-10 p-0 border border-border-default text-text-muted"
                  aria-label="Remove Guest"
                >
                  <Icon name="close" size={16} />
                </Button>
              )}
            </>
          )}

          {guest.status === "deleted" && (
            <StatusLabel tone="neutral">
              REMOVED
            </StatusLabel>
          )}
        </div>
      </div>
    </article>
  );
};

export default GuestListCard;
