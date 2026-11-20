// Khối "Chọn hàng": tìm, lọc và nhập số lượng cho từng mã hàng của chương trình.
import { memo, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ClipboardPaste } from "lucide-react";
import type { CalcLine, ID, ProductGroup, ProductItem } from "../../types";
import { formatNumber, matchesSearch } from "../../lib/format";
import { Button, Card, SearchInput, Select, cx, numCls, tableCls, tableWrapCls, tdCls, thCls } from "../../ui";
import { itemSearchText, lineKey } from "./orderOps";
import { QtyCell, focusFirstQtyCell, moveQtyFocus } from "./qtyCells";
import { useStableCallback } from "./useStableCallback";

type SetQty = (groupId: ID, item: ProductItem, qty: number) => void;

interface PickRow {
  key: string;
  groupId: ID;
  item: ProductItem;
  /** Chữ để tìm (mã + tên), tính sẵn một lần. */
  haystack: string;
}

interface Section {
  group: ProductGroup;
  rows: PickRow[];
}

function buildSections(groups: ProductGroup[]): Section[] {
  return groups.map((group) => {
    const seen = new Set<string>();
    const rows: PickRow[] = [];
    for (const item of group.items) {
      const key = lineKey(group.id, item.sku);
      if (seen.has(key)) continue; // mã lặp lại trong cùng danh mục: đơn chỉ có một dòng cho mã đó
      seen.add(key);
      rows.push({ key, groupId: group.id, item, haystack: itemSearchText(item) });
    }
    return { group, rows };
  });
}

const NO_KEYS: ReadonlySet<string> = new Set();

// Bảng đổi dạng theo bề rộng của chính khung "Chọn hàng" (container query), vì khung này hẹp cả trên điện thoại lẫn
// khi đứng cạnh cột kết quả:
//  • hẹp (điện thoại): mã nằm trên tên, thành tiền nằm dưới giá, lề ô nhỏ, ô số lượng cao cho dễ bấm;
//  • từ @md: thêm cột thành tiền, dòng thấp hơn để thấy được nhiều mã;
//  • từ 44rem: mã hàng tách thành cột riêng, tên hàng nằm trên một dòng.
// Riêng trên điện thoại bảng còn tràn hết bề ngang khung để không phải cuộn ngang.
const wrapCls = cx(tableWrapCls, "max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0");
const headCls = cx(thCls, "@max-md:px-2 @max-md:whitespace-normal");
const cellCls = cx(tdCls, "@max-md:px-2 @md:py-1");

