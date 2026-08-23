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

type Feedback = {
  scopeKey: string;
  type: "success" | "error";
  message: string;
} | null;

type PendingUserAction = {
  kind: "toggle" | "reset-password" | "delete";
  user: User;
} | null;

const EMPTY_USERS: User[] = [];
const EMPTY_AUDIT_EVENTS: UserAuditEvent[] = [];

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
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "partial" | "error"
  >("idle");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "shared" | User["role"]
  >("all");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("current");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [pendingUserAction, setPendingUserAction] =
    useState<PendingUserAction>(null);
  const [passwordLink, setPasswordLink] = useState<{
    scopeKey: string;
    userName: string;
    linkKind: "invitation" | "password_reset";
    passwordUrl: string;
    expiresAt: string;
  } | null>(null);
  const passwordLinkPanelRef = useRef<HTMLDivElement>(null);
  const shouldFocusPasswordLinkRef = useRef(false);

  const requestScopeKey = `${isSuperAdmin ? "super" : "venue"}:${effectiveVenueId ?? ""}`;
  const requestGuard = useLatestRequestGuard();
  const mutationGuard = useScopedOperationGuard();
  const currentScopeKeyRef = useRef(requestScopeKey);
  const activeMutationIdRef = useRef<number | null>(null);
  currentScopeKeyRef.current = requestScopeKey;
  const scopedPasswordLink =
    passwordLink?.scopeKey === requestScopeKey ? passwordLink : null;
  const scopedFeedback =
    feedback?.scopeKey === requestScopeKey ? feedback : null;

  const scopedUsers = loadedScopeKey === requestScopeKey ? users : EMPTY_USERS;
  const scopedAuditEvents =
    loadedScopeKey === requestScopeKey ? auditEvents : EMPTY_AUDIT_EVENTS;
  const isCurrentScopeLoading = isLoading || loadedScopeKey !== requestScopeKey;
  useSectionLoadingTask(isActive && isCurrentScopeLoading);

  useEffect(() => {
    requestGuard.invalidateRequests();
    mutationGuard.invalidateOperations();
    activeMutationIdRef.current = null;
    setBusyUserId(null);
    setPendingUserAction(null);
    setPasswordLink(null);
    shouldFocusPasswordLinkRef.current = false;
    setFeedback(null);
    setLoadOutcome("idle");
  }, [mutationGuard, requestGuard, requestScopeKey]);

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

  const loadUsers = useCallback(async () => {
    if (currentScopeKeyRef.current !== requestScopeKey) return;
    const isLatestRequest = requestGuard.beginRequest();
    if (!effectiveVenueId && !isSuperAdmin) {
      setUsers([]);
      setAuditEvents([]);
      setLoadedScopeKey(requestScopeKey);
      setLoadOutcome("success");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const requestedVenueId = isSuperAdmin
        ? effectiveVenueId || null
        : effectiveVenueId;
      const [userResult, auditResult] = await Promise.all([
        actions.fetchManagedUsersByVenue(requestedVenueId),
        isSuperAdmin
          ? actions.fetchUserAuditEvents(requestedVenueId)
          : Promise.resolve(null),
      ]);
      if (
        !isLatestRequest() ||
        currentScopeKeyRef.current !== requestScopeKey
      )
        return;
      if (userResult.error) {
        console.error("Failed to load users:", userResult.error);
        setLoadError(t("loadFailed"));
        setUsers([]);
        setLoadOutcome("error");
      } else {
        setUsers(userResult.data ?? []);
        setLoadOutcome(auditResult?.error ? "partial" : "success");
      }
      if (auditResult?.error) {
        console.error("Failed to load user activity:", auditResult.error);
        setAuditEvents([]);
        if (!userResult.error) setLoadError(t("activityLoadFailed"));
      } else if (isSuperAdmin) {
        setAuditEvents(auditResult?.data ?? []);
      } else if (!isSuperAdmin) {
        setAuditEvents([]);
      }
      setLoadedScopeKey(requestScopeKey);
    } catch (error) {
      if (
        !isLatestRequest() ||
        currentScopeKeyRef.current !== requestScopeKey
      )
        return;
      console.error("Failed to load users:", error);
      setUsers([]);
      setAuditEvents([]);
      setLoadedScopeKey(requestScopeKey);
      setLoadError(t("connectionLoadFailed"));
      setLoadOutcome("error");
    } finally {
      if (
        isLatestRequest() &&
        currentScopeKeyRef.current === requestScopeKey
      ) {
        setIsLoading(false);
      }
    }
  }, [actions, effectiveVenueId, isSuperAdmin, requestGuard, requestScopeKey, t]);

  useEffect(() => {
    if (isActive && (effectiveVenueId || isSuperAdmin)) {
      loadUsers();
    }
  }, [effectiveVenueId, isActive, isSuperAdmin, loadUsers]);

  const beginUserMutation = (userId: string) => {
    if (activeMutationIdRef.current !== null) return null;
    const operation = mutationGuard.beginOperation(
      requestScopeKey,
      "user-mutation",
    );
    activeMutationIdRef.current = operation.id;
    setBusyUserId(userId);
    setFeedback(null);
    return operation;
  };

  const finishUserMutation = (
    operation: ReturnType<typeof mutationGuard.beginOperation>,
  ) => {
    if (activeMutationIdRef.current !== operation.id) return;
    activeMutationIdRef.current = null;
    if (operation.finish(currentScopeKeyRef.current)) {
      setBusyUserId(null);
    }
  };

  const handleUserUpdate = async (
    userId: string,
    updates: UserProfileUpdateInput,
  ): Promise<boolean> => {
    const operation = beginUserMutation(userId);
    if (!operation) return false;
    try {
      const { error } = await actions.updateUserProfile(userId, updates);
      if (!operation.isCurrent(currentScopeKeyRef.current)) return false;
      if (error) {
        console.error("Failed to update user:", error);
        setFeedback({
          scopeKey: operation.scopeKey,
          type: "error",
          message: getActionError(error),
        });
        return false;
      } else {
        await loadUsers();
        if (!operation.isCurrent(currentScopeKeyRef.current)) return false;
        setFeedback({
          scopeKey: operation.scopeKey,
          type: "success",
          message: t("updated"),
        });
        return true;
      }
    } catch (error) {
      if (!operation.isCurrent(currentScopeKeyRef.current)) return false;
      console.error("Failed to update user:", error);
      setFeedback({
        scopeKey: operation.scopeKey,
        type: "error",
        message: t("updateFailed"),
      });
      return false;
    } finally {
      finishUserMutation(operation);
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
    const operation = beginUserMutation(user.id);
    if (!operation) return;
    setPasswordLink(null);
    shouldFocusPasswordLinkRef.current = false;
    try {
      const { data, error } =
        await actions.issueManagedPasswordLinkViaEdge(user.id);
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      if (error || !data) {
        setFeedback({
          scopeKey: operation.scopeKey,
          type: "error",
          message: getActionError(error ?? "UPDATE_FAILED"),
        });
        return;
      }
      shouldFocusPasswordLinkRef.current = true;
      setPasswordLink({
        scopeKey: operation.scopeKey,
        userName: user.name,
        linkKind: data.linkKind,
        passwordUrl: data.passwordUrl,
        expiresAt: data.expiresAt,
      });
      setFeedback({
        scopeKey: operation.scopeKey,
        type: "success",
        message:
          data.linkKind === "invitation"
            ? t("invitationReissued")
            : t("passwordResetLinkIssued"),
      });
      await loadUsers();
    } catch (error: unknown) {
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      console.error("Failed to reset user password:", error);
      setFeedback({
        scopeKey: operation.scopeKey,
        type: "error",
        message: t("resetPasswordFailed"),
      });
    } finally {
      finishUserMutation(operation);
    }
  };

  const handleUserDelete = async (user: User) => {
    const operation = beginUserMutation(user.id);
    if (!operation) return;
    try {
      const { error } = await actions.deleteUserViaEdge(user.id);
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      if (error) {
        console.error("Failed to delete user:", error);
        setFeedback({
          scopeKey: operation.scopeKey,
          type: "error",
          message: getActionError(error),
        });
      } else {
        await loadUsers();
        if (!operation.isCurrent(currentScopeKeyRef.current)) return;
        setFeedback({
          scopeKey: operation.scopeKey,
          type: "success",
          message: t("deleted"),
        });
      }
    } catch (error: unknown) {
      if (!operation.isCurrent(currentScopeKeyRef.current)) return;
      console.error("Failed to delete user:", error);
      setFeedback({
        scopeKey: operation.scopeKey,
        type: "error",
        message: t("deleteFailed"),
      });
    } finally {
      finishUserMutation(operation);
    }
  };

  const confirmPendingUserAction = async () => {
    if (!pendingUserAction) return;
    const { kind, user } = pendingUserAction;
    const operationScopeKey = requestScopeKey;
    if (kind === "toggle") await handleActiveChange(user);
    if (kind === "reset-password") await handlePasswordReset(user);
    if (kind === "delete") await handleUserDelete(user);
    if (currentScopeKeyRef.current === operationScopeKey) {
      setPendingUserAction((current) =>
        current?.kind === kind && current.user.id === user.id ? null : current,
      );
    }
  };

  const sharePasswordLink = async () => {
    if (!scopedPasswordLink) return;
    const operation = mutationGuard.beginOperation(
      requestScopeKey,
      "share-password-link",
    );
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
    if (!operation.isCurrent(currentScopeKeyRef.current)) return;
    if (result === "shared" || result === "copied") {
      setFeedback({
        scopeKey: operation.scopeKey,
        type: "success",
        message:
          result === "shared"
            ? t("passwordLinkShared")
            : t("passwordLinkCopied"),
      });
    } else if (result === "failed") {
      setFeedback({
        scopeKey: operation.scopeKey,
        type: "error",
        message: t("passwordLinkCopyFailed"),
      });
    }
    operation.finish(currentScopeKeyRef.current);
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
    confirmPendingUserAction,
    currentUsers,
    filteredUsers,
    handleUserUpdate,
    isCurrentScopeLoading,
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
    setPasswordLink,
    setPendingUserAction,
    setRoleFilter,
    setSearchQuery,
    setStatusFilter,
    sharePasswordLink,
    statusFilter,
  };
}
