// Tab "Tổng hợp" của một chương trình: đã bán bao nhiêu, đã hứa tặng bao nhiêu quà, đại lý nào mua.
import { useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { calculateOrder } from "../lib/engine";
import { formatNumber, formatVND } from "../lib/format";
import { Link } from "../lib/router";
import { useStore } from "../lib/store";
import { Button, Card, EmptyState, Notice, cx, numCls, tableCls, tableWrapCls, tdCls, thCls, toast } from "../ui";
import { exportProgramReport } from "./orders/excel";
import { NO_DEALER_NAME } from "./orders/labels";
import { summarizeOrders, type SkuTotal } from "./orders/totals";

function Figure({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cx("rounded-lg border border-gray-200 bg-white px-4 py-3", className)}>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-gray-900 sm:text-lg">{value}</dd>
      {note ? <dd className="text-xs text-gray-500">{note}</dd> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

/** Bảng cộng theo mã: Mã hàng · Tên · SL · giá trị, dòng cuối là tổng. */
function SkuTable({
  title,
  nameLabel,
  valueLabel,
  emptyText,
  rows,
  totalQty,
  totalValue,
}: {
  title: string;
  nameLabel: string;
  valueLabel: string;
  emptyText: string;
  rows: SkuTotal[];
  totalQty: number;
  totalValue: number;
}) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">{emptyText}</p>
      ) : (
        <div className={tableWrapCls}>
          <table className={tableCls}>
            <thead>
              <tr>
                <th className={thCls}>Mã hàng</th>
                <th className={thCls}>{nameLabel}</th>
                <th className={cx(thCls, numCls)}>SL</th>
                <th className={cx(thCls, numCls)}>{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sku || row.name}>
                  <td className={cx(tdCls, "whitespace-nowrap")}>
                    {row.sku || <span className="text-gray-400">—</span>}
                  </td>
                  <td className={cx(tdCls, "min-w-48")}>{row.name}</td>
                  <td className={cx(tdCls, numCls)}>{formatNumber(row.qty)}</td>
                  <td className={cx(tdCls, numCls)}>{formatVND(row.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className={tdCls} colSpan={2}>
                  Tổng: {formatNumber(rows.length)} mã
                </td>
                <td className={cx(tdCls, numCls)}>{formatNumber(totalQty)}</td>
                <td className={cx(tdCls, numCls)}>{formatVND(totalValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

export default function ProgramReport({ programId }: { programId: string }) {
  const { orders, getProgram } = useStore();
  const program = getProgram(programId);
  const [includeDrafts, setIncludeDrafts] = useState(true);

  const entries = useMemo(
    () =>
      orders
        .filter((order) => order.programId === programId)
        .map((order) => ({ order, calc: calculateOrder(program, order) })),
    [orders, program, programId],
  );
  const summary = useMemo(
    () => summarizeOrders(includeDrafts ? entries : entries.filter((e) => e.order.status === "confirmed")),
    [entries, includeDrafts],
  );

  if (entries.length === 0) {
    return (
      <EmptyState
        title="Chương trình này chưa có đơn hàng nào"
        hint="Khi có đơn, số lượng bán và quà tặng của chương trình sẽ được cộng ở đây."
      />
    );
  }

  const confirmedCount = entries.filter((e) => e.order.status === "confirmed").length;
  const draftCount = entries.length - confirmedCount;

  const counted = includeDrafts
    ? `Đang tính tất cả ${entries.length} đơn của chương trình (${confirmedCount} đã chốt, ${draftCount} nháp).`
    : `Đang chỉ tính ${confirmedCount} đơn đã chốt, bỏ qua ${draftCount} đơn nháp.`;

  const exportExcel = () => {
    const programName = program?.name ?? "chương trình";
    exportProgramReport({ programName, includeDrafts, confirmedCount, draftCount, summary })
      .then(() => toast("Đã xuất bảng tổng hợp ra file Excel"))
      .catch(() => toast("Không xuất được file Excel. Hãy thử lại.", "error"));
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-900">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-600"
                checked={includeDrafts}
                onChange={(e) => setIncludeDrafts(e.target.checked)}
              />
              Tính cả đơn nháp
            </label>
            <p className="mt-1 text-sm text-gray-600">{counted}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              to={`/orders?program=${encodeURIComponent(programId)}`}
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              Xem các đơn của chương trình
            </Link>
            <Button onClick={exportExcel} disabled={summary.orderCount === 0}>
              <Download className="h-4 w-4" /> Xuất Excel
            </Button>
          </div>
        </div>
      </Card>

      {summary.errorCount > 0 ? (
        <Notice tone="warning">
          Có {summary.errorCount} đơn đang có lỗi (ví dụ quà vượt hạn mức). Số liệu của các đơn này vẫn được tính bên
          dưới — nên mở danh sách đơn để kiểm tra.
        </Notice>
      ) : null}

      {summary.orderCount === 0 ? (
        <EmptyState
          title="Chưa có đơn nào đã chốt"
          hint="Chương trình mới chỉ có đơn nháp. Tích «Tính cả đơn nháp» để xem số liệu của các đơn nháp."
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Figure
              className="col-span-2 sm:col-span-1"
              label="Số đơn"
              value={formatNumber(summary.orderCount)}
              note={includeDrafts ? `${confirmedCount} đã chốt · ${draftCount} nháp` : "chỉ đơn đã chốt"}
            />
            <Figure label="Số lượng bán" value={formatNumber(summary.totalQty)} />
            <Figure label="Thanh toán" value={formatVND(summary.totalAmount)} />
            <Figure label="Số lượng quà" value={formatNumber(summary.giftQty)} />
            <Figure label="Giá trị quà" value={formatVND(summary.giftValue)} />
          </dl>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <SkuTable
              title="Hàng bán theo mã"
              nameLabel="Tên hàng"
              valueLabel="Thành tiền"
              emptyText="Các đơn đang tính chưa có dòng hàng nào."
              rows={summary.items}
              totalQty={summary.totalQty}
              totalValue={summary.totalAmount}
            />
            <div className="space-y-4">
              <SkuTable
                title="Quà tặng theo mã"
                nameLabel="Tên"
                valueLabel="Giá trị"
                emptyText="Các đơn đang tính chưa có quà tặng nào."
                rows={summary.gifts}
                totalQty={summary.giftQty}
                totalValue={summary.giftValue}
              />
              <Section title="Theo đại lý">
                <div className={tableWrapCls}>
                  <table className={tableCls}>
                    <thead>
                      <tr>
                        <th className={thCls}>Đại lý</th>
                        <th className={cx(thCls, numCls)}>Số đơn</th>
                        <th className={cx(thCls, numCls)}>Thanh toán</th>
                        <th className={cx(thCls, numCls)}>Giá trị quà</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.dealers.map((dealer) => (
                        <tr key={dealer.name}>
                          <td className={cx(tdCls, "min-w-44")}>
                            {dealer.name || <span className="text-gray-400">{NO_DEALER_NAME}</span>}
                          </td>
                          <td className={cx(tdCls, numCls)}>{formatNumber(dealer.orderCount)}</td>
                          <td className={cx(tdCls, numCls)}>{formatVND(dealer.totalAmount)}</td>
                          <td className={cx(tdCls, numCls)}>{formatVND(dealer.giftValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 font-semibold">
                        <td className={tdCls}>Tổng: {formatNumber(summary.dealers.length)} đại lý</td>
                        <td className={cx(tdCls, numCls)}>{formatNumber(summary.orderCount)}</td>
                        <td className={cx(tdCls, numCls)}>{formatVND(summary.totalAmount)}</td>
                        <td className={cx(tdCls, numCls)}>{formatVND(summary.giftValue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
