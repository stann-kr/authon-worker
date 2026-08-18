"use client";

import { useVenueBrand } from "@/components/VenueBrandProvider";

interface FooterProps {
  /** true = 카드 내부용 (auth 페이지 등). false = 전체 페이지 하단용 */
  compact?: boolean;
  /** Door의 mobile dock 아래에만 Footer chrome 레이어를 낮춘다. */
  layer?: "chrome" | "below-mobile-dock";
}

export default function Footer({
  compact = false,
  layer = "chrome",
}: FooterProps) {
  const { brand } = useVenueBrand();
  const footerClassName = [
    "relative",
    layer === "chrome" ? "z-[var(--app-z-chrome)]" : "z-0",
    !compact && "mt-auto",
    "flex-shrink-0",
    "bg-canvas",
  ].filter(Boolean).join(" ");

  return (
    <footer className={footerClassName}>
      <div className="mt-8 border-t border-border-subtle py-5 text-center">
        <p className="break-words px-4 text-xs text-text-dim">
          {brand.footer}
        </p>
      </div>
    </footer>
  );
}
