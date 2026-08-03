"use client";

import { useState, useEffect, useCallback } from "react";
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
  fetchUsersByVenue,
  updateUserProfile,
  deleteUserViaEdge,
} from "../../../lib/api/users";
import type { User } from "../../../lib/api/types";

export default function UserManagement() {
  const [activeTab, setActiveTab] = useLocalStorage<"create" | "users" | "migrate">(
    "usermgmt:activeTab",
    "create",
  );
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

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
    if (!isSuperAdmin && activeTab === "migrate") {
      setActiveTab("create");
    }
  }, [activeTab, isSuperAdmin, setActiveTab]);

  const loadUsers = useCallback(async () => {
    if (!effectiveVenueId && !isSuperAdmin) return;
    setIsLoading(true);
    setLoadError("");
    try {
      const { data, error } = await fetchUsersByVenue(
        isSuperAdmin ? effectiveVenueId || null : effectiveVenueId,
      );
      if (error) {
        console.error("Failed to load users:", error);
        setLoadError("Unable to load users. Please try again.");
      } else if (data) {
        setUsers(data);
      }
    } catch (error) {
      console.error("Failed to load users:", error);
      setLoadError("Unable to load users. Please check your connection.");
    } finally {
      setIsLoading(false);
    }
  }, [effectiveVenueId, isSuperAdmin]);

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
      role?: string;
    },
  ) => {
    try {
      const { error } = await updateUserProfile(userId, updates);
      if (error) {
        console.error("Failed to update user:", error);
        alert("Failed to update user.");
      } else {
        await loadUsers();
      }
    } catch (error) {
      console.error("Failed to update user:", error);
    }
  };

  const handleUserDelete = async (userId: string) => {
    if (!confirm("Delete this user? This action cannot be undone.")) return;
    try {
      const { error } = await deleteUserViaEdge(userId);
      if (error) {
        console.error("Failed to delete user:", error);
        alert(error || "Failed to delete user.");
      } else {
        await loadUsers();
      }
    } catch (error: unknown) {
      console.error("Failed to delete user:", error);
      alert(error instanceof Error ? error.message : "Failed to delete user.");
    }
  };

  const getTabInfo = () => {
    switch (activeTab) {
      case "create":
        return {
          title: "Create user",
          description: "Create new staff accounts",
        };
      case "users":
        return { title: "Users", description: "Manage existing users" };
      case "migrate":
        return { title: "Migration", description: "Legacy user data import" };
      default:
        return { title: "", description: "" };
    }
  };

  const tabInfo = getTabInfo();

  return (
    <OperationsLayout
      title="Admin user management"
      dashboard={
        <>
        {/* Venue selector for super_admin */}
        {isSuperAdmin && venues.length > 0 && (
          <VenueSelector
            venues={venues}
            selectedVenueId={selectedVenueId}
            onVenueChange={setSelectedVenueId}
            placeholder="ALL VENUES"
            className="app-panel p-4 sm:p-5"
          />
        )}
        <div className="app-panel p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="type-context-title mb-3">
              Section
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
                Create
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
                Users
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
                  Migrate
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
              {activeTab === "users" ? users.length : "-"}
            </div>
            <div className="text-xs font-medium text-text-muted">
              {activeTab === "users" ? "TOTAL USERS" : ""}
            </div>
          </div>

          {activeTab === "users" && (
            <div className="space-y-3">
              <StatGrid
                items={[
                  {
                    label: "DJ",
                    value: users.filter((u) => u.role === "dj").length,
                    color: "default",
                  },
                  {
                    label: "STAFF",
                    value: users.filter((u) => u.role === "staff").length,
                    color: "default",
                  },
                  {
                    label: "DOOR",
                    value: users.filter((u) => u.role === "door_staff").length,
                    color: "default",
                  },
                  {
                    label: "ADMIN",
                    value: users.filter((u) => u.role === "venue_admin").length,
                    color: "danger",
                  },
                ]}
              />
              <StatGrid
                items={[
                  {
                    label: "READY",
                    value: users.filter(
                      (u) => u.active && u.migrationStatus !== "pending_reset",
                    ).length,
                    color: "default",
                  },
                  {
                    label: "SETUP PENDING",
                    value: users.filter(
                      (u) => u.active && u.migrationStatus === "pending_reset",
                    ).length,
                    color: "waiting",
                  },
                  {
                    label: "INACTIVE",
                    value: users.filter((u) => !u.active).length,
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
              title="User list"
              count={users.length}
              onRefresh={loadUsers}
              isLoading={isLoading}
            />
            <div className="p-4">
              {loadError && <Alert type="error" message={loadError} className="mb-4" />}
              {isLoading && users.length === 0 ? (
                <Skeleton rows={5} />
              ) : users.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-text-muted font-mono text-sm">
                    No users found.
                  </p>
                </div>
              ) : (
                <div
                  className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200 ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
                >
                  {users.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      canEditRole={isSuperAdmin}
                      onUpdate={handleUserUpdate}
                      onDelete={handleUserDelete}
                    />
                  ))}
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
  canEditRole,
  onUpdate,
  onDelete,
}: {
  user: User;
  canEditRole: boolean;
  onUpdate: (
    id: string,
    updates: {
      name?: string;
      guestLimit?: number | null;
      active?: boolean;
      role?: string;
    },
  ) => void;
  onDelete: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isSetupPending =
    user.active && user.migrationStatus === "pending_reset";
  const [editData, setEditData] = useState({
    role: user.role,
    guestLimit: user.guestLimit,
    active: user.active,
  });
  const handleSave = () => {
    const updates = canEditRole
      ? editData
      : {
          guestLimit: editData.guestLimit,
          active: editData.active,
        };
    onUpdate(user.id, updates);
    setIsEditing(false);
  };

  // Available roles for editing depend on current user
  const editableRoles = ["venue_admin", "door_staff", "staff", "dj"];

  return (
    <div
      className={`app-panel p-4 sm:p-5 transition-opacity duration-200 ${!user.active ? "opacity-60" : ""}`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="type-row-title font-mono tracking-wider">
            {user.name}
          </h3>
          <p className="text-text-muted font-mono text-xs sm:text-sm">
            {user.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isSetupPending && (
            <span
              className="border border-status-waiting/70 bg-status-waiting/10 px-2 py-1 font-mono text-xs uppercase tracking-wider text-status-waiting"
              aria-label="First login setup pending"
            >
              SETUP PENDING
            </span>
          )}
          <span className="text-xs font-medium">
            <RoleLabel role={user.role} colored />
          </span>
        </div>
      </div>

      {!isEditing ? (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <p className="text-xs text-text-dim mb-1">
                GUEST LIMIT
              </p>
              <p className="text-text-heading font-mono text-xs sm:text-sm">
                {user.guestLimit}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-dim mb-1">
                Status
              </p>
              <p
                className={`font-mono text-xs sm:text-sm ${user.active ? "text-text-heading" : "text-status-danger"}`}
              >
                {user.active ? "ACTIVE" : "INACTIVE"}
              </p>
            </div>
          </div>
          {isSetupPending && (
            <div className="mb-3 border border-status-waiting/60 bg-status-waiting/10 p-3">
              <p className="font-mono text-xs font-medium uppercase tracking-wider text-status-waiting">
                First login not completed
              </p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                This account must set a password through the first-login flow before normal sign-in.
              </p>
            </div>
          )}
          <div className={`grid gap-2 ${canEditRole ? "grid-cols-2" : "grid-cols-1"}`}>
            <button
              onClick={() => setIsEditing(true)}
              className="bg-surface-active hover:bg-border-strong text-text-heading text-xs font-medium py-2 sm:py-3 transition-colors"
            >
              EDIT
            </button>
            {canEditRole && (
              <button
                onClick={() => onDelete(user.id)}
                className="border border-status-danger/70 bg-status-danger/10 py-2 font-mono text-xs uppercase tracking-wider text-status-danger transition-colors hover:bg-status-danger/20 sm:py-3"
              >
                DELETE
              </button>
            )}
          </div>
          {!user.active && (
            <div className="mt-2">
              <button
                disabled
                title="Available after the email service is connected"
                className="w-full bg-surface text-text-dim border border-border-default text-xs font-medium py-2 sm:py-3 cursor-not-allowed"
              >
                EMAIL INVITE UNAVAILABLE
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {canEditRole && (
            <fieldset>
              <legend className="app-label">
                Role
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
                    className={`p-2 sm:p-3 border text-xs font-medium transition-colors ${
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

          <div>
            <label htmlFor={`user-guest-limit-${user.id}`} className="app-label">
              GUEST LIMIT
            </label>
            <input
              id={`user-guest-limit-${user.id}`}
              type="number"
              value={editData.guestLimit || ""}
              onChange={(e) =>
                setEditData({
                  ...editData,
                  guestLimit: e.target.value ? parseInt(e.target.value) : null,
                })
              }
              className="w-full bg-surface-raised border border-border-strong px-3 py-2 sm:py-3 text-text-heading font-mono text-sm focus:outline-none focus:border-border-focus"
              min="0"
              max="999"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={editData.active}
              onClick={() =>
                setEditData({ ...editData, active: !editData.active })
              }
              className={`flex-1 p-2 sm:p-3 border text-xs font-medium transition-colors ${
                editData.active
                  ? "bg-text-heading text-canvas border-text-heading"
                  : "border-status-danger bg-status-danger/10 text-status-danger"
              }`}
            >
              {editData.active ? "ACTIVE" : "INACTIVE"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleSave}
              className="bg-text-heading hover:bg-text-body text-canvas text-xs font-medium py-2 sm:py-3 transition-colors"
            >
              SAVE
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                setEditData({
                  role: user.role,
                  guestLimit: user.guestLimit,
                  active: user.active,
                });
              }}
              className="bg-surface-active hover:bg-border-strong text-text-heading text-xs font-medium py-2 sm:py-3 transition-colors"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
