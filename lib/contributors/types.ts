export interface VenueContributor {
  id: string;
  venueId: string;
  displayName: string;
  kind: "dj";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContributorSourceMapping {
  sourceKind: "user" | "external_link";
  sourceId: string;
  contributorId: string | null;
}

export interface ExternalDjSuggestion {
  contributorId: string;
  displayName: string;
  linkCount: number;
  lastUsedDate: string | null;
}
