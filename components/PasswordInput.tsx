"use client";

import { useId, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent } from "react";

interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  inputClassName?: string;
  showCapsLockWarning?: boolean;
}

const defaultInputClassName =
  "w-full bg-black border border-gray-600 px-4 py-3 pr-12 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

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
          className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-white transition-colors"
          aria-label={isVisible ? "Hide password" : "Show password"}
          aria-pressed={isVisible}
        >
          <i className={isVisible ? "ri-eye-off-line" : "ri-eye-line"}></i>
        </button>
      </div>
      {isWarningVisible && (
        <p
          id={capsLockWarningId}
          role="status"
          aria-live="polite"
          className="mt-2 flex items-center gap-1.5 text-[10px] font-mono tracking-[0.08em] text-yellow-300"
        >
          <i className="ri-alert-line"></i>
          Caps Lock is on
        </p>
      )}
    </div>
  );
}
