"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocalStorage } from "../../../lib/hooks";
import Sheet from "@/components/overlays/Sheet";
import RecordList, { useRecordDetail } from "@/components/records/RecordList";
import InviteUser from "./InviteUser";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import PanelHeader from "../../../components/PanelHeader";
import RoleLabel from "../../../components/RoleLabel";
import Alert from "../../../components/Alert";
import Skeleton from "../../../components/Skeleton";
import OperationsLayout from "../../../components/OperationsLayout";
import OperationalSectionNav from "../../../components/OperationalSectionNav";
import ConfirmDialog from "../../../components/ConfirmDialog";
import Button from "../../../components/Button";
import EmptyState from "../../../components/EmptyState";
import {
  fetchManagedUsersByVenue,
  fetchUserAuditEvents,
  updateUserProfile,
  deleteUserViaEdge,
  issueManagedPasswordLinkViaEdge,
} from "../../../lib/api/users";
import type { User } from "@/lib/users/types";
import { useLocale, useTranslations } from "next-intl";
import { hasAccess, isVenueManagedRole } from "@/lib/users/policy";
import { formatVenueDateTime } from "@/lib/date";
import { shouldShowEmptyState } from "@/lib/ui/async-list-state";
import {
  useUserDirectoryController,
  type StatusFilter,
  type UserDirectoryControllerActions,
} from "./useUserDirectoryController";

export type UserManagementSection = "create" | "users";

const USER_DIRECTORY_ACTIONS: UserDirectoryControllerActions = Object.freeze({
  fetchManagedUsersByVenue,
  fetchUserAuditEvents,
  updateUserProfile,
  deleteUserViaEdge,
  issueManagedPasswordLinkViaEdge,
});

interface UserManagementProps {
  activeSection?: UserManagementSection;
  onActiveSectionChange?: (section: UserManagementSection) => void;
  showSectionNavigation?: boolean;
}

