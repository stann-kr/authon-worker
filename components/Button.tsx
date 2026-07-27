"use client";

import React from "react";
import Spinner from "./Spinner";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost" | "cyan";
  size?: "sm" | "md" | "lg" | "xl";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export default function Button({
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
}: ButtonProps) {
  // Base classes with touch feedback and focus accessibility
  const baseClasses = "font-mono tracking-wider uppercase transition-all duration-150 ease-out flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] active:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white";
  
  const variantClasses = {
    primary: "bg-white text-black hover:bg-gray-200",
    secondary: "bg-gray-800 text-white hover:bg-gray-700 border border-gray-700",
    outline: "bg-transparent text-white border border-gray-700 hover:border-white hover:bg-white/5",
    danger: "bg-red-900/30 text-red-400 border border-red-700 hover:bg-red-900/50",
    ghost: "bg-transparent text-gray-400 hover:text-white hover:bg-white/5",
    cyan: "bg-cyan-600 text-white hover:bg-cyan-700",
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-[10px]",
    md: "px-4 py-2.5 text-xs",
    lg: "px-6 py-3.5 text-sm",
    xl: "px-8 py-4 text-base",
  };

  const widthClass = fullWidth ? "w-full" : "";
  
  const combinedClasses = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`;

  return (
    <button
      disabled={disabled || isLoading}
      className={combinedClasses}
      {...props}
    >
      {isLoading && <Spinner mode="button" />}
      {!isLoading && leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
      <span className="truncate">{children}</span>
      {!isLoading && rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
    </button>
  );
}
