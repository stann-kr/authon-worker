"use client";

import type { ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";

interface AppHeaderProps {
  brandName: string;
  homeHref: string;
  homeLabel: string;
  contextLabel?: string;
  actions: ReactNode;
}

export default function AppHeader({
  brandName,
  homeHref,
  homeLabel,
  contextLabel,
  actions,
}: AppHeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-[var(--app-z-chrome)] border-b border-border-default bg-canvas">
      <div className="mx-auto flex h-[var(--app-header-height)] w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
        <TransitionLink
          href={homeHref}
          className="pressable flex min-w-0 items-center gap-3 rounded-control focus-visible:outline-none"
          aria-label={homeLabel}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
            {brandName.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-heading">
              {brandName}
            </span>
            {contextLabel && (
              <span className="block truncate text-xs text-text-muted">
                {contextLabel}
              </span>
            )}
          </span>
        </TransitionLink>

        <div className="flex items-center gap-1.5 sm:gap-2">{actions}</div>
      </div>
    </header>
  );
}
