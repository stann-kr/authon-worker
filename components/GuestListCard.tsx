import React, { useContext, useEffect, useId, useRef, useState } from "react";
import Button from "./Button";
import Icon from "./Icon";
import StatusLabel from "./StatusLabel";
import ConfirmDialog from "./ConfirmDialog";
import Sheet from "./overlays/Sheet";
import { restoreOverlayFocus } from "./overlays/restore-focus";
import { RosterSelection } from "./guests/RosterView";
import { formatVenueTime } from "@/lib/date";
import { useTranslations } from "next-intl";

export interface Guest {
  id: string;
  name: string;
  status: "pending" | "checked" | "deleted";
  checkInTime?: string | null;
  createdAt?: string | null;
  date?: string | null;
}


interface GuestListCardProps {
  guest: Guest;
  index: number;
  mode?: "registration" | "operations";
  djName?: string;
  accountKind?: "personal" | "shared";
  registeredByName?: string | null;
  showRegisteredAt?: boolean;
  timeZone?: string | null;
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
  timeZone,
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
  const formatTime = (value: string) => formatVenueTime(value, timeZone) ?? "—";
  const timestamp = (value?: string | null) => value ? <time dateTime={value}>{formatTime(value)}</time> : "—";
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
  const rowRef = useRef<HTMLElement>(null);
  const restoreFocusAfterDeleteRef = useRef(false);
  const detailId = useId();
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const confirmationKey = `${guest.id}:${guest.status}`;
  const isDeleteConfirmOpen = Boolean(
    onDelete &&
      guest.status !== "deleted" &&
      deleteConfirmation === confirmationKey,
  );
  const canDelete = onDelete && (mode === "operations" ? guest.status !== "deleted" : guest.status === "pending");
  const hasDetailInformation = Boolean(djName || accountKind === "shared" || registeredByName ||
    (showRegisteredAt && guest.createdAt) || guest.checkInTime);

  useEffect(() => {
    if (undoConfirmation && undoConfirmation !== confirmationKey) setUndoConfirmation(null);
    if (deleteConfirmation && (!isDetailOpen || deleteConfirmation !== confirmationKey || !onDelete)) {
      setDeleteConfirmation(null);
      if (document.activeElement === document.body) {
        rowRef.current?.focus({ preventScroll: true });
      }
    }
  }, [confirmationKey, deleteConfirmation, isDetailOpen, onDelete, undoConfirmation]);

  useEffect(() => () => {
    if (!restoreFocusAfterDeleteRef.current || document.activeElement !== document.body) return;
    const mainContent = document.getElementById("main-content");
    if (mainContent && !mainContent.hasAttribute("tabindex")) mainContent.tabIndex = -1;
    restoreOverlayFocus(mainContent);
  }, []);

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
          {mode === "registration" && !isDetailOpen && <Icon name="chevron-down" size={16} className="text-text-muted" />}
        </div>
        {mode === "operations" && <>
          <div className="product-guest-owner" aria-hidden="true"><span>{djName || "—"}</span>
            {registeredByName && <small>{registeredByName}</small>}
          </div>
          <span className="product-guest-time product-guest-registered-time"><span className="sr-only">{rosterT("registeredAt")} </span>{timestamp(guest.createdAt)}</span>
          <span className="product-guest-time product-guest-checked-time"><span className="sr-only">{rosterT("checkedInAt")} </span>{timestamp(guest.status === "checked" ? guest.checkInTime : null)}</span>
          <span className="product-guest-status" aria-hidden="true">
            {guest.status === "checked" ? <><Icon name="check" size={14} /><span className="product-guest-status-compact">{guest.checkInTime ? formatTime(guest.checkInTime) : rosterT("checked")}</span><span className="product-guest-status-wide">{rosterT("checked")}</span></>
              : guest.status === "pending" ? rosterT("pending") : t("removed")}
          </span>
        </>}
      </div>
      <Sheet id={detailId} open={isDetailOpen} title={guest.name} onClose={() => {
        setDeleteConfirmation(null);
        closeDetail();
      }} busy={isDeleteLoading}>
        <StatusLabel appearance="inline" tone={guest.status === "checked" ? "checked" : guest.status === "pending" ? "waiting" : "neutral"}>
          {guest.status === "checked" ? t("checkedIn") : guest.status === "pending" ? t("waitingStatus") : t("removed")}
        </StatusLabel>
        {hasDetailInformation && <dl className="product-detail-list" aria-label={rosterT("detail")}>
          {djName && <div><dt>{rosterT("owner")}</dt><dd>{djName}</dd></div>}
          {(accountKind === "shared" || registeredByName) && <div><dt>{rosterT("operator")}</dt><dd>{registeredByName || "—"}</dd></div>}
          {showRegisteredAt && guest.createdAt && <div><dt>{t("registered")}</dt><dd><time dateTime={guest.createdAt}>{formatTime(guest.createdAt)}</time></dd></div>}
          {guest.checkInTime && <div><dt>{t("checkedIn")}</dt><dd><time dateTime={guest.checkInTime}>{formatTime(guest.checkInTime)}</time></dd></div>}
        </dl>}
        {canDelete && <div className="product-guest-detail-actions">
          <div hidden={isDeleteConfirmOpen}>
            <Button variant="danger" onClick={() => setDeleteConfirmation(confirmationKey)}
              disabled={isDeleteDisabled} isLoading={isDeleteLoading}>
              {t("deleteGuest")}
            </Button>
          </div>
          {deleteError && <p className="mt-2 text-sm text-status-danger" role="alert">{deleteError}</p>}
          {isDeleteDisabled && deleteDisabledReason && <p className="mt-2 text-sm text-text-muted" role="status">{deleteDisabledReason}</p>}
          {isDeleteConfirmOpen && (
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
        </div>}
      </Sheet>
      {onUndo && undoConfirmation === confirmationKey && guest.status === "checked" && <ConfirmDialog open
        title={rosterT("undoTitle")} description={rosterT("undoDescription", { name: guest.name })}
        confirmLabel={rosterT("undoConfirm")} cancelLabel={t("cancel")} isLoading={isUndoLoading}
        confirmDisabled={isEntryDisabled}
        onCancel={() => setUndoConfirmation(null)} onConfirm={() => { if (isEntryDisabled) return; setUndoConfirmation(null); onUndo(); }} />}
    </article>
    </>
  );
};

export default GuestListCard;
