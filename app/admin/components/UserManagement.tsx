"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocalStorage } from "../../../lib/hooks";
import InviteUser from "./InviteUser";
import LegacyUserMigration from "./LegacyUserMigration";
import VenueSelector, {
  useVenueSelector,
} from "../../../components/VenueSelector";
import StatGrid from "../../../components/StatGrid";
import PanelHeader from "../../../components/PanelHeader";
import RoleLabel from "../../../components/RoleLabel";
import Alert from "../../../components/Alert";
import Icon from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import OperationsLayout from "../../../components/OperationsLayout";
import {
  fetchManagedUsersByVenue,
  fetchUserAuditEvents,
  updateUserProfile,
  deleteUserViaEdge,
  requireFirstLoginPasswordSetup,
} from "../../../lib/api/users";
import type { User, UserAuditEvent } from "../../../lib/api/types";
import { useLocale, useTranslations } from "next-intl";
import { isVenueManagedRole } from "@/lib/users/policy";

type StatusFilter = "current" | "ready" | "setup" | "inactive" | "deleted";

type Feedback = { type: "success" | "error"; message: string } | null;

export default function UserManagement() {
  const t = useTranslations("UserAdmin");
  const locale = useLocale();
  const [activeTab, setActiveTab] = useLocalStorage<"create" | "users" | "migrate">(
    "usermgmt:activeTab",
    "create",
  );
  const [users, setUsers] = useState<User[]>([]);
  const [auditEvents, setAuditEvents] = useState<UserAuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "shared" | User["role"]>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("current");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [setupCredential, setSetupCredential] = useState<{
    userName: string;
    setupCode: string;
  } | null>(null);

  const {
    venues,
    selectedVenueId,
    setSelectedVenueId,
    isSuperAdmin,
    user: currentUser,
  } = useVenueSelector();

  const effectiveVenueId = isSuperAdmin
    ? selectedVenueId
    : currentUser?.venue_id;

  useEffect(() => {
    const isKnownTab = ["create", "users", "migrate"].includes(activeTab as string);
    if (!isKnownTab || (!isSuperAdmin && activeTab === "migrate")) {
      setActiveTab("create");
    }
  }, [activeTab, isSuperAdmin, setActiveTab]);

  useEffect(() => {
    setSetupCredential(null);
    setFeedback(null);
  }, [effectiveVenueId]);

  const loadUsers = useCallback(async () => {
    if (!effectiveVenueId && !isSuperAdmin) return;
    setIsLoading(true);
    setLoadError("");
    try {
      const requestedVenueId = isSuperAdmin
        ? effectiveVenueId || null
        : effectiveVenueId;
      const [userResult, auditResult] = await Promise.all([
        fetchManagedUsersByVenue(requestedVenueId),
        isSuperAdmin ? fetchUserAuditEvents(requestedVenueId) : Promise.resolve(null),
      ]);
      if (userResult.error) {
        console.error("Failed to load users:", userResult.error);
        setLoadError(t("loadFailed"));
      } else if (userResult.data) {
        setUsers(userResult.data);
      }
      if (auditResult?.error) {
        console.error("Failed to load user activity:", auditResult.error);
      } else if (auditResult?.data) {
        setAuditEvents(auditResult.data);
      } else if (!isSuperAdmin) {
        setAuditEvents([]);
      }
    } catch (error) {
      console.error("Failed to load users:", error);
      setLoadError(t("connectionLoadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [effectiveVenueId, isSuperAdmin, t]);

  useEffect(() => {
    if (activeTab === "users" && (effectiveVenueId || isSuperAdmin)) {
      loadUsers();
    }
  }, [activeTab, effectiveVenueId, isSuperAdmin, loadUsers]);

  const handleUserUpdate = async (
    userId: string,
    updates: {
      name?: string;
      guestLimit?: number | null;
      active?: boolean;
      role?: User["role"];
      accountKind?: User["accountKind"];
      doorAccessEnabled?: boolean;
    },
  ): Promise<boolean> => {
    setBusyUserId(userId);
    setFeedback(null);
    try {
      const { error } = await updateUserProfile(userId, updates);
      if (error) {
        console.error("Failed to update user:", error);
        setFeedback({ type: "error", message: getActionError(error) });
        return false;
      } else {
        await loadUsers();
        setFeedback({ type: "success", message: t("updated") });
        return true;
      }
    } catch (error) {
      console.error("Failed to update user:", error);
      setFeedback({ type: "error", message: t("updateFailed") });
      return false;
    } finally {
      setBusyUserId(null);
    }
  };

  const getActionError = useCallback((error: string): string => {
    const errorMessages: Record<string, string> = {
      CANNOT_MANAGE_SELF: t("cannotManageSelf"),
      FORBIDDEN: t("forbiddenAction"),
      INVALID_INPUT: t("invalidInput"),
      INVALID_ROLE: t("invalidRole"),
      LAST_SUPER_ADMIN: t("lastSuperAdmin"),
      USER_DELETED: t("alreadyDeleted"),
      USER_INACTIVE: t("inactiveResetUnavailable"),
      USER_MUST_BE_INACTIVE: t("deactivateBeforeDelete"),
      USER_NOT_FOUND: t("userNotFound"),
    };
    return errorMessages[error] || t("updateFailed");
  }, [t]);

  const handleActiveChange = async (user: User) => {
    if (!confirm(user.active ? t("deactivateConfirm") : t("activateConfirm"))) return;
    await handleUserUpdate(user.id, { active: !user.active });
  };

  const handlePasswordReset = async (user: User) => {
    if (!confirm(t("resetPasswordConfirm", { name: user.name }))) return;
    setBusyUserId(user.id);
    setFeedback(null);
    try {
      const { data, error } = await requireFirstLoginPasswordSetup(user.id);
      if (error) {
        setFeedback({ type: "error", message: getActionError(error) });
        return;
      }
      if (data) {
        setSetupCredential({ userName: user.name, setupCode: data.setupCode });
        setFeedback({ type: "success", message: t("resetPasswordReady") });
        await loadUsers();
      }
    } catch (error: unknown) {
      console.error("Failed to reset user password:", error);
      setFeedback({ type: "error", message: t("resetPasswordFailed") });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleUserDelete = async (user: User) => {
    if (!confirm(t("deleteConfirm", { name: user.name }))) return;
    setBusyUserId(user.id);
    setFeedback(null);
    try {
      const { error } = await deleteUserViaEdge(user.id);
      if (error) {
        console.error("Failed to delete user:", error);
        setFeedback({ type: "error", message: getActionError(error) });
      } else {
        await loadUsers();
        setFeedback({ type: "success", message: t("deleted") });
      }
    } catch (error: unknown) {
      console.error("Failed to delete user:", error);
      setFeedback({ type: "error", message: t("deleteFailed") });
    } finally {
      setBusyUserId(null);
    }
  };

  const copySetupCode = async () => {
    if (!setupCredential) return;
    try {
      await navigator.clipboard.writeText(setupCredential.setupCode);
      setFeedback({ type: "success", message: t("setupCodeCopied") });
    } catch {
      setFeedback({ type: "error", message: t("setupCodeCopyFailed") });
    }
  };

  const currentUsers = useMemo(
    () => users.filter((user) => !user.deletedAt),
    [users],
  );

  const filteredUsers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !normalizedQuery ||
        user.name.toLowerCase().includes(normalizedQuery) ||
        user.email.toLowerCase().includes(normalizedQuery);
      const matchesRole =
        roleFilter === "all" ||
        (roleFilter === "shared" ? user.accountKind === "shared" : user.role === roleFilter);
      const isSetupPending =
        user.active && user.migrationStatus === "pending_reset" && !user.passwordSetAt;
      const matchesStatus =
        statusFilter === "current"
          ? !user.deletedAt
          : statusFilter === "deleted"
            ? !!user.deletedAt
            : statusFilter === "inactive"
              ? !user.deletedAt && !user.active
              : statusFilter === "setup"
                ? !user.deletedAt && isSetupPending
                : !user.deletedAt && user.active && !isSetupPending;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, searchQuery, statusFilter, users]);

  const formatActivityDate = (value: string): string =>
    new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  const resolveAuditUserName = (userId: string | null): string => {
    if (!userId) return t("systemActor");
    if (currentUser?.id === userId) return currentUser.name;
    return users.find((user) => user.id === userId)?.name || t("unknownUser");
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
      case "password_setup_completed":
        return t("audit_password_setup_completed");
      case "password_reset_completed":
        return t("audit_password_reset_completed");
      case "deleted":
        return t("audit_deleted");
      default:
        return t("audit_unknown");
    }
  };

  const getTabInfo = () => {
    switch (activeTab) {
      case "create":
        return {
          title: t("createUser"),
          description: t("createDescription"),
        };
      case "users":
        return { title: t("users"), description: t("usersDescription") };
      case "migrate":
        return { title: t("migration"), description: t("migrationDescription") };
      default:
        return { title: "", description: "" };
    }
  };

  const tabInfo = getTabInfo();

  return (
    <OperationsLayout
      title={t("title")}
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
        <div className="app-panel p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="type-context-title mb-3">
              {t("section")}
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab("create")}
                className={`flex w-full items-center gap-2 p-3 text-left text-sm font-medium transition-colors ${
                  activeTab === "create"
                    ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                    : "bg-surface-raised text-text-muted hover:text-text-heading border border-border-default"
                }`}
              >
                <Icon name="user-add" size={17} />
                {t("create")}
              </button>
              <button
                onClick={() => setActiveTab("users")}
                className={`flex w-full items-center gap-2 p-3 text-left text-sm font-medium transition-colors ${
                  activeTab === "users"
                    ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                    : "bg-surface-raised text-text-muted hover:text-text-heading border border-border-default"
                }`}
              >
                <Icon name="user" size={17} />
                {t("users")}
              </button>
              {isSuperAdmin && (
                <button
                  onClick={() => setActiveTab("migrate")}
                  className={`flex w-full items-center gap-2 p-3 text-left text-sm font-medium transition-colors ${
                    activeTab === "migrate"
                      ? "border border-border-default border-l-2 border-l-action-primary bg-surface-raised text-text-heading"
                      : "bg-surface-raised text-text-muted hover:text-text-heading border border-border-default"
                  }`}
                >
                  <Icon name="database" size={17} />
                  {t("migrate")}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="app-panel p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="type-panel-title mb-1">
              {tabInfo.title}
            </h2>
            <p className="text-sm text-text-muted">
              {tabInfo.description}
            </p>
          </div>
          <div className="text-center mb-4">
            <div className="text-text-heading font-mono text-3xl sm:text-4xl tracking-wider">
              {activeTab === "users" ? currentUsers.length : "-"}
            </div>
            <div className="text-xs font-medium text-text-muted">
              {activeTab === "users" ? t("totalUsers") : ""}
            </div>
          </div>

          {activeTab === "users" && (
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
              <StatGrid
                items={[
                  {
                    label: t("ready"),
                    value: currentUsers.filter(
                      (u) => u.active && (u.migrationStatus !== "pending_reset" || !!u.passwordSetAt),
                    ).length,
                    color: "default",
                  },
                  {
                    label: t("setupPending"),
                    value: currentUsers.filter(
                      (u) => u.active && u.migrationStatus === "pending_reset" && !u.passwordSetAt,
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
            </div>
          )}
        </div>
        </>
      }
    >

      <div className="min-w-0">
        {activeTab === "create" && <InviteUser />}
        {activeTab === "migrate" && <LegacyUserMigration />}
        {activeTab === "users" && (
          <div className="app-panel">
            <PanelHeader
              title={t("userList")}
              count={filteredUsers.length}
              onRefresh={loadUsers}
              isLoading={isLoading}
            />
            <div className="p-4">
              {loadError && <Alert type="error" message={loadError} className="mb-4" />}
              {feedback && (
                <Alert type={feedback.type} message={feedback.message} className="mb-4" />
              )}
              {setupCredential && (
                <div className="mb-4 border border-status-waiting/70 bg-status-waiting/10 p-4" role="status">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-mono text-xs font-semibold uppercase tracking-wider text-status-waiting">
                        {t("setupCodeTitle", { name: setupCredential.userName })}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-text-muted">
                        {t("setupCodeHelp")}
                      </p>
                      <code className="mt-3 block select-all break-all bg-canvas px-3 py-2 font-mono text-base tracking-wider text-text-heading">
                        {setupCredential.setupCode}
                      </code>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={copySetupCode}
                        className="bg-action-primary px-3 py-2 text-xs font-semibold text-action-text hover:bg-action-hover"
                      >
                        {t("copySetupCode")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSetupCredential(null)}
                        className="border border-border-default px-3 py-2 text-xs text-text-muted hover:text-text-heading"
                      >
                        {t("closeSetupCode")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                <div>
                  <label htmlFor="user-search" className="app-label">
                    {t("searchUsers")}
                  </label>
                  <input
                    id="user-search"
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="app-field"
                    placeholder={t("searchPlaceholder")}
                  />
                </div>
                <div>
                  <label htmlFor="user-role-filter" className="app-label">
                    {t("roleFilter")}
                  </label>
                  <select
                    id="user-role-filter"
                    value={roleFilter}
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
                    value={statusFilter}
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

              {isLoading && users.length === 0 ? (
                <Skeleton rows={5} />
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-text-muted font-mono text-sm">
                    {users.length === 0 ? t("noUsers") : t("noMatchingUsers")}
                  </p>
                </div>
              ) : (
                <div
                  className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200 ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {filteredUsers.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      actorRole={currentUser?.role || null}
                      currentUserId={currentUser?.id || null}
                      isBusy={busyUserId === user.id}
                      onUpdate={handleUserUpdate}
                      onToggleActive={handleActiveChange}
                      onResetPassword={handlePasswordReset}
                      onDelete={handleUserDelete}
                    />
                  ))}
                </div>
              )}

              {isSuperAdmin && (
              <div className="mt-6 border-t border-border-default pt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="type-panel-title">{t("activityTitle")}</h3>
                    <p className="mt-1 text-xs text-text-muted">{t("activityDescription")}</p>
                  </div>
                  <span className="font-mono text-xs text-text-dim">{auditEvents.length}</span>
                </div>
                {auditEvents.length === 0 ? (
                  <p className="border border-border-default bg-canvas p-4 text-xs text-text-muted">
                    {t("noActivity")}
                  </p>
                ) : (
                  <div className="max-h-80 divide-y divide-border-subtle overflow-y-auto border border-border-default bg-canvas">
                    {auditEvents.map((event) => (
                      <div key={event.id} className="grid gap-1 p-3 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                        <p className="text-text-body">
                          <span className="font-semibold text-text-heading">
                            {resolveAuditUserName(event.actorUserId)}
                          </span>{" "}
                          {getAuditActionLabel(event.action)}{" "}
                          <span className="font-semibold text-text-heading">
                            {resolveAuditUserName(event.targetUserId)}
                          </span>
                        </p>
                        <time className="font-mono text-text-dim" dateTime={event.createdAt}>
                          {formatActivityDate(event.createdAt)}
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
  );
}

function UserCard({
  user,
  actorRole,
  currentUserId,
  isBusy,
  onUpdate,
  onToggleActive,
  onResetPassword,
  onDelete,
}: {
  user: User;
  actorRole: User["role"] | null;
  currentUserId: string | null;
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
    return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  };

  const statusLabel = isDeleted
    ? t("deletedStatus")
    : user.active
      ? isSetupPending
        ? t("setupPending")
        : t("active")
      : t("inactive");

  return (
    <div
      className={`app-panel p-4 sm:p-5 transition-opacity duration-200 ${!user.active || isDeleted ? "opacity-70" : ""}`}
      aria-busy={isBusy}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="min-w-0">
          <h3 className="type-row-title font-mono tracking-wider">
            {user.name}
          </h3>
          <p className="truncate text-text-muted font-mono text-xs sm:text-sm">
            {isDeleted ? t("deletedAccount") : user.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isSetupPending && (
            <span
              className="border border-status-waiting/70 bg-status-waiting/10 px-2 py-1 font-mono text-xs uppercase tracking-wider text-status-waiting"
              aria-label={t("firstLoginPending")}
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
                {user.guestLimit ?? "—"}
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
              <p className="font-mono text-xs font-medium uppercase tracking-wider text-status-waiting">
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
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  disabled={isBusy}
                  className="bg-surface-active py-2 text-xs font-medium text-text-heading transition-colors hover:bg-border-strong disabled:opacity-50 sm:py-3"
                >
                  {t("edit")}
                </button>
              )}
              <button
                type="button"
                onClick={() => onResetPassword(user)}
                disabled={isBusy || !user.active}
                title={!user.active ? t("inactiveResetUnavailable") : undefined}
                className="border border-border-default bg-canvas py-2 text-xs font-medium text-text-body transition-colors hover:border-border-strong hover:text-text-heading disabled:cursor-not-allowed disabled:opacity-40 sm:py-3"
              >
                {t("resetPassword")}
              </button>
              <button
                type="button"
                onClick={() => onToggleActive(user)}
                disabled={isBusy}
                className={`py-2 text-xs font-medium transition-colors disabled:opacity-50 sm:py-3 ${
                  user.active
                    ? "border border-status-danger/70 bg-status-danger/10 text-status-danger hover:bg-status-danger/20"
                    : "bg-action-primary text-action-text hover:bg-action-hover"
                }`}
              >
                {user.active ? t("deactivate") : t("activate")}
              </button>
              {!user.active && (
                <button
                  type="button"
                  onClick={() => onDelete(user)}
                  disabled={isBusy}
                  className="border border-status-danger/70 bg-status-danger/10 py-2 font-mono text-xs uppercase tracking-wider text-status-danger transition-colors hover:bg-status-danger/20 disabled:opacity-50 sm:py-3"
                >
                  {t("delete")}
                </button>
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
              type="text"
              value={editData.name}
              onChange={(event) => setEditData({ ...editData, name: event.target.value })}
              className="app-field"
              maxLength={100}
              disabled={isBusy}
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
                    className={`border p-2 text-xs font-medium transition-colors disabled:opacity-50 sm:p-3 ${
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
              <div className="grid grid-cols-4 gap-1">
                {editableRoles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={editData.role === role}
                    onClick={() =>
                      setEditData({ ...editData, role: role as User["role"] })
                    }
                    disabled={isBusy}
                    className={`p-2 sm:p-3 border text-xs font-medium transition-colors disabled:opacity-50 ${
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
                type="checkbox"
                checked={editData.doorAccessEnabled}
                onChange={(event) =>
                  setEditData({ ...editData, doorAccessEnabled: event.target.checked })
                }
                disabled={isBusy}
                className="mt-0.5 h-4 w-4"
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
              type="number"
              value={editData.guestLimit ?? ""}
              onChange={(e) =>
                setEditData({
                  ...editData,
                  guestLimit: e.target.value ? parseInt(e.target.value) : null,
                })
              }
              className="w-full bg-surface-raised border border-border-strong px-3 py-2 sm:py-3 text-text-heading font-mono text-sm focus:outline-none focus:border-border-focus"
              min="0"
              max="999"
              disabled={isBusy}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isBusy}
              className="bg-text-heading hover:bg-text-body text-canvas text-xs font-medium py-2 sm:py-3 transition-colors disabled:opacity-50"
            >
              {t("save")}
            </button>
            <button
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
              className="bg-surface-active hover:bg-border-strong text-text-heading text-xs font-medium py-2 sm:py-3 transition-colors disabled:opacity-50"
            >
              {commonT("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
