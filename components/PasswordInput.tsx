"use client";

import { useId, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent } from "react";
import Icon from "./Icon";

interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  inputClassName?: string;
  showCapsLockWarning?: boolean;
}

const defaultInputClassName =
  "app-field pr-12";

export default function PasswordInput({
  inputClassName,
  showCapsLockWarning = true,
  className,
  onKeyDown,
  onKeyUp,
  "aria-describedby": ariaDescribedBy,
  ...props
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const capsLockWarningId = useId();
  const isWarningVisible = showCapsLockWarning && isCapsLockOn;
  const describedBy = [ariaDescribedBy, isWarningVisible ? capsLockWarningId : undefined]
    .filter(Boolean)
    .join(" ") || undefined;

  const handleKeyboardEvent = (event: KeyboardEvent<HTMLInputElement>) => {
    if (typeof event.getModifierState === "function") {
      setIsCapsLockOn(event.getModifierState("CapsLock"));
    }
  };

  return (
    <div className={className}>
      <div className="relative">
        <input
          {...props}
          type={isVisible ? "text" : "password"}
          className={inputClassName ?? defaultInputClassName}
          aria-describedby={describedBy}
          onKeyDown={(event) => {
            handleKeyboardEvent(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            handleKeyboardEvent(event);
            onKeyUp?.(event);
          }}
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          className="pressable absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-control text-text-muted hover:bg-surface-hover hover:text-text-heading"
          aria-label={isVisible ? "Hide password" : "Show password"}
          aria-pressed={isVisible}
        >
          <Icon name={isVisible ? "view-off" : "view"} size={18} />
        </button>
      </div>
      {isWarningVisible && (
        <p
          id={capsLockWarningId}
          role="status"
          aria-live="polite"
          className="mt-2 flex items-center gap-1.5 text-xs text-text-muted"
        >
          <Icon name="warning" size={14} />
          Caps Lock is on
        </p>
      )}
    </div>
  );
}
