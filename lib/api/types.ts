export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

export interface Venue {
  id: string;
  name: string;
  type: "club" | "bar" | "lounge" | "festival" | "private";
  address?: string | null;
  description?: string | null;
  brandName?: string | null;
  brandTagline?: string | null;
  brandDescription?: string | null;
  brandFooter?: string | null;
  primaryDomain?: string | null;
  active: boolean;
}

export interface User {
  id: string;
  venueId: string | null; // null for super_admin
  email: string;
  name: string;
  role: "super_admin" | "venue_admin" | "door_staff" | "staff" | "dj";
  guestLimit: number | null;
  active: boolean;
}

export interface Guest {
  id: string;
  venueId: string;
  name: string;
  email?: string | null;
  instagram?: string | null;
  externalLinkId?: string | null;
  createdByUserId?: string | null;
  status: "pending" | "checked" | "deleted";
  checkInTime?: string | null;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalDJLink {
  id: string;
  venueId: string;
  token: string;
  djName: string;
  event: string | null;
  date: string | null;
  maxGuests: number;
  usedGuests: number;
  active: boolean;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  guestUrl?: string | null;
}
