// Các ô nhập nhỏ dùng chung trong màn hình sửa chương trình.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ID, ProductGroup } from "../../types";
import { formatNumber, parseDecimal } from "../../lib/format";
import { QtyInput, Select, cx, inputCls } from "../../ui";

export const hintCls = "mt-1.5 text-xs text-gray-500";
export const legendCls = "mb-1.5 text-sm font-medium text-gray-700";
const tickCls = "mt-0.5 h-4 w-4 shrink-0 accent-blue-600";
const tickRowCls = "flex cursor-pointer items-start gap-2 py-0.5 text-sm text-gray-800";

/** Ô tên của danh mục / quy tắc. Mục vừa được thêm thì con trỏ nhảy vào và bôi đen tên mặc định để gõ đè luôn. */
export function NameInput({
  value,
  onChange,
  selectOnMount = false,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  selectOnMount?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selectOnMount) return;
    ref.current?.focus();
    ref.current?.select();
  }, [selectOnMount]);
  return (
    <input
      ref={ref}
      type="text"
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

const percentText = (value: number) => (value ? String(value).replace(".", ",") : "");

/** Ô nhập % cho phép số lẻ ("12,5"). Trong lúc gõ thì giữ nguyên chữ đang gõ, để dấu phẩy vừa gõ không bị nuốt mất. */
export function PercentInput({
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  "aria-label": string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="0"
      aria-label={ariaLabel}
      value={draft ?? percentText(value)}
      onChange={(e) => {
        const text = e.target.value.replace(/[^\d.,]/g, "");
        setDraft(text);
        onChange(parseDecimal(text));
      }}
      onFocus={(e) => {
        setDraft(percentText(value));
        e.target.select();
      }}
      onBlur={() => setDraft(null)}
      className={cx(inputCls, "text-right tabular-nums")}
    />
  );
}

/** Ô số lượng được phép để trống: trống = không giới hạn (null). */
export function OptionalQtyInput({
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  "aria-label": string;
}) {
  return (
    <QtyInput
      aria-label={ariaLabel}
      placeholder="không giới hạn"
      value={value ?? 0}
      onChange={(n) => onChange(n > 0 ? n : null)}
    />
  );
}

/** Một câu có ô nhập chen giữa chữ, vd «Giảm [45] % trên [giá lẻ] cho danh mục». */
export function Sentence({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-gray-800">{children}</div>;
}

/** Khung bề rộng cố định cho một ô nhập đặt giữa câu hoặc trong bảng (ô nhập của ui.tsx luôn giãn hết khung chứa). */
export function Slot({ width = "w-20", children }: { width?: string; children: ReactNode }) {
  return <span className={cx("inline-block shrink-0", width)}>{children}</span>;
}

function Tick({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={tickRowCls}>
      <input type="checkbox" className={tickCls} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** Một lựa chọn trong nhóm chọn-một. Các lựa chọn cùng nhóm dùng chung `name`. */
export function Choice({
  name,
  checked,
  onSelect,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className={tickRowCls}>
      <input type="radio" name={name} className={tickCls} checked={checked} onChange={onSelect} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

const groupLabel = (group: ProductGroup) =>
  `${group.name.trim() || "(chưa đặt tên)"} (${formatNumber(group.items.length)} sản phẩm)`;

/** Một ô tích cho mỗi danh mục của chương trình. `label` là tên của cả nhóm ô tích. */
export function GroupChecklist({
  label,
  groups,
  selected,
  onChange,
  className,
}: {
  label: string;
  groups: ProductGroup[];
  selected: ID[];
  onChange: (ids: ID[]) => void;
  className?: string;
}) {
  if (groups.length === 0) {
    return (
      <p className={cx("text-sm text-gray-500", className)}>
        Chương trình chưa có danh mục nào. Hãy tạo danh mục ở tab «Danh mục sản phẩm» trước.
      </p>
    );
  }
  return (
    <div role="group" aria-label={label} className={className}>
      {groups.map((group) => (
        <Tick
          key={group.id}
          checked={selected.includes(group.id)}
          // Ghi lại theo thứ tự danh mục của chương trình; id của danh mục không còn tồn tại bị bỏ đi.
          onChange={(checked) =>
            onChange(groups.filter((g) => (g.id === group.id ? checked : selected.includes(g.id))).map((g) => g.id))
          }
        >
          {groupLabel(group)}
        </Tick>
      ))}
    </div>
  );
}

/** Ô chọn một danh mục của chương trình (null = chưa chọn). */
export function GroupSelect({
  groups,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  groups: ProductGroup[];
  value: ID | null;
  onChange: (id: ID | null) => void;
  "aria-label"?: string;
}) {
  const known = groups.some((group) => group.id === value);
  return (
    <Select
      aria-label={ariaLabel}
      value={known && value ? value : ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">— Chọn danh mục —</option>
      {groups.map((group) => (
        <option key={group.id} value={group.id}>
          {groupLabel(group)}
        </option>
      ))}
    </Select>
  );
}
