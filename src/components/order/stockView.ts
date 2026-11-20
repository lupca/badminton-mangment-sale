// Tồn kho trên màn hình tính đơn: khi nào được hiện, và lời cảnh báo khi đơn đặt nhiều hơn số đang tồn. Các hàm đều thuần.
import type { CalcResult, Order, Stock } from "../../types";
import { formatDateTime, formatNumber, formatQty, normalizeSku } from "../../lib/format";
import { orderStockIssues } from "../../lib/stock";
import type { OrderStockIssue } from "../../lib/stock";

/** Một mã trong đơn mà kho không đủ, kèm phần là quà tặng trong tổng số đặt. */
export interface StockWarning extends OrderStockIssue {
  /** Trong `ordered`, bao nhiêu là quà tặng (quà sale chọn và quà tự tặng). */
  giftQty: number;
}

/** Mọi thứ về tồn kho mà màn hình tính đơn cần cho một đơn. */
export interface OrderStockView {
  /** Tồn kho hiện cạnh từng mã hàng. Danh tính chỉ đổi khi tồn kho được nhập lại. */
  stock: Stock;
  /** Ngưỡng «sắp hết» (settings.lowStockThreshold). */
  lowThreshold: number;
  /** Các mã mà kho không đủ cho đơn này. Chỉ để báo cho sale biết — không chặn việc chốt đơn. */
  warnings: StockWarning[];
  /** Mã hàng (đã chuẩn hóa) của các cảnh báo — để tô đỏ số tồn ở đúng các dòng đó. */
  overSkus: ReadonlySet<string>;
}

/**
 * Tồn kho cho một đơn; null = màn hình không hiện gì về tồn kho.
 * Chưa nhập tồn kho lần nào thì màn hình giữ nguyên như khi chưa có tồn kho. Đơn đã chốt là lịch sử nên không so
 * với số tồn của hôm nay.
 */
export function orderStockView(
  stock: Stock,
  lowThreshold: number,
  status: Order["status"],
  calc: Pick<CalcResult, "lines" | "gifts">,
): OrderStockView | null {
  if (status !== "draft" || Object.keys(stock.bySku).length === 0) return null;
  const warnings = stockWarnings(calc, stock);
  return { stock, lowThreshold, warnings, overSkus: new Set(warnings.map((warning) => normalizeSku(warning.sku))) };
}

/** Các mã trong đơn mà kho không đủ (xem `orderStockIssues`), thêm số lượng là quà tặng của từng mã. */
export function stockWarnings(calc: Pick<CalcResult, "lines" | "gifts">, stock: Stock): StockWarning[] {
  const issues = orderStockIssues(calc, stock);
  if (issues.length === 0) return [];
  const giftQty = new Map<string, number>();
  for (const gift of calc.gifts) {
    const sku = normalizeSku(gift.sku);
    if (sku && gift.qty > 0) giftQty.set(sku, (giftQty.get(sku) ?? 0) + gift.qty);
  }
  return issues.map((issue) => ({ ...issue, giftQty: giftQty.get(normalizeSku(issue.sku)) ?? 0 }));
}

/**
 * Một dòng cảnh báo: «Vượt tồn kho: P-AYPR285-3 đặt 30, kho còn 24» hoặc «P-AYPR287-3: kho đã hết hàng».
 * Số đặt gồm cả quà tặng nên có thể khác số sale gõ ở bảng chọn hàng — khi có quà thì ghi rõ phần mua và phần quà.
 */
export function stockWarningText(warning: StockWarning): string {
  const { sku, ordered, giftQty } = warning;
  const onlyGifts = giftQty >= ordered;
  if (warning.level === "out") return `${sku}: kho đã hết hàng${onlyGifts ? " (quà tặng)" : ""}`;
  const parts = onlyGifts
    ? " (quà tặng)"
    : giftQty > 0
      ? ` (gồm ${formatNumber(ordered - giftQty)} mua + ${formatNumber(giftQty)} quà tặng)`
      : "";
  return `Vượt tồn kho: ${sku} đặt ${formatNumber(ordered)}, kho còn ${formatQty(warning.stock)}${parts}`;
}

/** Cảnh báo tồn kho gói trong một dòng cho thanh đáy màn hình điện thoại; null = không có gì để báo. */
export function stockWarningSummary(warnings: StockWarning[]): string | null {
  if (warnings.length === 0) return null;
  if (warnings.length === 1) return stockWarningText({ ...warnings[0], giftQty: 0 });
  return `Tồn kho không đủ cho ${formatNumber(warnings.length)} mã — xem kết quả`;
}

/** Câu nói rõ số tồn lấy từ đâu và vì sao chỉ là cảnh báo: file kho có thể đã cũ nên đơn vẫn chốt được. */
export function stockSourceNote(stock: Pick<Stock, "updatedAt">): string {
  const at = formatDateTime(stock.updatedAt);
  return `Tồn kho là số trong file kho ${at ? `cập nhật lúc ${at}` : "đã nhập"}, có thể đã thay đổi — vẫn chốt đơn được.`;
}
