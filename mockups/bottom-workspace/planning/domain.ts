import type { MockState } from "../data/types";
import { MOCK_NOW } from "../data/types";
import {
  bookingStatuses,
  type Artist,
  type Booking,
  type BookingStatus,
} from "./types";

// This standalone mockup uses explicit KST wall times; browser timezone must not change comparisons.
export const timeValue = (value: string) =>
  value ? Date.parse(`${value}:00+09:00`) : NaN;
export const activeBooking = (b: Booking) =>
  !["cancelled", "completed"].includes(b.status);
export const holdExpired = (b: Booking) =>
  b.status === "hold" &&
  !!b.holdUntil &&
  timeValue(b.holdUntil) < Date.parse(MOCK_NOW);
export const safeUrl = (value: string) => {
  if (!value) return true;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
export function artistError(artist: Artist) {
  if (!artist.name.trim()) return "아티스트 이름을 입력해주세요.";
  if (!safeUrl(artist.pressUrl) || !safeUrl(artist.riderUrl))
    return "자료 링크는 http 또는 https 주소를 입력해주세요.";
  if (artist.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(artist.email))
    return "이메일 주소를 확인해주세요.";
  return "";
}
export function bookingError(b: Booking) {
  if (
    (b.start || b.end) &&
    (!Number.isFinite(timeValue(b.start)) || !Number.isFinite(timeValue(b.end)))
  )
    return "출연 시작과 종료 일시를 모두 입력해주세요.";
  if (b.start && timeValue(b.end) <= timeValue(b.start))
    return "종료 일시는 시작보다 늦어야 합니다. 자정 이후에는 다음 날짜를 선택해주세요.";
  if (
    b.arrival &&
    (!b.start ||
      !Number.isFinite(timeValue(b.arrival)) ||
      timeValue(b.arrival) > timeValue(b.start))
  )
    return "도착 일시는 출연 시작 이전으로 입력해주세요.";
  if (
    b.soundcheck &&
    (!b.start ||
      !Number.isFinite(timeValue(b.soundcheck)) ||
      timeValue(b.soundcheck) > timeValue(b.start) ||
      (b.arrival && timeValue(b.soundcheck) < timeValue(b.arrival)))
  )
    return "사운드체크는 도착 이후, 출연 시작 이전으로 입력해주세요.";
  if (b.holdUntil && !Number.isFinite(timeValue(b.holdUntil)))
    return "홀드 기한을 확인해주세요.";
  if (!safeUrl(b.materials.pressUrl) || !safeUrl(b.materials.riderUrl))
    return "자료 링크는 http 또는 https 주소를 입력해주세요.";
  return "";
}
export function conflictsFor(b: Booking, bookings: Booking[]) {
  if (!activeBooking(b) || !b.start || !b.end) return [];
  return bookings.filter(
    (other) =>
      other.id !== b.id &&
      other.scopeId === b.scopeId &&
      activeBooking(other) &&
      (other.artistId === b.artistId ||
        (other.eventId === b.eventId &&
          !!b.stage.trim() &&
          other.stage.trim().toLowerCase() === b.stage.trim().toLowerCase())) &&
      timeValue(b.start) < timeValue(other.end) &&
      timeValue(other.start) < timeValue(b.end),
  );
}
export function assertScope(data: MockState, scopeId: string, actorId: string) {
  const actor = data.users.find(
    (u) => u.id === actorId && u.active && !u.deleted,
  );
  if (
    !actor ||
    !(
      actor.role === "super_admin" ||
      (actor.role === "venue_admin" && actor.venueId === scopeId)
    ) ||
    !data.venues.some((v) => v.id === scopeId && v.active)
  )
    throw Error("이 화면에 접근할 권한이 없습니다.");
}
export function addHistory(b: Booking, actor: string, message: string) {
  b.history.unshift({ id: crypto.randomUUID(), at: MOCK_NOW, actor, message });
}
export function saveBooking(
  data: MockState,
  candidate: Booking,
  actorId: string,
) {
  assertScope(data, candidate.scopeId, actorId);
  const old = data.planning.bookings.find((b) => b.id === candidate.id);
  if (
    old &&
    (old.scopeId !== candidate.scopeId || old.revision !== candidate.revision)
  )
    throw Error("부킹이 변경되었습니다. 닫고 최신 내용을 다시 확인해주세요.");
  if (
    !data.planning.artists.some(
      (a) => a.id === candidate.artistId && a.scopeId === candidate.scopeId,
    )
  )
    throw Error("아티스트를 확인해주세요.");
  const event = data.events.find(
    (e) =>
      e.id === candidate.eventId &&
      e.venueId === candidate.scopeId &&
      !e.general,
  );
  if (!event || !["draft", "open"].includes(event.state))
    throw Error("준비 중이거나 운영 중인 행사를 선택해주세요.");
  if (
    old &&
    (old.artistId !== candidate.artistId || old.eventId !== candidate.eventId)
  )
    throw Error(
      "아티스트와 행사는 기존 부킹에서 바꿀 수 없습니다. 새 부킹을 만들어주세요.",
    );
  const error = bookingError(candidate);
  if (error) throw Error(error);
  if (
    ["confirmed", "completed", "cancelled"].includes(candidate.status) &&
    old?.status !== candidate.status
  )
    throw Error("상세 화면에서 부킹 상태를 변경해주세요.");
  if (
    old &&
    ["confirmed", "completed", "cancelled"].includes(old.status) &&
    old.status !== candidate.status
  )
    throw Error("확정 이후 상태는 상세 화면에서 변경해주세요.");
  if (old && ["completed", "cancelled"].includes(old.status))
    throw Error("완료되거나 취소된 부킹은 수정할 수 없습니다.");
  if (candidate.status === "confirmed") {
    assertConfirmable(candidate, data.planning.bookings);
  }
  const next = structuredClone(candidate);
  if (old) {
    next.tasks = old.tasks;
    next.guestLinkId = old.guestLinkId;
    next.history = old.history;
    next.revision = old.revision + 1;
    const shared = (b: Booking) =>
      JSON.stringify([
        b.start,
        b.end,
        b.arrival,
        b.soundcheck,
        b.stage,
        b.materials,
      ]);
    next.acknowledgedRevision =
      shared(old) === shared(next) && old.acknowledgedRevision === old.revision
        ? next.revision
        : null;
    addHistory(
      next,
      actorId,
      next.status !== old.status
        ? `부킹 상태 변경 · ${bookingStatuses[next.status]}`
        : "부킹 내용 수정",
    );
    data.planning.bookings[data.planning.bookings.indexOf(old)] = next;
  } else {
    addHistory(next, actorId, "부킹 생성");
    data.planning.bookings.unshift(next);
  }
}
function assertConfirmable(b: Booking, bookings: Booking[]) {
  if (!b.start || !b.end || !b.stage.trim() || !b.owner.trim())
    throw Error("출연 일시·무대·담당자를 입력한 뒤 확정해주세요.");
  const error = bookingError(b);
  if (error) throw Error(error);
  if (b.availability !== "available")
    throw Error("상대에게 일정 가능 여부를 확인한 뒤 확정해주세요.");
  if (holdExpired(b))
    throw Error(
      "홀드 기한이 지났습니다. 일정을 재확인하고 기한을 갱신하거나 조율 상태로 변경해주세요.",
    );
  if (conflictsFor(b, bookings).some((other) => other.status === "confirmed"))
    throw Error(
      "확정된 일정과 겹칩니다. 아티스트 또는 무대의 시간을 조정해주세요.",
    );
}
export function transitionBooking(
  data: MockState,
  bookingId: string,
  scopeId: string,
  actorId: string,
  revision: number,
  status: BookingStatus,
) {
  assertScope(data, scopeId, actorId);
  const b = data.planning.bookings.find(
    (b) => b.id === bookingId && b.scopeId === scopeId,
  );
  if (!b || b.revision !== revision)
    throw Error("부킹이 변경되었습니다. 최신 내용을 확인해주세요.");
  if (
    status === "confirmed" &&
    ["inquiry", "negotiating", "hold"].includes(b.status)
  ) {
    const event = data.events.find((e) => e.id === b.eventId);
    if (!event || !["draft", "open"].includes(event.state))
      throw Error("종료된 행사의 부킹은 확정할 수 없습니다.");
    assertConfirmable(b, data.planning.bookings);
  } else if (
    !(status === "cancelled" && activeBooking(b)) &&
    !(status === "completed" && b.status === "confirmed")
  )
    throw Error("이 상태로 변경할 수 없습니다.");
  if (status === "completed" && timeValue(b.end) > Date.parse(MOCK_NOW))
    throw Error("출연 종료 이후에 완료로 기록할 수 있습니다.");
  b.status = status;
  b.revision++;
  b.acknowledgedRevision = null;
  addHistory(b, actorId, `부킹 상태 변경 · ${bookingStatuses[status]}`);
}
export function connectGuestLink(
  data: MockState,
  bookingId: string,
  scopeId: string,
  actorId: string,
  limit: number,
) {
  assertScope(data, scopeId, actorId);
  const b = data.planning.bookings.find(
    (b) => b.id === bookingId && b.scopeId === scopeId,
  );
  if (!b || b.status !== "confirmed")
    throw Error("확정된 부킹에 게스트 링크를 연결할 수 있습니다.");
  if (!Number.isInteger(limit) || limit < 0 || limit > 500)
    throw Error("게스트 한도는 0~500명으로 입력해주세요.");
  const event = data.events.find(
    (e) => e.id === b.eventId && e.venueId === scopeId,
  );
  if (!event || !["draft", "open"].includes(event.state))
    throw Error("종료된 행사에는 게스트 링크를 만들 수 없습니다.");
  const artist = data.planning.artists.find(
    (a) => a.id === b.artistId && a.scopeId === scopeId,
  )!;
  const key = `artist:${artist.id}`;
  const existing = data.links.find(
    (l) =>
      l.eventId === b.eventId &&
      l.venueId === scopeId &&
      l.contributorKey === key &&
      !l.deleted,
  );
  if (existing) {
    b.guestLinkId = existing.id;
    return;
  }
  const linkId = crypto.randomUUID();
  data.links.unshift({
    id: linkId,
    venueId: scopeId,
    eventId: b.eventId,
    ownerName: artist.name,
    contributorKey: key,
    contributorUserId: null,
    kind: "contributor",
    limit,
    active: false,
    deleted: false,
    locale: "auto",
    createdAt: MOCK_NOW,
    expiresAt: null,
  });
  b.guestLinkId = linkId;
  addHistory(b, actorId, "게스트 링크 준비 · 비활성");
}
