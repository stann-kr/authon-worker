"use client";

import type { ComponentProps, ReactNode } from "react";
import TransitionLink from "./TransitionLink";
import {
  getButtonClassName,
  type ButtonSize,
  type ButtonVariant,
} from "./buttonStyles";

interface ButtonLinkProps
  extends Omit<ComponentProps<typeof TransitionLink>, "children" | "className"> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
}

export default function ButtonLink({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  leftIcon,
  rightIcon,
  className = "",
  ...props
}: ButtonLinkProps) {
  return (
    <TransitionLink
      {...props}
      className={getButtonClassName({
        variant,
        size,
        fullWidth,
        className,
      })}
      data-variant={variant}
    >
      {leftIcon ? (
        <span aria-hidden="true" className="shrink-0">
          {leftIcon}
        </span>
      ) : null}
      <span>{children}</span>
      {rightIcon ? (
        <span aria-hidden="true" className="shrink-0">
          {rightIcon}
        </span>
      ) : null}
    </TransitionLink>
  );
}
