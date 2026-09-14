/* eslint-disable @next/next/no-img-element -- Standalone offline HTML uses an inline generated QR image, with no Next image server. */
import {
  useEffect,
  useId,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import QRCode from "qrcode";
import { useMock } from "../data/MockData";
import { Icon } from "./Icon";
export function Text({ children }: { children: string }) {
  const { t } = useMock();
  return <>{t(children)}</>;
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  const { t, notice, noticeError } = useMock();
  const isError =
    error ||
    (typeof children === "string" && children === notice && noticeError);
  return (
    <p
      className={`flow-notice ${isError ? "error" : ""}`}
      role={isError ? "alert" : "status"}
    >
      {typeof children === "string" ? t(children) : children}
    </p>
  );
}
export function Field({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const { t } = useMock();
  const generated = useId();
  const [revealed, setRevealed] = useState(false);
  const input = (
    <input
      {...props}
      type={props.type === "password" && revealed ? "text" : props.type}
      id={props.id ?? generated}
      aria-labelledby={props["aria-labelledby"] ?? (props["aria-label"] ? undefined : `${generated}-label`)}
      aria-invalid={error ? true : props["aria-invalid"]}
      aria-describedby={
        error ? `${generated}-error` : props["aria-describedby"]
      }
      placeholder={
        props.placeholder
          ? t(props.placeholder.replaceAll("\\n", "\n"))
          : undefined
      }
    />
  );
  return (
    <label className="field" htmlFor={props.id ?? generated}>
      <span id={`${generated}-label`}>
        {t(label)}
        {props.required ? " *" : ""}
      </span>
      {props.type === "password" ? (
        <div className="flow-secret">
          {input}
          <button
            type="button"
            aria-label={t(revealed ? "비밀번호 숨기기" : "비밀번호 표시")}
            aria-pressed={revealed}
            onClick={() => setRevealed((v) => !v)}
          >
            {t(revealed ? "숨기기" : "표시")}
          </button>
        </div>
      ) : (
        input
      )}
      {error && (
        <small id={`${generated}-error`} className="form-error" role="alert">
          {t(error)}
        </small>
      )}
    </label>
  );
}
export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
}) {
  const { t } = useMock();
  const generated = useId();
  return (
    <label className="field" htmlFor={props.id ?? generated}>
      <span id={`${generated}-label`}>{t(label)}{props.required ? " *" : ""}</span>
      <select {...props} id={props.id ?? generated}
        aria-labelledby={props["aria-labelledby"] ?? (props["aria-label"] ? undefined : `${generated}-label`)}>
        {children}
      </select>
    </label>
  );
}
export function Area({
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const { t } = useMock();
  const generated = useId();
  return (
    <label className="field" htmlFor={props.id ?? generated}>
      <span id={`${generated}-label`}>{t(label)}{props.required ? " *" : ""}</span>
      <textarea
        {...props}
        id={props.id ?? generated}
        aria-labelledby={props["aria-labelledby"] ?? (props["aria-label"] ? undefined : `${generated}-label`)}
        placeholder={
          props.placeholder
            ? t(props.placeholder.replaceAll("\\n", "\n"))
            : undefined
        }
      />
    </label>
  );
}
export function Toggle({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { t } = useMock();
  return (
    <label className="form-toggle">
      <span>{t(label)}</span>
      <input {...props} type="checkbox" />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}
export function Action({
  children,
  onClick,
  disabled = false,
  secondary = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  secondary?: boolean;
  type?: "button" | "submit";
}) {
  const { busy, t } = useMock();
  return (
    <button
      className={secondary ? "secondary" : "primary"}
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {typeof children === "string" ? t(children) : children}
    </button>
  );
}
export function Form({
  children,
  onSubmit,
  submit = "저장",
  disabled = false,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => void | Promise<void>;
  submit?: string;
  disabled?: boolean;
}) {
  const { busy, notice, notify, t } = useMock();
  useEffect(() => notify(""), [notify]);
  return (
    <form
      className="flow-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        notify("");
        await onSubmit(new FormData(e.currentTarget));
      }}
    >
      <fieldset disabled={busy} className="flow-fields">
        {children}
      </fieldset>
      <div className="flow-form-actions">
        {notice && <Notice>{notice}</Notice>}
        <Action type="submit" disabled={disabled}>
          {busy ? t("저장 중입니다.") : t(submit)}
        </Action>
      </div>
    </form>
  );
}
export function Tabs({
  items,
  value,
  onChange,
  label = "보기",
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const { t } = useMock();
  return (
    <nav className="flow-tabs" aria-label={t(label)}>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-pressed={value === item.id}
          onClick={() => onChange(item.id)}
        >
          {t(item.label)}
        </button>
      ))}
    </nav>
  );
}
export function Row({
  title,
  meta,
  badge,
  children,
  onClick,
}: {
  title: string;
  meta?: string;
  badge?: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  const { t } = useMock();
  const content = (
    <>
      <span>
        <strong>{t(title)}</strong>
        {meta && <small>{t(meta)}</small>}
      </span>
      {badge && <span className="status-badge">{t(badge)}</span>}
      {onClick && <Icon name="chevron" size={16} />}
    </>
  );
  return (
    <div className="flow-row">
      {onClick ? (
        <button className="flow-row-button" onClick={onClick}>
          {content}
        </button>
      ) : (
        <div className="flow-row-static">{content}</div>
      )}
      {children}
    </div>
  );
}
export function Empty({ text = "등록된 내용이 없습니다." }: { text?: string }) {
  const { t } = useMock();
  return (
    <div className="empty-state">
      <Icon name="file" size={26} />
      <p>{t(text)}</p>
    </div>
  );
}
export function Confirm({
  title,
  description,
  onConfirm,
  onCancel,
  disabled = false,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const { t } = useMock();
  return (
    <div className="confirmation">
      <strong>{t(title)}</strong>
      <p>{t(description)}</p>
      <div className="button-row">
        <Action secondary onClick={onCancel}>
          취소
        </Action>
        <Action disabled={disabled} onClick={onConfirm}>
          확인
        </Action>
      </div>
    </div>
  );
}
export function Metrics({
  items,
}: {
  items: { label: string; value: string | number }[];
}) {
  const { t } = useMock();
  return (
    <dl className="flow-metrics">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{t(item.label)}</dt>
          <dd>{typeof item.value === "string" ? t(item.value) : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function CopyBox({
  value,
  label = "링크 복사",
  onOpen,
}: {
  value: string;
  label?: string;
  onOpen?: () => void;
}) {
  const { notify, t } = useMock();
  const copy = async (share = false) => {
    try {
      if (share && navigator.share) await navigator.share({ text: value });
      else await navigator.clipboard.writeText(value);
      notify(
        share ? "게스트 링크를 공유했습니다." : "게스트 링크를 복사했습니다.",
      );
    } catch {
      notify(
        "링크를 공유하거나 복사하지 못했습니다. URL을 직접 선택해 복사해주세요.",
      );
    }
  };
  return (
    <div className="flow-copy">
      <label className="field">
        <span>{t(label)}</span>
        <textarea
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      <div className="button-row">
        <Action secondary onClick={() => void copy()}>
          {label}
        </Action>
        <Action secondary onClick={() => void copy(true)}>
          공유
        </Action>
        {onOpen && <Action onClick={onOpen}>열기</Action>}
      </div>
    </div>
  );
}
export function Qr({ code }: { code: string }) {
  const { scenario, t } = useMock();
  const [uri, setUri] = useState("");
  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(code, { type: "svg", margin: 2, width: 196 }).then(
      (svg) => {
        if (!cancelled)
          setUri(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code]);
  return scenario === "qr-error" ? (
    <Notice error>
      코드를 표시하지 못했습니다. 입구에서 이름을 알려주세요.
    </Notice>
  ) : (
    <div className="flow-qr">
      {uri && (
        <img src={uri} width="196" height="196" alt={t("입장 QR 코드")} />
      )}
      <code>{code}</code>
      <small>{t("입장할 때 이 코드를 보여주세요.")}</small>
    </div>
  );
}
export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    const raw = String(value ?? "");
    const safe = /^[=+@\-]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const href = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}
export const string = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();
export const optionalNumber = (data: FormData, key: string) =>
  string(data, key) === "" ? null : Number(data.get(key));
