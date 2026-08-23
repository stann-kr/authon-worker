"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocalStorage } from "../../../lib/hooks";
import InviteUser from "./InviteUser";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import StatGrid from "../../../components/StatGrid";
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
import { isVenueManagedRole } from "@/lib/users/policy";
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
    isSharingPasswordLink,
    listState,
    loadError,
    loadUsers,
    passwordLinkPanelRef,
    pendingUserAction,
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
        ? t("deactivateConfirm")
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
      title={t("title")}
      headingLevel={null}
      dashboard={
        <>
        {/* Venue selector for super_admin */}
        {isSuperAdmin && venues.length > 0 && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
            placeholder={t("allVenues")}
            className="app-panel p-4 sm:p-5"
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

        {activeTab === "users" && (
          <div className="app-panel space-y-3 p-3 sm:p-4">
            <StatGrid
              items={[
                {
                  label: t("totalUsers"),
                  value: currentUsers.length,
                  color: "default",
                },
                {
                  label: t("ready"),
                  value: currentUsers.filter(
                    (u) =>
                      u.active &&
                      (u.migrationStatus !== "pending_reset" ||
                        !!u.passwordSetAt),
                  ).length,
                  color: "default",
                },
                {
                  label: t("setupPending"),
                  value: currentUsers.filter(
                    (u) =>
                      u.active &&
                      u.migrationStatus === "pending_reset" &&
                      !u.passwordSetAt,
                  ).length,
                  color: "waiting",
                },
                {
                  label: t("inactive"),
                  value: currentUsers.filter((u) => !u.active).length,
                  color: "danger",
                },
              ]}
            />
            <div className="space-y-3">
              <StatGrid
                items={[
                  {
                    label: "DJ",
                    value: currentUsers.filter((u) => u.role === "dj").length,
                    color: "default",
                  },
                  {
                    label: t("staff"),
                    value: currentUsers.filter((u) => u.role === "staff").length,
                    color: "default",
                  },
                  {
                    label: t("door"),
                    value: currentUsers.filter((u) => u.role === "door_staff").length,
                    color: "default",
                  },
                  {
                    label: t("admin"),
                    value: currentUsers.filter((u) => u.role === "venue_admin").length,
                    color: "danger",
                  },
                ]}
              />
            </div>
          </div>
        )}
        </>
      }
    >

      <div className="min-w-0">
        {activeTab === "create" && <InviteUser />}
        {activeTab === "users" && (
          <div className="app-panel">
            <PanelHeader
              title={t("userList")}
              count={filteredUsers.length}
              onRefresh={loadUsers}
              isLoading={isCurrentScopeLoading}
            />
            <div className="p-4">
              {loadError && <Alert type="error" message={loadError} className="mb-4" />}
              {scopedFeedback && (
                <Alert type={scopedFeedback.type} message={scopedFeedback.message} className="mb-4" />
              )}
              {scopedPasswordLink && (
                <div
                  ref={passwordLinkPanelRef}
                  className="mb-4 border border-status-waiting/70 bg-status-waiting/10 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
              )}

              <div className="mb-4 grid gap-2 xl:grid-cols-[minmax(0,1fr)_180px_180px]">
                <div>
                  <label htmlFor="user-search" className="app-label">
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
                  <label htmlFor="user-role-filter" className="app-label">
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
                  <label htmlFor="user-status-filter" className="app-label">
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
                <div
                  aria-busy={isCurrentScopeLoading}
                  className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${
                    isCurrentScopeLoading ? "pointer-events-none" : ""
                  }`}
                >
                  {filteredUsers.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      actorRole={currentUser?.role || null}
                      currentUserId={currentUser?.id || null}
                      timeZone={
                        venues.find((venue) => venue.id === user.venueId)?.timezone ??
                        currentVenue?.timezone
                      }
                      isBusy={busyUserId === user.id}
                      onUpdate={handleUserUpdate}
                      onToggleActive={async (user) =>
                        setPendingUserAction({ kind: "toggle", user })
                      }
                      onResetPassword={async (user) => {
                        setPendingUserAction({ kind: "reset-password", user });
                      }}
                      onDelete={async (user) =>
                        setPendingUserAction({ kind: "delete", user })
                      }
                    />
                  ))}
                </div>
              )}

              {isSuperAdmin && (
              <div className="mt-6 border-t border-border-default pt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="type-panel-title">{t("activityTitle")}</h3>
                  <span className="font-mono text-xs text-text-dim">{scopedAuditEvents.length}</span>
                </div>
                {scopedAuditEvents.length === 0 ? (
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
              </div>
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
          isLoading={busyUserId === pendingUserAction.user.id}
          tone={
            pendingUserAction.kind === "reset-password" ||
            (pendingUserAction.kind === "toggle" && !pendingUserAction.user.active)
              ? "primary"
              : "danger"
          }
        >
          {pendingUserAction.kind === "reset-password" && (
            <div className="border border-border-default bg-surface p-3">
              <p className="text-sm font-semibold text-text-heading">
                {isPendingInvitationReissue
                  ? t("invitationLinkMethod")
                  : t("passwordResetLinkMethod")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {isPendingInvitationReissue
                  ? t("reissueInvitationHelp")
                  : t("issuePasswordResetLinkHelp")}
              </p>
            </div>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

function UserCard({
  user,
  actorRole,
  currentUserId,
  timeZone,
  isBusy,
  onUpdate,
  onToggleActive,
  onResetPassword,
  onDelete,
}: {
  user: User;
  actorRole: User["role"] | null;
  currentUserId: string | null;
  timeZone?: string | null;
  isBusy: boolean;
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
  const [isEditing, setIsEditing] = useState(false);
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
    if (saved) setIsEditing(false);
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

  return (
    <div className="app-panel p-4 sm:p-5" aria-busy={isBusy}>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="type-row-title break-words">
            {user.name}
          </h3>
          <p className="truncate text-text-muted font-mono text-xs sm:text-sm">
            {isDeleted ? t("deletedAccount") : user.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {isSetupPending && (
            <span
              className="border border-status-waiting/70 bg-status-waiting/10 px-2 py-1 font-mono text-xs uppercase tracking-wider text-status-waiting"
            >
              {t("setupPending")}
            </span>
          )}
          {isDeleted && (
            <span className="border border-border-strong bg-canvas px-2 py-1 font-mono text-xs uppercase tracking-wider text-text-dim">
              {t("deletedStatus")}
            </span>
          )}
          <span className="text-xs font-medium">
            <RoleLabel role={user.accountKind === "shared" ? "shared" : user.role} colored />
          </span>
        </div>
      </div>

      {!isEditing ? (
        <div>
          <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <p className="text-xs text-text-dim mb-1">
                {t("guestLimit")}
              </p>
              <p className="text-text-heading font-mono text-xs sm:text-sm">
                {user.guestLimit ?? "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-dim mb-1">
                {t("status")}
              </p>
              <p className={`font-mono text-xs sm:text-sm ${user.active && !isDeleted ? "text-text-heading" : "text-status-danger"}`}>
                {statusLabel}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-text-dim">{t("accountType")}</p>
              <p className="font-mono text-xs text-text-heading">
                {user.accountKind === "shared" ? t("sharedAccount") : t("personalAccount")}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-text-dim">{t("doorAccess")}</p>
              <p className="font-mono text-xs text-text-heading">
                {user.accountKind === "shared"
                  ? user.doorAccessEnabled
                    ? t("enabled")
                    : t("disabled")
                  : t("roleBased")}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-text-dim">{t("createdAt")}</p>
              <p className="font-mono text-xs text-text-heading">{formatDate(user.createdAt)}</p>
            </div>
            <div>
              <p className="mb-1 text-xs text-text-dim">{t("lastLoginAt")}</p>
              <p className="font-mono text-xs text-text-heading">{formatDate(user.lastLoginAt)}</p>
            </div>
          </div>
          {isSetupPending && (
            <div className="mb-3 border border-status-waiting/60 bg-status-waiting/10 p-3">
              <p className="text-xs font-semibold text-status-waiting">
                {t("firstLoginIncomplete")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {t("firstLoginHelp")}
              </p>
            </div>
          )}
          {isSelf && !isDeleted && (
            <p className="mb-3 border border-border-default bg-canvas p-3 text-xs text-text-muted">
              {t("selfManagementHelp")}
            </p>
          )}
          {canManage && (
            <div className="grid grid-cols-2 gap-2">
              {canEditDetails && (
                <Button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  disabled={isBusy}
                  variant="secondary"
                  size="sm"
                  fullWidth
                >
                  {t("edit")}
                </Button>
              )}
              <Button
                type="button"
                onClick={() => onResetPassword(user)}
                disabled={isBusy || !user.active}
                title={!user.active ? t("inactiveResetUnavailable") : undefined}
                variant="outline"
                size="sm"
                fullWidth
              >
                {isSetupPending
                  ? t("reissueInvitation")
                  : t("issuePasswordResetLink")}
              </Button>
              <Button
                type="button"
                onClick={() => onToggleActive(user)}
                disabled={isBusy}
                variant={user.active ? "danger" : "primary"}
                size="sm"
                fullWidth
              >
                {user.active ? t("deactivate") : t("activate")}
              </Button>
              {!user.active && (
                <Button
                  type="button"
                  onClick={() => onDelete(user)}
                  disabled={isBusy}
                  variant="danger"
                  size="sm"
                  fullWidth
                >
                  {t("delete")}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor={`user-name-${user.id}`} className="app-label">
              {t("name")}
            </label>
            <input
              id={`user-name-${user.id}`}
              name={`user-name-${user.id}`}
              type="text"
              value={editData.name}
              onChange={(event) => setEditData({ ...editData, name: event.target.value })}
              className="app-field"
              maxLength={100}
              disabled={isBusy}
              autoComplete="off"
            />
          </div>
          {canEditRole && (
            <fieldset>
              <legend className="app-label">{t("accountType")}</legend>
              <div className="grid grid-cols-2 gap-1">
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
                    disabled={isBusy}
                    className={`min-h-11 border p-2 text-xs font-medium transition-colors disabled:opacity-50 sm:p-3 ${
                      editData.accountKind === accountKind
                        ? "border-action-primary bg-action-primary text-action-text"
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
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {editableRoles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={editData.role === role}
                    onClick={() =>
                      setEditData({ ...editData, role: role as User["role"] })
                    }
                    disabled={isBusy}
                    className={`min-h-11 border p-2 text-xs font-medium transition-colors disabled:opacity-50 sm:p-3 ${
                      editData.role === role
                        ? "border-action-primary bg-action-primary text-action-text"
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
                disabled={isBusy}
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
              disabled={isBusy}
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={isBusy}
              size="sm"
              fullWidth
            >
              {t("save")}
            </Button>
            <Button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setIsEditing(false);
                setEditData({
                  name: user.name,
                  role: user.role,
                  accountKind: user.accountKind,
                  doorAccessEnabled: user.doorAccessEnabled,
                  guestLimit: user.guestLimit,
                });
              }}
              variant="secondary"
              size="sm"
              fullWidth
            >
              {commonT("cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
