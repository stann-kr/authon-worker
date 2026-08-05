export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "danger"
  | "confirm"
  | "ghost";

export type ButtonSize = "sm" | "md" | "lg" | "xl";

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

const baseClasses =
  "app-button pressable inline-flex min-w-11 touch-manipulation items-center justify-center gap-2 whitespace-nowrap rounded-control disabled:cursor-not-allowed disabled:opacity-50";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-action-primary bg-action-primary font-semibold text-action-text",
  secondary:
    "border border-border-strong bg-surface-raised font-medium text-text-heading",
  outline:
    "border border-border-strong bg-transparent font-medium text-text-heading",
  danger:
    "border border-status-danger/70 bg-status-danger/10 font-semibold text-status-danger",
  confirm: "border font-semibold",
  ghost:
    "border border-transparent bg-transparent font-medium text-text-muted",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 py-2 text-xs",
  md: "min-h-11 px-4 py-2.5 text-sm",
  lg: "min-h-11 px-5 py-3 text-sm",
  xl: "min-h-12 px-6 py-3.5 text-base",
};

export function getButtonClassName({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
}: ButtonStyleOptions): string {
  return `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${
    fullWidth ? "w-full" : ""
  } ${className}`;
}

export function getButtonSpinnerColor(
  variant: ButtonVariant,
): "black" | "white" {
  return variant === "primary" || variant === "confirm" ? "black" : "white";
}
