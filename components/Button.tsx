"use client";

import React from "react";
import Spinner from "./Spinner";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "confirm" | "ghost";
  size?: "sm" | "md" | "lg" | "xl";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    isLoading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    className = "",
    disabled,
    ...props
  },
  ref,
) {
  const baseClasses = "pressable inline-flex min-w-11 touch-manipulation items-center justify-center gap-2 rounded-control whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";
  
  const variantClasses = {
    primary: "border border-action-primary bg-action-primary font-semibold text-action-text hover:border-action-hover hover:bg-action-hover",
    secondary: "border border-border-default bg-surface-raised font-medium text-text-heading hover:border-border-strong hover:bg-surface-hover",
    outline: "border border-border-default bg-transparent font-medium text-text-heading hover:border-border-strong hover:bg-surface-hover",
    danger: "border border-status-danger/70 bg-status-danger/10 font-semibold text-status-danger hover:bg-status-danger/20",
    confirm: "border border-action-primary bg-action-primary font-semibold text-action-text hover:border-action-hover hover:bg-action-hover",
    ghost: "border border-transparent bg-transparent font-medium text-text-muted hover:bg-surface-hover hover:text-text-heading",
  };

  const sizeClasses = {
    sm: "min-h-11 px-3 py-2 text-xs",
    md: "min-h-11 px-4 py-2.5 text-sm",
    lg: "min-h-11 px-5 py-3 text-sm",
    xl: "min-h-12 px-6 py-3.5 text-base",
  };

  const widthClass = fullWidth ? "w-full" : "";
  
  const combinedClasses = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`;

  return (
    <button
      {...props}
      ref={ref}
      disabled={disabled || isLoading}
      className={combinedClasses}
      aria-busy={isLoading || props["aria-busy"]}
    >
      {isLoading && (
        <Spinner
          mode="button"
          color={variant === "primary" || variant === "confirm" ? "black" : "white"}
        />
      )}
      {!isLoading && leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
      <span>{children}</span>
      {!isLoading && rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
    </button>
  );
});

export default Button;
