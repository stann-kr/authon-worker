import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { initialData } from "./fixtures";
import { translate } from "./copy";
import {
  MOCK_DATE,
  MOCK_NOW,
  type MockState,
  type Locale,
  type View,
  type Scenario,
  type MockUser,
  type MockEvent,
  type MockVenue,
} from "./types";
export const id = () => crypto.randomUUID();
export const attendanceFor = (data: MockState, eventId: string) =>
  data.attendance[eventId] ?? {
    walkIns: 0,
    undoIds: [],
    finalized: false,
    finalTotal: null,
    reason: "",
  };
export const activeGuests = (data: MockState, eventId: string) =>
  data.guests.filter((g) => g.eventId === eventId && g.status !== "deleted");
export function quotaFor(data: MockState, userId: string, eventId: string) {
  const user = data.users.find((u) => u.id === userId);
  const extra = data.requests
    .filter(
      (r) =>
        r.userId === userId && r.eventId === eventId && r.state === "approved",
    )
    .reduce((n, r) => n + r.approved, 0);
  const used = activeGuests(data, eventId).filter(
    (g) => g.ownerId === userId && !g.externalLinkId,
  ).length;
  const limit = user?.limit == null ? null : user.limit + extra;
  return {
    used,
    extra,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
  };
}
export function audit(data: MockState, userId: string, action: string) {
  data.audit.unshift({
    id: id(),
    userId,
    venueId: data.users.find((u) => u.id === userId)?.venueId ?? null,
    action,
    at: MOCK_NOW,
  });
}
type Context = {
  intent: string;
  setIntent: (value: string) => void;
  data: MockState;
  user: MockUser;
  venue: MockVenue;
  event: MockEvent;
  view: View;
  scenario: Scenario;
  locale: Locale;
  busy: boolean;
  notice: string;
  noticeError: boolean;
  operator: string;
  externalLinkId: string;
  authPage: string;
  receiptId: string;
  setReceiptId: (id: string) => void;
  setAuthPage: (page: string) => void;
  setExternalLinkId: (id: string) => void;
  setOperator: (v: string) => void;
  setLocale: (v: Locale) => void;
  setScenario: (v: Scenario) => void;
  notify: (message: string) => void;
  navigate: (v: View) => void;
  chooseUser: (id: string) => void;
  chooseEvent: (id: string) => void;
  chooseVenue: (id: string) => void;
  mutate: (
    action: (draft: MockState) => void,
    success?: string,
  ) => Promise<boolean>;
  reset: () => void;
  t: (text: string, values?: Record<string, string | number>) => string;
  isAdmin: boolean;
  isSuper: boolean;
  canDoor: boolean;
  canRegister: boolean;
  writable: boolean;
  setData: React.Dispatch<React.SetStateAction<MockState>>;
};
const MockContext = createContext<Context | null>(null);
export function MockProvider({ children }: { children: ReactNode }) {
  const [intent, setIntent] = useState("");
  const [data, setData] = useState(initialData);
  const [userId, setUserId] = useState("admin");
  const [venueId, setVenueId] = useState("faust");
  const [eventId, setEventId] = useState("tonight");
  const [view, setView] = useState<View>("roster");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [locale, setLocale] = useState<Locale>("ko");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [operator, setOperator] = useState("");
  const [externalLinkId, setExternalLinkId] = useState("rsvp-link");
  const [authPage, setAuthPage] = useState("login");
  const [receiptId, setReceiptId] = useState("");
  const user = data.users.find((u) => u.id === userId) ?? data.users[0];
  const venue = data.venues.find((v) => v.id === venueId) ?? data.venues[0];
  const event =
    data.events.find((e) => e.id === eventId && e.venueId === venue.id) ??
    data.events.find((e) => e.venueId === venue.id) ??
    data.events[0];
  const version = useRef(0),
    pending = useRef(false),
    current = useRef(data);
  current.current = data;
  const isSuper = user.role === "super_admin",
    isAdmin = isSuper || user.role === "venue_admin";
  const canDoor =
    isAdmin ||
    user.role === "door_staff" ||
    (user.accountKind === "shared" && user.doorAccess);
  const canRegister = true;
  const t = (text: string, values?: Record<string, string | number>) =>
    translate(text, locale, values);
  const navigate = (v: View) => {
    version.current++;
    setView(v);
    setNotice("");
  };
  const chooseEvent = (id: string) => {
    version.current++;
    setEventId(id);
    setNotice("");
    setScenario("normal");
  };
  const chooseVenue = (id: string) => {
    if (!isSuper && id !== user.venueId) return;
    const next =
      data.events.find((e) => e.venueId === id && e.date === MOCK_DATE) ??
      data.events.find((e) => e.venueId === id);
    version.current++;
    setVenueId(id);
    if (next) setEventId(next.id);
    setNotice("");
    setScenario("normal");
  };
  const chooseUser = (id: string) => {
    const next = data.users.find((u) => u.id === id && !u.deleted && u.active);
    if (!next) return;
    version.current++;
    setUserId(id);
    const v = next.venueId ?? "faust";
    setVenueId(v);
    setEventId(
      data.events.find(
        (e) => e.venueId === v && e.date === MOCK_DATE && !e.general,
      )?.id ?? "tonight",
    );
    setView(next.role === "door_staff" ? "door" : "roster");
    setScenario("normal");
    setNotice("");
    setOperator("");
    setLocale(
      next.locale ??
        data.venues.find((venue) => venue.id === v)?.locale ??
        "ko",
    );
  };
  const mutate = async (
    action: (draft: MockState) => void,
    success = "저장했습니다.",
  ) => {
    if (pending.current || scenario === "saving") return false;
    pending.current = true;
    setNoticeError(false);
    setBusy(true);
    const started = version.current;
    await new Promise((r) => setTimeout(r, 140));
    try {
      if (started !== version.current) return false;
      if (scenario === "save-error" || scenario === "rate-limited")
        throw Error(
          scenario === "rate-limited"
            ? "짧은 시간에 너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요."
            : "저장하지 못했습니다. 입력 내용은 유지됩니다.",
        );
      if (scenario === "stale")
        throw Error(
          "데이터가 변경되었습니다. 최신 내용을 확인하고 다시 시도해 주세요.",
        );
      if (["artists", "bookings", "schedule", "preparation"].includes(view)) {
        if (scenario === "offline")
          throw Error(
            "인터넷에 연결한 뒤 다시 저장해주세요. 입력 내용은 유지됩니다.",
          );
        if (scenario === "unknown-result")
          throw Error(
            "최신 내용을 확인한 뒤 다시 저장해주세요. 입력 내용은 유지됩니다.",
          );
      }
      const next = structuredClone(current.current);
      action(next);
      setData(next);
      if (scenario === "unknown-result") {
        setNotice(
          "등록 결과를 확인할 수 없어 최신 명단을 다시 불러왔습니다. 다시 시도하기 전에 명단을 확인해주세요.",
        );
        return false;
      }
      setNotice(success);
      return true;
    } catch (error) {
      setNoticeError(true);
      setNotice(
        error instanceof Error
          ? error.message
          : "저장하지 못했습니다. 입력 내용은 유지됩니다.",
      );
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <MockContext.Provider
      value={{
        intent,
        setIntent,
        data,
        setData,
        user,
        venue,
        event,
        view,
        scenario,
        locale,
        busy: busy || scenario === "saving",
        notice,
        noticeError,
        operator,
        externalLinkId,
        authPage,
        receiptId,
        setReceiptId,
        setAuthPage,
        setExternalLinkId,
        setOperator,
        setLocale,
        setScenario,
        notify: setNotice,
        navigate,
        chooseUser,
        chooseEvent,
        chooseVenue,
        mutate,
        reset: () => {
          version.current++;
          setData(initialData());
          setUserId("admin");
          setVenueId("faust");
          setEventId("tonight");
          setView("roster");
          setScenario("normal");
          setReceiptId("");
          setNotice("");
          setOperator("");
        },
        t,
        isAdmin,
        isSuper,
        canDoor,
        canRegister,
        writable:
          user.active &&
          !user.deleted &&
          venue.active &&
          event.state === "open" &&
          !attendanceFor(data, event.id).finalized &&
          scenario !== "scope-closed",
      }}
    >
      {children}
    </MockContext.Provider>
  );
}
export function useMock() {
  const context = useContext(MockContext);
  if (!context) throw Error("MockProvider missing");
  return context;
}

export function useIntent(key: string, handler: () => void) {
  const { intent, setIntent } = useMock();
  useEffect(() => {
    if (intent === key) {
      setIntent("");
      handler();
    }
  }, [intent, key, handler, setIntent]);
}
