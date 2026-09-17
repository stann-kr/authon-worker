import type { ExternalLinkDirectoryEntry } from "@/lib/external-links/types";
import type { GuestQuota } from "@/lib/guest-limits/types";
import type { Guest } from "@/lib/guests/types";
import type { UserDirectoryEntry } from "@/lib/users/types";

export interface GuestOperationsSnapshot {
  guests: Guest[];
  users: UserDirectoryEntry[];
  externalLinks: ExternalLinkDirectoryEntry[];
  failedSections: Array<"guests" | "users" | "externalLinks">;
  /** Older server responses omit this during rolling deployments. */
  offlineRosterStatus?: "available" | "unavailable";
}

export interface GuestWorkspaceSnapshot {
  guests: Guest[];
  quota: GuestQuota | null;
  failedSections: Array<"guests" | "quota">;
}
