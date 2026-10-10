import Icon, { type IconName } from "./Icon";

type StatusTone = "waiting" | "checked" | "danger" | "neutral";

interface StatusLabelProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  appearance?: "bar" | "inline";
}

const toneClasses: Record<StatusTone, string> = {
  waiting: "text-status-waiting",
  checked: "text-status-checked",
  danger: "text-status-danger",
  neutral: "text-text-muted",
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
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 text-xs font-semibold ${toneClasses[tone]} ${className}`}
    >
      {/* The standalone status is a quiet dot; inline statuses keep the icon beside their action. */}
      {appearance === "bar"
        ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
        : <Icon name={toneIcons[tone]} size={14} />}
      <span>{children}</span>
    </span>
  );
}
