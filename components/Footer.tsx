"use client";

import { useVenueBrand } from "@/components/VenueBrandProvider";

interface FooterProps {
  /** true = 카드 내부용 (auth 페이지 등). false = 전체 페이지 하단용 */
  compact?: boolean;
}

export default function Footer({ compact = false }: FooterProps) {
  const { brand } = useVenueBrand();
  const footerClassName = compact
    ? "relative z-[var(--app-z-chrome)] flex-shrink-0 bg-canvas"
    : "relative mt-auto flex-shrink-0 bg-canvas";

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
