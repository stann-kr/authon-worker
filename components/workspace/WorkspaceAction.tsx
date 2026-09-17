import type { ButtonHTMLAttributes } from "react";
import Icon, { type IconName } from "@/components/Icon";

export default function WorkspaceAction({ icon, tone = "accent", children, className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; tone?: "accent" | "muted" }) {
  return <button type="button" {...props} data-tone={tone} className={`workspace-action ${className}`}>
    <span className="workspace-action-icon" data-tone={tone}><Icon name={icon} size={14} /></span>
    <span>{children}</span>
  </button>;
}
