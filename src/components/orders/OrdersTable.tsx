// Bảng danh sách đơn hàng, dòng cuối là tổng của các đơn đang hiện.
import { formatDate, formatDateTime, formatNumber, formatVND } from "../../lib/format";
import { Link } from "../../lib/router";
import type { Order, Program } from "../../types";
import { Badge, Button, buttonCls, cx, numCls, tableCls, tableWrapCls, tdCls, thCls } from "../../ui";
import { NO_DEALER_NAME, NO_PROGRAM_NAME, ORDER_STATUS_LABEL } from "./labels";
import type { OrderCalc, OrderTotals } from "./totals";

/** Một đơn hàng kèm chương trình của nó (undefined nếu chương trình đã bị xóa) và kết quả tính. */
export interface OrderRow extends OrderCalc {
  program: Program | undefined;
}

/** Giá trị quà, bên dưới là số lượng quà. */
function GiftCell({ qty, value }: { qty: number; value: number }) {
  if (qty === 0) return <span className="font-normal text-gray-400">—</span>;
  return (
    <>
      {formatVND(value)}
      <span className="block text-xs font-normal text-gray-500">SL: {formatNumber(qty)}</span>
    </>
  );
}

function OrderTableRow({
  row: { order, program, calc },
  onDuplicate,
  onDelete,
}: {
  row: OrderRow;
  onDuplicate: (order: Order) => void;
  onDelete: (order: Order) => void;
}) {
  const path = `/orders/${encodeURIComponent(order.id)}`;
  const contact = [order.customerPhone, order.salesperson && `Sale: ${order.salesperson}`].filter(Boolean).join(" · ");
  return (
    <tr className="hover:bg-gray-50">
      <td className={cx(tdCls, "whitespace-nowrap")}>
        <Link to={path} className="font-medium text-blue-700 hover:underline">
          {order.code || "(chưa có mã)"}
        </Link>
      </td>
      <td className={cx(tdCls, "whitespace-nowrap")} title={formatDateTime(order.createdAt)}>
        {formatDate(order.createdAt)}
      </td>
      <td className={cx(tdCls, "min-w-40")}>
        {order.customerName.trim() || <span className="text-gray-400">{NO_DEALER_NAME}</span>}
        {contact ? <span className="block whitespace-nowrap text-xs text-gray-500">{contact}</span> : null}
      </td>
      <td className={cx(tdCls, "min-w-56")}>
        {program?.name ?? <span className="text-gray-400">{NO_PROGRAM_NAME}</span>}
      </td>
      <td className={cx(tdCls, numCls)}>{formatNumber(calc.totalQty)}</td>
      <td className={cx(tdCls, numCls)}>{formatVND(calc.totalAmount)}</td>
      <td className={cx(tdCls, numCls)}>
        <GiftCell qty={calc.giftQty} value={calc.giftValue} />
      </td>
      <td className={tdCls}>
        <span className="flex flex-wrap gap-1">
          <Badge tone={order.status === "confirmed" ? "green" : "gray"}>{ORDER_STATUS_LABEL[order.status]}</Badge>
          {calc.hasError ? <Badge tone="red">Có lỗi</Badge> : null}
        </span>
      </td>
      <td className={tdCls}>
        <div className="flex justify-end gap-1.5">
          <Link to={path} className={buttonCls("default", "sm")}>
            Mở
          </Link>
          <Button size="sm" onClick={() => onDuplicate(order)}>
            Nhân bản
          </Button>
          <Button size="sm" variant="danger" onClick={() => onDelete(order)}>
            Xóa
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function OrdersTable({
  rows,
  totals,
  allCount,
  onDuplicate,
  onDelete,
}: {
  rows: OrderRow[];
  /** Tổng của `rows`. */
  totals: OrderTotals;
  /** Số đơn khi chưa lọc — để dòng tổng nói rõ đang lọc. */
  allCount: number;
  onDuplicate: (order: Order) => void;
  onDelete: (order: Order) => void;
}) {
  return (
    <div className={tableWrapCls}>
      <table className={tableCls}>
        <thead>
          <tr>
            <th className={thCls}>Mã đơn</th>
            <th className={thCls}>Ngày tạo</th>
            <th className={thCls}>Đại lý</th>
            <th className={thCls}>Chương trình</th>
            <th className={cx(thCls, numCls)}>SL</th>
            <th className={cx(thCls, numCls)}>Thanh toán</th>
            <th className={cx(thCls, numCls)}>Quà tặng</th>
            <th className={thCls}>Trạng thái</th>
            <th className={thCls} aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <OrderTableRow key={row.order.id} row={row} onDuplicate={onDuplicate} onDelete={onDelete} />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-semibold">
            <td className={tdCls} colSpan={4}>
              Tổng: {formatNumber(totals.orderCount)} đơn
              {totals.orderCount < allCount ? (
                <span className="font-normal text-gray-500"> (đang lọc trong {formatNumber(allCount)} đơn)</span>
              ) : null}
            </td>
            <td className={cx(tdCls, numCls)}>{formatNumber(totals.totalQty)}</td>
            <td className={cx(tdCls, numCls)}>{formatVND(totals.totalAmount)}</td>
            <td className={cx(tdCls, numCls)}>
              <GiftCell qty={totals.giftQty} value={totals.giftValue} />
            </td>
            <td className={tdCls} colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
