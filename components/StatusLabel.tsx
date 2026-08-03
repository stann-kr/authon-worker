import Icon, { type IconName } from "./Icon";

type StatusTone = "waiting" | "checked" | "danger" | "neutral";

interface StatusLabelProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  appearance?: "bar" | "inline";
}

const toneClasses: Record<StatusTone, string> = {
  waiting: "border-status-waiting text-status-waiting",
  checked: "border-status-checked text-status-checked",
  danger: "border-status-danger text-status-danger",
  neutral: "border-border-strong text-text-muted",
};

const toneIcons: Record<StatusTone, IconName> = {
  waiting: "time",
  checked: "check",
  danger: "warning",
  neutral: "subtract",
};

export default function StatusLabel({
  tone,
  children,
  className = "",
  appearance = "bar",
}: StatusLabelProps) {
  const appearanceClasses =
    appearance === "bar" ? "border-l-2 pl-2" : "";

  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 text-xs font-semibold ${appearanceClasses} ${toneClasses[tone]} ${className}`}
    >
      <Icon name={toneIcons[tone]} size={14} />
      <span>{children}</span>
    </span>
  );
}
