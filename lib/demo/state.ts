export type DemoGuestStatus = "waiting" | "checked_in";
export type DemoRequestStatus = "pending" | "approved" | "declined";

export interface DemoGuest {
  id: string;
  name: string;
  host: string;
  partySize: number;
  status: DemoGuestStatus;
  createdAt: string;
  checkedInAt: string | null;
}

export interface DemoGuestLimitRequest {
  id: string;
  requester: string;
  role: "staff" | "dj";
  requestedCount: number;
  approvedCount: number | null;
  reason: string;
  status: DemoRequestStatus;
}

export interface DemoExternalLink {
  id: string;
  label: string;
  capacity: number;
  used: number;
  status: "active" | "paused";
  createdAt: string;
}

export type DemoActivityKind =
  | "guest_added"
  | "guest_checked_in"
  | "guest_check_in_undone"
  | "request_approved"
  | "request_declined"
  | "link_created";

export interface DemoActivity {
  id: string;
  kind: DemoActivityKind;
  subject: string;
  createdAt: string;
}

export interface DemoCompletedSteps {
  guestAdded: boolean;
  guestCheckedIn: boolean;
  requestReviewed: boolean;
  linkCreated: boolean;
}

export interface DemoState {
  version: 1;
  nextSequence: number;
  guests: DemoGuest[];
  requests: DemoGuestLimitRequest[];
  links: DemoExternalLink[];
  activity: DemoActivity[];
  completedSteps: DemoCompletedSteps;
}

export function createDemoState(): DemoState {
  return {
    version: 1,
    nextSequence: 20,
    guests: [
      {
        id: "guest-1",
        name: "Mina Park",
        host: "Resident DJ",
        partySize: 2,
        status: "waiting",
        createdAt: "2026-08-03T12:32:00.000Z",
        checkedInAt: null,
      },
      {
        id: "guest-2",
        name: "Alex Chen",
        host: "Studio Mondo",
        partySize: 1,
        status: "waiting",
        createdAt: "2026-08-03T12:26:00.000Z",
        checkedInAt: null,
      },
      {
        id: "guest-3",
        name: "Rina Sato",
        host: "Resident DJ",
        partySize: 3,
        status: "checked_in",
        createdAt: "2026-08-03T12:08:00.000Z",
        checkedInAt: "2026-08-03T12:51:00.000Z",
      },
      {
        id: "guest-4",
        name: "Theo Martins",
        host: "Night Service",
        partySize: 2,
        status: "checked_in",
        createdAt: "2026-08-03T11:54:00.000Z",
        checkedInAt: "2026-08-03T12:44:00.000Z",
      },
    ],
    requests: [
      {
        id: "request-1",
        requester: "Joon Kim",
        role: "dj",
        requestedCount: 6,
        approvedCount: null,
        reason: "Late international bookings",
        status: "pending",
      },
      {
        id: "request-2",
        requester: "Sora Lee",
        role: "staff",
        requestedCount: 3,
        approvedCount: 3,
        reason: "Artist team",
        status: "approved",
      },
    ],
    links: [
      {
        id: "link-1",
        label: "Studio Mondo — guest list",
        capacity: 20,
        used: 8,
        status: "active",
        createdAt: "2026-08-03T10:30:00.000Z",
      },
      {
        id: "link-2",
        label: "Resident DJ — August 3",
        capacity: 12,
        used: 11,
        status: "active",
        createdAt: "2026-08-03T09:45:00.000Z",
      },
    ],
    activity: [
      {
        id: "activity-1",
        kind: "guest_checked_in",
        subject: "Rina Sato",
        createdAt: "2026-08-03T12:51:00.000Z",
      },
      {
        id: "activity-2",
        kind: "request_approved",
        subject: "Sora Lee · +3",
        createdAt: "2026-08-03T12:37:00.000Z",
      },
    ],
    completedSteps: {
      guestAdded: false,
      guestCheckedIn: false,
      requestReviewed: false,
      linkCreated: false,
    },
  };
}

function nextId(state: DemoState, prefix: string): string {
  return `${prefix}-${state.nextSequence}`;
}

function addActivity(
  state: DemoState,
  kind: DemoActivityKind,
  subject: string,
  createdAt: string,
): DemoActivity[] {
  return [
    {
      id: nextId(state, "activity"),
      kind,
      subject,
      createdAt,
    },
    ...state.activity,
  ].slice(0, 8);
}

export function addDemoGuest(
  state: DemoState,
  input: { name: string; host: string; partySize: number },
  createdAt = new Date().toISOString(),
): DemoState {
  const name = input.name.trim().slice(0, 60);
  const host = input.host.trim().slice(0, 60);
  if (!name || !host) return state;

  const partySize = Math.min(10, Math.max(1, Math.floor(input.partySize)));
  const guest: DemoGuest = {
    id: nextId(state, "guest"),
    name,
    host,
    partySize,
    status: "waiting",
    createdAt,
    checkedInAt: null,
  };

  return {
    ...state,
    nextSequence: state.nextSequence + 1,
    guests: [guest, ...state.guests],
    activity: addActivity(state, "guest_added", name, createdAt),
    completedSteps: { ...state.completedSteps, guestAdded: true },
  };
}

