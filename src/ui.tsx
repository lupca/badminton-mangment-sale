// Bộ thành phần giao diện dùng chung. Một kiểu cho cả ứng dụng: nền trắng, viền xám, một màu nhấn (xanh dương),
// khung bo góc có bóng mờ; danh sách nào cũng gồm thanh tìm / lọc ở trên, bảng ở giữa, phân trang ở dưới.
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from "lucide-react";
import { formatDate, formatNumber, parseDateVN, parseInteger } from "./lib/format";
import { PAGE_SIZES, pageButtons, type Page } from "./lib/paging";
import { Link } from "./lib/router";
import liNingLogo from "./assets/brand/lining-logo.png";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ───────────────────────── Nút ─────────────────────────

type ButtonVariant = "primary" | "default" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "border-blue-600 bg-blue-600 text-white shadow-xs hover:bg-blue-700 hover:border-blue-700",
  default: "border-gray-300 bg-white text-gray-800 shadow-xs hover:bg-gray-50",
  danger: "border-red-200 bg-white text-red-700 shadow-xs hover:bg-red-50",
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
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-xs placeholder:text-gray-400 " +
  "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 disabled:bg-gray-100 disabled:text-gray-500 disabled:shadow-none";

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputCls, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, className)} {...rest} />;
}

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputCls, "pr-8", className)} {...rest} />;
}

/**
 * Ô ngày luôn theo kiểu Việt Nam ngày/tháng/năm, bất kể trình duyệt cài tiếng gì (ô ngày có sẵn của trình duyệt có
 * máy hiện tháng trước ngày). Gõ tay được, hoặc bấm biểu tượng lịch để chọn. `value` / `onChange` dùng "YYYY-MM-DD",
 * null = để trống.
 */
