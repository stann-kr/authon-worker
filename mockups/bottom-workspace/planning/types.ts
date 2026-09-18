export type ArtistKind = "dj" | "live" | "band" | "performer";
export interface Artist {
  id: string;
  scopeId: string;
  name: string;
  kind: ArtistKind;
  city: string;
  contact: string;
  email: string;
  agency: string;
  bio: string;
  pressUrl: string;
  riderUrl: string;
  notes: string;
}
export type BookingStatus =
  "inquiry" | "negotiating" | "hold" | "confirmed" | "completed" | "cancelled";
export interface PreparationTask {
  id: string;
  title: string;
  owner: string;
  due: string;
  done: boolean;
}
export interface Booking {
  id: string;
  scopeId: string;
  artistId: string;
  eventId: string;
  status: BookingStatus;
  owner: string;
  start: string;
  end: string;
  arrival: string;
  soundcheck: string;
  stage: string;
  changeoverMinutes: number;
  travelMinutes: number;
  nextAction: string;
  due: string;
  holdUntil: string;
  availability: "unknown" | "available" | "unavailable";
  notes: string;
  materials: { pressUrl: string; riderUrl: string; requirements: string };
  tasks: PreparationTask[];
  revision: number;
  acknowledgedRevision: number | null;
  materialsReviewedRevision: number | null;
  cancellation: { reason: string; linkAction: "keep" | "pause" } | null;
  guestLinkId: string | null;
  history: { id: string; at: string; actor: string; message: string }[];
}
export interface PlanningState {
  artists: Artist[];
  bookings: Booking[];
}
export const artistKinds: Record<ArtistKind, string> = {
  dj: "DJ",
  live: "라이브",
  band: "밴드",
  performer: "공연자",
};
export const bookingStatuses: Record<BookingStatus, string> = {
  inquiry: "문의",
  negotiating: "조율 중",
  hold: "홀드",
  confirmed: "확정",
  completed: "완료",
  cancelled: "취소",
};
