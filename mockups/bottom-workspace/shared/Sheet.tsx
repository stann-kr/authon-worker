import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { useMock } from "../data/MockData";
import { useSheetLayout } from "./useSheetLayout";
import "./sheet.css";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const valueOf = (input: Control) =>
  input instanceof HTMLInputElement && ["checkbox", "radio"].includes(input.type)
    ? String(input.checked) : input.value;
const defaultValueOf = (input: Control) => {
  if (input instanceof HTMLInputElement && ["checkbox", "radio"].includes(input.type))
    return String(input.defaultChecked);
  if (input instanceof HTMLSelectElement)
    return input.querySelector<HTMLOptionElement>("option[selected]")?.value ?? input.options[0]?.value ?? "";
  return input.defaultValue;
};

export function Sheet({
  id,
  title,
  subtitle,
  onClose,
  children,
  protectEdits = false,
  dirty = false,
  presentation = "modal",
  size = "default",
}: {
  id?: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  protectEdits?: boolean;
  dirty?: boolean;
  presentation?: "modal" | "detail";
  size?: "default" | "wide";
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
  const initialValues = useRef(new Map<Element, string>());
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    opener.current = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.querySelectorAll<Control>("form input, form select, form textarea").forEach((input) => {
      initialValues.current.set(input, valueOf(input));
    });
    return () => {
      const restore = document.activeElement === document.body || !!dialog?.contains(document.activeElement);
      dialog?.close();
      if (!restore) return;
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>(
            '.dock-nav [aria-current="page"],.account-button,.preview-toolbar select',
          )
          ?.focus();
    };
  }, []);
  useSheetLayout(ref, presentation, size, protectEdits && (edited || dirty));
  return createPortal(
    <dialog
      id={id}
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onChangeCapture={(event) => {
        if (protectEdits && (event.target as HTMLElement).closest("form")) {
          const inputs = [...event.currentTarget.querySelectorAll<Control>("form input, form select, form textarea")];
          setEdited(inputs.some((input) => valueOf(input) !== (initialValues.current.get(input) ?? defaultValueOf(input))));
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (discardPrompt) keepEditing();
        else requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.dataset.inline === "true" && !event.defaultPrevented) {
          event.preventDefault();
          requestClose();
        }
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
    </dialog>,
    document.body,
  );
}
