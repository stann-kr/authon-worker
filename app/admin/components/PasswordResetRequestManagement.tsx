"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import RoleLabel from "@/components/RoleLabel";
import Skeleton from "@/components/Skeleton";
import { useSectionLoadingTask } from "@/components/RouteTransitionProvider";
import {
  fetchPasswordResetRequests,
  rejectPasswordResetRequest,
  startManagedPasswordReset,
} from "@/lib/api/password-reset-requests";
import type {
  PasswordResetRequestView,
  PasswordResetVerificationMethod,
} from "@/lib/api/types";
import { useLatestRequestGuard } from "@/lib/hooks";
import { useLocale, useTranslations } from "next-intl";

interface PasswordResetRequestManagementProps {
  onPendingCountChange?: (count: number) => void;
}

type PendingAction = {
  kind: "approve" | "reject";
  request: PasswordResetRequestView;
} | null;

type ResetResult = {
  userName: string;
  expiresAt: string | null;
} | null;

type ActionErrorFocusTarget =
  | "dialog"
  | "verification-method"
  | "verification-challenge"
  | "verification-attestation";

type ActionError = {
  message: string;
  focusTarget: ActionErrorFocusTarget;
} | null;

export default function PasswordResetRequestManagement({
  onPendingCountChange,
}: PasswordResetRequestManagementProps) {
  const t = useTranslations("PasswordResetAdmin");
  const commonT = useTranslations("Common");
  const locale = useLocale();
  const [requests, setRequests] = useState<PasswordResetRequestView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [verificationMethod, setVerificationMethod] =
    useState<PasswordResetVerificationMethod | null>(null);
  const [verificationChallenge, setVerificationChallenge] = useState("");
  const [verificationAttested, setVerificationAttested] = useState(false);
  const [actionError, setActionError] = useState<ActionError>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [resetResult, setResetResult] = useState<ResetResult>(null);
  const actionErrorRef = useRef<HTMLDivElement>(null);
  const verificationMethodRef = useRef<HTMLInputElement>(null);
  const verificationChallengeRef = useRef<HTMLInputElement>(null);
  const verificationAttestationRef = useRef<HTMLInputElement>(null);
  const resultPanelRef = useRef<HTMLDivElement>(null);
  const shouldFocusResultRef = useRef(false);
  const requestGuard = useLatestRequestGuard();
  useSectionLoadingTask(isLoading);

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests],
  );
  const decidedRequests = useMemo(
    () => requests.filter((request) => request.status !== "pending"),
    [requests],
  );

  const loadRequests = useCallback(async () => {
    const isLatestRequest = requestGuard.beginRequest();
    setIsLoading(true);
    try {
      const { data, error } = await fetchPasswordResetRequests();
      if (!isLatestRequest()) return;
      if (error) {
        console.error("Failed to load password reset requests:", error);
        setFeedback({ type: "error", message: t("loadFailed") });
        setRequests([]);
        onPendingCountChange?.(0);
        return;
      }
      const nextRequests = data ?? [];
      setRequests(nextRequests);
      onPendingCountChange?.(
        nextRequests.filter((request) => request.status === "pending").length,
      );
    } catch (error: unknown) {
      if (!isLatestRequest()) return;
      console.error("Failed to load password reset requests:", error);
      setFeedback({ type: "error", message: t("loadFailed") });
      setRequests([]);
      onPendingCountChange?.(0);
    } finally {
      if (isLatestRequest()) setIsLoading(false);
    }
  }, [onPendingCountChange, requestGuard, t]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (!resetResult || pendingAction || !shouldFocusResultRef.current) return;
    shouldFocusResultRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      resultPanelRef.current?.focus({ preventScroll: true });
      resultPanelRef.current?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [pendingAction, resetResult]);

  const getActionError = (error: string): string => {
    switch (error) {
      case "CANNOT_MANAGE_SELF":
        return t("cannotManageSelf");
      case "FORBIDDEN":
        return t("forbidden");
      case "DIRECT_RESET_NOT_ALLOWED":
      case "EXACT_SELF_SERVICE_REQUEST_REQUIRED":
      case "SIGNED_RECEIPT_REQUIRED":
        return t("directNotAllowed");
      case "VERIFICATION_FAILED":
        return t("verificationFailed");
      case "VERIFICATION_REQUIRED":
        return t("verificationRequired");
      case "REQUEST_ALREADY_DECIDED":
        return t("alreadyDecided");
      case "REQUEST_EXPIRED":
        return t("requestExpired");
      case "REQUEST_NOT_FOUND":
      case "USER_NOT_FOUND":
        return t("notFound");
      case "USER_INACTIVE":
        return t("inactiveUser");
      case "USER_DELETED":
        return t("deletedUser");
      default:
        return t("decisionFailed");
    }
  };

  const showActionError = (
    message: string,
    focusTarget: ActionErrorFocusTarget = "dialog",
  ) => {
    setActionError({ message, focusTarget });
    window.requestAnimationFrame(() => {
      const target =
        focusTarget === "verification-method"
          ? verificationMethodRef.current
          : focusTarget === "verification-challenge"
            ? verificationChallengeRef.current
            : focusTarget === "verification-attestation"
              ? verificationAttestationRef.current
              : actionErrorRef.current;
      target?.focus();
    });
  };

  const closePendingAction = () => {
    setActionError(null);
    setPendingAction(null);
  };

  const handlePendingAction = async () => {
    if (!pendingAction) return;
    const { request, kind } = pendingAction;
    setBusyRequestId(request.id);
    setActionError(null);
    setFeedback(null);
    try {
      if (kind === "reject") {
        const { error } = await rejectPasswordResetRequest(request.id);
        if (error) {
          showActionError(getActionError(error));
          return;
        }
        setFeedback({ type: "success", message: t("rejected") });
        await loadRequests();
        closePendingAction();
        return;
      }

      const { data, error } = await startManagedPasswordReset({
        requestId: request.id,
        setupMethod: "admin_approved",
        verificationMethod,
        verificationChallenge,
        verificationAttested,
      });
      if (error || !data) {
        const errorCode = error ?? "UPDATE_FAILED";
        const focusTarget: ActionErrorFocusTarget =
          !verificationMethod
            ? "verification-method"
            : errorCode === "VERIFICATION_FAILED"
              ? "verification-challenge"
              : !verificationAttested
                ? "verification-attestation"
                : errorCode === "VERIFICATION_REQUIRED"
                  ? "verification-challenge"
                  : "dialog";
        showActionError(getActionError(errorCode), focusTarget);
        return;
      }

      shouldFocusResultRef.current = true;
      setResetResult({
        userName: request.userName,
        expiresAt: data.expiresAt,
      });
      setFeedback({
        type: "success",
        message: t("approvedDirect"),
      });
      await loadRequests();
      closePendingAction();
    } catch (error: unknown) {
      console.error("Failed to decide password reset request:", error);
      showActionError(t("decisionFailed"));
    } finally {
      setBusyRequestId(null);
    }
  };

  const formatDate = (value: string | null): string => {
    if (!value) return "-";
    return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  };

  const getStatusLabel = (request: PasswordResetRequestView): string => {
    if (request.status === "approved") {
      return request.setupMethod === "admin_approved"
        ? t("historyDirect")
        : t("historyCode");
    }
    return t(`status_${request.status}`);
  };

  return (
    <>
      <section className="app-panel" aria-labelledby="password-reset-requests-title">
        <PanelHeader
          title={t("title")}
          headingId="password-reset-requests-title"
          count={pendingRequests.length}
          onRefresh={loadRequests}
          isLoading={isLoading}
        />
        <div className="space-y-4 p-4 sm:p-5">
          <p className="text-sm leading-relaxed text-text-muted">
            {t("description")}
          </p>
          {feedback && <Alert type={feedback.type} message={feedback.message} />}

          {resetResult && (
            <div
              ref={resultPanelRef}
              tabIndex={-1}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="border border-status-waiting/70 bg-status-waiting/10 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-text-heading">
                    {t("directResultTitle", { name: resetResult.userName })}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-text-muted">
                    {t("directResultHelp", {
                      expiresAt: formatDate(resetResult.expiresAt),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setResetResult(null)}
                  >
                    {commonT("close")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {isLoading && requests.length === 0 ? (
            <Skeleton rows={4} />
          ) : pendingRequests.length === 0 ? (
            <EmptyState icon="key" message={t("noPending")} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {pendingRequests.map((request) => (
                <article
                  key={request.id}
                  className="border border-border-default bg-canvas p-4"
                  aria-busy={busyRequestId === request.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="type-row-title break-words">
                        {request.userName}
                      </h2>
                      <p className="mt-1 break-all font-mono text-xs text-text-muted">
                        {request.userEmail}
                      </p>
                    </div>
                    <RoleLabel role={request.userRole} colored />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-text-dim">{t("venue")}</dt>
                      <dd className="mt-1 break-words text-text-body">
                        {request.venueName || t("platform")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-dim">{t("requestedAt")}</dt>
                      <dd className="mt-1 font-mono text-text-body">
                        <time dateTime={request.createdAt}>
                          {formatDate(request.createdAt)}
                        </time>
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      fullWidth
                      onClick={() => {
                        setActionError(null);
                        setFeedback(null);
                        setVerificationMethod(null);
                        setVerificationChallenge("");
                        setVerificationAttested(false);
                        setPendingAction({ kind: "approve", request });
                      }}
                      disabled={
                        busyRequestId === request.id ||
                        !request.codeFreeEligible
                      }
                      title={
                        !request.codeFreeEligible
                          ? t("directNotAllowed")
                          : undefined
                      }
                    >
                      {t("process")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      fullWidth
                      variant="outline"
                      onClick={() => {
                        setActionError(null);
                        setFeedback(null);
                        setPendingAction({ kind: "reject", request });
                      }}
                      disabled={busyRequestId === request.id}
                    >
                      {t("reject")}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {decidedRequests.length > 0 && (
            <details className="border-t border-border-default pt-4">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text-heading">
                {t("history", { count: decidedRequests.length })}
              </summary>
              <div className="mt-3 divide-y divide-border-subtle border border-border-default bg-canvas">
                {decidedRequests.slice(0, 30).map((request) => (
                  <div
                    key={request.id}
                    className="flex items-start justify-between gap-3 p-3 text-xs"
                  >
                    <span className="min-w-0 break-words text-text-body">
                      {request.userName} · {request.venueName || t("platform")}
                    </span>
                    <span className="shrink-0 text-right font-mono text-text-muted">
                      {getStatusLabel(request)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      {pendingAction && (
        <ConfirmDialog
          open
          title={
            pendingAction.kind === "approve"
              ? t("approveTitle", { name: pendingAction.request.userName })
              : t("rejectTitle", { name: pendingAction.request.userName })
          }
          description={
            pendingAction.kind === "approve"
              ? t("approveDescription")
              : t("rejectDescription")
          }
          confirmLabel={
            pendingAction.kind === "approve" ? t("approve") : t("reject")
          }
          cancelLabel={commonT("cancel")}
          onConfirm={handlePendingAction}
          onCancel={closePendingAction}
          isLoading={busyRequestId === pendingAction.request.id}
          confirmDisabled={
            pendingAction.kind === "approve" &&
            (!verificationMethod ||
              !verificationAttested ||
              !/^\d{4}$/.test(verificationChallenge.trim()))
          }
          tone={pendingAction.kind === "approve" ? "primary" : "danger"}
        >
          {actionError && (
            <div
              ref={actionErrorRef}
              id="password-reset-action-error"
              className="mb-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              tabIndex={-1}
            >
              <Alert type="error" message={actionError.message} />
            </div>
          )}
          {pendingAction.kind === "approve" && (
            <div className="space-y-4">
              <p className="rounded-control border border-border-default bg-surface-raised p-3 text-xs leading-relaxed text-text-muted">
                {t("approvalSteps")}
              </p>
              <fieldset
                aria-describedby={
                  actionError?.focusTarget === "verification-method"
                    ? "password-reset-action-error"
                    : undefined
                }
              >
                <legend className="app-label">
                  {t("verificationMethod")}
                </legend>
                <div className="space-y-2">
                  {([
                    "in_person",
                    "registered_phone",
                    "verified_messenger",
                  ] as const).map((method) => (
                    <label
                      key={method}
                      className="flex cursor-pointer items-start gap-3 border border-border-default bg-canvas p-3"
                    >
                      <input
                        ref={method === "in_person" ? verificationMethodRef : undefined}
                        type="radio"
                        name="password-reset-verification-method"
                        value={method}
                        checked={verificationMethod === method}
                        onChange={() => {
                          setVerificationMethod(method);
                          setActionError(null);
                        }}
                        required
                        disabled={busyRequestId === pendingAction.request.id}
                        className="mt-1"
                      />
                      <span className="text-sm text-text-body">
                        {t(`verification_${method}`)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="password-reset-verification-challenge" className="app-label">
                  {t("verificationChallenge")}
                </label>
                <input
                  ref={verificationChallengeRef}
                  id="password-reset-verification-challenge"
                  name="password-reset-verification-challenge"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={verificationChallenge}
                  onChange={(event) => {
                    setVerificationChallenge(
                      event.target.value.replace(/\D/g, "").slice(0, 4),
                    );
                    setActionError(null);
                  }}
                  disabled={busyRequestId === pendingAction.request.id}
                  autoComplete="off"
                  required
                  placeholder="0000"
                  className="app-field font-mono text-center text-lg tracking-[0.35em]"
                  aria-describedby={`password-reset-verification-help${
                    actionError?.focusTarget === "verification-challenge"
                      ? " password-reset-action-error"
                      : ""
                  }`}
                  aria-required="true"
                  aria-invalid={
                    (verificationChallenge.length > 0 &&
                      !/^\d{4}$/.test(verificationChallenge.trim())) ||
                    actionError?.focusTarget === "verification-challenge"
                  }
                />
                <p
                  id="password-reset-verification-help"
                  className="app-helper"
                >
                  {verificationChallenge.length > 0 &&
                  !/^\d{4}$/.test(verificationChallenge.trim())
                    ? t("verificationChallengeInvalid")
                    : t("verificationChallengeHelp")}
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-3 border border-border-default bg-canvas p-3">
                <input
                  ref={verificationAttestationRef}
                  type="checkbox"
                  required
                  checked={verificationAttested}
                  onChange={(event) => {
                    setVerificationAttested(event.target.checked);
                    setActionError(null);
                  }}
                  disabled={busyRequestId === pendingAction.request.id}
                  className="mt-1"
                  aria-describedby={
                    actionError?.focusTarget === "verification-attestation"
                      ? "password-reset-action-error"
                      : undefined
                  }
                  aria-invalid={
                    actionError?.focusTarget === "verification-attestation"
                  }
                />
                <span className="text-xs leading-relaxed text-text-muted">
                  {t("verificationAttestation")}
                </span>
              </label>
            </div>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