export function ProductPicker({
  groups,
  lines,
  disabled,
  emptyText,
  onQty,
  onPaste,
}: {
  /** Các danh mục được chọn mua. */
  groups: ProductGroup[];
  lines: CalcLine[];
  disabled: boolean;
  /** Lời giải thích khi không có mã hàng nào để chọn. */
  emptyText: string;
  /** Phải có danh tính cố định (các dòng được React.memo). */
  onQty: SetQty;
  onPaste: () => void;
}) {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [onlyEntered, setOnlyEntered] = useState(disabled);
  // Các dòng vừa sửa khi đang bật "chỉ hiện dòng đã nhập": giữ lại dù số lượng về 0, để ô đang gõ không biến mất.
  const [kept, setKept] = useState(NO_KEYS);
  const searchRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => buildSections(groups), [groups]);
  const activeGroup = sections.some((s) => s.group.id === groupFilter) ? groupFilter : "";
  const matched = useMemo(
    () =>
      sections
        .filter((s) => !activeGroup || s.group.id === activeGroup)
        .map((s) => ({ ...s, rows: s.rows.filter((r) => matchesSearch(r.haystack, search)) })),
    [sections, activeGroup, search],
  );

  const lineByKey = useMemo(() => {
    const map = new Map<string, CalcLine>();
    for (const line of lines) {
      const key = lineKey(line.groupId, line.sku);
      if (!map.has(key)) map.set(key, line);
    }
    return map;
  }, [lines]);
  const qtyByGroup = useMemo(() => {
    const map = new Map<ID, number>();
    for (const line of lines) map.set(line.groupId, (map.get(line.groupId) ?? 0) + line.qty);
    return map;
  }, [lines]);

  const visible = matched
    .map((s) =>
      onlyEntered ? { ...s, rows: s.rows.filter((r) => (lineByKey.get(r.key)?.qty ?? 0) > 0 || kept.has(r.key)) } : s,
    )
    .filter((s) => s.rows.length > 0);

  const handleQty = useStableCallback<Parameters<SetQty>, void>((groupId, item, qty) => {
    if (onlyEntered) {
      const key = lineKey(groupId, item.sku);
      setKept((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    }
    onQty(groupId, item, qty);
  });

  const focusSearch = () => {
    const input = searchRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  };
  const onSearchKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key !== "Enter" && event.key !== "ArrowDown") || event.nativeEvent.isComposing) return;
    event.preventDefault();
    focusFirstQtyCell(tableRef.current);
  };
  // Hết bảng thì quay về ô tìm: gõ mã → Enter → gõ số lượng → Enter → gõ mã kế tiếp.
  const onTableKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const moved = moveQtyFocus(event);
    if (moved === "top" || (moved === "bottom" && event.key === "Enter" && search !== "")) focusSearch();
  };

  const resetFilters = () => {
    setSearch("");
    setGroupFilter("");
    setOnlyEntered(false);
    setKept(NO_KEYS);
  };

  const hasItems = sections.some((s) => s.rows.length > 0);
  const groupSelect =
    sections.length > 1 ? (
      <Select aria-label="Lọc theo danh mục" value={activeGroup} onChange={(e) => setGroupFilter(e.target.value)}>
        <option value="">Tất cả danh mục</option>
        {sections.map((s) => (
          <option key={s.group.id} value={s.group.id}>
            {s.group.name}
          </option>
        ))}
      </Select>
    ) : null;

  return (
    <Card
      title="Chọn hàng"
      bodyClassName="@container"
      actions={
        <Button size="sm" onClick={onPaste} disabled={disabled || !hasItems}>
          <ClipboardPaste className="h-4 w-4" /> Dán mã + số lượng
        </Button>
      }
    >
      {!hasItems ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <>
          {/* Thanh tìm dính trên đầu màn hình khi cuộn danh sách dài. Điện thoại: chỉ ô tìm dính, ô lọc danh mục nằm bên dưới. */}
          <div className="sticky top-0 z-10 -mx-4 -mt-4 flex gap-2 border-b border-gray-200 bg-white px-4 py-3">
            <div ref={searchRef} className="min-w-0 flex-1" onKeyDown={onSearchKeys}>
              <SearchInput value={search} onChange={setSearch} placeholder="Tìm mã hoặc tên hàng" />
            </div>
            {groupSelect ? <div className="hidden w-64 shrink-0 sm:block">{groupSelect}</div> : null}
          </div>
          {groupSelect ? <div className="pt-3 sm:hidden">{groupSelect}</div> : null}

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-600"
                checked={onlyEntered}
                onChange={(e) => {
                  setOnlyEntered(e.target.checked);
                  setKept(NO_KEYS);
                }}
              />
              Chỉ hiện dòng đã nhập số lượng
            </label>
            {disabled ? null : (
              <p className="hidden text-xs text-gray-500 sm:block">Enter hoặc ↓ để xuống ô số lượng kế tiếp, ↑ để lên.</p>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
              <p>
                {onlyEntered && !search && !activeGroup
                  ? "Đơn chưa có dòng hàng nào."
                  : "Không có mã hàng nào khớp với điều kiện tìm."}
              </p>
              <Button size="sm" className="mt-3" onClick={resetFilters}>
                Hiện tất cả mã hàng
              </Button>
            </div>
          ) : (
            <div ref={tableRef} className={wrapCls} onKeyDown={onTableKeys}>
              <table className={tableCls}>
                <thead>
                  <tr>
                    <th className={cx(headCls, "hidden @[44rem]:table-cell")}>Mã hàng</th>
                    <th className={headCls}>
                      <span className="@[44rem]:hidden">Mã hàng / </span>Tên hàng
                    </th>
                    <th className={cx(headCls, numCls)}>Giá sỉ</th>
                    <th className={headCls}>
                      <div className="text-center">SL</div>
                    </th>
                    <th className={cx(headCls, numCls, "hidden @md:table-cell")}>Thành tiền</th>
                  </tr>
                </thead>
                {visible.map(({ group, rows }) => {
                  const groupQty = qtyByGroup.get(group.id) ?? 0;
                  return (
                    <tbody key={group.id}>
                      <tr>
                        <th
                          colSpan={5}
                          scope="rowgroup"
                          className="border-b border-gray-200 bg-gray-100 px-2 py-1.5 text-left text-sm font-semibold text-gray-800 @md:px-3"
                        >
                          {group.name}
                          {groupQty > 0 ? (
                            <span className="ml-2 font-normal text-gray-600">· đã nhập {formatNumber(groupQty)} sản phẩm</span>
                          ) : null}
                        </th>
                      </tr>
                      {rows.map((row) => {
                        const line = lineByKey.get(row.key);
                        return (
                          <ProductRow
                            key={row.key}
                            row={row}
                            qty={line?.qty ?? 0}
                            wholesalePrice={line?.wholesalePrice ?? row.item.wholesalePrice}
                            discountedPrice={line && line.discountRuleId != null ? line.unitPrice : null}
                            amount={line?.amount ?? 0}
                            disabled={disabled}
                            onQty={handleQty}
                          />
                        );
                      })}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const ProductRow = memo(function ProductRow({
  row,
  qty,
  wholesalePrice,
  discountedPrice,
  amount,
  disabled,
  onQty,
}: {
  row: PickRow;
  qty: number;
  /** Giá sỉ đang tính cho dòng này (giá chép vào đơn nếu đã có dòng, ngược lại là giá danh mục). */
  wholesalePrice: number;
  /** Đơn giá sau giảm, null nếu dòng không được giảm giá. */
  discountedPrice: number | null;
  amount: number;
  disabled: boolean;
  onQty: SetQty;
}) {
  const { item, groupId } = row;
  return (
    <tr className={qty > 0 ? "bg-blue-50" : undefined}>
      <td className={cx(cellCls, "hidden whitespace-nowrap font-medium @[44rem]:table-cell")}>{item.sku}</td>
      <td className={cellCls}>
        <div className="font-medium @[44rem]:hidden">{item.sku}</div>
        <div className="text-xs text-gray-600 @[44rem]:text-sm @[44rem]:text-gray-900">{item.name}</div>
        {item.note ? <div className="text-xs text-gray-500">{item.note}</div> : null}
      </td>
      <td className={cx(cellCls, numCls)}>
        {discountedPrice != null ? (
          // Giá cũ nằm ngay trên giá mới, hai dòng cao vừa bằng ô số lượng: bật/tắt giảm giá không làm xô lệch cột hay dòng.
          <>
            <s className="block text-xs leading-none text-gray-400 line-through">{formatNumber(wholesalePrice)}</s>
            <span className="block leading-tight font-medium text-green-700">{formatNumber(discountedPrice)}</span>
          </>
        ) : (
          formatNumber(wholesalePrice)
        )}
        {qty > 0 ? <div className="text-xs font-medium text-gray-900 @md:hidden">= {formatNumber(amount)}</div> : null}
      </td>
      <td className={cx(cellCls, "text-center")}>
        <QtyCell
          className="@md:py-1"
          value={qty}
          onChange={(value) => onQty(groupId, item, value)}
          disabled={disabled}
          aria-label={`Số lượng ${item.sku}`}
        />
      </td>
      <td className={cx(cellCls, numCls, "hidden font-medium @md:table-cell")}>{qty > 0 ? formatNumber(amount) : ""}</td>
    </tr>
  );
});
