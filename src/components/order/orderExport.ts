// Nội dung đơn hàng để chép vào Zalo và để xuất Excel.
import type { CalcLine, CalcResult, Order, Program } from "../../types";
import type { XlsxCell, XlsxSheet } from "../../lib/exportXlsx";
import { formatDate, formatNumber, formatPeriod, formatPercent, formatVND } from "../../lib/format";

export const ORDER_STATUS_LABEL: Record<Order["status"], string> = { draft: "Nháp", confirmed: "Đã chốt" };

const DELETED_PROGRAM = "(chương trình đã bị xóa)";

/** Những gì bản in, bản chép và file Excel cần: đơn, chương trình, kết quả tính và các dòng hàng đã xếp theo thứ tự danh mục. */
export interface OrderDocument {
  order: Order;
  program: Program | null;
  calc: CalcResult;
  lines: CalcLine[];
}

/** Bản tóm tắt dạng chữ, dán được vào Zalo. */
export function buildOrderText({ order, program, calc, lines }: OrderDocument): string {
  const out: string[] = [`ĐƠN HÀNG ${order.code}`, `Ngày: ${formatDate(order.createdAt)}`];
  const customer = [order.customerName.trim(), order.customerPhone.trim()].filter(Boolean).join(" — ");
  if (customer) out.push(`Đại lý: ${customer}`);
  if (order.salesperson.trim()) out.push(`Sale: ${order.salesperson.trim()}`);
  out.push(`Chương trình: ${program ? program.name : DELETED_PROGRAM}`);

  out.push("");
  lines.forEach((line, i) => {
    const discount = line.discountPercent != null ? ` (đã giảm ${formatPercent(line.discountPercent)})` : "";
    out.push(`${i + 1}. ${line.sku}  ${line.name} × ${formatNumber(line.qty)} = ${formatVND(line.amount)}${discount}`);
  });

  out.push("");
  out.push(`Tổng số lượng: ${formatNumber(calc.totalQty)}`);
  if (calc.discountAmount > 0) {
    out.push(`Tổng giá sỉ: ${formatVND(calc.totalWholesale)}`);
    out.push(`Giảm giá: −${formatVND(calc.discountAmount)}`);
  }
  out.push(`Thanh toán: ${formatVND(calc.totalAmount)}`);

  if (calc.gifts.length > 0) {
    out.push("");
    out.push("Quà tặng:");
    for (const gift of calc.gifts) {
      out.push(`- ${gift.sku ? `${gift.sku}  ` : ""}${gift.name} × ${formatNumber(gift.qty)}`);
    }
  }
  if (order.note.trim()) {
    out.push("");
    out.push(`Ghi chú: ${order.note.trim()}`);
  }
  return out.join("\n");
}

/** Một sheet Excel: thông tin đơn, bảng hàng, tổng, bảng quà. */
export function buildOrderSheet({ order, program, calc, lines }: OrderDocument): XlsxSheet {
  const groupName = (id: string) => program?.groups.find((g) => g.id === id)?.name ?? "";
  // Số tiền nằm ở cột "Thành tiền" (cột thứ 8) để thẳng hàng với bảng hàng.
  const totalRow = (label: string, amount: number): XlsxCell[] => [null, null, label, null, null, null, null, amount];

  const rows: XlsxCell[][] = [
    [`ĐƠN HÀNG ${order.code}`],
    ["Ngày", formatDate(order.createdAt)],
    ["Trạng thái", ORDER_STATUS_LABEL[order.status]],
    ["Chương trình", program ? program.name : DELETED_PROGRAM],
    ["Thời gian", program ? formatPeriod(program.startDate, program.endDate) : ""],
    ["Đại lý", order.customerName],
    ["Số điện thoại", order.customerPhone],
    ["Sale", order.salesperson],
    ["Ghi chú", order.note],
    [],
    ["STT", "Mã hàng", "Tên hàng", "SL", "Giá lẻ", "Giá sỉ", "Đơn giá", "Thành tiền", "Danh mục"],
    ...lines.map((line, i): XlsxCell[] => [
      i + 1,
      line.sku,
      line.name,
      line.qty,
      line.retailPrice,
      line.wholesalePrice,
      line.unitPrice,
      line.amount,
      groupName(line.groupId),
    ]),
    [null, null, "Tổng số lượng", calc.totalQty],
    totalRow("Tổng giá lẻ", calc.totalRetail),
    totalRow("Tổng giá sỉ", calc.totalWholesale),
  ];
  if (calc.discountAmount > 0) rows.push(totalRow("Giảm giá", -calc.discountAmount));
  rows.push(totalRow("Thanh toán", calc.totalAmount));

  if (calc.gifts.length > 0) {
    rows.push(
      [],
      ["QUÀ TẶNG"],
      ["STT", "Mã hàng", "Tên quà", "SL", "Giá trị 1 sản phẩm", "Giá trị"],
      ...calc.gifts.map((gift, i): XlsxCell[] => [i + 1, gift.sku, gift.name, gift.qty, gift.unitValue, gift.value]),
      [null, null, "Tổng quà tặng", calc.giftQty, null, calc.giftValue],
    );
  }
  return { name: order.code || "Đơn hàng", rows, colWidths: [14, 18, 46, 8, 14, 14, 14, 16, 30] };
}