export function DateInput({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState(formatDate(value));
  const [invalid, setInvalid] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  // Ngày đổi từ nơi khác (chọn trên lịch, hoàn tác…): hiện lại theo ngày/tháng/năm.
  useEffect(() => {
    if (parseDateVN(text) !== value) setText(formatDate(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (raw: string, final: boolean) => {
    if (!raw.trim()) {
      setInvalid(false);
      if (value !== null) onChange(null);
      return;
    }
    const parsed = parseDateVN(raw);
    if (parsed) {
      setInvalid(false);
      if (parsed !== value) onChange(parsed);
      if (final) setText(formatDate(parsed));
    } else if (final) setInvalid(true);
  };

  return (
    <span className="block">
      <span className="relative block">
        <input
          {...rest}
          type="text"
          inputMode="numeric"
          placeholder="ngày/tháng/năm"
          autoComplete="off"
          aria-invalid={invalid || undefined}
          className={cx(inputCls, "pr-10", invalid && "border-red-400 focus:border-red-500 focus:ring-red-500/25", className)}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value, false);
          }}
          onBlur={(e) => commit(e.target.value, true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget.value, true);
          }}
        />
        <button
          type="button"
          aria-label="Chọn trên lịch"
          title="Chọn trên lịch"
          disabled={rest.disabled}
          className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-md text-gray-500 hover:text-blue-600 disabled:cursor-default disabled:text-gray-300"
          onClick={(e) => {
            e.preventDefault();
            const picker = pickerRef.current;
            if (!picker) return;
            try {
              picker.showPicker();
            } catch {
              picker.focus();
              picker.click();
            }
          }}
        >
          <CalendarDays aria-hidden className="h-4 w-4" />
        </button>
        {/* Lịch có sẵn của trình duyệt, chỉ dùng để chọn; ô hiển thị là ô chữ ở trên. */}
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          max="9999-12-31"
          className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
          value={value ?? ""}
          onChange={(e) => {
            setInvalid(false);
            onChange(e.target.value || null);
            setText(formatDate(e.target.value));
          }}
        />
      </span>
      {invalid ? (
        <span className="mt-1 block text-xs text-red-600">Ngày chưa đúng. Gõ theo ngày/tháng/năm, vd 05/11/2026.</span>
      ) : null}
    </span>
  );
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
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={cx(inputCls, "pl-9")}
      />
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
  /** Số dòng thuộc lựa chọn này (hiện trong ngoặc sau nhãn). */
  count?: number;
}

/**
 * Ô lọc của một danh sách: lựa chọn đầu là «tất cả» (giá trị ""). Đang lọc thì ô đổi màu để người dùng thấy ngay
 * danh sách đang bị thu hẹp ở đâu.
 */
export function FilterSelect({
  label,
  allLabel,
  value,
  onChange,
  options,
  className,
}: {
  /** Tên bộ lọc, vd "Hãng" — đọc cho trình đọc màn hình. */
  label: string;
  /** Nhãn của lựa chọn «tất cả», vd "Tất cả hãng". */
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  className?: string;
}) {
  return (
    <select
      aria-label={`Lọc theo ${label.toLowerCase()}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(inputCls, "cursor-pointer pr-8", value !== "" && "border-blue-500 bg-blue-50 font-medium text-blue-900", className)}
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
          {option.count != null ? ` (${formatNumber(option.count)})` : ""}
        </option>
      ))}
    </select>
  );
}

/** Nhãn của một bộ lọc đang bật, kèm nút bỏ riêng bộ lọc đó. */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-blue-800">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Bỏ lọc ${label}`}
        className="cursor-pointer rounded-full p-0.5 text-blue-600 hover:bg-blue-100 hover:text-blue-900"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
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
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 print:hidden">
      <div className="min-w-0">
        {backTo ? (
          <Link to={backTo} className="mb-1 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> Quay lại
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Màn hình đứng riêng, không có thanh điều hướng (đăng nhập, chờ duyệt, đang tải…): một khung hẹp nằm giữa trang. */
export function CenteredScreen({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50 px-4 py-10 text-gray-900 sm:items-center">
      <div className="w-full max-w-sm">
        <p className="mb-4 flex items-center justify-center gap-3 text-base font-semibold text-gray-900">
          <img src={liNingLogo} alt="Li-Ning" width={148} height={76} className="h-10 w-auto" />
          Chương trình khuyến mãi
        </p>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
          {title ? <h1 className="mb-3 text-lg font-semibold text-gray-900">{title}</h1> : null}
          {children}
        </div>
      </div>
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
    <section className={cx("rounded-xl border border-gray-200 bg-white shadow-xs", className)}>
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

const BADGE_DOT: Record<Tone, string> = {
  gray: "bg-gray-400",
  green: "bg-green-500",
  blue: "bg-blue-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
};

/** Nhãn trạng thái dạng viên. `dot` = thêm chấm màu ở đầu (cho các trạng thái cần nhìn lướt là thấy). */
export function Badge({ tone = "gray", dot, children }: { tone?: Tone; dot?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE_TONE[tone],
      )}
    >
      {dot ? <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", BADGE_DOT[tone])} /> : null}
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
    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center">
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
export const tableWrapCls = "relative overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-xs";
/** Khung cuộn ngang cho bảng nằm trong `ListCard` (khung đó đã có viền). */
export const tableScrollCls = "relative overflow-x-auto";
export const tableCls = "w-full border-collapse text-sm";
export const thCls =
  "border-b border-gray-200 bg-gray-50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap";
export const tdCls = "border-b border-gray-100 px-3 py-2.5 align-middle";
/** Thêm vào th/td của cột số. */
export const numCls = "text-right tabular-nums whitespace-nowrap";

// ───────────────────────── Danh sách: khung, tiêu đề cột sắp xếp, phân trang, ô số liệu ─────────────────────────

/** Khung của một danh sách: thanh tìm / lọc ở trên, bảng ở giữa, phân trang ở dưới — chung một khung viền. */
export function ListCard({
  toolbar,
  footer,
  className,
  children,
}: {
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cx("overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs", className)}>
      {toolbar ? <div className="border-b border-gray-200 px-3 py-3 sm:px-4">{toolbar}</div> : null}
      {children}
      {footer ? <div className="border-t border-gray-200 bg-gray-50/60 px-3 py-2.5 sm:px-4">{footer}</div> : null}
    </section>
  );
}

/** Tiêu đề cột bấm được để sắp xếp: bấm lần đầu xếp tăng dần, bấm lần nữa đổi chiều. */
export function SortTh({
  label,
  active,
  dir,
  onSort,
  numeric,
  className,
}: {
  label: string;
  /** Bảng đang xếp theo cột này. */
  active: boolean;
  dir: "asc" | "desc";
  onSort: () => void;
  /** Cột số: canh phải. */
  numeric?: boolean;
  className?: string;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cx(thCls, "align-middle", numeric && "text-right", className)} aria-sort={!active ? "none" : dir === "asc" ? "ascending" : "descending"}>
      <button
        type="button"
        onClick={onSort}
        title={`Sắp xếp theo ${label.toLowerCase()}`}
        className={cx(
          "group inline-flex cursor-pointer items-center gap-1 rounded align-middle uppercase tracking-wide hover:text-gray-900",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
          numeric && "flex-row-reverse",
          active && "text-gray-900",
        )}
      >
        {label}
        <Icon aria-hidden className={cx("h-3.5 w-3.5", active ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600")} />
      </button>
    </th>
  );
}

const pageBtnCls =
  "inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md border px-2 text-sm font-medium tabular-nums " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Thanh phân trang: «Hiển thị 1–25 trong 166 sản phẩm», chọn số dòng mỗi trang, các nút chuyển trang.
 * `page` là kết quả của `paginate()`.
 */
export function Pagination({
  page,
  unit,
  onPage,
  onSize,
  note,
}: {
  page: Omit<Page<unknown>, "items">;
  /** Tên của một dòng, vd "sản phẩm", "đơn". */
  unit: string;
  onPage: (page: number) => void;
  /** Có thì hiện ô chọn số dòng mỗi trang. */
  onSize?: (size: number) => void;
  /** Ghi thêm sau dòng «Hiển thị…», vd "(đang lọc trong 166)". */
  note?: React.ReactNode;
}) {
  const { page: current, pages, total, from, to, size } = page;
  const go = (n: number) => {
    if (n >= 1 && n <= pages && n !== current) onPage(n);
  };
  return (
    <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-gray-600 print:hidden">
      <p role="status">
        {total === 0 ? (
          <>Không có {unit} nào</>
        ) : (
          <>
            Hiển thị{" "}
            <strong className="font-semibold text-gray-900">
              {formatNumber(from)}–{formatNumber(to)}
            </strong>{" "}
            trong <strong className="font-semibold text-gray-900">{formatNumber(total)}</strong> {unit}
          </>
        )}
        {note ? <span className="text-gray-500"> {note}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onSize ? (
          <label className="flex items-center gap-2 whitespace-nowrap">
            <span className="max-sm:sr-only">Mỗi trang</span>
            <select
              aria-label="Số dòng mỗi trang"
              value={size}
              onChange={(e) => onSize(Number(e.target.value))}
              className="h-8 cursor-pointer rounded-md border border-gray-300 bg-white pl-2 pr-7 text-sm text-gray-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} dòng
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(current - 1)}
            disabled={current <= 1}
            aria-label="Trang trước"
            className={cx(pageBtnCls, "border-gray-300 bg-white text-gray-700 shadow-xs hover:bg-gray-50")}
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </button>
          {/* Điện thoại: chỉ ghi «Trang 2 / 7»; màn hình rộng hơn: các nút số trang. */}
          <span className="px-2 tabular-nums sm:hidden">
            Trang {formatNumber(current)} / {formatNumber(pages)}
          </span>
          {pageButtons(current, pages).map((item, index) =>
            item === "gap" ? (
              <span key={`gap-${index}`} aria-hidden className="px-1 text-gray-400 max-sm:hidden">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => go(item)}
                aria-label={`Trang ${item}`}
                aria-current={item === current ? "page" : undefined}
                className={cx(
                  pageBtnCls,
                  "max-sm:hidden",
                  item === current
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-transparent text-gray-700 hover:bg-gray-100",
                )}
              >
                {formatNumber(item)}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => go(current + 1)}
            disabled={current >= pages}
            aria-label="Trang sau"
            className={cx(pageBtnCls, "border-gray-300 bg-white text-gray-700 shadow-xs hover:bg-gray-50")}
          >
            <ChevronRight aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );
}

const STAT_TONE: Record<Tone, { icon: string; value: string }> = {
  gray: { icon: "bg-gray-100 text-gray-600", value: "text-gray-900" },
  blue: { icon: "bg-blue-50 text-blue-600", value: "text-gray-900" },
  green: { icon: "bg-green-50 text-green-600", value: "text-gray-900" },
  amber: { icon: "bg-amber-50 text-amber-600", value: "text-amber-700" },
  red: { icon: "bg-red-50 text-red-600", value: "text-red-700" },
};

/**
 * Ô số liệu tóm tắt đặt phía trên một danh sách. Có `onClick` thì ô là nút bấm để lọc danh sách theo số liệu đó
 * (`active` = danh sách đang được lọc theo ô này).
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "gray",
  icon,
  active,
  onClick,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      {icon ? (
        <span aria-hidden className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg max-sm:hidden", STAT_TONE[tone].icon)}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-gray-500">{label}</span>
        <span className={cx("block text-xl font-semibold leading-tight tabular-nums", STAT_TONE[tone].value)}>{value}</span>
        {hint ? <span className="block truncate text-xs text-gray-500 max-sm:hidden">{hint}</span> : null}
      </span>
    </>
  );
  const cls = cx(
    "flex min-w-0 items-center gap-3 rounded-xl border bg-white px-3 py-2 text-left shadow-xs sm:px-3.5 sm:py-3",
    active ? "border-blue-500 ring-2 ring-blue-500/20" : "border-gray-200",
    className,
  );
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className={cx(cls, "cursor-pointer transition-colors hover:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500")}
    >
      {body}
    </button>
  );
}

/** Màn hình có khớp một điều kiện CSS không, vd useMediaQuery("(min-width: 768px)"); tự cập nhật khi đổi cỡ cửa sổ. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
    () => query.includes("min-width"), // Dựng sẵn ngoài trình duyệt (kiểm thử): coi như màn hình máy tính.
  );
}

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
      <div role="dialog" aria-modal="true" className={cx("my-auto flex max-h-full w-full flex-col rounded-xl bg-white shadow-xl", width)}>
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

/** Khung chi tiết trượt ra ở mép phải màn hình (điện thoại: phủ cả màn hình). Đóng bằng nút ×, phím Esc hoặc bấm ra ngoài. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Mở ra thì đưa bàn phím vào khung (Tab đi tiếp vào nội dung), không làm nút × sáng viền.
  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, [open]);
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
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40 print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={panel}
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl focus:outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-sm text-gray-500">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3 sm:px-5">{footer}</footer> : null}
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
