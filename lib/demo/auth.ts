export type DemoRole = "venue_admin" | "door_staff" | "dj";
export type DemoAccess = "guests" | "door" | "requests" | "links";

export interface DemoAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  role: DemoRole;
}

export interface DemoSession {
  version: 1;
  accountId: string;
  name: string;
  email: string;
  role: DemoRole;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    id: "demo-venue-admin",
    name: "Casey Morgan",
    email: "venue.admin@demo.authon.app",
    password: "Demo2026!",
    role: "venue_admin",
  },
  {
    id: "demo-door-staff",
    name: "Noah Park",
    email: "door.staff@demo.authon.app",
    password: "Demo2026!",
    role: "door_staff",
  },
  {
    id: "demo-resident-dj",
    name: "Joon Kim",
    email: "resident.dj@demo.authon.app",
    password: "Demo2026!",
    role: "dj",
  },
] as const;

const accessByRole: Record<DemoRole, readonly DemoAccess[]> = {
  venue_admin: ["guests", "door", "requests", "links"],
  door_staff: ["guests", "door"],
  dj: ["guests"],
};

export function getDemoAccess(role: DemoRole): readonly DemoAccess[] {
  return accessByRole[role];
}

export function authenticateDemoAccount(
  email: string,
  password: string,
): DemoSession | null {
  const normalizedEmail = email.trim().toLocaleLowerCase();
  const account = DEMO_ACCOUNTS.find(
    (candidate) =>
      candidate.email.toLocaleLowerCase() === normalizedEmail &&
      candidate.password === password,
  );

  if (!account) return null;
  return {
    version: 1,
    accountId: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
  };
}

export function isDemoSession(value: unknown): value is DemoSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoSession>;
  if (
    candidate.version !== 1 ||
    typeof candidate.accountId !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.email !== "string" ||
    (candidate.role !== "venue_admin" &&
      candidate.role !== "door_staff" &&
      candidate.role !== "dj")
  ) {
    return false;
  }

  return DEMO_ACCOUNTS.some(
    (account) =>
      account.id === candidate.accountId &&
      account.name === candidate.name &&
      account.email === candidate.email &&
      account.role === candidate.role,
  );
}
