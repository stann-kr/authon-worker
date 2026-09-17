import { useEffect } from "react";
import { getAdminShortcutTask, type AdminTask } from "../../../lib/admin-navigation";
import type { View } from "../data/types";

const destinations: Partial<Record<AdminTask, { view: View; intent?: string }>> = {
  "guest-list": { view: "roster" },
  "link-create": { view: "links", intent: "link-create" },
  "user-create": { view: "users", intent: "user-create" },
  analytics: { view: "analytics" },
  "venue-list": { view: "venues" },
};

export function useAdminShortcuts({ enabled, isSuper, onNavigate }: {
  enabled: boolean;
  isSuper: boolean;
  onNavigate: (view: View, intent?: string) => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing ||
        event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
        document.querySelector('dialog[open], [aria-modal="true"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]') ||
        target.isContentEditable
      )) return;
      const task = getAdminShortcutTask(event.key, isSuper);
      const destination = task && destinations[task];
      if (!destination) return;
      event.preventDefault();
      onNavigate(destination.view, destination.intent);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled, isSuper, onNavigate]);
}
