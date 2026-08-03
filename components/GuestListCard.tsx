import React, { useState } from "react";
import Button from "./Button";
import Icon from "./Icon";
import StatusLabel from "./StatusLabel";
import ConfirmDialog from "./ConfirmDialog";
import { useTranslations } from "next-intl";

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
  accountKind?: "personal" | "shared";
  registeredByName?: string | null;
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
  accountKind = "personal",
  registeredByName,
  showRegisteredAt = false,
  onCheck,
  onUndo,
  onDelete,
  isCheckLoading = false,
  isUndoLoading = false,
  isDeleteLoading = false,
}) => {
  const t = useTranslations("Common");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const rowTone = index % 2 === 0 ? "bg-surface" : "bg-surface-raised";
  const indicatorTone =
    guest.status === "checked"
      ? "before:bg-status-checked"
      : guest.status === "deleted"
        ? "before:bg-border-strong"
        : "before:bg-status-waiting";
  const handleDelete = () => {
    if (!onDelete) return;
    setIsDeleteConfirmOpen(false);
    onDelete();
  };

  return (
    <>
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
            {(djName || registeredByName) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                {accountKind === "shared" && (
                  <span className="border border-border-strong bg-canvas px-1.5 py-0.5 font-mono uppercase tracking-wider text-text-heading">
                    {t("sharedAccount")}
                  </span>
                )}
                {djName ? (
                  <span>{t("byName", { name: djName })}</span>
                ) : null}
                {registeredByName && (
                  <span>{t("registeredByName", { name: registeredByName })}</span>
                )}
              </div>
            )}

            {((showRegisteredAt && guest.createdAt) || guest.checkInTime) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
                {showRegisteredAt && guest.createdAt && (
                  <span className="flex items-baseline gap-2 text-xs text-text-dim">
                    <span>{t("registered")}</span>
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
                    <span>{t("checkedIn")}</span>
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
              <span className="sr-only">{t("waitingStatus")}</span>
              {onCheck && (
                <Button
                  onClick={onCheck}
                  isLoading={isCheckLoading}
                  variant="confirm"
                  size="md"
                  className="w-32 px-2 sm:w-36 sm:px-4"
                >
                  {t("checkIn")}
                </Button>
              )}

              {mode === "registration" && onDelete && (
                <Button
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  isLoading={isDeleteLoading}
                  variant="danger"
                  className="px-3 sm:px-4"
                >
                  {t("delete")}
                </Button>
              )}

              {mode === "operations" && onDelete && (
                <Button
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  isLoading={isDeleteLoading}
                  variant="ghost"
                  className="px-3 sm:px-4 border border-border-default text-text-muted"
                  aria-label={t("deleteGuest")}
                >
                  <Icon name="close" size={16} />
                </Button>
              )}
            </>
          )}

          {guest.status === "checked" && (
            <>
              <span className="sr-only">{t("checkedInStatus")}</span>
              {onUndo && (
                <Button
                  onClick={onUndo}
                  isLoading={isUndoLoading}
                  variant="outline"
                  size="md"
                  leftIcon={<Icon name="undo" size={16} />}
                  className="w-32 px-2 sm:w-36 sm:px-4"
                  aria-label={t("undoCheckIn", { name: guest.name })}
                >
                  {t("undo")}
                </Button>
              )}
              {!onUndo && (
                <StatusLabel
                  tone="checked"
                  appearance="inline"
                  className="whitespace-nowrap"
                >
                  {t("checkedIn")}
                </StatusLabel>
              )}
              {mode === "operations" && onDelete && (
                <Button
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  isLoading={isDeleteLoading}
                  variant="ghost"
                  className="w-8 h-8 sm:w-10 sm:h-10 p-0 border border-border-default text-text-muted"
                  aria-label={t("removeGuest")}
                >
                  <Icon name="close" size={16} />
                </Button>
              )}
            </>
          )}

          {guest.status === "deleted" && (
            <StatusLabel tone="neutral">
              {t("removed")}
            </StatusLabel>
          )}
        </div>
      </div>
    </article>
      {isDeleteConfirmOpen && (
        <ConfirmDialog
          open
          title={t("deleteGuest")}
          description={t("removeGuestConfirm")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onConfirm={handleDelete}
          onCancel={() => setIsDeleteConfirmOpen(false)}
          isLoading={isDeleteLoading}
        />
      )}
    </>
  );
};

export default GuestListCard;
