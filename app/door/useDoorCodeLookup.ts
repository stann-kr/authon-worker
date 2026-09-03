import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useScopedOperationGuard } from "@/lib/hooks";
import {
  parseDoorGuestCode,
  type OfflineDoorScope,
} from "@/lib/door/offline-domain";

export type DoorCodeLookupFeedback =
  | "found"
  | "notFound"
  | "unavailable"
  | null;

interface DoorCodeLookupGuest {
  name: string;
}

export interface DoorCodeLookupDependencies {
  findDoorGuestByCode(params: OfflineDoorScope & {
    code: string;
  }): Promise<{
    data: DoorCodeLookupGuest | null;
    error: string | null;
  }>;
}

interface DoorCodeLookupRosterGuest {
  id: string;
  name: string;
}

interface UseDoorCodeLookupParams {
  scope: OfflineDoorScope | null;
  guests: readonly DoorCodeLookupRosterGuest[];
  isOfflineMode: boolean;
  onGuestFound: (name: string) => void;
  dependencies: DoorCodeLookupDependencies;
}

function getScopeKey(scope: OfflineDoorScope | null): string {
  return JSON.stringify(
    scope
      ? [scope.venueId, scope.eventId, scope.businessDate]
      : null,
  );
}

export default function useDoorCodeLookup({
  scope,
  guests,
  isOfflineMode,
  onGuestFound,
  dependencies,
}: UseDoorCodeLookupParams) {
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState<DoorCodeLookupFeedback>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(code);
  const busyRef = useRef(false);
  const activeOperationIdRef = useRef<number | null>(null);
  const operationGuard = useScopedOperationGuard();
  const scopeKey = getScopeKey(scope);
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;

  useEffect(() => {
    operationGuard.invalidateOperations("door-code-lookup");
    activeOperationIdRef.current = null;
    codeRef.current = "";
    busyRef.current = false;
    setCode("");
    setFeedback(null);
    setBusy(false);
  }, [operationGuard, scopeKey]);

  const change = useCallback((value: string) => {
    codeRef.current = value;
    setCode(value);
    setFeedback(null);
  }, []);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const submittedCode = codeRef.current;
      if (!scope || !submittedCode.trim() || busyRef.current) return;

      busyRef.current = true;
      setBusy(true);
      setFeedback(null);
      const operation = operationGuard.beginOperation(
        scopeKey,
        "door-code-lookup",
      );
      activeOperationIdRef.current = operation.id;

      try {
        if (isOfflineMode || navigator.onLine === false) {
          const guestId = parseDoorGuestCode(submittedCode);
          const localGuest = guestId
            ? guests.find((guest) => guest.id === guestId)
            : null;
          if (!operation.isCurrent(currentScopeKeyRef.current)) return;
          if (!localGuest) {
            setFeedback("notFound");
            return;
          }
          onGuestFound(localGuest.name);
          setFeedback("found");
          return;
        }

        const response = await dependencies.findDoorGuestByCode({
          ...scope,
          code: submittedCode,
        });
        if (!operation.isCurrent(currentScopeKeyRef.current)) return;
        if (response.data) {
          onGuestFound(response.data.name);
          setFeedback("found");
        } else {
          setFeedback(
            response.error === "DOOR_GUEST_CODE_NOT_FOUND" ||
              response.error === "INVALID_DOOR_GUEST_CODE"
              ? "notFound"
              : "unavailable",
          );
        }
      } catch {
        if (operation.isCurrent(currentScopeKeyRef.current)) {
          setFeedback("unavailable");
        }
      } finally {
        if (activeOperationIdRef.current === operation.id) {
          activeOperationIdRef.current = null;
          if (operation.finish(currentScopeKeyRef.current)) {
            busyRef.current = false;
            setBusy(false);
          }
        }
      }
    },
    [
      dependencies,
      guests,
      isOfflineMode,
      onGuestFound,
      operationGuard,
      scope,
      scopeKey,
    ],
  );

  return {
    code,
    feedback,
    busy,
    change,
    submit,
  };
}
