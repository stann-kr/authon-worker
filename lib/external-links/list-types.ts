export const LINK_PAGE_SIZE = 10;
export type LinkListFilter = "all" | "active" | "attention";
export type LinkListSort = "newest" | "expiresSoonest" | "djName";
export interface LinkListCursor { value: string; id: string }
export interface LinkListOptions {
  date?: string;
  eventId?: string | null;
  filter: LinkListFilter;
  sort: LinkListSort;
  cursor?: LinkListCursor | null;
}
export interface LinkListStats { total: number; active: number; attention: number }
