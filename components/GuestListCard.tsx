import React, { useEffect, useId, useRef, useState } from "react";
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
  isDeleteDisabled?: boolean;
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
  isDeleteDisabled = false,
}) => {
  const t = useTranslations("Common");
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLElement>(null);
  const restoreFocusAfterDeleteRef = useRef(false);
  const confirmationId = useId();
  const confirmationKey = `${guest.id}:${guest.status}`;
  const isDeleteConfirmOpen = Boolean(
    onDelete &&
      guest.status !== "deleted" &&
      deleteConfirmation === confirmationKey,
  );
  const isInlineDeleteOpen = isDeleteConfirmOpen && guest.status === "pending";

  useEffect(() => {
    if (deleteConfirmation && (deleteConfirmation !== confirmationKey || !onDelete)) {
      setDeleteConfirmation(null);
      if (document.activeElement === document.body) {
        rowRef.current?.focus({ preventScroll: true });
      }
    }
  }, [confirmationKey, deleteConfirmation, onDelete]);

  useEffect(() => {
    if (isInlineDeleteOpen) cancelDeleteRef.current?.focus();
  }, [isInlineDeleteOpen]);

  useEffect(() => () => {
    if (!restoreFocusAfterDeleteRef.current || document.activeElement !== document.body) return;
    const mainContent = document.getElementById("main-content");
    if (mainContent && !mainContent.hasAttribute("tabindex")) mainContent.tabIndex = -1;
    mainContent?.focus({ preventScroll: true });
  }, []);

  const cancelDelete = () => {
    setDeleteConfirmation(null);
    if (!deleteTriggerRef.current?.disabled) {
      deleteTriggerRef.current?.focus({ preventScroll: true });
    } else {
      rowRef.current?.focus({ preventScroll: true });
    }
  };
  const indicatorTone =
    guest.status === "checked"
      ? "before:bg-status-checked"
      : guest.status === "deleted"
        ? "before:bg-border-strong"
        : "before:bg-status-waiting";
  const handleDelete = () => {
    if (!onDelete || !isDeleteConfirmOpen || isDeleteDisabled || isDeleteLoading) return;
    if (isInlineDeleteOpen) {
      restoreFocusAfterDeleteRef.current = true;
      rowRef.current?.focus({ preventScroll: true });
    }
    setDeleteConfirmation(null);
    onDelete();
  };

  return (
    <>
    <article
      ref={rowRef}
      tabIndex={-1}
      className={`guest-list-row relative overflow-hidden bg-surface px-4 py-3 transition-colors before:absolute before:inset-y-0 before:left-0 before:w-0.5 sm:px-5 ${indicatorTone}`}
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
                  <span className="min-w-0 break-words">
                    {t("byName", { name: djName })}
                  </span>
                ) : null}
                {registeredByName && (
                  <span className="min-w-0 break-words">
                    {t("registeredByName", { name: registeredByName })}
                  </span>
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

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {guest.status === "pending" && (
            <>
              <span className="sr-only">{t("waitingStatus")}</span>
              {onCheck && (
                <Button
                  onClick={onCheck}
                  isLoading={isCheckLoading}
                  variant="confirm"
                  size="md"
                  className="w-28 px-3 sm:w-36 sm:px-4"
                >
                  {t("checkIn")}
                </Button>
              )}

              {mode === "registration" && onDelete && (
                <Button
                  ref={deleteTriggerRef}
                  onClick={() => setDeleteConfirmation(confirmationKey)}
                  aria-expanded={isInlineDeleteOpen}
                  aria-controls={isInlineDeleteOpen ? confirmationId : undefined}
                  isLoading={isDeleteLoading}
                  disabled={isDeleteDisabled}
                  variant="danger"
                  className="min-w-20 px-3 sm:px-4"
                >
                  {t("delete")}
                </Button>
              )}

              {mode === "operations" && onDelete && (
                <Button
                  ref={deleteTriggerRef}
                  onClick={() => setDeleteConfirmation(confirmationKey)}
                  aria-expanded={isInlineDeleteOpen}
                  aria-controls={isInlineDeleteOpen ? confirmationId : undefined}
                  isLoading={isDeleteLoading}
                  disabled={isDeleteDisabled}
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
                  className="w-28 px-3 sm:w-36 sm:px-4"
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
                  ref={deleteTriggerRef}
                  onClick={() => setDeleteConfirmation(confirmationKey)}
                  isLoading={isDeleteLoading}
                  disabled={isDeleteDisabled}
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
      {isInlineDeleteOpen && (
        <div
          id={confirmationId}
          role="group"
          aria-label={t("deleteGuestConfirm", { name: guest.name })}
          className="mt-3 border-t border-border-default pt-3"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !isDeleteLoading) {
              event.preventDefault();
              event.stopPropagation();
              cancelDelete();
            }
          }}
        >
          <p className="text-sm text-text-muted">
            {t("deleteGuestConfirm", { name: guest.name })}
          </p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button ref={cancelDeleteRef} variant="outline" onClick={cancelDelete} disabled={isDeleteLoading}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={isDeleteLoading} disabled={isDeleteDisabled}>
              {t("delete")}
            </Button>
          </div>
        </div>
      )}
    </article>
      {isDeleteConfirmOpen && guest.status === "checked" && (
        <ConfirmDialog
          open
          title={t("deleteGuestConfirm", { name: guest.name })}
          description={t("removeGuestConfirm")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmation(null)}
          isLoading={isDeleteLoading}
          confirmDisabled={isDeleteDisabled}
        />
      )}
    </>
  );
};

export default GuestListCard;
