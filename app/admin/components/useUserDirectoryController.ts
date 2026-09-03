"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  useLatestRequestGuard,
  useScopedOperationGuard,
} from "@/lib/hooks";
import { useSectionLoadingTask } from "@/components/RouteTransitionProvider";
import { deriveAsyncListState } from "@/lib/ui/async-list-state";
import { shareUrl, toUrlShareData } from "@/lib/share/url";
import type { ApiResponse } from "@/lib/api/response";
import type { ScopedOperation } from "@/lib/latest-request";
import type {
  ManagedPasswordLinkResult,
  User,
  UserAuditEvent,
  UserProfileUpdateInput,
} from "@/lib/users/types";

export type StatusFilter =
  | "current"
  | "ready"
  | "setup"
  | "inactive"
  | "deleted";

interface UserDirectoryScopeOwner {
  scopeKey: string;
}

type UserDirectoryLoadResult = "applied" | "failed" | "stale";

type Feedback = {
  scopeOwner: UserDirectoryScopeOwner;
  type: "success" | "error";
  message: string;
} | null;

type PendingUserAction = {
  kind: "toggle" | "reset-password" | "delete";
  user: User;
} | null;

interface OwnedPendingUserAction {
  scopeOwner: UserDirectoryScopeOwner;
  action: Exclude<PendingUserAction, null>;
  opener: HTMLElement | null;
}

interface OperationLease {
  scopeOwner: UserDirectoryScopeOwner;
  operation: ScopedOperation;
}

interface DirectoryFocusIntent {
  scopeOwner: UserDirectoryScopeOwner;
  opener: HTMLElement | null;
}

const EMPTY_USERS: User[] = [];
const EMPTY_AUDIT_EVENTS: UserAuditEvent[] = [];

function getActiveFocusOwner(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const activeElement = document.activeElement;
  if (
    !(activeElement instanceof HTMLElement) ||
    activeElement === document.body ||
    activeElement === document.documentElement
  ) {
    return null;
  }
  return activeElement;
}

export interface UserDirectoryControllerActions {
  fetchManagedUsersByVenue: (
    venueId?: string | null,
  ) => Promise<ApiResponse<User[]>>;
  fetchUserAuditEvents: (
    venueId?: string | null,
  ) => Promise<ApiResponse<UserAuditEvent[]>>;
  updateUserProfile: (
    userId: string,
    updates: UserProfileUpdateInput,
  ) => Promise<ApiResponse<User>>;
  deleteUserViaEdge: (userId: string) => Promise<{ error: string | null }>;
  issueManagedPasswordLinkViaEdge: (
    userId: string,
  ) => Promise<ApiResponse<ManagedPasswordLinkResult>>;
}

interface UseUserDirectoryControllerOptions {
  actions: UserDirectoryControllerActions;
  effectiveVenueId?: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
}

