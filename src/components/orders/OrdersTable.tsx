// Bảng danh sách đơn hàng (một trang), dòng cuối là tổng của mọi đơn khớp bộ lọc — không chỉ trang đang xem.
import { formatDate, formatDateTime, formatNumber, formatVND } from "../../lib/format";
import { Link } from "../../lib/router";
import type { Order, Program } from "../../types";
import { Badge, Button, buttonCls, cx, numCls, tableCls, tableScrollCls, tdCls, thCls } from "../../ui";
import { NO_DEALER_NAME, NO_PROGRAM_NAME, ORDER_STATUS_LABEL } from "./labels";
import type { OrderCalc, OrderTotals } from "./totals";

/** Một đơn hàng kèm chương trình của nó (undefined nếu chương trình đã bị xóa) và kết quả tính. */
export interface OrderRow extends OrderCalc {
  program: Program | undefined;
}

// Chín cột phải vừa bề ngang màn hình máy tính (không phải kéo ngang mới thấy các nút thao tác), nên lề ô hẹp hơn
// bảng thường, ngày tạo ghi nhỏ dưới mã đơn và số điện thoại ghi nhỏ dưới tên. Màn hình hẹp hơn thì bảng cuộn ngang
// trong khung; trên điện thoại cột đại lý và cột sale thu hẹp lại để ba cột đầu — mã đơn, đại lý, sale — nằm gọn
// trong màn hình.
const ordersTableCls = cx(tableCls, "[&_td]:px-2 [&_th]:px-2");
/** Dòng chữ nhỏ dưới nội dung chính của ô: ngày tạo, số điện thoại. Chỉ trên điện thoại mới được xuống dòng. */
const subCls = "block text-xs text-gray-500 sm:whitespace-nowrap";

/** Tên, bên dưới là số điện thoại. `blank` hiện thay cho tên khi chưa ghi tên. */
function PersonCell({ name, phone, blank }: { name: string; phone: string; blank: string }) {
  return (
    <>
      {name.trim() || <span className="text-gray-400">{blank}</span>}
      {phone.trim() ? <span className={subCls}>{phone.trim()}</span> : null}
    </>
  );
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
  return (
    <tr className="hover:bg-blue-50/40">
      <td className={cx(tdCls, "whitespace-nowrap")}>
        <Link to={path} className="font-medium text-blue-700 hover:underline">
          {order.code || "(chưa có mã)"}
        </Link>
        <span className={subCls} title={formatDateTime(order.createdAt)}>
          {formatDate(order.createdAt)}
        </span>
      </td>
      <td className={cx(tdCls, "min-w-40 max-sm:min-w-32")}>
        <PersonCell name={order.customerName} phone={order.customerPhone} blank={NO_DEALER_NAME} />
      </td>
      <td className={cx(tdCls, "min-w-32 max-sm:min-w-25")}>
        <PersonCell name={order.salesperson} phone={order.salespersonPhone} blank="—" />
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
          <Badge tone={order.status === "confirmed" ? "green" : "gray"} dot>
            {ORDER_STATUS_LABEL[order.status]}
          </Badge>
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
  /** Các đơn của trang đang xem. */
  rows: OrderRow[];
  /** Tổng của mọi đơn khớp bộ lọc (mọi trang). */
  totals: OrderTotals;
  /** Số đơn khi chưa lọc — để dòng tổng nói rõ đang lọc. */
  allCount: number;
  onDuplicate: (order: Order) => void;
  onDelete: (order: Order) => void;
}) {
  return (
    <div className={tableScrollCls}>
      <table className={ordersTableCls}>
        <thead>
          <tr>
            <th className={thCls}>Mã đơn</th>
            <th className={thCls}>Đại lý</th>
            <th className={thCls}>Sale</th>
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
          <tr className="bg-gray-50 font-semibold [&_td]:border-b-0">
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
