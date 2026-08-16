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
import type { ExternalDjSuggestion } from "@/lib/api/types";
import { getContributorNameKey } from "@/lib/contributors/domain";
import { filterExternalDjSuggestions } from "@/lib/contributors/external-dj";
import { MAX_EXTERNAL_LINK_DJ_NAME_LENGTH } from "@/lib/external-links/domain";

interface ExternalDjComboboxProps {
  value: string;
  contributorId: string | null;
  suggestions: readonly ExternalDjSuggestion[];
  isDirectoryEnabled: boolean;
  isDirectoryLoading: boolean;
  directoryError: string | null;
  disabled: boolean;
  hasError: boolean;
  errorId?: string;
  onChange: (value: string, contributorId: string | null) => void;
}

const ExternalDjCombobox = forwardRef<HTMLInputElement, ExternalDjComboboxProps>(
  function ExternalDjCombobox(
    {
      value,
      contributorId,
      suggestions,
      isDirectoryEnabled,
      isDirectoryLoading,
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
      () =>
        isDirectoryEnabled
          ? filterExternalDjSuggestions(suggestions, value)
          : [],
      [isDirectoryEnabled, suggestions, value],
    );
    const selectedSuggestion = useMemo(
      () =>
        contributorId
          ? suggestions.find(
              (suggestion) => suggestion.contributorId === contributorId,
            ) ?? null
          : null,
      [contributorId, suggestions],
    );
    const activeOptionId =
      isOpen && filteredSuggestions[activeIndex]
        ? `${listboxId}-option-${activeIndex}`
        : undefined;
    const describedBy = [errorId, isDirectoryEnabled ? statusId : null]
      .filter(Boolean)
      .join(" ") || undefined;

    useEffect(() => {
      setActiveIndex(0);
    }, [suggestions, value]);

    useEffect(() => {
      if (!isDirectoryEnabled || disabled) setIsOpen(false);
    }, [disabled, isDirectoryEnabled]);

    useEffect(() => {
      if (!isDirectoryEnabled || !value || contributorId) return;
      const nameKey = getContributorNameKey(value);
      const exactMatch = suggestions.find(
        (suggestion) =>
          getContributorNameKey(suggestion.displayName) === nameKey,
      );
      if (exactMatch) {
        onChange(exactMatch.displayName, exactMatch.contributorId);
        setIsOpen(false);
      }
    }, [contributorId, isDirectoryEnabled, onChange, suggestions, value]);

    const chooseSuggestion = (suggestion: ExternalDjSuggestion) => {
      onChange(suggestion.displayName, suggestion.contributorId);
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (!isDirectoryEnabled || disabled) return;
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
          id="link-dj-name"
          name="dj-name"
          type="text"
          role={isDirectoryEnabled ? "combobox" : undefined}
          aria-autocomplete={isDirectoryEnabled ? "list" : undefined}
          aria-expanded={isDirectoryEnabled ? isOpen : undefined}
          aria-controls={isDirectoryEnabled ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          value={value}
          disabled={disabled}
          maxLength={MAX_EXTERNAL_LINK_DJ_NAME_LENGTH}
          onFocus={() =>
            setIsOpen(
              isDirectoryEnabled &&
                !disabled &&
                filteredSuggestions.length > 0,
            )
          }
          onBlur={() => setIsOpen(false)}
          onChange={(event) => {
            const nextValue = event.target.value.toUpperCase();
            const nextNameKey = getContributorNameKey(nextValue);
            const nextSuggestions = isDirectoryEnabled
              ? filterExternalDjSuggestions(suggestions, nextValue)
              : [];
            const exactMatch = suggestions.find(
              (suggestion) =>
                getContributorNameKey(suggestion.displayName) === nextNameKey,
            );
            onChange(
              exactMatch?.displayName ?? nextValue,
              isDirectoryEnabled ? exactMatch?.contributorId ?? null : null,
            );
            setIsOpen(!exactMatch && nextSuggestions.length > 0);
          }}
          onKeyDown={handleKeyDown}
          className={`app-field uppercase ${
            hasError ? "border-status-danger" : "border-border-strong"
          }`}
          placeholder={t("djName")}
          required
        />

        {isOpen && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t("djSuggestions")}
            className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto border border-border-strong bg-surface-raised shadow-lg"
          >
            {filteredSuggestions.map((suggestion, index) => (
              <li
                id={`${listboxId}-option-${index}`}
                key={suggestion.contributorId}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  chooseSuggestion(suggestion);
                }}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm ${
                  index === activeIndex
                    ? "bg-action-primary text-action-text"
                    : "text-text-heading hover:bg-surface-hover"
                }`}
              >
                <span className="truncate font-medium">{suggestion.displayName}</span>
                <span className="shrink-0 font-mono text-[11px] opacity-75">
                  {t("djPreviousLinks", { count: suggestion.linkCount })}
                </span>
              </li>
            ))}
          </ul>
        )}

        {isDirectoryEnabled && (
          <p
            id={statusId}
            className="mt-1 text-xs text-text-dim"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {isDirectoryLoading
              ? t("djSuggestionsLoading")
              : directoryError
                ? directoryError
              : selectedSuggestion
                ? t("existingDjSelected", {
                    name: selectedSuggestion.displayName,
                    count: selectedSuggestion.linkCount,
                  })
                : value
                  ? t("newDjWillBeCreated")
                  : t("djAutocompleteHelp")}
          </p>
        )}
      </div>
    );
  },
);

export default ExternalDjCombobox;
