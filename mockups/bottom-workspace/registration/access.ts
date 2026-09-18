import { MOCK_NOW, type MockLink, type MockState } from "../data/types";

function writableLink(data: MockState, linkId: string, kind: MockLink["kind"], scenario: string) {
  const link = data.links.find((l) => l.id === linkId && l.kind === kind && l.active && !l.deleted);
  const event = data.events.find((e) => e.id === link?.eventId && e.venueId === link?.venueId);
  if (!link || !event || !["draft", "open"].includes(event.state) ||
    !data.venues.some((v) => v.id === link.venueId && v.active) ||
    data.attendance[event.id]?.finalized ||
    (link.expiresAt && new Date(link.expiresAt).getTime() < new Date(MOCK_NOW).getTime()) ||
    ["link-expired", "link-inactive", "scope-closed", "storage-denied", "unknown-result"].includes(scenario))
    return null;
  return link;
}

export function canWriteLink(data: MockState, linkId: string, kind: MockLink["kind"], scenario: string) {
  return Boolean(writableLink(data, linkId, kind, scenario));
}

export function requireWritableLink(data: MockState, linkId: string, kind: MockLink["kind"], scenario: string) {
  const link = writableLink(data, linkId, kind, scenario);
  if (!link) throw Error("이 게스트 링크를 사용할 수 없거나, 만료 또는 비활성화되었습니다.");
  return link;
}
