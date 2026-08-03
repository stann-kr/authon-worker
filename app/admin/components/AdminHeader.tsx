"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth";
import Icon from "@/components/Icon";
import { useVenueBrand } from "@/components/VenueBrandProvider";

const contextLabels: Record<string, string> = {
  "/admin": "Admin",
  "/door": "Door",
  "/guest": "Guest",
  "/profile": "Profile",
};

export default function AdminHeader() {
  const pathname = usePathname();
  const contextLabel = contextLabels[pathname];
  const { brand } = useVenueBrand();

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border-default bg-canvas">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
        <Link
          href="/"
          className="pressable flex min-w-0 items-center gap-3 rounded-control focus-visible:outline-none"
          aria-label={`${brand.name} Home`}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-border-strong bg-surface font-mono text-sm font-semibold text-text-heading">
            {brand.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-heading">
              {brand.name}
            </span>
            {contextLabel && (
              <span className="block truncate text-xs text-text-muted">
                {contextLabel}
              </span>
            )}
          </span>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {pathname !== "/profile" && (
            <Link
              href="/profile"
              className="pressable flex h-10 w-10 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
              aria-label="Profile settings"
              title="Profile settings"
            >
              <Icon name="user-admin" size={18} />
            </Link>
          )}
          <button
            onClick={logout}
            className="pressable flex h-10 w-10 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
            aria-label="Logout"
            title="Logout"
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
