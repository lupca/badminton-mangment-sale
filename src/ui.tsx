// Bộ thành phần giao diện dùng chung. Giữ đơn giản: nền trắng, viền xám, một màu nhấn (xanh dương).
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { formatNumber, parseInteger } from "./lib/format";
import { Link } from "./lib/router";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ───────────────────────── Nút ─────────────────────────

type ButtonVariant = "primary" | "default" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:border-blue-700",
  default: "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
  danger: "border-red-200 bg-white text-red-700 hover:bg-red-50",
  ghost: "border-transparent bg-transparent text-gray-700 hover:bg-gray-100",
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
};

export function buttonCls(variant: ButtonVariant = "default", size: ButtonSize = "md"): string {
  return cx(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
    "disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
  );
}

export function Button({
  variant = "default",
  size = "md",
  className,
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={cx(buttonCls(variant, size), className)} {...rest} />;
}

// ───────────────────────── Ô nhập ─────────────────────────

export const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 " +
  "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500";

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputCls, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, className)} {...rest} />;
}

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputCls, "pr-8", className)} {...rest} />;
}

/** Ô nhập số tiền (đồng): hiện dấu chấm phân cách hàng nghìn, trả về số nguyên. */
export function MoneyInput({
  value,
  onChange,
  className,
  ...rest
}: { value: number; onChange: (value: number) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
>) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="0"
      value={value ? formatNumber(value) : ""}
      onChange={(e) => onChange(Math.max(0, parseInteger(e.target.value)))}
      onFocus={(e) => e.target.select()}
      className={cx(inputCls, "text-right tabular-nums", className)}
      {...rest}
    />
  );
}

/** Ô nhập số lượng: số nguyên >= 0, để trống = 0. Rộng theo khung chứa — muốn hẹp thì đặt độ rộng ở phần tử bọc ngoài. */
export function QtyInput({
  value,
  onChange,
  max,
  className,
  ...rest
}: { value: number; onChange: (value: number) => void; max?: number } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "max"
>) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="0"
      value={value > 0 ? String(value) : ""}
      onChange={(e) => {
        const n = Math.max(0, parseInteger(e.target.value));
        onChange(max != null ? Math.min(n, max) : n);
      }}
      onFocus={(e) => e.target.select()}
      className={cx(inputCls, "text-center tabular-nums", className)}
      {...rest}
    />
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Tìm…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(inputCls, "pl-8")}
      />
    </div>
  );
}

/** Nhãn + ô nhập + dòng gợi ý. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  );
}

// ───────────────────────── Khối trình bày ─────────────────────────

/** Tiêu đề trang: nút quay lại (tùy chọn), tiêu đề, mô tả, các nút hành động bên phải. */
export function PageHeader({
  title,
  subtitle,
  backTo,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  backTo?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
      <div className="min-w-0">
        {backTo ? (
          <Link to={backTo} className="mb-1 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> Quay lại
          </Link>
        ) : null}
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Khung nội dung có viền, tiêu đề và nút hành động tùy chọn. */
export function Card({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cx("rounded-lg border border-gray-200 bg-white", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "gray" | "green" | "blue" | "red" | "amber";
const BADGE_TONE: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-green-100 text-green-800",
  blue: "bg-blue-100 text-blue-800",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
};

export function Badge({ tone = "gray", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", BADGE_TONE[tone])}>
      {children}
    </span>
  );
}

const NOTICE_TONE: Record<"error" | "warning" | "info" | "success", string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  success: "border-green-200 bg-green-50 text-green-800",
};

/** Dòng thông báo: lỗi (đỏ), cảnh báo (vàng), gợi ý (xanh dương), thành công (xanh lá). */
export function Notice({
  tone = "info",
  className,
  children,
}: {
  tone?: "error" | "warning" | "info" | "success";
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cx("rounded-md border px-3 py-2 text-sm", NOTICE_TONE[tone], className)}>{children}</div>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-10 text-center">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Thanh tab đơn giản. Trên điện thoại thanh tab cuộn ngang và tự đưa tab đang mở vào tầm nhìn. */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ key: K; label: React.ReactNode; count?: number }>;
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  // Chỉ cuộn ngang trong thanh tab (không dùng scrollIntoView, vốn có thể kéo cả trang theo chiều dọc).
  useEffect(() => {
    const el = bar.current;
    const active = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }, [value]);

  return (
    <div
      ref={bar}
      role="tablist"
      className={cx("relative flex gap-1 overflow-x-auto border-b border-gray-200 print:hidden", className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === value}
          onClick={() => onChange(tab.key)}
          className={cx(
            "-mb-px cursor-pointer whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            tab.key === value
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900",
          )}
        >
          {tab.label}
          {tab.count != null ? <span className="ml-1.5 text-xs text-gray-400">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// Lớp CSS cho bảng — dùng trực tiếp trên <table>/<th>/<td>. Bọc bảng trong <div className={tableWrapCls}> để cuộn ngang trên điện thoại.
// `relative` giữ các phần tử định vị tuyệt đối bên trong (vd `sr-only`) nằm trong khung cuộn, không làm cả trang cuộn ngang.
export const tableWrapCls = "relative overflow-x-auto rounded-lg border border-gray-200 bg-white";
export const tableCls = "w-full border-collapse text-sm";
export const thCls =
  "border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap";
export const tdCls = "border-b border-gray-100 px-3 py-2 align-middle";
/** Thêm vào th/td của cột số. */
export const numCls = "text-right tabular-nums whitespace-nowrap";

// ───────────────────────── Hộp thoại ─────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = size === "xl" ? "max-w-5xl" : size === "lg" ? "max-w-3xl" : "max-w-lg";
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6 print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" className={cx("my-auto flex max-h-full w-full flex-col rounded-lg bg-white shadow-xl", width)}>
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

// ───────────────────────── Thông báo nổi ─────────────────────────

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}
let toastItems: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((fn) => fn());

/** Hiện thông báo ngắn ở góc màn hình, tự tắt sau vài giây. Gọi được từ bất cứ đâu. */
export function toast(message: string, tone: ToastItem["tone"] = "success"): void {
  const id = ++toastSeq;
  toastItems = [...toastItems, { id, message, tone }];
  emitToasts();
  window.setTimeout(
    () => {
      toastItems = toastItems.filter((t) => t.id !== id);
      emitToasts();
    },
    tone === "error" ? 6000 : 3000,
  );
}

const TOAST_TONE: Record<ToastItem["tone"], string> = {
  success: "bg-gray-900 text-white",
  error: "bg-red-600 text-white",
  info: "bg-blue-600 text-white",
};

export function Toaster() {
  const items = useSyncExternalStore(
    (callback) => {
      toastListeners.add(callback);
      return () => toastListeners.delete(callback);
    },
    () => toastItems,
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 print:hidden">
      {items.map((t) => (
        <div key={t.id} role="status" className={cx("max-w-md rounded-md px-4 py-2 text-sm shadow-lg", TOAST_TONE[t.tone])}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
