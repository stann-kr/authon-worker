import { initialData } from "../data/fixtures";

// Only the explicit comparison URL uses this larger, in-memory sample.
export function initialRosterComparisonData() {
  const data = initialData();
  const base = data.guests.find((guest) => guest.id === "g1")!;
  const names = [
    "김서윤", "Lucas Hernández-Müller", "정하늘", "CHOI MINJUN", "한유진",
    "이수빈", "Noah Bennett", "최예린", "Daniel Park", "강민재",
    "서지안", "Emma Lee", "정우진", "박소연", "김태오",
  ];
  data.guests.push(...names.map((name, index) => {
    const checked = [2, 5, 8, 12].includes(index);
    const id = `comparison-${index + 1}`;
    return {
      ...base,
      id,
      name,
      ownerId: ["milo", "team", "sora"][index % 3],
      externalLinkId: null,
      operator: index % 3 === 1 ? "샘플 입력자" : "",
      code: `AUTHON:MOCKUP:${id}`,
      createdAt: `2026-09-12T19:${String(59 - index).padStart(2, "0")}:00+09:00`,
      status: checked ? "checked" as const : "pending" as const,
      checkedAt: checked ? "2026-09-12T23:37:00+09:00" : null,
      checkIns: checked ? 1 : 0,
      cancellations: 0,
    };
  }));
  return data;
}
