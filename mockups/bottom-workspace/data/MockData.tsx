import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { initialData } from "./fixtures";
import { translate } from "./copy";
import { useMockRoute } from "../workspace/useMockRoute";
import { isBusinessDate } from "../../../lib/events/domain";
import type { AdminAnalyticsUrlState } from "../../../lib/analytics/url-state";
import { availableVenues, needsEvent, needsVenue, resolveScope } from "./scope";
import { assertViewAccess, permissionsFor } from "./access";
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
  type VenuePreview,
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
export function ensureGeneralEvent(data: MockState, venueId: string, date: string) {
  if (!isBusinessDate(date)) throw Error("날짜를 확인해주세요.");
  if (!data.venues.some((v) => v.id === venueId && v.active))
    throw Error("이 베뉴를 사용할 수 없습니다.");
  let event = data.events.find((e) => e.venueId === venueId && e.date === date && e.general);
  if (!event) {
    event = {
      id: id(), venueId, date, name: "일반 명단", state: "open", general: true,
      capacity: null, target: null, createdAt: MOCK_NOW, openedAt: MOCK_NOW,
      closedAt: null, templateId: null,
    };
    data.events.push(event);
  }
  return event;
}
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
  availableVenues: MockVenue[];
  scopeStatus: ReturnType<typeof resolveScope>["status"];
  venuePreview: VenuePreview;
  setVenuePreview: (preview: VenuePreview) => void;
  chooseGeneralScope: (date: string) => void;
  view: View;
  scenario: Scenario;
  locale: Locale;
  busy: boolean;
  notice: string;
  noticeError: boolean;
  operator: string;
  externalLinkId: string;
  authPage: string;
  analyticsPeriod: AdminAnalyticsUrlState;
  setAnalyticsPeriod: (period: AdminAnalyticsUrlState) => void;
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
  chooseVenue: (id: string, date?: string) => void;
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
  canRequestQuota: boolean;
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
  const [businessDate, setBusinessDate] = useState(MOCK_DATE);
  const [venuePreview, setVenuePreviewState] = useState<VenuePreview>("default");
  const [route, setRoute] = useMockRoute();
  const { view, externalLinkId, authPage } = route;
  const setView = (view: View) => setRoute((route) => ({ ...route, view }));
  const setAuthPage = (authPage: string) => setRoute((route) => ({ ...route, authPage }));
  const setExternalLinkId = (externalLinkId: string) => setRoute((route) => ({ ...route, externalLinkId }));
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [locale, setLocale] = useState<Locale>("ko");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [operator, setOperator] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const user = data.users.find((u) => u.id === userId) ?? data.users[0];
  const scope = resolveScope(data, user, venueId, eventId, businessDate);
  const { venue, event } = scope;
  const version = useRef(0),
    pending = useRef(false),
    current = useRef(data);
  current.current = data;
  useLayoutEffect(() => {
    version.current++;
  }, [view, externalLinkId, authPage, user.id, venue.id, event.id, businessDate]);
  const { isSuper, isAdmin, canDoor, canRegister, canRequestQuota } = permissionsFor(user);
  const t = (text: string, values?: Record<string, string | number>) =>
    translate(text, locale, values);
  const navigate = (v: View) => {
    version.current++;
    setView(v);
    setNotice("");
  };
  const chooseEvent = (id: string) => {
    const selected = current.current.events.find((e) => e.id === id &&
      e.venueId === venue.id && e.state !== "archived");
    if (!venue.id || !selected) return;
    version.current++;
    setEventId(id);
    setBusinessDate(selected.date);
    setIntent("");
    setNotice("");
    setScenario("normal");
  };
  const chooseVenue = (id: string, date = businessDate) => {
    if (!availableVenues(data, user).some((v) => v.id === id) || !isBusinessDate(date)) return;
    const next = resolveScope(data, user, id, "", date);
    version.current++;
    setVenueId(id);
    setEventId(next.event.id);
    setBusinessDate(date);
    setIntent("");
    setOperator("");
    setNotice("");
    setScenario("normal");
  };
  const chooseUser = (id: string) => {
    const next = current.current.users.find((u) => u.id === id && !u.deleted && u.active);
    if (!next) return;
    version.current++;
    setUserId(id);
    const nextScope = resolveScope(current.current, next, next.venueId ?? venue.id, "", MOCK_DATE);
    setVenueId(nextScope.venue.id);
    setEventId(nextScope.event.id);
    setBusinessDate(MOCK_DATE);
    setIntent("");
    setView(!nextScope.venue.id ? "home" : next.role === "door_staff" ? "door" : "roster");
    setScenario("normal");
    setNotice("");
    setOperator("");
    setLocale(
      next.locale ??
        nextScope.venue.locale ??
        "ko",
    );
  };
  const chooseGeneralScope = (date: string) => {
    if (!venue.id || !isBusinessDate(date)) return;
    const next = structuredClone(data);
    const general = ensureGeneralEvent(next, venue.id, date);
    if (general.state === "archived") return;
    version.current++;
    setData(next);
    setEventId(general.id);
    setBusinessDate(date);
    setIntent("");
    setNotice("");
    setScenario("normal");
  };
  const setVenuePreview = (preview: VenuePreview) => {
    const next = initialData();
    if (preview === "one") next.venues = next.venues.filter((v) => v.id === (venue.id || user.venueId || "faust"));
    if (preview === "none") next.venues = [];
    if (preview === "inactive") next.venues.forEach((v) => { v.active = false; });
    if (preview === "no-events") next.events = [];
    if (preview === "archived") next.events = next.events.filter((e) => !e.general).map((e) => ({ ...e, state: "archived" }));
    version.current++;
    setData(next);
    setUserId(next.users.some((u) => u.id === user.id) ? user.id : "admin");
    setBusinessDate(MOCK_DATE);
    setEventId("");
    setVenuePreviewState(preview);
    setIntent("");
    setOperator("");
    setNotice("");
    setScenario("normal");
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
      assertViewAccess(current.current, user.id, view, venue.id);
      if ((needsVenue(view) && !venue.id) || (needsEvent(view) && !event.id))
        throw Error("운영할 베뉴와 명단을 먼저 선택해주세요.");
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
      current.current = next;
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
        availableVenues: scope.venues,
        scopeStatus: scope.status,
        venuePreview,
        setVenuePreview,
        chooseGeneralScope,
        view,
        scenario,
        locale,
        busy: busy || scenario === "saving",
        notice,
        noticeError,
        operator,
        externalLinkId,
        authPage,
        analyticsPeriod: route.analytics,
        setAnalyticsPeriod: (analytics) => setRoute((route) => ({ ...route, analytics })),
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
          setBusinessDate(MOCK_DATE);
          setVenuePreviewState("default");
          setIntent("");
          setRoute((route) => ({
            ...route,
            view: "roster",
            analytics: { granularity: "month", anchorDate: MOCK_DATE },
          }));
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
        canRequestQuota,
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
