import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import "./sheet.css";

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    opener.current = document.activeElement as HTMLElement;
    const dialog = ref.current;
    const frame =
      dialog?.closest(".preview-frame") ??
      document.querySelector(".preview-frame");
    const alignWithFrame = () => {
      const box = frame?.getBoundingClientRect();
      if (!dialog || !box?.width) return;
      dialog.style.setProperty("--sheet-left", `${box.left}px`);
      dialog.style.setProperty("--sheet-width", `${box.width}px`);
      dialog.style.setProperty(
        "--sheet-bottom",
        `${Math.max(0, window.innerHeight - box.bottom)}px`,
      );
      dialog.style.setProperty(
        "--sheet-max-height",
        `${Math.max(120, box.height - 16)}px`,
      );
    };
    alignWithFrame();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(alignWithFrame);
    if (frame) observer?.observe(frame);
    window.addEventListener("resize", alignWithFrame);
    dialog?.showModal();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", alignWithFrame);
      dialog?.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="sheet-handle" aria-hidden="true" />
      <header className="sheet-header">
        <div>
          <h2 id="sheet-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
