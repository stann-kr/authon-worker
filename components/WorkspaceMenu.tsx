"use client";

import Icon, { type IconName } from "@/components/Icon";
import TransitionLink from "@/components/TransitionLink";

export interface WorkspaceMenuItem {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  href: string;
}

interface WorkspaceMenuProps {
  label: string;
  items: WorkspaceMenuItem[];
  onSelect?: (item: WorkspaceMenuItem) => void;
}

export default function WorkspaceMenu({ label, items, onSelect }: WorkspaceMenuProps) {
  return (
    <nav aria-label={label} className="mx-auto w-full border-y border-border-default">
      {items.map((item, index) => (
        <TransitionLink
          key={item.id}
          href={item.href}
          onClick={(event) => {
            if (!onSelect) return;
            event.preventDefault();
            onSelect(item);
          }}
          className="pressable group relative grid min-h-[88px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border-subtle px-4 py-4 last:border-b-0 hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none sm:min-h-[104px] sm:gap-5 sm:px-5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-action-primary before:opacity-0 before:transition-opacity hover:before:opacity-100 focus-visible:before:opacity-100"
        >
          <Icon
            name={item.icon}
            size={22}
            className="text-text-muted group-hover:text-text-heading"
          />
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-[-0.015em] text-text-heading sm:text-lg">
              {item.title}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">
              {item.description}
            </p>
          </div>
          <span className="flex items-center gap-3 text-text-muted group-hover:text-text-heading">
            <kbd className="hidden border border-border-default bg-canvas px-2 py-1 font-mono text-xs text-text-dim sm:inline-block">
              {index + 1}
            </kbd>
            <Icon name="arrow-right" size={18} />
          </span>
        </TransitionLink>
      ))}
    </nav>
  );
}
