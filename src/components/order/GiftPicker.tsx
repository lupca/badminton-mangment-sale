// Bảng chọn quà của một quy tắc: mỗi mã một dòng, có ô số lượng.
import { useState } from "react";
import type { ReactNode } from "react";
import { formatNumber, matchesSearch } from "../../lib/format";
import { Button, SearchInput, cx, numCls, tableCls } from "../../ui";
import { itemSearchText } from "./orderOps";
import type { GiftRow } from "./orderOps";
import { QtyCell, moveQtyFocus } from "./qtyCells";

/** Danh sách dài hơn số này thì có ô tìm và cuộn riêng, để khối kết quả không quá dài. */
const LONG_LIST = 12;

const headCls = "border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-semibold text-gray-600";
const cellCls = "border-b border-gray-100 px-2 py-1.5 align-middle";

export function GiftPicker({
  heading,
  rows,
  disabled,
  onQty,
}: {
  heading: ReactNode;
  rows: GiftRow[];
  disabled: boolean;
  onQty: (row: GiftRow, qty: number) => void;
}) {
  const [search, setSearch] = useState("");
  // Đơn đã chốt không chọn được nữa: chỉ cần thấy những quà đã chọn.
  const listed = disabled ? rows.filter((row) => row.qty > 0) : rows;
  const long = listed.length > LONG_LIST;
  const shown = long ? listed.filter((row) => row.invalid || matchesSearch(itemSearchText(row), search)) : listed;

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-gray-900">{heading}</div>
      {long ? <SearchInput className="mb-2" value={search} onChange={setSearch} placeholder="Tìm quà theo mã hoặc tên" /> : null}
      <div
        className={cx("rounded-md border border-gray-200", long ? "max-h-96 overflow-y-auto" : "overflow-hidden")}
        onKeyDown={moveQtyFocus}
      >
        <table className={tableCls}>
          <thead>
            <tr>
              <th className={cx(headCls, "text-left")}>Mã hàng / Tên quà</th>
              <th className={cx(headCls, numCls)}>Giá trị</th>
              <th className={cx(headCls, "text-center")}>SL</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={`${row.invalid ? "x" : "o"} ${row.sku} ${row.groupId}`}
                className={row.invalid ? "bg-red-50" : row.qty > 0 ? "bg-blue-50" : undefined}
              >
                <td className={cellCls}>
                  <div className="font-medium">{row.sku}</div>
                  <div className="text-xs text-gray-600">{row.name}</div>
                  {row.invalid ? <div className="text-xs font-medium text-red-700">Không còn được chọn</div> : null}
                </td>
                <td className={cx(cellCls, numCls)}>{formatNumber(row.unitValue)}</td>
                <td className={cx(cellCls, "text-center")}>
                  {row.invalid ? (
                    <div className="flex flex-col items-center gap-1">
                      <span className="tabular-nums">× {formatNumber(row.qty)}</span>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={disabled}
                        onClick={() => onQty(row, 0)}
                        aria-label={`Bỏ quà ${row.sku}`}
                      >
                        Bỏ
                      </Button>
                    </div>
                  ) : (
                    <QtyCell
                      value={row.qty}
                      onChange={(qty) => onQty(row, qty)}
                      disabled={disabled}
                      aria-label={`Số lượng quà ${row.sku}`}
                    />
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2 py-4 text-center text-sm text-gray-500">
                  {listed.length === 0 ? "Chưa chọn quà nào." : "Không có quà nào khớp."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
