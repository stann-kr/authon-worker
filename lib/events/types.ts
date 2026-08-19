export type EventState = "draft" | "open" | "closed" | "archived";

export interface Event {
  id: string;
  venueId: string;
  businessDate: string;
  name: string;
  doorOpensAt: string | null;
  guestCutoffAt: string | null;
  capacity: number | null;
  targetGuests: number | null;
  state: EventState;
  templateSourceEventId: string | null;
  compatibilityKey: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  closedAt: string | null;
}

export interface EventTemplateCloneSummary {
  contributors: number;
  externalLinks: number;
}

export interface EventCreationResult {
  event: Event;
  templateClone: EventTemplateCloneSummary;
}
