// Tồn kho và danh sách sản phẩm gộp từ mọi chương trình (cho màn hình «Sản phẩm»). Các hàm đều thuần.
import type { ProductGroup, ProductItem, Program, Stock } from "../types";
import { matchesSearch, normalizeSku } from "./format";

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

// ───────────────────────── Danh sách sản phẩm theo danh mục ─────────────────────────

/** Lọc theo tồn kho: tất cả / còn hàng (> 0) / hết hàng (≤ 0) / chưa có số liệu. */
export type StockFilter = "all" | "in" | "out" | "unknown";

export interface ProductFilter {
  /** "" = mọi chương trình. */
  programId: string;
  /** Tìm theo mã hoặc tên hàng. */
  search: string;
  stock: StockFilter;
}

export interface ProductRow {
  item: ProductItem;
  /** null = chưa có số liệu tồn kho của mã này. */
  stock: number | null;
}

export interface ProductGroupRows {
  group: ProductGroup;
  rows: ProductRow[];
}

export interface ProgramProducts {
  program: Program;
  groups: ProductGroupRows[];
}

function stockStatus(stock: number | null): Exclude<StockFilter, "all"> {
  if (stock == null) return "unknown";
  return stock > 0 ? "in" : "out";
}

/**
 * Sản phẩm của các chương trình, xếp theo chương trình → danh mục, kèm tồn kho của từng mã.
 * Danh mục và chương trình không còn dòng nào sau khi lọc thì bỏ.
 */
export function listProducts(programs: Program[], stock: Stock, filter: ProductFilter): ProgramProducts[] {
  const result: ProgramProducts[] = [];
  for (const program of programs) {
    if (filter.programId && program.id !== filter.programId) continue;
    const groups: ProductGroupRows[] = [];
    for (const group of program.groups) {
      const rows: ProductRow[] = [];
      for (const item of group.items) {
        const qty = stockOf(stock, item.sku);
        if (filter.stock !== "all" && stockStatus(qty) !== filter.stock) continue;
        if (!matchesSearch(`${item.sku} ${item.name}`, filter.search)) continue;
        rows.push({ item, stock: qty });
      }
      if (rows.length > 0) groups.push({ group, rows });
    }
    if (groups.length > 0) result.push({ program, groups });
  }
  return result;
}

export interface ProductSummary {
  /** Số mã hàng khác nhau: một mã nằm ở nhiều danh mục chỉ đếm một lần. */
  skus: number;
  inStock: number;
  outOfStock: number;
  unknown: number;
}

export function summarizeProducts(list: ProgramProducts[]): ProductSummary {
  const seen = new Map<string, number | null>();
  for (const { groups } of list) {
    for (const { rows } of groups) {
      for (const row of rows) seen.set(normalizeSku(row.item.sku), row.stock);
    }
  }
  const summary: ProductSummary = { skus: seen.size, inStock: 0, outOfStock: 0, unknown: 0 };
  for (const qty of seen.values()) {
    const status = stockStatus(qty);
    if (status === "in") summary.inStock++;
    else if (status === "out") summary.outOfStock++;
    else summary.unknown++;
  }
  return summary;
}

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
