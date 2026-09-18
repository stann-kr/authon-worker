import React, { useContext, useEffect, useId, useRef, useState } from "react";
import Button from "./Button";
import Icon from "./Icon";
import StatusLabel from "./StatusLabel";
import ConfirmDialog from "./ConfirmDialog";
import { RosterSelection } from "./guests/RosterView";
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
  isEntryDisabled?: boolean;
  isDeleteLoading?: boolean;
  isDeleteDisabled?: boolean;
  deleteDisabledReason?: string;
  deleteError?: string;
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
  isEntryDisabled = false,
  isDeleteLoading = false,
  isDeleteDisabled = false,
  deleteDisabledReason,
  deleteError,
}) => {
  const t = useTranslations("Common");
  const rosterT = useTranslations("Roster");
  const selection = useContext(RosterSelection);
  const [localDetail, setLocalDetail] = useState(false);
  const isDetailOpen = selection ? selection.selectedId === guest.id : localDetail;
  const toggleDetail = () => {
    if (isDeleteLoading) return;
    if (selection) selection.select(isDetailOpen ? null : guest.id);
    else setLocalDetail((open) => !open);
  };
  const closeDetail = () => selection ? selection.select(null) : setLocalDetail(false);
  const [undoConfirmation, setUndoConfirmation] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLElement>(null);
  const restoreFocusAfterDeleteRef = useRef(false);
  const confirmationId = useId();
  const detailId = useId();
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const confirmationKey = `${guest.id}:${guest.status}`;
  const isDeleteConfirmOpen = Boolean(
    onDelete &&
      guest.status !== "deleted" &&
      deleteConfirmation === confirmationKey,
  );
  const isInlineDeleteOpen = isDeleteConfirmOpen && mode === "registration" && guest.status === "pending";

  useEffect(() => {
    if (undoConfirmation && undoConfirmation !== confirmationKey) setUndoConfirmation(null);
    if (deleteConfirmation && (deleteConfirmation !== confirmationKey || !onDelete)) {
      setDeleteConfirmation(null);
      if (document.activeElement === document.body) {
        rowRef.current?.focus({ preventScroll: true });
      }
    }
  }, [confirmationKey, deleteConfirmation, onDelete, undoConfirmation]);

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
  const handleDelete = () => {
    if (!onDelete || !isDeleteConfirmOpen || isDeleteDisabled || isDeleteLoading) return;
    restoreFocusAfterDeleteRef.current = true;
    rowRef.current?.focus({ preventScroll: true });
    setDeleteConfirmation(null);
    onDelete();
  };

  return (
    <>
    <article
      ref={rowRef}
      tabIndex={-1}
      className="product-guest-row"
      data-status={guest.status}
      data-selected={isDetailOpen}
      data-mode={mode}
    >
      <div className="product-guest-line">
        {/* A stretched disclosure and separate raised actions avoid nested buttons. */}
        <button type="button" ref={disclosureRef} className="product-guest-disclosure" onClick={toggleDetail}
          aria-label={[guest.name, djName, registeredByName !== djName ? registeredByName : null].filter(Boolean).join(" ")}
          aria-controls={detailId} aria-expanded={isDetailOpen} aria-disabled={isDeleteLoading} />
        <div className="product-guest-identity">
          <span className="product-guest-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <span className="product-guest-name">
            <strong>{guest.name}</strong>
            {(djName || registeredByName) && <small>{djName || registeredByName}</small>}
          </span>
        </div>

        <div className="product-guest-actions">
          {guest.status === "pending" && (
            <>
              <span className="sr-only">{t("waitingStatus")}</span>
              {onCheck && (
                <Button
                  onClick={onCheck}
                  disabled={isEntryDisabled || isDeleteLoading}
                  isLoading={isCheckLoading}
                  variant="confirm"
                  size="md"
                  className="min-w-16"
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
            </>
          )}

          {guest.status === "checked" && (
            <>
              <span className="sr-only">{t("checkedInStatus")}</span>
              {onUndo && (
                <Button
                  onClick={() => setUndoConfirmation(confirmationKey)}
                  disabled={isEntryDisabled || isDeleteLoading}
                  isLoading={isUndoLoading}
                  variant="outline"
                  size="md"
                  leftIcon={<Icon name="undo" size={16} />}
                  className="min-w-16"
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

            </>
          )}

          {guest.status === "deleted" && (
            <StatusLabel tone="neutral">
              {t("removed")}
            </StatusLabel>
          )}
        </div>
        {mode === "operations" && <>
          <div className="product-guest-owner" aria-hidden="true"><span>{djName || "—"}</span>
            {registeredByName && <small>{registeredByName}</small>}
          </div>
          <span className="product-guest-status" aria-hidden="true">
            {guest.status === "checked" ? <><Icon name="check" size={14} />{guest.checkInTime ? formatTime(guest.checkInTime) : rosterT("checked")}</>
              : guest.status === "pending" ? rosterT("pending") : t("removed")}
          </span>
        </>}
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
      <div id={detailId} className="product-guest-detail" data-open={isDetailOpen}
        role="region" aria-label={guest.name} aria-hidden={!isDetailOpen} inert={!isDetailOpen}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || isDeleteLoading || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          closeDetail();
          disclosureRef.current?.focus({ preventScroll: true });
        }}>
        <div className="product-guest-detail-clip"><div className="product-guest-detail-content">
        <StatusLabel appearance="inline" tone={guest.status === "checked" ? "checked" : guest.status === "pending" ? "waiting" : "neutral"}>
          {guest.status === "checked" ? t("checkedIn") : guest.status === "pending" ? t("waitingStatus") : t("removed")}
        </StatusLabel>
        <dl className="product-detail-list" aria-label={rosterT("detail")}>
          {djName && <div><dt>{rosterT("owner")}</dt><dd>{djName}</dd></div>}
          {(accountKind === "shared" || registeredByName) && <div><dt>{rosterT("operator")}</dt><dd>{registeredByName || "—"}</dd></div>}
          {showRegisteredAt && guest.createdAt && <div><dt>{t("registered")}</dt><dd><time dateTime={guest.createdAt}>{formatTime(guest.createdAt)}</time></dd></div>}
          {guest.checkInTime && <div><dt>{t("checkedIn")}</dt><dd><time dateTime={guest.checkInTime}>{formatTime(guest.checkInTime)}</time></dd></div>}
        </dl>
        {mode === "operations" && onDelete && guest.status !== "deleted" && <div className="product-guest-detail-actions">
          <Button ref={deleteTriggerRef} variant="danger" onClick={() => setDeleteConfirmation(confirmationKey)}
            disabled={isDeleteDisabled} isLoading={isDeleteLoading}>
            {t("deleteGuest")}
          </Button>
          {deleteError && <p className="mt-2 text-sm text-status-danger" role="alert">{deleteError}</p>}
          {isDeleteDisabled && deleteDisabledReason && <p className="mt-2 text-sm text-text-muted" role="status">{deleteDisabledReason}</p>}
        </div>}
        </div></div>
      </div>
      {onUndo && undoConfirmation === confirmationKey && guest.status === "checked" && <ConfirmDialog open
        title={rosterT("undoTitle")} description={rosterT("undoDescription", { name: guest.name })}
        confirmLabel={rosterT("undoConfirm")} cancelLabel={t("cancel")} isLoading={isUndoLoading}
        confirmDisabled={isEntryDisabled}
        onCancel={() => setUndoConfirmation(null)} onConfirm={() => { if (isEntryDisabled) return; setUndoConfirmation(null); onUndo(); }} />}
      {isDeleteConfirmOpen && !isInlineDeleteOpen && (
        <ConfirmDialog
          open
          title={t("deleteGuestConfirm", { name: guest.name })}
          description={guest.status === "checked" ? t("removeGuestConfirm") : undefined}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmation(null)}
          isLoading={isDeleteLoading}
          confirmDisabled={isDeleteDisabled}
        />
      )}
    </article>
    </>
  );
};

export default GuestListCard;
