// Xuất Excel: danh sách đơn hàng và bảng tổng hợp của một chương trình.
import { exportTableXlsx, safeFileName } from "../../lib/exportXlsx";
import { formatDate, todayISO } from "../../lib/format";
import { NO_DEALER_NAME, NO_PROGRAM_NAME, NO_SALES_NAME, ORDER_STATUS_LABEL } from "./labels";
import type { OrderRow } from "./OrdersTable";
import type { OrderTotals, OrdersSummary, SkuTotal } from "./totals";

/** Một sheet: mỗi đơn một dòng, dòng cuối là tổng. */
export function exportOrderList(rows: OrderRow[], totals: OrderTotals): Promise<void> {
  const header = [
    "Mã đơn",
    "Ngày tạo",
    "Đại lý",
    "Số điện thoại",
    "Sale",
    "Số điện thoại sale",
    "Chương trình",
    "SL",
    "Thanh toán",
    "SL quà",
    "Giá trị quà",
    "Trạng thái",
    "Ghi chú",
  ];
  const body = rows.map(({ order, program, calc }) => [
    order.code,
    formatDate(order.createdAt),
    order.customerName.trim(),
    order.customerPhone,
    order.salesperson.trim(),
    order.salespersonPhone.trim(),
    program?.name ?? NO_PROGRAM_NAME,
    calc.totalQty,
    calc.totalAmount,
    calc.giftQty,
    calc.giftValue,
    ORDER_STATUS_LABEL[order.status] + (calc.hasError ? " (có lỗi)" : ""),
    order.note,
  ]);
  const total = [
    `Tổng ${totals.orderCount} đơn`,
    "",
    "",
    "",
    "",
    "",
    "",
    totals.totalQty,
    totals.totalAmount,
    totals.giftQty,
    totals.giftValue,
    "",
    "",
  ];
  return exportTableXlsx(`don-hang-${todayISO()}`, [
    {
      name: "Đơn hàng",
      rows: [header, ...body, total],
      colWidths: [16, 12, 28, 14, 20, 18, 44, 8, 16, 8, 16, 16, 30],
    },
  ]);
}

/** Sheet đầu ghi rõ đang tính những đơn nào, sau đó mỗi bảng của trang tổng hợp một sheet. */
export function exportProgramReport(report: {
  programName: string;
  includeDrafts: boolean;
  confirmedCount: number;
  draftCount: number;
  summary: OrdersSummary;
}): Promise<void> {
  const { programName, includeDrafts, confirmedCount, draftCount, summary } = report;
  const skuRows = (rows: SkuTotal[]) => rows.map((row) => [row.sku, row.name, row.qty, row.value]);
  return exportTableXlsx(safeFileName(`Tổng hợp - ${programName}`), [
    {
      name: "Tổng hợp",
      rows: [
        ["Chương trình", programName],
        ["Ngày xuất", formatDate(todayISO())],
        ["Đơn được tính", includeDrafts ? "Tất cả đơn, kể cả đơn nháp" : "Chỉ đơn đã chốt"],
        ["Số đơn được tính", summary.orderCount],
        ["Số đơn đã chốt", confirmedCount],
        [includeDrafts ? "Số đơn nháp" : "Số đơn nháp (không tính)", draftCount],
        ["Số lượng bán", summary.totalQty],
        ["Thanh toán", summary.totalAmount],
        ["Số lượng quà", summary.giftQty],
        ["Giá trị quà", summary.giftValue],
      ],
      colWidths: [26, 50],
    },
    {
      name: "Hàng bán theo mã",
      rows: [
        ["Mã hàng", "Tên hàng", "SL", "Thành tiền"],
        ...skuRows(summary.items),
        ["Tổng", "", summary.totalQty, summary.totalAmount],
      ],
      colWidths: [16, 50, 8, 16],
    },
    {
      name: "Quà tặng theo mã",
      rows: [
        ["Mã hàng", "Tên", "SL", "Giá trị"],
        ...skuRows(summary.gifts),
        ["Tổng", "", summary.giftQty, summary.giftValue],
      ],
      colWidths: [16, 50, 8, 16],
    },
    {
      name: "Theo sale",
      rows: [
        ["Sale", "Số đơn", "SL", "Thanh toán", "Giá trị quà"],
        ...summary.sales.map((sale) => [
          sale.name || NO_SALES_NAME,
          sale.orderCount,
          sale.totalQty,
          sale.totalAmount,
          sale.giftValue,
        ]),
        ["Tổng", summary.orderCount, summary.totalQty, summary.totalAmount, summary.giftValue],
      ],
      colWidths: [28, 10, 8, 16, 16],
    },
    {
      name: "Theo đại lý",
      rows: [
        ["Đại lý", "Số đơn", "Thanh toán", "Giá trị quà"],
        ...summary.dealers.map((dealer) => [
          dealer.name || NO_DEALER_NAME,
          dealer.orderCount,
          dealer.totalAmount,
          dealer.giftValue,
        ]),
        ["Tổng", summary.orderCount, summary.totalAmount, summary.giftValue],
      ],
      colWidths: [36, 10, 16, 16],
    },
  ]);
}