export default function UserManagement({
  activeSection,
  onActiveSectionChange,
  showSectionNavigation = true,
}: UserManagementProps = {}) {
  const t = useTranslations("UserAdmin");
  const commonT = useTranslations("Common");
  const locale = useLocale();
  const [internalActiveSection, setInternalActiveSection] =
    useLocalStorage<UserManagementSection>(
    "usermgmt:activeTab",
    "create",
  );
  const activeTab = activeSection ?? internalActiveSection;
  const setActiveTab = useCallback(
    (section: UserManagementSection) => {
      if (onActiveSectionChange) {
        onActiveSectionChange(section);
        return;
      }
      setInternalActiveSection(section);
    },
    [onActiveSectionChange, setInternalActiveSection],
  );
  const {
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    user: currentUser,
    currentVenue,
  } = useVenueSelector();

  const effectiveVenueId = isSuperAdmin
    ? selectedVenueId
    : currentUser?.venue_id;

  useEffect(() => {
    const isKnownTab = ["create", "users"].includes(activeTab as string);
    if (!isKnownTab) {
      setActiveTab("create");
    }
  }, [activeTab, isSuperAdmin, setActiveTab]);

  const {
    busyUserId,
    closePasswordLink,
    confirmPendingUserAction,
    currentUsers,
    directoryFocusFallbackRef,
    filteredUsers,
    handleUserUpdate,
    isCurrentScopeLoading,
    isUserMutationPending,
    isSharingPasswordLink,
    listState,
    loadError,
    loadUsers,
    passwordLinkPanelRef,
    pendingUserAction,
    requestActiveChange,
    roleFilter,
    scopedAuditEvents,
    scopedFeedback,
    scopedPasswordLink,
    scopedUsers,
    searchQuery,
    setPendingUserAction,
    setRoleFilter,
    setSearchQuery,
    setStatusFilter,
    sharePasswordLink,
    statusFilter,
  } = useUserDirectoryController({
    actions: USER_DIRECTORY_ACTIONS,
    effectiveVenueId,
    isActive: activeTab === "users",
    isSuperAdmin,
  });

  const formatActivityDate = (
    value: string,
    venueId?: string | null,
  ): string =>
    formatVenueDateTime(value, {
      locale: locale === "ko" ? "ko-KR" : "en-US",
      timeZone:
        venues.find((venue) => venue.id === venueId)?.timezone ??
        currentVenue?.timezone,
    }) ?? "-";

  const resolveAuditUserName = (userId: string | null): string => {
    if (!userId) return t("systemActor");
    if (currentUser?.id === userId) return currentUser.name;
    return scopedUsers.find((user) => user.id === userId)?.name || t("unknownUser");
  };

  const getAuditActionLabel = (action: string): string => {
    switch (action) {
      case "created":
        return t("audit_created");
      case "role_changed":
        return t("audit_role_changed");
      case "deactivated":
        return t("audit_deactivated");
      case "reactivated":
        return t("audit_reactivated");
      case "user_updated":
        return t("audit_user_updated");
      case "password_reset_required":
        return t("audit_password_reset_required");
      case "password_reset_cancelled":
        return t("audit_password_reset_cancelled");
      case "password_setup_completed":
        return t("audit_password_setup_completed");
      case "password_reset_completed":
        return t("audit_password_reset_completed");
      case "password_reset_request_rejected":
        return t("audit_password_reset_request_rejected");
      case "invitation_reissued":
        return t("audit_invitation_reissued");
      case "password_reset_link_issued":
        return t("audit_password_reset_link_issued");
      case "password_changed":
        return t("audit_password_changed");
      case "deleted":
        return t("audit_deleted");
      default:
        return t("audit_unknown");
    }
  };

  const isPendingInvitationReissue =
    pendingUserAction?.kind === "reset-password" &&
    pendingUserAction.user.migrationStatus === "pending_reset" &&
    !pendingUserAction.user.passwordSetAt;
  const pendingActionTitle = pendingUserAction
    ? pendingUserAction.kind === "toggle"
      ? pendingUserAction.user.active
        ? t("deactivateTitle")
        : t("activateTitle")
      : pendingUserAction.kind === "reset-password"
        ? isPendingInvitationReissue
          ? t("reissueInvitationTitle")
          : t("resetPasswordTitle")
        : t("deleteTitle")
    : "";
  const pendingActionDescription = pendingUserAction
    ? pendingUserAction.kind === "toggle"
      ? pendingUserAction.user.active
        ? t("deactivateConfirm", { name: pendingUserAction.user.name })
        : t("activateConfirm")
      : pendingUserAction.kind === "reset-password"
        ? isPendingInvitationReissue
          ? t("reissueInvitationConfirm", { name: pendingUserAction.user.name })
          : t("resetPasswordConfirm", { name: pendingUserAction.user.name })
        : t("deleteConfirm", { name: pendingUserAction.user.name })
    : "";
  const pendingActionLabel = pendingUserAction
    ? pendingUserAction.kind === "toggle"
      ? pendingUserAction.user.active
        ? t("deactivate")
        : t("activate")
      : pendingUserAction.kind === "reset-password"
        ? isPendingInvitationReissue
          ? t("reissueInvitation")
          : t("issuePasswordResetLink")
        : t("delete")
    : "";

  return (
    <>
    <OperationsLayout
      variant="stacked"
      width={activeTab === "create" ? "form" : "full"}
      contextClassName="account-context"
      title={t("title")}
      headingLevel={null}
      dashboard={
        <>
        {/* Venue selector for super_admin */}
        {activeTab === "users" && isSuperAdmin && venues.length > 0 && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
            placeholder={t("allVenues")}
            className="account-venue"
          />
        )}
        {showSectionNavigation && (
          <OperationalSectionNav
            label={t("section")}
            items={[
              { id: "create", label: t("create"), icon: "user-add" },
              { id: "users", label: t("users"), icon: "user" },
            ]}
            activeId={activeTab}
            onChange={setActiveTab}
          />
        )}

        {activeTab === "users" && <dl className="account-summary">
          {[
            { label: t("totalUsers"), value: currentUsers.length },
            { label: t("ready"), value: currentUsers.filter((u) => u.active && (u.migrationStatus !== "pending_reset" || !!u.passwordSetAt)).length },
            { label: t("setupPending"), value: currentUsers.filter((u) => u.active && u.migrationStatus === "pending_reset" && !u.passwordSetAt).length },
            { label: t("inactive"), value: currentUsers.filter((u) => !u.active).length },
          ].map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{isCurrentScopeLoading ? "—" : item.value}</dd></div>)}
        </dl>}
        </>
      }
    >

      <div className="min-w-0">
        {activeTab === "create" && <div className="record-form"><InviteUser /></div>}
        {activeTab === "users" && (
          <div className="account-directory">
            <div className="account-directory-body">
              {loadError && <Alert type="error" message={loadError} className="mb-4" />}
              {scopedFeedback && (
                <Alert type={scopedFeedback.type} message={scopedFeedback.message} className="mb-4" />
              )}
              {scopedPasswordLink && <Sheet title={scopedPasswordLink.userName} onClose={closePasswordLink} busy={isSharingPasswordLink}>
                {scopedFeedback && <Alert type={scopedFeedback.type} message={scopedFeedback.message} />}
                <div
                  ref={passwordLinkPanelRef}
                  className="mb-4 border border-status-waiting/70 bg-status-waiting/10 p-4 outline-none"
                  role="region"
                  aria-labelledby="managed-password-link-title"
                  tabIndex={-1}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p id="managed-password-link-title" className="break-words text-sm font-semibold text-status-waiting">
                        {scopedPasswordLink.linkKind === "invitation"
                          ? t("invitationLinkTitle", {
                              name: scopedPasswordLink.userName,
                            })
                          : t("passwordResetLinkTitle", {
                              name: scopedPasswordLink.userName,
                            })}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-text-muted">
                        {scopedPasswordLink.linkKind === "invitation"
                          ? t("invitationLinkPanelHelp", {
                              expiresAt: formatActivityDate(
                                scopedPasswordLink.expiresAt,
                              ),
                            })
                          : t("passwordResetLinkPanelHelp", {
                              expiresAt: formatActivityDate(
                                scopedPasswordLink.expiresAt,
                              ),
                            })}
                      </p>
                      <a
                        href={scopedPasswordLink.passwordUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 block select-all break-all bg-canvas px-3 py-2 font-mono text-xs text-text-heading underline decoration-border-strong underline-offset-4 hover:text-text-heading"
                      >
                        {scopedPasswordLink.passwordUrl}
                      </a>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void sharePasswordLink()}
                        disabled={isSharingPasswordLink}
                        className="min-h-11 bg-action-primary px-3 py-2 text-xs font-semibold text-action-text hover:bg-action-hover"
                      >
                        {scopedPasswordLink.linkKind === "invitation"
                          ? t("shareInvitationLink")
                          : t("sharePasswordResetLink")}
                      </button>
                      <button
                        type="button"
                        onClick={closePasswordLink}
                        className="min-h-11 border border-border-default px-3 py-2 text-xs text-text-muted hover:text-text-heading"
                      >
                        {t("closeCredential")}
                      </button>
                    </div>
                  </div>
                </div>
              </Sheet>}

              <div className="account-filters">
                <div>
                  <label htmlFor="user-search" className="sr-only">
                    {t("searchUsers")}
                  </label>
                  <input
                    ref={directoryFocusFallbackRef}
                    id="user-search"
                    name="user-search"
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="app-field"
                    placeholder={t("searchPlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label htmlFor="user-role-filter" className="sr-only">
                    {t("roleFilter")}
                  </label>
                  <select
                    id="user-role-filter"
                    name="user-role-filter"
                    value={roleFilter}
                    autoComplete="off"
                    onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
                    className="app-field"
                  >
                    <option value="all">{t("allRoles")}</option>
                    {isSuperAdmin && (
                      <option value="super_admin">{t("roleSuperAdmin")}</option>
                    )}
                    <option value="venue_admin">{t("roleVenueAdmin")}</option>
                    <option value="door_staff">{t("roleDoorStaff")}</option>
                    <option value="staff">{t("roleStaff")}</option>
                    <option value="dj">{t("roleDj")}</option>
                    <option value="shared">{t("roleSharedAccount")}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="user-status-filter" className="sr-only">
                    {t("statusFilter")}
                  </label>
                  <select
                    id="user-status-filter"
                    name="user-status-filter"
                    value={statusFilter}
                    autoComplete="off"
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className="app-field"
                  >
                    <option value="current">{t("currentAccounts")}</option>
                    <option value="ready">{t("ready")}</option>
                    <option value="setup">{t("setupPending")}</option>
                    <option value="inactive">{t("inactive")}</option>
                    <option value="deleted">{t("deletedAccounts")}</option>
                  </select>
                </div>
                <PanelHeader
                  title={t("userList")}
                  count={filteredUsers.length}
                  onRefresh={loadUsers}
                  isLoading={isCurrentScopeLoading}
                />
              </div>

              {listState === "loading" ? (
                <Skeleton rows={5} />
              ) : shouldShowEmptyState(listState) ? (
                <EmptyState
                  icon="users"
                  message={
                    scopedUsers.length === 0
                      ? t("noUsers")
                      : t("noMatchingUsers")
                  }
                />
              ) : (
                <RecordList
                  key={`${effectiveVenueId}:${searchQuery}:${statusFilter}:${roleFilter}`}
                  aria-busy={isCurrentScopeLoading}
                  className={`${
                    isCurrentScopeLoading ? "pointer-events-none" : ""
                  }`}
                >
                  <table className="account-table" aria-label={t("userList")}>
                    <thead><tr>
                      <th scope="col" className="account-name-cell">{t("name")}</th>
                      <th scope="col" className="account-role-cell">{t("role")}</th>
                      <th scope="col" className="account-limit-cell">{t("guestLimit")}</th>
                      <th scope="col" className="account-door-cell">{t("door")}</th>
                      <th scope="col" className="account-status-cell">{t("status")}</th>
                      <th scope="col" className="account-login-cell">{t("lastLoginAt")}</th>
                    </tr></thead>
                    <tbody>{filteredUsers.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      actorRole={currentUser?.role || null}
                      currentUserId={currentUser?.id || null}
                      timeZone={
                        venues.find((venue) => venue.id === user.venueId)?.timezone ??
                        currentVenue?.timezone
                      }
                      venueName={venues.find((venue) => venue.id === user.venueId)?.name ?? currentVenue?.name}
                      activity={isSuperAdmin ? scopedAuditEvents.filter((event) => event.targetUserId === user.id).map((event) => ({
                        id: event.id, actor: resolveAuditUserName(event.actorUserId), action: getAuditActionLabel(event.action),
                        createdAt: event.createdAt, displayTime: formatActivityDate(event.createdAt, event.venueId),
                      })) : undefined}
                      activityUnavailable={listState === "partial"}
                      feedback={scopedFeedback}
                      isBusy={busyUserId === user.id}
                      actionsDisabled={
                        isUserMutationPending || isCurrentScopeLoading
                      }
                      onUpdate={handleUserUpdate}
                      onToggleActive={requestActiveChange}
                      onResetPassword={async (user) => {
                        setPendingUserAction({ kind: "reset-password", user });
                      }}
                      onDelete={async (user) =>
                        setPendingUserAction({ kind: "delete", user })
                      }
                    />
                  ))}</tbody>
                  </table>
                </RecordList>
              )}

              {isSuperAdmin && (
              <details className="account-audit">
                <summary>{t("activityTitle")} <span>{scopedAuditEvents.length}</span></summary>
                {listState === "partial" ? (
                  <p className="py-3 text-xs text-text-muted" role="status">{t("activityLoadFailed")}</p>
                ) : scopedAuditEvents.length === 0 ? (
                  <p className="border border-border-default bg-canvas p-4 text-xs text-text-muted">
                    {t("noActivity")}
                  </p>
                ) : (
                  <div className="max-h-80 divide-y divide-border-subtle overflow-y-auto border border-border-default bg-canvas">
                    {scopedAuditEvents.map((event) => (
                      <div key={event.id} className="grid gap-1 p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <p className="min-w-0 break-words text-text-body">
                          <span className="font-semibold text-text-heading">
                            {resolveAuditUserName(event.actorUserId)}
                          </span>{" "}
                          {getAuditActionLabel(event.action)}{" "}
                          <span className="font-semibold text-text-heading">
                            {resolveAuditUserName(event.targetUserId)}
                          </span>
                        </p>
                        <time className="shrink-0 font-mono text-text-dim" dateTime={event.createdAt}>
                          {formatActivityDate(event.createdAt, event.venueId)}
                        </time>
                      </div>
                    ))}
                  </div>
                )}
              </details>
              )}
            </div>
          </div>
        )}
      </div>
    </OperationsLayout>
      {pendingUserAction && (
        <ConfirmDialog
          open
          title={pendingActionTitle}
          description={pendingActionDescription}
          confirmLabel={pendingActionLabel}
          cancelLabel={commonT("cancel")}
          onConfirm={confirmPendingUserAction}
          onCancel={() => setPendingUserAction(null)}
          isLoading={isUserMutationPending}
          tone={
            pendingUserAction.kind === "reset-password" ||
            (pendingUserAction.kind === "toggle" && !pendingUserAction.user.active)
              ? "primary"
              : "danger"
          }
        />
      )}
    </>
  );
}

