"use client";

import React from "react";

/**
 * GuestSearchInput — 게스트 목록 검색용 공용 입력 컴포넌트.
 * 검색 아이콘, 텍스트 입력, 초기화(X) 버튼으로 구성.
 *
 * @param value - 현재 검색 키워드
 * @param onChange - 검색 키워드 변경 핸들러
 * @param placeholder - 입력 필드 placeholder (기본: "SEARCH GUEST...")
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
  placeholder = "SEARCH GUEST...",
  className = "",
}) => {
  return (
    <div className={`px-4 py-3 border-b border-gray-700 ${className}`}>
      <div className="relative flex items-center">
        <i className="ri-search-line absolute left-3 text-gray-500 text-sm pointer-events-none"></i>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-gray-800/50 border border-gray-700 pl-9 pr-9 py-2 text-white font-mono text-xs tracking-wider uppercase placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            aria-label="Clear search"
          >
            <i className="ri-close-line text-sm"></i>
          </button>
        )}
      </div>
    </div>
  );
};

export default GuestSearchInput;
