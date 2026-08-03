"use client";

import { useVenueBrand } from "@/components/VenueBrandProvider";

interface FooterProps {
  /** true = 카드 내부용 (auth 페이지 등). false = 전체 페이지 하단용 */
  compact?: boolean;
  /** 데모처럼 실제 tenant context를 사용하지 않는 화면의 표시 문구 */
  text?: string;
}

export default function Footer({ compact = false, text }: FooterProps) {
  const { brand } = useVenueBrand();
  const footerClassName = compact
    ? "relative z-[var(--app-z-chrome)] flex-shrink-0 bg-canvas"
    : "relative z-[var(--app-z-chrome)] mt-auto flex-shrink-0 bg-canvas";

  return (
    <footer className={footerClassName}>
      <div className="mt-8 border-t border-border-subtle py-5 text-center">
        <p className="text-xs text-text-dim">
          {text ?? brand.footer}
        </p>
      </div>
    </footer>
  );
}
