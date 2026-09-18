"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import ConfirmDialog from "@/components/ConfirmDialog";
import DisclosureSection from "@/components/DisclosureSection";
import EmptyState from "@/components/EmptyState";
import PanelHeader from "@/components/PanelHeader";
import RoleLabel from "@/components/RoleLabel";
import Skeleton from "@/components/Skeleton";
import AsyncListContent from "@/components/AsyncListContent";
import {
  fetchPasswordResetRequests,
  rejectPasswordResetRequest,
  startManagedPasswordReset,
} from "@/lib/api/password-reset-requests";
import type {
  PasswordResetRequestView,
  PasswordResetVerificationMethod,
} from "@/lib/auth/password-reset-request-types";
import { useLatestRequestGuard } from "@/lib/hooks";
import { formatVenueDateTime } from "@/lib/date";
import { useVenueSelector } from "@/components/VenueSelector";
import {
  deriveAsyncListState,
} from "@/lib/ui/async-list-state";
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
  venueId: string | null;
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
  const { venues, currentVenue } = useVenueSelector();
  const [requests, setRequests] = useState<PasswordResetRequestView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadOutcome, setLoadOutcome] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [loadError, setLoadError] = useState("");
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
  const requestsPanelRef = useRef<HTMLElement>(null);
  const rejectButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const rejectCancelRef = useRef<HTMLButtonElement>(null);
  const activeDecisionRef = useRef<symbol | null>(null);
  const shouldFocusResultRef = useRef(false);
  const requestGuard = useLatestRequestGuard();

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
    setLoadError("");
    try {
      const { data, error } = await fetchPasswordResetRequests();
      if (!isLatestRequest()) return;
      if (error) {
        console.error("Failed to load password reset requests:", error);
        setLoadError(t("loadFailed"));
        setRequests([]);
        onPendingCountChange?.(0);
        setLoadOutcome("error");
        return;
      }
      const nextRequests = data ?? [];
      setRequests(nextRequests);
      onPendingCountChange?.(
        nextRequests.filter((request) => request.status === "pending").length,
      );
      setLoadOutcome("success");
    } catch (error: unknown) {
      if (!isLatestRequest()) return;
      console.error("Failed to load password reset requests:", error);
      setLoadError(t("loadFailed"));
      setRequests([]);
      onPendingCountChange?.(0);
      setLoadOutcome("error");
    } finally {
      if (isLatestRequest()) setIsLoading(false);
    }
  }, [onPendingCountChange, requestGuard, t]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(
    () => () => {
      activeDecisionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (pendingAction?.kind !== "reject") return;
    const frameId = window.requestAnimationFrame(() => {
      rejectCancelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [pendingAction]);

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
    if (pendingAction?.kind === "reject") {
      const requestId = pendingAction.request.id;
      window.requestAnimationFrame(() => {
        const target =
          rejectButtonsRef.current.get(requestId) ?? requestsPanelRef.current;
        target?.focus({ preventScroll: true });
      });
    }
  };

  const handlePendingAction = async () => {
    if (!pendingAction || activeDecisionRef.current) return;
    const decision = Symbol("password-reset-decision");
    activeDecisionRef.current = decision;
    const { request, kind } = pendingAction;
    setBusyRequestId(request.id);
    setActionError(null);
    setFeedback(null);
    try {
      if (kind === "reject") {
        const { error } = await rejectPasswordResetRequest(request.id);
        if (activeDecisionRef.current !== decision) return;
        if (error) {
          showActionError(getActionError(error));
          return;
        }
        setFeedback({ type: "success", message: t("rejected") });
        await loadRequests();
        if (activeDecisionRef.current !== decision) return;
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
      if (activeDecisionRef.current !== decision) return;
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
        venueId: request.venueId,
      });
      setFeedback({
        type: "success",
        message: t("approvedDirect"),
      });
      await loadRequests();
      if (activeDecisionRef.current !== decision) return;
      closePendingAction();
    } catch (error: unknown) {
      if (activeDecisionRef.current !== decision) return;
      console.error("Failed to decide password reset request:", error);
      showActionError(t("decisionFailed"));
    } finally {
      if (activeDecisionRef.current === decision) {
        activeDecisionRef.current = null;
        setBusyRequestId(null);
      }
    }
  };

  const formatDate = (value: string | null, venueId?: string | null): string => {
    if (!value) return "-";
    return (
      formatVenueDateTime(value, {
        locale: locale === "ko" ? "ko-KR" : "en-US",
        timeZone:
          venues.find((venue) => venue.id === venueId)?.timezone ??
          currentVenue?.timezone,
      }) ?? "-"
    );
  };

  const getStatusLabel = (request: PasswordResetRequestView): string => {
    if (request.status === "approved") {
      return request.setupMethod === "admin_approved"
        ? t("historyDirect")
        : t("historyCode");
    }
    return t(`status_${request.status}`);
  };
  const listState = deriveAsyncListState({
    hasStarted: isLoading || loadOutcome !== "idle",
    isLoading,
    itemCount: pendingRequests.length,
    hasError: loadOutcome === "error",
  });

  return (
    <>
      <section
        ref={requestsPanelRef}
        tabIndex={-1}
        className="record-collection outline-none"
        aria-labelledby="password-reset-requests-title"
      >
        <PanelHeader
          title={t("title")}
          headingId="password-reset-requests-title"
          count={pendingRequests.length}
          onRefresh={loadRequests}
          isLoading={isLoading}
        />
        <div className="record-collection-body space-y-4">
          <p className="text-sm leading-relaxed text-text-muted">
            {t("description")}
          </p>
          {loadError && <Alert type="error" message={loadError} />}
          {feedback && <Alert type={feedback.type} message={feedback.message} />}

          {resetResult && (
            <div
              ref={resultPanelRef}
              tabIndex={-1}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="border border-status-waiting/70 bg-status-waiting/10 p-4 outline-none"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-text-heading">
                    {t("directResultTitle", { name: resetResult.userName })}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-text-muted">
                    {t("directResultHelp", {
                      expiresAt: formatDate(
                        resetResult.expiresAt,
                        resetResult.venueId,
                      ),
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

          <AsyncListContent
            state={listState}
            loading={<Skeleton rows={4} />}
            empty={<EmptyState icon="key" message={t("noPending")} />}
          >
            <div className="record-list">
              {pendingRequests.map((request) => (
                <article
                  key={request.id}
                  className="record-review-row"
                  aria-busy={busyRequestId === request.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="type-row-title break-words">
                        {request.userName}
                      </h3>
                      <p className="mt-1 break-all font-mono text-xs text-text-muted">
                        {request.userEmail}
                      </p>
                    </div>
                    <RoleLabel role={request.userAccountKind === "shared" ? "shared" : request.userRole} colored />
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
                          {formatDate(request.createdAt, request.venueId)}
                        </time>
                      </dd>
                    </div>
                  </dl>
                  {pendingAction?.kind === "reject" &&
                  pendingAction.request.id === request.id ? (
                    <div
                      className="mt-4 space-y-3"
                      role="group"
                      aria-labelledby={`reject-request-${request.id}`}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !activeDecisionRef.current) {
                          event.preventDefault();
                          event.stopPropagation();
                          closePendingAction();
                        }
                      }}
                    >
                      <p
                        id={`reject-request-${request.id}`}
                        className="text-sm text-text-heading"
                      >
                        {t("rejectTitle", { name: request.userName })}
                      </p>
                      {actionError && (
                        <div
                          ref={actionErrorRef}
                          id={`reject-request-error-${request.id}`}
                          tabIndex={-1}
                        >
                          <Alert type="error" message={actionError.message} />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          ref={rejectCancelRef}
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!activeDecisionRef.current) closePendingAction();
                          }}
                          disabled={busyRequestId !== null}
                        >
                          {commonT("cancel")}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={handlePendingAction}
                          aria-describedby={
                            actionError ? `reject-request-error-${request.id}` : undefined
                          }
                          isLoading={busyRequestId === request.id}
                        >
                          {t("reject")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <Button
                        type="button"
                        size="sm"
                        fullWidth
                        onClick={() => {
                          if (activeDecisionRef.current) return;
                          setActionError(null);
                          setFeedback(null);
                          setVerificationMethod(null);
                          setVerificationChallenge("");
                          setVerificationAttested(false);
                          setPendingAction({ kind: "approve", request });
                        }}
                        disabled={busyRequestId !== null || !request.codeFreeEligible}
                        title={!request.codeFreeEligible ? t("directNotAllowed") : undefined}
                      >
                        {t("process")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        fullWidth
                        variant="outline"
                        ref={(button) => {
                          if (button) rejectButtonsRef.current.set(request.id, button);
                          else rejectButtonsRef.current.delete(request.id);
                        }}
                        onClick={() => {
                          if (activeDecisionRef.current) return;
                          setActionError(null);
                          setFeedback(null);
                          setPendingAction({ kind: "reject", request });
                        }}
                        disabled={busyRequestId !== null}
                      >
                        {t("reject")}
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </AsyncListContent>

          {decidedRequests.length > 0 && (
            <DisclosureSection title={t("history", { count: decidedRequests.length })}>
              <div className="divide-y divide-border-subtle border border-border-default bg-canvas">
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
            </DisclosureSection>
          )}
        </div>
      </section>

      {pendingAction?.kind === "approve" && (
        <ConfirmDialog
          open
          role="dialog"
          title={t("approveTitle", { name: pendingAction.request.userName })}
          description={t("approveDescription")}
          confirmLabel={t("approve")}
          cancelLabel={commonT("cancel")}
          onConfirm={handlePendingAction}
          onCancel={() => {
            if (!activeDecisionRef.current) closePendingAction();
          }}
          isLoading={busyRequestId === pendingAction.request.id}
          confirmDisabled={
            !verificationMethod ||
            !verificationAttested ||
            !/^\d{4}$/.test(verificationChallenge.trim())
          }
          tone="primary"
        >
          {actionError && (
            <div
              ref={actionErrorRef}
              id="password-reset-action-error"
              className="mb-4 outline-none"
              tabIndex={-1}
            >
              <Alert type="error" message={actionError.message} />
            </div>
          )}
          <div className="space-y-4">
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
                        className="mt-1 accent-action-primary"
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
                  className="mt-1 accent-action-primary"
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
        </ConfirmDialog>
      )}
    </>
  );
}
