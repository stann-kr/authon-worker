export type GuestDisplaySortMode = "default" | "alpha";

interface GuestDisplayOrderItem {
  status: string;
  name?: string | null;
  createdAt?: string | null;
}

interface GuestDisplayOrderOptions {
  sortMode: GuestDisplaySortMode;
  locale: string;
  prioritizeWaiting: boolean;
}

function getCreatedTime(value?: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Door 명단 정렬 정책을 한 곳에서 적용합니다.
 * 원본 배열을 변경하지 않으며 동률이면 기존 화면 순서를 보존합니다.
 */
export function orderGuestDisplayList<T extends GuestDisplayOrderItem>(
  guests: readonly T[],
  options: GuestDisplayOrderOptions,
): T[] {
  return guests
    .map((guest, originalIndex) => ({ guest, originalIndex }))
    .sort((a, b) => {
      if (options.prioritizeWaiting && a.guest.status !== b.guest.status) {
        if (a.guest.status === "pending") return -1;
        if (b.guest.status === "pending") return 1;
      }

      const contentOrder =
        options.sortMode === "alpha"
          ? (a.guest.name ?? "").localeCompare(
              b.guest.name ?? "",
              options.locale,
              { sensitivity: "base" },
            )
          : getCreatedTime(a.guest.createdAt) -
            getCreatedTime(b.guest.createdAt);

      return contentOrder || a.originalIndex - b.originalIndex;
    })
    .map(({ guest }) => guest);
}
