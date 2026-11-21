// Tồn kho: đọc, gộp và xếp mức tồn của từng mã hàng. Danh sách sản phẩm của màn hình «Sản phẩm» ở catalog.ts. Các hàm đều thuần.
import type { CalcResult, Program, Stock } from "../types";
import { normalizeSku } from "./format";

/** Số lượng tồn hợp lệ: số hữu hạn (nhận cả 0 và số âm — kho bị âm), làm tròn 3 chữ số lẻ. Không phải số → null. */
export function stockQty(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000 || 0; // "|| 0" đổi -0 thành 0
}

/** Tồn kho của một mã hàng; null = chưa có số liệu. */
export function stockOf(stock: Stock, sku: string): number | null {
  const qty = stock.bySku[normalizeSku(sku)];
  return typeof qty === "number" ? qty : null;
}

/** Ghi `entries` (mã hàng → số lượng) đè lên `base`; `base` = null thì bỏ hết số liệu cũ. `at` = thời điểm cập nhật. */
export function applyStock(base: Stock | null, entries: Record<string, number>, at: string): Stock {
  const bySku: Record<string, number> = { ...base?.bySku };
  for (const [key, value] of Object.entries(entries)) {
    const sku = normalizeSku(key);
    const qty = stockQty(value);
    if (sku && qty != null) bySku[sku] = qty;
  }
  return { bySku, updatedAt: at };
}

/**
 * Chọn một trong hai bộ tồn kho khi gộp dữ liệu từ file sao lưu: lấy trọn bộ được cập nhật gần đây hơn.
 * Tồn kho là ảnh chụp tại một thời điểm nên không trộn từng mã của hai bộ với nhau.
 */
export function newerStock(current: Stock, incoming: Stock): Stock {
  if (Object.keys(incoming.bySku).length === 0) return current;
  if (Object.keys(current.bySku).length === 0) return incoming;
  const time = (stock: Stock) => (stock.updatedAt ? Date.parse(stock.updatedAt) : Number.NEGATIVE_INFINITY);
  return time(incoming) > time(current) ? incoming : current;
}

// ───────────────────────── Mức tồn kho ─────────────────────────

/** Chưa có số liệu / hết hàng (≤ 0) / sắp hết (từ 1 đến ngưỡng cảnh báo) / còn hàng (trên ngưỡng). */
export type StockLevel = "unknown" | "out" | "low" | "in";

/** Mức tồn kho của một mã. `lowThreshold` = ngưỡng cảnh báo sắp hết (0 = không cảnh báo sắp hết). */
export function stockLevel(qty: number | null, lowThreshold: number): StockLevel {
  if (qty == null) return "unknown";
  if (qty <= 0) return "out";
  return qty <= lowThreshold ? "low" : "in";
}

// ───────────────────────── Danh sách sản phẩm theo danh mục ─────────────────────────

/**
 * Lọc theo tồn kho: tất cả / còn hàng (> 0, gồm cả mã sắp hết) / sắp hết / hết hàng / chưa có số liệu /
 * cần chú ý (sắp hết + hết hàng).
 */
export type StockFilter = "all" | "in" | "low" | "out" | "unknown" | "attention";

/** Tên của từng mã hàng có trong danh mục của các chương trình (lấy tên ở nơi mã xuất hiện đầu tiên). */
export function productNames(programs: Program[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const program of programs) {
    for (const group of program.groups) {
      for (const item of group.items) {
        const sku = normalizeSku(item.sku);
        if (!names.has(sku)) names.set(sku, item.name);
      }
    }
  }
  return names;
}

/** Số mã có số liệu tồn kho nhưng không nằm trong danh mục nào (nên không hiện ở màn hình «Sản phẩm»). */
export function unlistedStockCount(programs: Program[], stock: Stock): number {
  const listed = productNames(programs);
  return Object.keys(stock.bySku).filter((sku) => !listed.has(sku)).length;
}

export interface OrderStockIssue {
  sku: string;
  name: string;
  /** Tổng số lượng của mã này trong đơn: hàng mua cộng quà tặng. */
  ordered: number;
  stock: number;
  /** out = kho đã hết; over = đặt nhiều hơn số đang tồn. */
  level: "out" | "over";
}

/**
 * Các mã trong đơn mà kho không đủ: đã hết hàng, hoặc số lượng trong đơn (hàng mua + quà, kể cả quà tự tặng) nhiều hơn
 * số tồn. Mã chưa có số liệu tồn kho thì không báo. Thứ tự theo lần xuất hiện đầu tiên trong đơn.
 */
export function orderStockIssues(calc: Pick<CalcResult, "lines" | "gifts">, stock: Stock): OrderStockIssue[] {
  const demand = new Map<string, { name: string; ordered: number }>();
  for (const row of [...calc.lines, ...calc.gifts]) {
    const sku = normalizeSku(row.sku);
    if (!sku || row.qty <= 0) continue;
    const entry = demand.get(sku);
    if (entry) entry.ordered += row.qty;
    else demand.set(sku, { name: row.name, ordered: row.qty });
  }
  const issues: OrderStockIssue[] = [];
  for (const [sku, { name, ordered }] of demand) {
    const qty = stockOf(stock, sku);
    if (qty == null || ordered <= qty) continue;
    issues.push({ sku, name, ordered, stock: qty, level: qty <= 0 ? "out" : "over" });
  }
  return issues;
}
