import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import { useMock } from "../data/MockData";
import "./sheet.css";

export function Sheet({
  id,
  title,
  subtitle,
  onClose,
  children,
  protectEdits = false,
  dirty = false,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  protectEdits?: boolean;
  dirty?: boolean;
}) {
  const { t, busy } = useMock();
  const titleId = useId();
  const [edited, setEdited] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const editFocus = useRef<HTMLElement | null>(null);
  const requestClose = () => {
    if (busy) return;
    if (protectEdits && (edited || dirty)) {
      editFocus.current = document.activeElement as HTMLElement;
      setDiscardPrompt(true);
    } else onClose();
  };
  const keepEditing = () => {
    setDiscardPrompt(false);
    requestAnimationFrame(
      () => editFocus.current?.isConnected && editFocus.current.focus(),
    );
  };
  useLayoutEffect(() => {
    if (discardPrompt) continueRef.current?.focus();
  }, [discardPrompt]);
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
      const viewport = window.visualViewport;
      const visibleTop = Math.max(box.top, viewport?.offsetTop ?? 0);
      const visibleBottom = Math.min(
        box.bottom,
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
      );
      const width = Math.min(box.width, 560);
      dialog.style.setProperty("--sheet-left", `${box.right - width}px`);
      dialog.style.setProperty("--sheet-width", `${width}px`);
      dialog.style.setProperty(
        "--sheet-bottom",
        `${Math.max(0, window.innerHeight - visibleBottom)}px`,
      );
      dialog.style.setProperty(
        "--sheet-max-height",
        `${Math.max(0, visibleBottom - visibleTop - 12)}px`,
      );
    };
    alignWithFrame();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(alignWithFrame);
    if (frame) observer?.observe(frame);
    window.addEventListener("resize", alignWithFrame);
    window.visualViewport?.addEventListener("resize", alignWithFrame);
    window.visualViewport?.addEventListener("scroll", alignWithFrame);
    dialog?.showModal();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", alignWithFrame);
      window.visualViewport?.removeEventListener("resize", alignWithFrame);
      window.visualViewport?.removeEventListener("scroll", alignWithFrame);
      dialog?.close();
      if (opener.current?.isConnected) opener.current.focus();
      else
        document
          .querySelector<HTMLElement>(
            '.dock-nav [aria-current="page"],.account-button,.preview-toolbar select',
          )
          ?.focus();
    };
  }, []);
  return (
    <dialog
      id={id}
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onChangeCapture={(event) => {
        if (protectEdits && (event.target as HTMLElement).closest("form"))
          setEdited(true);
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (discardPrompt) keepEditing();
        else requestClose();
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
            requestClose();
        }
      }}
    >
      <header className="sheet-header">
        <div>
          <h2 id={titleId} tabIndex={-1}>
            {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label={t("닫기")}
          disabled={busy}
          onClick={discardPrompt ? keepEditing : requestClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {discardPrompt && (
        <div
          className="sheet-discard"
          role="group"
          aria-label={t("작성 중인 내용")}
        >
          <p>{t("아직 저장하지 않은 내용이 있습니다.")}</p>
          <button className="primary" ref={continueRef} onClick={keepEditing}>
            {t("계속 작성")}
          </button>
          <button className="secondary" onClick={onClose}>
            {t("내용 버리고 닫기")}
          </button>
        </div>
      )}
      <div className="sheet-body" hidden={discardPrompt}>
        {children}
      </div>
    </dialog>
  );
}
