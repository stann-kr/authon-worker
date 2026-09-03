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
  defaultLocale?: "en" | "ko" | null;
  timezone: string;
  openingTime: string;
  closingTime: string;
  active: boolean;
}
