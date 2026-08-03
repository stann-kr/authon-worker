"use client";

import React, { useId } from "react";
import Icon from "./Icon";

/**
 * GuestSearchInput: 게스트 목록 검색용 공용 입력 컴포넌트.
 * 검색 아이콘, 텍스트 입력, 초기화(X) 버튼으로 구성.
 *
 * @param value - 현재 검색 키워드
 * @param onChange - 검색 키워드 변경 핸들러
 * @param placeholder - 입력 필드 placeholder
 * @param className - 외부 래퍼 추가 클래스
 */

interface GuestSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const GuestSearchInput: React.FC<GuestSearchInputProps> = ({
  value,
  onChange,
  placeholder = "Search guests…",
  className = "",
}) => {
  const inputId = useId();

  return (
    <div className={`border-b border-border-subtle bg-surface px-4 py-3 sm:px-5 ${className}`}>
      <label htmlFor={inputId} className="sr-only">
        Search guest names
      </label>
      <div className="relative flex items-center">
        <Icon name="search" size={16} className="pointer-events-none absolute left-3 text-text-dim" />
        <input
          id={inputId}
          name="guest-search"
          type="search"
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="guest-search-input app-field min-h-12 py-2.5 pl-9 pr-12 text-base sm:text-sm"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="pressable absolute inset-y-0 right-0 flex min-h-11 w-11 touch-manipulation items-center justify-center rounded-control text-text-muted hover:bg-surface-hover hover:text-text-heading"
            aria-label="Clear search"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

export default GuestSearchInput;
