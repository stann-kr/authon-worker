import type { ButtonHTMLAttributes, ReactNode } from "react";
import Icon, { type IconName } from "@/components/Icon";

/**
 * A screen-level action shown in the desktop header and the mobile dock.
 * `compact` keeps only the icon (and badge) visible in the mobile dock; the label stays for assistive technology.
 */
export default function WorkspaceAction({ icon, tone = "accent", badge, compact = false, children, className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; tone?: "accent" | "muted"; badge?: ReactNode; compact?: boolean }) {
  return <button type="button" {...props} data-tone={tone} data-compact={compact || undefined} className={`workspace-action ${className}`}>
    <span className="workspace-action-icon" data-tone={tone}><Icon name={icon} size={14} /></span>
    <span className="workspace-action-label">{children}</span>
    {/* The space keeps the label and count apart in the accessible name; flex layout ignores it. */}
    {badge != null && badge !== false && <>{" "}<span className="workspace-action-badge">{badge}</span></>}
  </button>;
}
