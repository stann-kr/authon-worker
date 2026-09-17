import { useId, useLayoutEffect, useRef, useState } from "react";
import { useMock } from "../data/MockData";
import { Icon } from "../shared/Icon";

export function BookingSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useMock();
  const [open, setOpen] = useState(false);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const close = () => {
    onChange("");
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <>
      <button
        ref={toggle}
        type="button"
        className="planning-search-toggle"
        aria-label={t(open ? "검색 닫기" : "검색 열기")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name={open ? "close" : "search"} size={19} />
      </button>
      <label
        className="field planning-search-field"
        hidden={!open}
        htmlFor={id}
      >
        <span className="sr-only">{t("부킹 검색")}</span>
        <input
          ref={input}
          id={id}
          type="search"
          value={value}
          placeholder={t("아티스트·행사·담당자")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (value) onChange("");
            else close();
          }}
        />
      </label>
    </>
  );
}