export function useUserDirectoryController({
  actions,
  effectiveVenueId,
  isActive,
  isSuperAdmin,
}: UseUserDirectoryControllerOptions) {
  const t = useTranslations("UserAdmin");
  const [users, setUsers] = useState<User[]>([]);
  const [auditEvents, setAuditEvents] = useState<UserAuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedScopeOwner, setLoadedScopeOwner] =
    useState<UserDirectoryScopeOwner | null>(null);
  const [loadErrorState, setLoadErrorState] = useState<{
    scopeOwner: UserDirectoryScopeOwner;
    message: string;
  } | null>(null);
  const [loadOutcomeState, setLoadOutcomeState] = useState<{
    scopeOwner: UserDirectoryScopeOwner;
    outcome: "idle" | "success" | "partial" | "error";
  } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "shared" | User["role"]
  >("all");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("current");
  const [busyUserState, setBusyUserState] = useState<{
    lease: OperationLease;
    userId: string;
  } | null>(null);
  const [pendingUserActionState, setPendingUserActionState] =
    useState<OwnedPendingUserAction | null>(null);
  const [passwordLink, setPasswordLink] = useState<{
    scopeOwner: UserDirectoryScopeOwner;
    userName: string;
    linkKind: "invitation" | "password_reset";
    passwordUrl: string;
    expiresAt: string;
  } | null>(null);
  const passwordLinkPanelRef = useRef<HTMLDivElement>(null);
  const shouldFocusPasswordLinkRef = useRef(false);
  const directoryFocusFallbackRef = useRef<HTMLInputElement>(null);
  const [directoryFocusIntent, setDirectoryFocusIntent] =
    useState<DirectoryFocusIntent | null>(null);
  const activeMutationLeaseRef = useRef<OperationLease | null>(null);
  const activeShareLeaseRef = useRef<OperationLease | null>(null);
  const [activeShareLease, setActiveShareLease] =
    useState<OperationLease | null>(null);

  const requestScopeKey = `${isSuperAdmin ? "super" : "venue"}:${effectiveVenueId ?? ""}`;
  const requestGuard = useLatestRequestGuard();
  const mutationGuard = useScopedOperationGuard();
  const scopeOwnerRef = useRef<UserDirectoryScopeOwner>({
    scopeKey: requestScopeKey,
  });
  const [scopeStateOwner, setScopeStateOwner] = useState(
    scopeOwnerRef.current,
  );
  if (scopeOwnerRef.current.scopeKey !== requestScopeKey) {
    scopeOwnerRef.current = { scopeKey: requestScopeKey };
  }
  const renderedScopeOwner = scopeOwnerRef.current;
  const isScopeStateCurrent = scopeStateOwner === renderedScopeOwner;
  const pendingUserActionOwnership =
    isScopeStateCurrent &&
    pendingUserActionState?.scopeOwner === renderedScopeOwner
      ? pendingUserActionState
      : null;
  const pendingUserAction = pendingUserActionOwnership?.action ?? null;
  const scopedPasswordLink =
    isScopeStateCurrent && passwordLink?.scopeOwner === renderedScopeOwner
      ? passwordLink
      : null;
  const scopedFeedback =
    isScopeStateCurrent && feedback?.scopeOwner === renderedScopeOwner
      ? feedback
      : null;
  const loadError =
    isScopeStateCurrent && loadErrorState?.scopeOwner === renderedScopeOwner
      ? loadErrorState.message
      : "";
  const loadOutcome =
    isScopeStateCurrent && loadOutcomeState?.scopeOwner === renderedScopeOwner
      ? loadOutcomeState.outcome
      : "idle";
  const busyUserId =
    isScopeStateCurrent &&
    busyUserState?.lease.scopeOwner === renderedScopeOwner
      ? busyUserState.userId
      : null;
  const isUserMutationPending = busyUserId !== null;
  const isSharingPasswordLink = Boolean(
    isScopeStateCurrent && activeShareLease?.scopeOwner === renderedScopeOwner,
  );

  const scopedUsers =
    isScopeStateCurrent && loadedScopeOwner === renderedScopeOwner
      ? users
      : EMPTY_USERS;
  const scopedAuditEvents =
    isScopeStateCurrent && loadedScopeOwner === renderedScopeOwner
      ? auditEvents
      : EMPTY_AUDIT_EVENTS;
  const isCurrentScopeLoading =
    !isScopeStateCurrent || isLoading || loadedScopeOwner !== renderedScopeOwner;
  useSectionLoadingTask(isActive && isCurrentScopeLoading);

  const setPendingUserAction = useCallback((action: PendingUserAction) => {
    if (!action) {
      setPendingUserActionState(null);
      return;
    }
    if (
      activeMutationLeaseRef.current?.scopeOwner === scopeOwnerRef.current
    ) {
      return;
    }
    const opener = getActiveFocusOwner();
    setPendingUserActionState({
      scopeOwner: scopeOwnerRef.current,
      action,
      opener,
    });
  }, []);

  const closePasswordLink = useCallback(() => {
    const scopeOwner = scopeOwnerRef.current;
    const opener = getActiveFocusOwner();
    setPasswordLink((current) =>
      current?.scopeOwner === scopeOwner ? null : current,
    );
    setDirectoryFocusIntent({ scopeOwner, opener });
  }, []);

  useEffect(() => {
    const scopeOwner = renderedScopeOwner;
    requestGuard.invalidateRequests();
    mutationGuard.invalidateOperations();
    activeMutationLeaseRef.current = null;
    activeShareLeaseRef.current = null;
    setBusyUserState(null);
    setActiveShareLease(null);
    setPendingUserActionState(null);
    setPasswordLink(null);
    setDirectoryFocusIntent(null);
    shouldFocusPasswordLinkRef.current = false;
    setFeedback(null);
    setLoadErrorState(null);
    setLoadOutcomeState(null);
    setLoadedScopeOwner(null);
    setIsLoading(false);
    setScopeStateOwner(scopeOwner);
  }, [mutationGuard, renderedScopeOwner, requestGuard]);

  useEffect(() => {
    if (!directoryFocusIntent) return;
    const intent = directoryFocusIntent;
    const frameId = window.requestAnimationFrame(() => {
      if (
        scopeOwnerRef.current === intent.scopeOwner &&
        !(
          intent.opener?.isConnected &&
          !intent.opener.closest("[inert]")
        )
      ) {
        const fallback = directoryFocusFallbackRef.current;
        if (fallback?.isConnected && !fallback.closest("[inert]")) {
          fallback.focus({ preventScroll: true });
        }
      }
      setDirectoryFocusIntent((current) =>
        current === intent ? null : current,
      );
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [directoryFocusIntent]);

  useEffect(() => {
    if (
      !scopedPasswordLink ||
      pendingUserAction ||
      !shouldFocusPasswordLinkRef.current
    ) {
      return;
    }

    shouldFocusPasswordLinkRef.current = false;

    const frameId = window.requestAnimationFrame(() => {
      const panel = passwordLinkPanelRef.current;
      if (!panel) return;
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ block: "center" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [pendingUserAction, scopedPasswordLink]);

  const loadUsers = useCallback(async (): Promise<UserDirectoryLoadResult> => {
    const scopeOwner = renderedScopeOwner;
    if (scopeOwnerRef.current !== scopeOwner) return "stale";
    const isLatestRequest = requestGuard.beginRequest();
    const isCurrentRequest = () =>
      isLatestRequest() && scopeOwnerRef.current === scopeOwner;
    if (!effectiveVenueId && !isSuperAdmin) {
      setUsers([]);
      setAuditEvents([]);
      setLoadedScopeOwner(scopeOwner);
      setLoadOutcomeState({ scopeOwner, outcome: "success" });
      setIsLoading(false);
      return "applied";
    }
    setIsLoading(true);
    setLoadErrorState(null);
    try {
      const requestedVenueId = isSuperAdmin
        ? effectiveVenueId || null
        : effectiveVenueId;
      const userRequest = actions.fetchManagedUsersByVenue(requestedVenueId);
      let auditRequestRejected = false;
      const auditRequest = isSuperAdmin
        ? actions.fetchUserAuditEvents(requestedVenueId).catch((error: unknown) => {
            auditRequestRejected = true;
            console.error("Failed to load user activity:", error);
            return null;
          })
        : Promise.resolve(null);
      const [userResult, auditResult] = await Promise.all([
        userRequest,
        auditRequest,
      ]);
      if (!isCurrentRequest()) return "stale";
      const auditFailed = auditRequestRejected || Boolean(auditResult?.error);
      if (userResult.error) {
        console.error("Failed to load users:", userResult.error);
        setLoadErrorState({ scopeOwner, message: t("loadFailed") });
        setUsers([]);
        setLoadOutcomeState({ scopeOwner, outcome: "error" });
      } else {
        setUsers(userResult.data ?? []);
        setLoadOutcomeState({
          scopeOwner,
          outcome: auditFailed ? "partial" : "success",
        });
      }
      if (auditFailed) {
        if (auditResult?.error) {
          console.error("Failed to load user activity:", auditResult.error);
        }
        setAuditEvents([]);
        if (!userResult.error) {
          setLoadErrorState({
            scopeOwner,
            message: t("activityLoadFailed"),
          });
        }
      } else if (isSuperAdmin) {
        setAuditEvents(auditResult?.data ?? []);
      } else if (!isSuperAdmin) {
        setAuditEvents([]);
      }
      setLoadedScopeOwner(scopeOwner);
      return userResult.error ? "failed" : "applied";
    } catch (error) {
      if (!isCurrentRequest()) return "stale";
      console.error("Failed to load users:", error);
      setUsers([]);
      setAuditEvents([]);
      setLoadedScopeOwner(scopeOwner);
      setLoadErrorState({
        scopeOwner,
        message: t("connectionLoadFailed"),
      });
      setLoadOutcomeState({ scopeOwner, outcome: "error" });
      return "failed";
    } finally {
      if (isCurrentRequest()) {
        setIsLoading(false);
      }
    }
  }, [
    actions,
    effectiveVenueId,
    isSuperAdmin,
    renderedScopeOwner,
    requestGuard,
    t,
  ]);

  useEffect(() => {
    if (isActive && (effectiveVenueId || isSuperAdmin)) {
      loadUsers();
    }
  }, [effectiveVenueId, isActive, isSuperAdmin, loadUsers]);

  const beginUserMutation = (userId: string) => {
    const scopeOwner = renderedScopeOwner;
    if (activeMutationLeaseRef.current?.scopeOwner === scopeOwner) return null;
    const operation = mutationGuard.beginOperation(
      scopeOwner.scopeKey,
      "user-mutation",
    );
    const lease: OperationLease = {
      scopeOwner,
      operation,
    };
    activeMutationLeaseRef.current = lease;
    setBusyUserState({ lease, userId });
    setFeedback(null);
    return lease;
  };

  const isUserMutationCurrent = (lease: OperationLease) =>
    activeMutationLeaseRef.current === lease &&
    scopeOwnerRef.current === lease.scopeOwner &&
    lease.operation.isCurrent(lease.scopeOwner.scopeKey);

  const finishUserMutation = (lease: OperationLease) => {
    if (activeMutationLeaseRef.current !== lease) return;
    activeMutationLeaseRef.current = null;
    lease.operation.finish(scopeOwnerRef.current.scopeKey);
    setBusyUserState((current) =>
      current?.lease === lease ? null : current,
    );
  };

  const handleUserUpdate = async (
    userId: string,
    updates: UserProfileUpdateInput,
  ): Promise<boolean> => {
    const lease = beginUserMutation(userId);
    if (!lease) return false;
    try {
      const { error } = await actions.updateUserProfile(userId, updates);
      if (!isUserMutationCurrent(lease)) return false;
      if (error) {
        console.error("Failed to update user:", error);
        setFeedback({
          scopeOwner: lease.scopeOwner,
          type: "error",
          message: getActionError(error),
        });
        return false;
      } else {
        const refreshResult = await loadUsers();
        if (!isUserMutationCurrent(lease) || refreshResult !== "applied") {
          return false;
        }
        setFeedback({
          scopeOwner: lease.scopeOwner,
          type: "success",
          message: t("updated"),
        });
        return true;
      }
    } catch (error) {
      if (!isUserMutationCurrent(lease)) return false;
      console.error("Failed to update user:", error);
      setFeedback({
        scopeOwner: lease.scopeOwner,
        type: "error",
        message: t("updateFailed"),
      });
      return false;
    } finally {
      finishUserMutation(lease);
    }
  };

  const getActionError = useCallback(
    (error: string): string => {
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
    },
    [t],
  );

  const handleActiveChange = async (user: User) => {
    await handleUserUpdate(user.id, { active: !user.active });
  };

  const handlePasswordReset = async (user: User) => {
    const lease = beginUserMutation(user.id);
    if (!lease) return;
    setPasswordLink(null);
    shouldFocusPasswordLinkRef.current = false;
    try {
      const { data, error } =
        await actions.issueManagedPasswordLinkViaEdge(user.id);
      if (!isUserMutationCurrent(lease)) return;
      if (error || !data) {
        setFeedback({
          scopeOwner: lease.scopeOwner,
          type: "error",
          message: getActionError(error ?? "UPDATE_FAILED"),
        });
        return;
      }
      shouldFocusPasswordLinkRef.current = true;
      setPasswordLink({
        scopeOwner: lease.scopeOwner,
        userName: user.name,
        linkKind: data.linkKind,
        passwordUrl: data.passwordUrl,
        expiresAt: data.expiresAt,
      });
      const refreshResult = await loadUsers();
      if (!isUserMutationCurrent(lease) || refreshResult !== "applied") return;
      setFeedback({
        scopeOwner: lease.scopeOwner,
        type: "success",
        message:
          data.linkKind === "invitation"
            ? t("invitationReissued")
            : t("passwordResetLinkIssued"),
      });
    } catch (error: unknown) {
      if (!isUserMutationCurrent(lease)) return;
      console.error("Failed to reset user password:", error);
      setFeedback({
        scopeOwner: lease.scopeOwner,
        type: "error",
        message: t("resetPasswordFailed"),
      });
    } finally {
      finishUserMutation(lease);
    }
  };

  const handleUserDelete = async (
    user: User,
  ): Promise<"deleted" | "failed" | "stale"> => {
    const lease = beginUserMutation(user.id);
    if (!lease) return "failed";
    try {
      const { error } = await actions.deleteUserViaEdge(user.id);
      if (!isUserMutationCurrent(lease)) return "stale";
      if (error) {
        console.error("Failed to delete user:", error);
        setFeedback({
          scopeOwner: lease.scopeOwner,
          type: "error",
          message: getActionError(error),
        });
        return "failed";
      } else {
        const refreshResult = await loadUsers();
        if (!isUserMutationCurrent(lease) || refreshResult === "stale") {
          return "stale";
        }
        if (refreshResult === "applied") {
          setFeedback({
            scopeOwner: lease.scopeOwner,
            type: "success",
            message: t("deleted"),
          });
        }
        return "deleted";
      }
    } catch (error: unknown) {
      if (!isUserMutationCurrent(lease)) return "stale";
      console.error("Failed to delete user:", error);
      setFeedback({
        scopeOwner: lease.scopeOwner,
        type: "error",
        message: t("deleteFailed"),
      });
      return "failed";
    } finally {
      finishUserMutation(lease);
    }
  };

  const confirmPendingUserAction = async () => {
    if (!pendingUserActionOwnership) return;
    if (
      activeMutationLeaseRef.current?.scopeOwner ===
      pendingUserActionOwnership.scopeOwner
    ) {
      return;
    }
    const { action, opener, scopeOwner } = pendingUserActionOwnership;
    const { kind, user } = action;
    let deleteResult: "deleted" | "failed" | "stale" = "failed";
    if (kind === "toggle") await handleActiveChange(user);
    if (kind === "reset-password") await handlePasswordReset(user);
    if (kind === "delete") deleteResult = await handleUserDelete(user);
    if (scopeOwnerRef.current === scopeOwner) {
      setPendingUserActionState((current) =>
        current === pendingUserActionOwnership ? null : current,
      );
      if (kind === "delete" && deleteResult === "deleted") {
        setDirectoryFocusIntent({ scopeOwner, opener });
      }
    }
  };

  const sharePasswordLink = async () => {
    if (!scopedPasswordLink) return;
    const scopeOwner = renderedScopeOwner;
    if (activeShareLeaseRef.current?.scopeOwner === scopeOwner) return;
    const operation = mutationGuard.beginOperation(
      scopeOwner.scopeKey,
      "share-password-link",
    );
    const lease: OperationLease = {
      scopeOwner,
      operation,
    };
    activeShareLeaseRef.current = lease;
    setActiveShareLease(lease);
    try {
      const result = await shareUrl(
        toUrlShareData(scopedPasswordLink.passwordUrl),
        {
          share:
            typeof navigator.share === "function"
              ? (data) => navigator.share(data)
              : undefined,
          canShare:
            typeof navigator.canShare === "function"
              ? (data) => navigator.canShare(data)
              : undefined,
          copy: async (url) => {
            if (!navigator.clipboard?.writeText) {
              throw new Error("Clipboard API is unavailable");
            }
            await navigator.clipboard.writeText(url);
          },
        },
      );
      const isCurrentShare =
        activeShareLeaseRef.current === lease &&
        scopeOwnerRef.current === scopeOwner &&
        operation.isCurrent(scopeOwner.scopeKey);
      if (!isCurrentShare) return;
      if (result === "shared" || result === "copied") {
        setFeedback({
          scopeOwner,
          type: "success",
          message:
            result === "shared"
              ? t("passwordLinkShared")
              : t("passwordLinkCopied"),
        });
      } else if (result === "failed") {
        setFeedback({
          scopeOwner,
          type: "error",
          message: t("passwordLinkCopyFailed"),
        });
      }
    } finally {
      if (activeShareLeaseRef.current === lease) {
        activeShareLeaseRef.current = null;
        operation.finish(scopeOwnerRef.current.scopeKey);
        setActiveShareLease((current) => (current === lease ? null : current));
      }
    }
  };

  const currentUsers = useMemo(
    () => scopedUsers.filter((user) => !user.deletedAt),
    [scopedUsers],
  );

  const filteredUsers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return scopedUsers.filter((user) => {
      const matchesSearch =
        !normalizedQuery ||
        user.name.toLowerCase().includes(normalizedQuery) ||
        user.email.toLowerCase().includes(normalizedQuery);
      const matchesRole =
        roleFilter === "all" ||
        (roleFilter === "shared"
          ? user.accountKind === "shared"
          : user.role === roleFilter);
      const isSetupPending =
        user.active &&
        user.migrationStatus === "pending_reset" &&
        !user.passwordSetAt;
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
  }, [roleFilter, scopedUsers, searchQuery, statusFilter]);
  const listState = deriveAsyncListState({
    hasStarted: isLoading || loadOutcome !== "idle",
    isLoading: isCurrentScopeLoading,
    itemCount: filteredUsers.length,
    hasError: loadOutcome === "error",
    isPartial: loadOutcome === "partial",
  });

  return {
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
  };
}
