// Tồn kho của một mã hàng, hiện cạnh ô số lượng trong bảng chọn hàng và bảng chọn quà.
import { formatQty } from "../../lib/format";
import { stockLevel } from "../../lib/stock";
import { Badge, cx } from "../../ui";

/**
 * Cùng cách trình bày với màn hình «Sản phẩm»: còn nhiều thì chỉ là con số, sắp hết thì thêm nhãn vàng «Sắp hết»,
 * hết hàng thì nhãn đỏ «Hết hàng», chưa có số liệu thì «—». Con số chuyển đỏ khi đơn đang đặt nhiều hơn số tồn.
 */
export function StockTag({
  qty,
  lowThreshold,
  over,
  compact = false,
}: {
  /** Số tồn của mã (`stockOf`); null = chưa có số liệu. */
  qty: number | null;
  /** Ngưỡng «sắp hết» (settings.lowStockThreshold). */
  lowThreshold: number;
  /** Số lượng của mã này trong đơn (hàng mua + quà) đang nhiều hơn số tồn. */
  over: boolean;
  /** Dạng gọn trên một dòng, tự mang chữ «Tồn» — dùng ở nơi không có cột «Tồn» riêng. */
  compact?: boolean;
}) {
  if (qty == null) {
    return (
      <span className="text-gray-400" title="Chưa có số liệu tồn kho">
        {compact ? "Tồn —" : "—"}
      </span>
    );
  }
  const level = stockLevel(qty, lowThreshold);
  if (level === "out") return <Badge tone="red">Hết hàng</Badge>;

  const overCls = over ? "font-semibold text-red-700" : undefined;
  const title = over ? "Số lượng trong đơn nhiều hơn tồn kho" : undefined;
  if (level === "low") {
    const number = (
      <span className={cx("tabular-nums", overCls ?? (compact ? "font-medium text-gray-900" : undefined))}>
        {formatQty(qty)}
      </span>
    );
    return compact ? (
      <span className="inline-flex items-center gap-1" title={title}>
        <Badge tone="amber">Sắp hết</Badge>
        {number}
      </span>
    ) : (
      // Trong cột «Tồn»: con số nằm trên nhãn để cột không rộng thêm.
      <span className="inline-flex flex-col items-end gap-0.5" title={title}>
        {number}
        <Badge tone="amber">Sắp hết</Badge>
      </span>
    );
  }
  return (
    <span className={cx("tabular-nums", overCls ?? (compact ? "text-gray-600" : undefined))} title={title}>
      {compact ? `Tồn ${formatQty(qty)}` : formatQty(qty)}
    </span>
  );
}
