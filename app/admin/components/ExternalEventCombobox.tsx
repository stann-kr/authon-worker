"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import type { ExternalEventSuggestion } from "@/lib/external-links/types";
import { MAX_EXTERNAL_LINK_EVENT_LENGTH } from "@/lib/external-links/domain";

interface ExternalEventComboboxProps {
  value: string;
  suggestions: readonly ExternalEventSuggestion[];
  isLoading: boolean;
  directoryError: string | null;
  disabled: boolean;
  hasError: boolean;
  errorId?: string;
  onChange: (value: string) => void;
}

function getEventNameKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

function filterEventSuggestions(
  suggestions: readonly ExternalEventSuggestion[],
  query: string,
): ExternalEventSuggestion[] {
  const queryKey = getEventNameKey(query);
  if (!queryKey) return suggestions.slice(0, 8);
  return suggestions
    .filter((suggestion) =>
      getEventNameKey(suggestion.eventName).includes(queryKey),
    )
    .sort((left, right) => {
      const leftKey = getEventNameKey(left.eventName);
      const rightKey = getEventNameKey(right.eventName);
      const leftRank = leftKey === queryKey ? 0 : leftKey.startsWith(queryKey) ? 1 : 2;
      const rightRank = rightKey === queryKey ? 0 : rightKey.startsWith(queryKey) ? 1 : 2;
      return leftRank - rightRank;
    })
    .slice(0, 8);
}

const ExternalEventCombobox = forwardRef<
  HTMLInputElement,
  ExternalEventComboboxProps
>(function ExternalEventCombobox(
  {
    value,
    suggestions,
    isLoading,
    directoryError,
    disabled,
    hasError,
    errorId,
    onChange,
  },
  ref,
) {
  const t = useTranslations("LinkAdmin");
  const listboxId = useId();
  const statusId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredSuggestions = useMemo(
    () => filterEventSuggestions(suggestions, value),
    [suggestions, value],
  );
  const activeOptionId =
    isOpen && filteredSuggestions[activeIndex]
      ? `${listboxId}-option-${activeIndex}`
      : undefined;
  const describedBy = [errorId, statusId].filter(Boolean).join(" ") || undefined;

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestions, value]);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  const chooseSuggestion = (suggestion: ExternalEventSuggestion) => {
    onChange(suggestion.eventName);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(filteredSuggestions.length > 0);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((index) =>
        Math.min(index + 1, filteredSuggestions.length - 1),
      );
    } else if (event.key === "ArrowUp") {
      if (!isOpen) return;
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && isOpen) {
      const suggestion = filteredSuggestions[activeIndex];
      if (!suggestion) return;
      event.preventDefault();
      chooseSuggestion(suggestion);
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        id="link-event-name"
        name="event-name"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={value}
        disabled={disabled}
        maxLength={MAX_EXTERNAL_LINK_EVENT_LENGTH}
        onFocus={() =>
          setIsOpen(!disabled && filteredSuggestions.length > 0)
        }
        onBlur={() => setIsOpen(false)}
        onChange={(event) => {
          const nextValue = event.target.value.toUpperCase();
          onChange(nextValue);
          setIsOpen(filterEventSuggestions(suggestions, nextValue).length > 0);
        }}
        onKeyDown={handleKeyDown}
        className={`app-field uppercase ${
          hasError ? "border-status-danger" : "border-border-default"
        }`}
        placeholder={t("eventName")}
        required
      />

      {isOpen && filteredSuggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t("eventSuggestions")}
          className="absolute z-30 mt-1 max-h-64 w-full space-y-1 overflow-y-auto rounded-control border border-border-default bg-surface-raised p-1 shadow-lg"
        >
          {filteredSuggestions.map((suggestion, index) => (
            <li
              id={`${listboxId}-option-${index}`}
              key={suggestion.eventName}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                chooseSuggestion(suggestion);
              }}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm ${
                index === activeIndex
                  ? "bg-surface-active text-text-heading"
                  : "text-text-heading hover:bg-surface-hover"
              }`}
            >
              <span className="truncate font-medium">{suggestion.eventName}</span>
            </li>
          ))}
        </ul>
      )}

      <p
        id={statusId}
        className="mt-1 text-xs text-text-dim"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {isLoading
          ? t("eventSuggestionsLoading")
          : directoryError
            ? directoryError
            : t("eventAutocompleteHelp")}
      </p>
    </div>
  );
});

export default ExternalEventCombobox;