export function UserCard({
  user,
  actorRole,
  currentUserId,
  timeZone,
  venueName,
  activity,
  activityUnavailable = false,
  isBusy,
  feedback,
  actionsDisabled,
  onUpdate,
  onToggleActive,
  onResetPassword,
  onDelete,
}: {
  user: User;
  actorRole: User["role"] | null;
  currentUserId: string | null;
  timeZone?: string | null;
  venueName?: string;
  activity?: Array<{ id: string; actor: string; action: string; createdAt: string; displayTime: string }>;
  activityUnavailable?: boolean;
  isBusy: boolean;
  feedback?: { type: "success" | "error"; message: string } | null;
  actionsDisabled: boolean;
  onUpdate: (
    id: string,
    updates: {
      name?: string;
      guestLimit?: number | null;
      role?: User["role"];
      accountKind?: User["accountKind"];
      doorAccessEnabled?: boolean;
    },
  ) => Promise<boolean>;
  onToggleActive: (user: User) => Promise<void>;
  onResetPassword: (user: User) => Promise<void>;
  onDelete: (user: User) => Promise<void>;
}) {
  const t = useTranslations("UserAdmin");
  const commonT = useTranslations("Common");
  const locale = useLocale();
  const detail = useRecordDetail(user.id);
  const [isEditing, setIsEditing] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editRegionRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusEditorRef = useRef(false);
  const shouldRestoreEditButtonRef = useRef(false);
  const isSetupPending =
    user.active && user.migrationStatus === "pending_reset" && !user.passwordSetAt;
  const isSelf = user.id === currentUserId;
  const isDeleted = !!user.deletedAt;
  const canManage =
    !isSelf &&
    !isDeleted &&
    (actorRole === "super_admin" ||
      (actorRole === "venue_admin" && isVenueManagedRole(user.role)));
  const canEditRole = canManage && user.role !== "super_admin";
  const canEditDetails = canManage && user.role !== "super_admin";
  const editableRoles: User["role"][] =
    actorRole === "super_admin"
      ? ["venue_admin", "door_staff", "staff", "dj"]
      : ["door_staff", "staff", "dj"];
  const [editData, setEditData] = useState({
    name: user.name,
    role: user.role,
    accountKind: user.accountKind,
    doorAccessEnabled: user.doorAccessEnabled,
    guestLimit: user.guestLimit,
  });

  useEffect(() => {
    setEditData({
      name: user.name,
      role: user.role,
      accountKind: user.accountKind,
      doorAccessEnabled: user.doorAccessEnabled,
      guestLimit: user.guestLimit,
    });
  }, [
    user.accountKind,
    user.doorAccessEnabled,
    user.guestLimit,
    user.name,
    user.role,
  ]);

  useEffect(() => {
    if (actionsDisabled) return;
    const activeElement = document.activeElement;
    const focusWasLost =
      !activeElement ||
      activeElement === document.body ||
      !activeElement.isConnected;

    if (isEditing && shouldFocusEditorRef.current) {
      shouldFocusEditorRef.current = false;
      if (focusWasLost) nameInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!isEditing && shouldRestoreEditButtonRef.current) {
      shouldRestoreEditButtonRef.current = false;
      if (focusWasLost) editButtonRef.current?.focus({ preventScroll: true });
    }
  }, [actionsDisabled, isEditing]);

  const beginEditing = () => {
    shouldFocusEditorRef.current = true;
    setIsEditing(true);
  };

  const closeEditor = () => {
    shouldRestoreEditButtonRef.current = Boolean(
      editRegionRef.current?.contains(document.activeElement),
    );
    setIsEditing(false);
    setEditData({
      name: user.name,
      role: user.role,
      accountKind: user.accountKind,
      doorAccessEnabled: user.doorAccessEnabled,
      guestLimit: user.guestLimit,
    });
  };

  const handleSave = async () => {
    const saved = await onUpdate(user.id, {
      name: editData.name,
      guestLimit: editData.guestLimit,
      ...(canEditRole
        ? {
            role: editData.accountKind === "shared" ? "staff" : editData.role,
            accountKind: editData.accountKind,
            doorAccessEnabled:
              editData.accountKind === "shared" && editData.doorAccessEnabled,
          }
        : {}),
    });
    if (saved) {
      shouldRestoreEditButtonRef.current = Boolean(
        editRegionRef.current?.contains(document.activeElement),
      );
      setIsEditing(false);
    }
  };

  const formatDate = (value: string | null): string => {
    if (!value) return t("never");
    return (
      formatVenueDateTime(value, {
        locale: locale === "ko" ? "ko-KR" : "en-US",
        timeZone,
      }) ?? t("never")
    );
  };

  const statusLabel = isDeleted
    ? t("deletedStatus")
    : user.active
      ? isSetupPending
        ? t("setupPending")
        : t("active")
      : t("inactive");

  const dirty = isEditing && (editData.name !== user.name || editData.role !== user.role ||
    editData.accountKind !== user.accountKind || editData.doorAccessEnabled !== user.doorAccessEnabled || editData.guestLimit !== user.guestLimit);
  const doorAllowed = hasAccess({ role: user.role, accountKind: user.accountKind, doorAccessEnabled: user.doorAccessEnabled }, ["door"]);
  const role = user.accountKind === "shared" ? "shared" : user.role;
  return (
    <>
    <tr className="account-row" aria-busy={isBusy} data-selected={detail.open}>
      <td className="account-name-cell">
        <button type="button" className="account-open" onClick={detail.show} disabled={actionsDisabled} aria-haspopup="dialog" aria-expanded={detail.open}>
          <strong>{user.name}</strong><small>{isDeleted ? t("deletedAccount") : user.email}</small>
          <span className="account-mobile-role"><RoleLabel role={role} /></span>
        </button>
      </td>
      <td className="account-role-cell"><RoleLabel role={role} /></td>
      <td className="account-limit-cell">{user.guestLimit ?? "—"}</td>
      <td className="account-door-cell">{doorAllowed ? t("enabled") : t("disabled")}</td>
      <td className="account-status-cell"><span className="record-status" data-tone={isSetupPending ? "waiting" : !user.active || isDeleted ? "inactive" : "neutral"}>{statusLabel}</span></td>
      <td className="account-login-cell">{user.lastLoginAt ? <time dateTime={user.lastLoginAt}>{formatDate(user.lastLoginAt)}</time> : t("never")}</td>
    </tr>
    {detail.open && <Sheet title={user.name} presentation="detail" size="record" onClose={() => { closeEditor(); detail.close(); }} busy={actionsDisabled} dirty={dirty}>
      {feedback && <Alert type={feedback.type} message={feedback.message} />}
      {!isEditing ? (
        <>
          <div className="account-detail-top">
            <div className="account-detail-status"><RoleLabel role={role} /><span className="record-status">{statusLabel}</span></div>
            {canManage && <div className="account-detail-actions">
              {canEditDetails && <Button ref={editButtonRef} onClick={beginEditing} disabled={actionsDisabled} size="sm">{t("edit")}</Button>}
              <Button onClick={() => onResetPassword(user)} disabled={actionsDisabled || !user.active}
                title={!user.active ? t("inactiveResetUnavailable") : undefined} variant="outline" size="sm">
                {isSetupPending ? t("reissueInvitation") : t("issuePasswordResetLink")}
              </Button>
              <details className="account-more-actions" onKeyDown={(event) => {
                if (event.key === "Escape" && event.currentTarget.open) {
                  event.preventDefault(); event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}>
                <summary aria-label={t("moreActions")} aria-disabled={actionsDisabled} tabIndex={actionsDisabled ? -1 : 0}
                  onClick={(event) => { if (actionsDisabled) event.preventDefault(); }}>···</summary>
                <div>
                  <Button onClick={() => onToggleActive(user)} disabled={actionsDisabled}
                    variant={user.active ? "danger" : "secondary"} size="sm" fullWidth>{user.active ? t("deactivate") : t("activate")}</Button>
                  {!user.active && <Button onClick={() => onDelete(user)} disabled={actionsDisabled} variant="danger" size="sm" fullWidth>{t("delete")}</Button>}
                </div>
              </details>
            </div>}
          </div>
          <div className="account-detail-columns">
            <div className="account-detail-main">
              <section className="account-detail-section">
                <h3>{t("permissions")}</h3>
                <dl className="account-properties">
                  <div><dt>{t("accountType")}</dt><dd>{user.accountKind === "shared" ? t("sharedAccount") : t("personalAccount")}</dd></div>
                  <div><dt>{t("role")}</dt><dd><RoleLabel role={role} /></dd></div>
                  <div><dt>{t("doorAccess")}</dt><dd>{doorAllowed ? t("enabled") : t("disabled")}</dd></div>
                  <div><dt>{t("guestLimit")}</dt><dd>{user.guestLimit ?? "—"}</dd></div>
                </dl>
              </section>
              <section className="account-detail-section">
                <h3>{t("loginAndRecovery")}</h3>
                <dl className="account-properties">
                  <div><dt>{t("passwordSetup")}</dt><dd>{user.migrationStatus === "pending_reset" && !user.passwordSetAt ? t("setupPending") : t("passwordConfigured")}</dd></div>
                </dl>
                {isSetupPending && <p className="account-detail-notice">{t("firstLoginHelp")}</p>}
                {isSelf && !isDeleted && <p className="account-detail-notice">{t("selfManagementHelp")}</p>}
              </section>
              {actorRole === "super_admin" && activity && <section className="account-detail-section">
                <h3>{t("activityTitle")}</h3>
                {activityUnavailable ? <p className="account-detail-notice" role="status">{t("activityLoadFailed")}</p>
                  : activity.length === 0 ? <p className="account-detail-notice">{t("noRecentActivity")}</p>
                    : <ul className="account-activity">{activity.map((event) => <li key={event.id}>
                      <span>{event.actor} {event.action} {user.name}</span><time dateTime={event.createdAt}>{event.displayTime}</time>
                    </li>)}</ul>}
              </section>}
            </div>
            <section className="account-detail-section account-basic-information">
              <h3>{t("basicInformation")}</h3>
              <dl className="account-properties">
                <div><dt>{t("emailAddress")}</dt><dd>{isDeleted ? t("deletedAccount") : user.email}</dd></div>
                {venueName && <div><dt>{t("venue")}</dt><dd>{venueName}</dd></div>}
                <div><dt>{t("createdAt")}</dt><dd><time dateTime={user.createdAt}>{formatDate(user.createdAt)}</time></dd></div>
                <div><dt>{t("lastLoginAt")}</dt><dd>{user.lastLoginAt ? <time dateTime={user.lastLoginAt}>{formatDate(user.lastLoginAt)}</time> : t("never")}</dd></div>
              </dl>
            </section>
          </div>
        </>
      ) : (
        <div ref={editRegionRef} className="account-editor">
          <div>
            <label htmlFor={`user-name-${user.id}`} className="app-label">
              {t("name")}
            </label>
            <input
              ref={nameInputRef}
              id={`user-name-${user.id}`}
              name={`user-name-${user.id}`}
              type="text"
              value={editData.name}
              onChange={(event) => setEditData({ ...editData, name: event.target.value })}
              className="app-field"
              maxLength={100}
              disabled={actionsDisabled}
              autoComplete="off"
            />
          </div>
          {canEditRole && (
            <fieldset>
              <legend className="app-label">{t("accountType")}</legend>
              <div className="grid grid-cols-2 gap-3">
                {(["personal", "shared"] as const).map((accountKind) => (
                  <button
                    key={accountKind}
                    type="button"
                    aria-pressed={editData.accountKind === accountKind}
                    onClick={() =>
                      setEditData({
                        ...editData,
                        accountKind,
                        role: accountKind === "shared" ? "staff" : editData.role,
                        doorAccessEnabled:
                          accountKind === "shared" ? editData.doorAccessEnabled : false,
                      })
                    }
                    disabled={actionsDisabled}
                    className={`min-h-11 border p-2 text-xs font-medium transition-colors disabled:opacity-50 sm:p-3 ${
                      editData.accountKind === accountKind
                        ? "border-border-strong bg-surface-active text-text-heading"
                        : "border-border-strong bg-surface-raised text-text-muted hover:text-text-heading"
                    }`}
                  >
                    {accountKind === "shared" ? t("sharedAccount") : t("personalAccount")}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {canEditRole && editData.accountKind === "personal" && (
            <fieldset>
              <legend className="app-label">
                {t("role")}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                {editableRoles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={editData.role === role}
                    onClick={() =>
                      setEditData({ ...editData, role: role as User["role"] })
                    }
                    disabled={actionsDisabled}
                    className={`min-h-11 border p-2 text-xs font-medium transition-colors disabled:opacity-50 sm:p-3 ${
                      editData.role === role
                        ? "border-border-strong bg-surface-active text-text-heading"
                        : "bg-surface-raised text-text-muted border-border-strong hover:text-text-heading hover:border-border-strong"
                    }`}
                  >
                    <RoleLabel role={role} />
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {canEditRole && editData.accountKind === "shared" && (
            <label className="flex items-start gap-3 border border-border-default bg-surface-raised p-3">
              <input
                name={`user-door-access-${user.id}`}
                type="checkbox"
                checked={editData.doorAccessEnabled}
                onChange={(event) =>
                  setEditData({ ...editData, doorAccessEnabled: event.target.checked })
                }
                disabled={actionsDisabled}
                className="mt-0.5 h-4 w-4"
                autoComplete="off"
              />
              <span className="text-sm text-text-heading">{t("doorAccess")}</span>
            </label>
          )}

          <div>
            <label htmlFor={`user-guest-limit-${user.id}`} className="app-label">
              {t("guestLimit")}
            </label>
            <input
              id={`user-guest-limit-${user.id}`}
              name={`user-guest-limit-${user.id}`}
              type="number"
              value={editData.guestLimit ?? ""}
              onChange={(e) =>
                setEditData({
                  ...editData,
                  guestLimit: e.target.value ? parseInt(e.target.value) : null,
                })
              }
              className="app-field font-mono tabular-nums"
              min="0"
              max="999"
              disabled={actionsDisabled}
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              onClick={handleSave}
              disabled={actionsDisabled}
              size="sm"
              fullWidth
            >
              {t("save")}
            </Button>
            <Button
              type="button"
              disabled={actionsDisabled}
              onClick={closeEditor}
              variant="secondary"
              size="sm"
              fullWidth
            >
              {commonT("cancel")}
            </Button>
          </div>
        </div>
      )}
      </Sheet>}
    </>
  );
}
