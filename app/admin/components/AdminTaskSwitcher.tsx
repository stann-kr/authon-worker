"use client";

import type { MouseEvent } from "react";
import Icon, { type IconName } from "@/components/Icon";
import {
  getAdminTaskSearch,
  type AdminTask,
  type AdminTaskGroup,
} from "@/lib/admin-navigation";

export interface AdminTaskOption {
  id: AdminTask;
  group: AdminTaskGroup;
  label: string;
}

interface AdminTaskSwitcherProps {
  label: string;
  groupLabels: Record<AdminTaskGroup, string>;
  options: AdminTaskOption[];
  value: AdminTask;
  onChange: (task: AdminTask) => void;
  disabled?: boolean;
}

const groupOrder: AdminTaskGroup[] = ["guests", "links", "users", "venues"];

const groupIcons: Record<AdminTaskGroup, IconName> = {
  guests: "users",
  links: "link",
  users: "user-admin",
  venues: "store",
};

export default function AdminTaskSwitcher({
  label,
  groupLabels,
  options,
  value,
  onChange,
  disabled = false,
}: AdminTaskSwitcherProps) {
  const handleTaskClick = (
    event: MouseEvent<HTMLAnchorElement>,
    task: AdminTask,
  ) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onChange(task);
  };

  return (
    <>
      <nav aria-label={label} className="app-panel p-2 lg:hidden">
        <div className="grid grid-cols-3 gap-1">
          {options.map((option) => {
            const isActive = option.id === value;
            return (
              <a
                key={option.id}
                href={`/admin${getAdminTaskSearch(option.id)}`}
                aria-label={`${groupLabels[option.group]} · ${option.label}`}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={disabled || undefined}
                tabIndex={disabled ? -1 : undefined}
                onClick={(event) => handleTaskClick(event, option.id)}
                className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 border px-1.5 py-2 text-center text-[0.6875rem] font-medium leading-tight ${
                  isActive
                    ? "border-action-primary bg-surface-active text-text-heading"
                    : "border-transparent bg-surface text-text-muted"
                } ${disabled ? "pointer-events-none opacity-50" : ""}`}
              >
                <Icon name={groupIcons[option.group]} size={15} />
                <span className="max-w-full break-keep">{option.label}</span>
              </a>
            );
          })}
        </div>
      </nav>

      <nav aria-label={label} className="app-panel hidden lg:block">
        <div className="grid gap-2 p-2">
          {groupOrder.map((group) => {
            const groupOptions = options.filter(
              (option) => option.group === group,
            );
            if (groupOptions.length === 0) return null;

            return (
              <section key={group} aria-labelledby={`admin-group-${group}`}>
                <h2
                  id={`admin-group-${group}`}
                  className="flex min-h-9 items-center gap-2 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-dim"
                >
                  <Icon name={groupIcons[group]} size={16} />
                  {groupLabels[group]}
                </h2>
                <div className="grid gap-1">
                  {groupOptions.map((option) => {
                    const isActive = option.id === value;
                    return (
                      <a
                        key={option.id}
                        href={`/admin${getAdminTaskSearch(option.id)}`}
                        aria-current={isActive ? "page" : undefined}
                        aria-disabled={disabled || undefined}
                        tabIndex={disabled ? -1 : undefined}
                        onClick={(event) =>
                          handleTaskClick(event, option.id)
                        }
                        className={`flex min-h-11 w-full items-center justify-between border-l-2 px-3 py-2 text-left text-sm font-medium ${
                          isActive
                            ? "border-action-primary bg-surface-active text-text-heading"
                            : "border-transparent bg-surface text-text-muted"
                        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
                      >
                        <span>{option.label}</span>
                        {isActive && <Icon name="chevron-right" size={16} />}
                      </a>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </nav>
    </>
  );
}
