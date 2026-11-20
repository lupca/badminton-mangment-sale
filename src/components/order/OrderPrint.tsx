// Bản in của đơn hàng (A4 dọc). Chỉ hiện khi in; phần còn lại của trang ẩn bằng `print:hidden`.
import { formatDate, formatNumber, formatPeriod, formatPercent, formatVND } from "../../lib/format";
import { cx } from "../../ui";
import type { OrderDocument } from "./orderExport";

const cell = "border border-gray-500 px-1.5 py-1 align-top";
const head = cx(cell, "font-bold");
const left = "text-left";
const num = "text-right tabular-nums whitespace-nowrap";

export function OrderPrint({ order, program, calc, lines }: OrderDocument) {
  return (
    <div className="hidden text-[12px] leading-snug text-black print:block">
      <h1 className="text-center text-xl font-bold">ĐƠN HÀNG {order.code}</h1>
      <p className="text-center">Ngày {formatDate(order.createdAt)}</p>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1">
        <p>
          <b>Đại lý:</b> {order.customerName}
        </p>
        <p>
          <b>SĐT:</b> {order.customerPhone}
        </p>
        <p className="col-span-2">
          <b>Sale:</b> {order.salesperson}
        </p>
        <p className="col-span-2">
          <b>Chương trình:</b>{" "}
          {program
            ? `${program.name} (${formatPeriod(program.startDate, program.endDate)})`
            : "(chương trình đã bị xóa)"}
        </p>
      </div>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr>
            <th className={cx(head, "w-8 text-center")}>STT</th>
            <th className={cx(head, left)}>Mã hàng</th>
            <th className={cx(head, left)}>Tên hàng</th>
            <th className={cx(head, num)}>SL</th>
            <th className={cx(head, num)}>Đơn giá</th>
            <th className={cx(head, num)}>Thành tiền</th>
          </tr>
        </thead>
        {/* Dòng tổng nằm trong tbody: tfoot sẽ bị lặp lại ở cuối mỗi trang in. */}
        <tbody>
          {lines.map((line, i) => (
            <tr key={line.index} className="break-inside-avoid">
              <td className={cx(cell, "text-center")}>{i + 1}</td>
              <td className={cx(cell, "whitespace-nowrap")}>{line.sku}</td>
              <td className={cell}>
                {line.name}
                {line.discountPercent != null ? ` (đã giảm ${formatPercent(line.discountPercent)})` : ""}
              </td>
              <td className={cx(cell, num)}>{formatNumber(line.qty)}</td>
              <td className={cx(cell, num)}>{formatNumber(line.unitPrice)}</td>
              <td className={cx(cell, num)}>{formatNumber(line.amount)}</td>
            </tr>
          ))}
          <tr className="break-inside-avoid font-semibold">
            <td className={cell} colSpan={3}>
              Tổng cộng
            </td>
            <td className={cx(cell, num)}>{formatNumber(calc.totalQty)}</td>
            <td className={cell} />
            <td className={cx(cell, num)}>{formatNumber(calc.totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 ml-auto w-72 break-inside-avoid space-y-0.5">
        {calc.discountAmount > 0 ? (
          <>
            <PrintTotal label="Tổng giá sỉ" value={formatVND(calc.totalWholesale)} />
            <PrintTotal label="Giảm giá" value={`−${formatVND(calc.discountAmount)}`} />
          </>
        ) : null}
        <PrintTotal label="Thanh toán" value={formatVND(calc.totalAmount)} strong />
      </div>

      {calc.gifts.length > 0 ? (
        <>
          <h2 className="mt-5 text-sm font-bold">Quà tặng</h2>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr>
                <th className={cx(head, left)}>Mã hàng</th>
                <th className={cx(head, left)}>Tên</th>
                <th className={cx(head, num)}>SL</th>
                <th className={cx(head, num)}>Giá trị</th>
              </tr>
            </thead>
            <tbody>
              {calc.gifts.map((gift, i) => (
                <tr key={i} className="break-inside-avoid">
                  <td className={cx(cell, "whitespace-nowrap")}>{gift.sku}</td>
                  <td className={cell}>{gift.name}</td>
                  <td className={cx(cell, num)}>{formatNumber(gift.qty)}</td>
                  <td className={cx(cell, num)}>{gift.value > 0 ? formatNumber(gift.value) : ""}</td>
                </tr>
              ))}
              <tr className="break-inside-avoid font-semibold">
                <td className={cell} colSpan={2}>
                  Tổng quà tặng
                </td>
                <td className={cx(cell, num)}>{formatNumber(calc.giftQty)}</td>
                <td className={cx(cell, num)}>{calc.giftValue > 0 ? formatNumber(calc.giftValue) : ""}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      {order.note.trim() ? (
        <p className="mt-4 whitespace-pre-wrap">
          <b>Ghi chú:</b> {order.note.trim()}
        </p>
      ) : null}
    </div>
  );
}

function PrintTotal({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-4", strong && "text-base font-bold")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
