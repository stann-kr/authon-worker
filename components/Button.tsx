"use client";

import React from "react";
import Spinner from "./Spinner";
import {
  getButtonClassName,
  getButtonSpinnerColor,
  type ButtonSize,
  type ButtonVariant,
} from "./buttonStyles";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
    type = "button",
    ...props
  },
  ref,
) {
  const combinedClasses = getButtonClassName({
    variant,
    size,
    fullWidth,
    className,
  });

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      className={combinedClasses}
      data-variant={variant}
      aria-busy={isLoading || props["aria-busy"]}
    >
      {isLoading && (
        <Spinner
          mode="button"
          color={getButtonSpinnerColor(variant)}
        />
      )}
      {!isLoading && leftIcon && (
        <span aria-hidden="true" className="shrink-0">
          {leftIcon}
        </span>
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && (
        <span aria-hidden="true" className="shrink-0">
          {rightIcon}
        </span>
      )}
    </button>
  );
});

export default Button;
