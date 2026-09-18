import type { CSSProperties } from "react";

const paths = {
  arrow: "M7 17 17 7M7 7h10v10",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  people:
    "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M20 21v-3a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  home: "m3 10 9-7 9 7v10H3V10m6 10v-7h6v7",
  calendar:
    "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2M3 10h18M8 2v6M16 2v6",
  chart: "M4 3v18h17M8 16v-5M13 16V6M18 16v-8",
  more: "M5 11v2M12 11v2M19 11v2",
  sliders: "M4 7h7M15 7h5M4 17h3M11 17h9M11 4v6M7 14v6",
  code: "M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6M8 8h3v3H8zM15 8h1M8 15h1M13 13h3v3h-3z",
  door: "M3 21h18M7 21V3h11v18M13 12h1",
  link: "m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  user: "M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  venue: "M3 21h18M5 21V4h14v17M9 8h1M14 8h1M9 12h1M14 12h1M10 21v-5h4v5",
  undo: "M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  file: "M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h8",
} as const;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
