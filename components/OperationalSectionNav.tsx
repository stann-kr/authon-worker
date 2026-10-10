"use client";

import Icon, { type IconName } from "./Icon";

export interface OperationalSectionNavItem<T extends string> {
  id: T;
  label: string;
  icon: IconName;
}

interface OperationalSectionNavProps<T extends string> {
  label: string;
  items: OperationalSectionNavItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  disabled?: boolean;
}

export default function OperationalSectionNav<T extends string>({
  label,
  items,
  activeId,
  onChange,
  disabled = false,
}: OperationalSectionNavProps<T>) {
  return (
    <nav className="app-panel p-4 sm:p-5" aria-label={label}>
      <h2 className="type-context-title mb-3">{label}</h2>
      <div className="space-y-2">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onChange(item.id)}
              className={`relative flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-control border p-3 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? "border-border-strong bg-surface-active text-text-heading"
                  : "border-border-default bg-surface-raised text-text-muted hover:border-border-strong hover:text-text-heading"
              }`}
            >
              {/* A straight inset bar keeps the accent from bending around the rounded corner. */}
              {isActive && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-action-primary" />}
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
