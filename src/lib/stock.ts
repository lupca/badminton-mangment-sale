// Tồn kho và danh sách sản phẩm gộp từ mọi chương trình (cho màn hình «Sản phẩm»). Các hàm đều thuần.
import type { CalcResult, ProductGroup, ProductItem, Program, Stock } from "../types";
import { matchesSearch, normalizeSku, programStatus, todayISO } from "./format";

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

export interface ProductFilter {
  /** "" = mọi chương trình. */
  programId: string;
  /** Tìm theo mã hoặc tên hàng. */
  search: string;
  stock: StockFilter;
  /** Ngưỡng cảnh báo sắp hết hàng (settings.lowStockThreshold). */
  lowThreshold: number;
}

export interface ProductRow {
  item: ProductItem;
  /** null = chưa có số liệu tồn kho của mã này. */
  stock: number | null;
  level: StockLevel;
}

export interface ProductGroupRows {
  group: ProductGroup;
  rows: ProductRow[];
}

export interface ProgramProducts {
  program: Program;
  groups: ProductGroupRows[];
}

function matchesStockFilter(level: StockLevel, filter: StockFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "in":
      return level === "in" || level === "low";
    case "attention":
      return level === "low" || level === "out";
    default:
      return level === filter;
  }
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
        const level = stockLevel(qty, filter.lowThreshold);
        if (!matchesStockFilter(level, filter.stock)) continue;
        if (!matchesSearch(`${item.sku} ${item.name}`, filter.search)) continue;
        rows.push({ item, stock: qty, level });
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
  /** Số mã còn hàng (> 0), gồm cả các mã sắp hết. */
  inStock: number;
  /** Trong số mã còn hàng, số mã sắp hết. */
  low: number;
  outOfStock: number;
  unknown: number;
}

export function summarizeProducts(list: ProgramProducts[]): ProductSummary {
  const seen = new Map<string, StockLevel>();
  for (const { groups } of list) {
    for (const { rows } of groups) {
      for (const row of rows) seen.set(normalizeSku(row.item.sku), row.level);
    }
  }
  const summary: ProductSummary = { skus: seen.size, inStock: 0, low: 0, outOfStock: 0, unknown: 0 };
  for (const level of seen.values()) {
    if (level === "unknown") summary.unknown++;
    else if (level === "out") summary.outOfStock++;
    else summary.inStock++;
    if (level === "low") summary.low++;
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

// ───────────────────────── Cảnh báo tồn kho ─────────────────────────

export interface StockAlert {
  sku: string;
  name: string;
  stock: number;
  level: "out" | "low";
  /** Chương trình và danh mục nơi mã này xuất hiện đầu tiên. */
  programId: string;
  programName: string;
  groupName: string;
}

/**
 * Các mã sale cần chú ý: hết hàng hoặc sắp hết, thuộc các chương trình chưa kết thúc (hàng của chương trình đã kết thúc
 * không còn bán nên không báo). Mỗi mã một dòng; hết hàng đứng trước, rồi tới tồn ít nhất.
 */
export function stockAlerts(programs: Program[], stock: Stock, lowThreshold: number, today: string = todayISO()): StockAlert[] {
  const alerts = new Map<string, StockAlert>();
  for (const program of programs) {
    if (programStatus(program, today) === "ended") continue;
    for (const group of program.groups) {
      for (const item of group.items) {
        const sku = normalizeSku(item.sku);
        if (alerts.has(sku)) continue;
        const qty = stockOf(stock, sku);
        const level = stockLevel(qty, lowThreshold);
        if (qty == null || (level !== "out" && level !== "low")) continue;
        alerts.set(sku, {
          sku,
          name: item.name,
          stock: qty,
          level,
          programId: program.id,
          programName: program.name,
          groupName: group.name,
        });
      }
    }
  }
  return [...alerts.values()].sort((a, b) => a.stock - b.stock);
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