export function setDemoGuestCheckIn(
  state: DemoState,
  guestId: string,
  checkedIn: boolean,
  createdAt = new Date().toISOString(),
): DemoState {
  const guest = state.guests.find((candidate) => candidate.id === guestId);
  if (!guest || (checkedIn && guest.status === "checked_in") || (!checkedIn && guest.status === "waiting")) {
    return state;
  }

  return {
    ...state,
    nextSequence: state.nextSequence + 1,
    guests: state.guests.map((candidate) =>
      candidate.id === guestId
        ? {
            ...candidate,
            status: checkedIn ? "checked_in" : "waiting",
            checkedInAt: checkedIn ? createdAt : null,
          }
        : candidate,
    ),
    activity: addActivity(
      state,
      checkedIn ? "guest_checked_in" : "guest_check_in_undone",
      guest.name,
      createdAt,
    ),
    completedSteps: checkedIn
      ? { ...state.completedSteps, guestCheckedIn: true }
      : state.completedSteps,
  };
}

export function decideDemoRequest(
  state: DemoState,
  requestId: string,
  decision: "approved" | "declined",
  createdAt = new Date().toISOString(),
): DemoState {
  const request = state.requests.find((candidate) => candidate.id === requestId);
  if (!request || request.status !== "pending") return state;

  const approvedCount = decision === "approved" ? request.requestedCount : 0;
  return {
    ...state,
    nextSequence: state.nextSequence + 1,
    requests: state.requests.map((candidate) =>
      candidate.id === requestId
        ? { ...candidate, status: decision, approvedCount }
        : candidate,
    ),
    activity: addActivity(
      state,
      decision === "approved" ? "request_approved" : "request_declined",
      `${request.requester} · ${decision === "approved" ? `+${approvedCount}` : "0"}`,
      createdAt,
    ),
    completedSteps: { ...state.completedSteps, requestReviewed: true },
  };
}

export function createDemoLink(
  state: DemoState,
  input: { label: string; capacity: number },
  createdAt = new Date().toISOString(),
): DemoState {
  const label = input.label.trim().slice(0, 80);
  if (!label) return state;

  const capacity = Math.min(100, Math.max(1, Math.floor(input.capacity)));
  const link: DemoExternalLink = {
    id: nextId(state, "link"),
    label,
    capacity,
    used: 0,
    status: "active",
    createdAt,
  };

  return {
    ...state,
    nextSequence: state.nextSequence + 1,
    links: [link, ...state.links],
    activity: addActivity(state, "link_created", label, createdAt),
    completedSteps: { ...state.completedSteps, linkCreated: true },
  };
}

export function isDemoState(value: unknown): value is DemoState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoState>;
  const steps = candidate.completedSteps as Partial<DemoCompletedSteps> | undefined;
  return (
    candidate.version === 1 &&
    typeof candidate.nextSequence === "number" &&
    Array.isArray(candidate.guests) && candidate.guests.every(isDemoGuest) &&
    Array.isArray(candidate.requests) && candidate.requests.every(isDemoRequest) &&
    Array.isArray(candidate.links) && candidate.links.every(isDemoLink) &&
    Array.isArray(candidate.activity) && candidate.activity.every(isDemoActivity) &&
    typeof steps?.guestAdded === "boolean" &&
    typeof steps.guestCheckedIn === "boolean" &&
    typeof steps.requestReviewed === "boolean" &&
    typeof steps.linkCreated === "boolean"
  );
}

function isDemoGuest(value: unknown): value is DemoGuest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoGuest>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.host === "string" &&
    typeof candidate.partySize === "number" &&
    (candidate.status === "waiting" || candidate.status === "checked_in") &&
    typeof candidate.createdAt === "string" &&
    (candidate.checkedInAt === null || typeof candidate.checkedInAt === "string")
  );
}

function isDemoRequest(value: unknown): value is DemoGuestLimitRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoGuestLimitRequest>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.requester === "string" &&
    (candidate.role === "staff" || candidate.role === "dj") &&
    typeof candidate.requestedCount === "number" &&
    (candidate.approvedCount === null || typeof candidate.approvedCount === "number") &&
    typeof candidate.reason === "string" &&
    (candidate.status === "pending" ||
      candidate.status === "approved" ||
      candidate.status === "declined")
  );
}

function isDemoLink(value: unknown): value is DemoExternalLink {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoExternalLink>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.capacity === "number" &&
    typeof candidate.used === "number" &&
    (candidate.status === "active" || candidate.status === "paused") &&
    typeof candidate.createdAt === "string"
  );
}

function isDemoActivity(value: unknown): value is DemoActivity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoActivity>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.subject === "string" &&
    typeof candidate.createdAt === "string" &&
    (candidate.kind === "guest_added" ||
      candidate.kind === "guest_checked_in" ||
      candidate.kind === "guest_check_in_undone" ||
      candidate.kind === "request_approved" ||
      candidate.kind === "request_declined" ||
      candidate.kind === "link_created")
  );
}

export function getDemoProgress(state: DemoState): number {
  return Object.values(state.completedSteps).filter(Boolean).length;
}
