// Cộng dồn kết quả tính của nhiều đơn hàng: tổng chung, theo mã hàng bán, theo mã quà, theo đại lý và theo sale.
import { normalizeSku, searchKey } from "../../lib/format";
import type { CalcResult, Order } from "../../types";

/** Một đơn hàng kèm kết quả tính của nó. */
export interface OrderCalc {
  order: Order;
  calc: CalcResult;
}

export interface OrderTotals {
  orderCount: number;
  /** Số đơn đang có lỗi (vd quà vượt hạn mức) — số liệu của các đơn này vẫn được cộng. */
  errorCount: number;
  totalQty: number;
  totalAmount: number;
  giftQty: number;
  giftValue: number;
}

/** Một dòng tổng hợp theo mã (hàng bán hoặc quà tặng). */
export interface SkuTotal {
  sku: string; // rỗng nếu là quà ghi bằng chữ
  name: string;
  qty: number;
  value: number;
}

export interface DealerTotal {
  name: string; // rỗng = các đơn chưa ghi tên đại lý
  orderCount: number;
  totalAmount: number;
  giftValue: number;
}

export interface SalesTotal {
  name: string; // cách viết gặp nhiều nhất; rỗng = các đơn chưa ghi tên sale
  orderCount: number;
  totalQty: number;
  totalAmount: number;
  giftValue: number;
}

export interface OrdersSummary extends OrderTotals {
  items: SkuTotal[]; // nhiều số lượng nhất đứng trước
  gifts: SkuTotal[]; // nhiều số lượng nhất đứng trước
  dealers: DealerTotal[]; // thanh toán nhiều nhất đứng trước
  sales: SalesTotal[]; // thanh toán nhiều nhất đứng trước
}

export function sumOrders(entries: OrderCalc[]): OrderTotals {
  const totals: OrderTotals = {
    orderCount: entries.length,
    errorCount: 0,
    totalQty: 0,
    totalAmount: 0,
    giftQty: 0,
    giftValue: 0,
  };
  for (const { calc } of entries) {
    if (calc.hasError) totals.errorCount += 1;
    totals.totalQty += calc.totalQty;
    totals.totalAmount += calc.totalAmount;
    totals.giftQty += calc.giftQty;
    totals.giftValue += calc.giftValue;
  }
  return totals;
}

/** Tên người (đại lý, sale) đã bỏ khoảng trắng thừa. */
function cleanName(name: string): string {
  // NFC: cùng một tên gõ trên máy khác (macOS, một số file Excel lưu dấu tách rời) vẫn ra cùng một chuỗi.
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Khóa gộp tên sale: cùng một người dù gõ khác chữ hoa/thường, có dấu hay không dấu, thừa khoảng trắng.
 * Rỗng = đơn chưa ghi tên sale.
 */
export function salesKey(name: string): string {
  return searchKey(cleanName(name));
}

/** Một cách viết tên sale: có bao nhiêu đơn viết như vậy, đơn mới nhất trong số đó tạo lúc nào. */
interface Spelling {
  name: string;
  count: number;
  latest: string; // ISO
}

/** Cách viết gặp nhiều hơn đứng trước; bằng nhau thì cách viết ở đơn tạo gần đây hơn. */
function byMostUsed(a: Spelling, b: Spelling): number {
  return (
    b.count - a.count ||
    (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0) ||
    a.name.localeCompare(b.name, "vi")
  );
}

/**
 * Tên hiển thị của từng sale có trong các đơn: khóa gộp (`salesKey`) → cách viết gặp nhiều nhất.
 * Các đơn chưa ghi tên sale nằm ở khóa rỗng, tên rỗng.
 */
export function salesNames(orders: Order[]): Map<string, string> {
  const spellings = new Map<string, Map<string, Spelling>>(); // khóa gộp → các cách viết của tên đó
  for (const order of orders) {
    const name = cleanName(order.salesperson);
    const key = salesKey(name);
    const sameKey = spellings.get(key) ?? new Map<string, Spelling>();
    const spelling = sameKey.get(name) ?? { name, count: 0, latest: "" };
    spelling.count += 1;
    if (order.createdAt > spelling.latest) spelling.latest = order.createdAt;
    sameKey.set(name, spelling);
    spellings.set(key, sameKey);
  }

  const names = new Map<string, string>();
  for (const [key, sameKey] of spellings) names.set(key, [...sameKey.values()].sort(byMostUsed)[0].name);
  return names;
}

function addSku(totals: Map<string, SkuTotal>, sku: string, name: string, qty: number, value: number): void {
  if (qty <= 0) return;
  // Quà ghi bằng chữ không có mã → gộp theo tên.
  const key = sku ? normalizeSku(sku) : `text:${name}`;
  const row = totals.get(key);
  if (row) {
    row.qty += qty;
    row.value += value;
  } else {
    totals.set(key, { sku, name, qty, value });
  }
}

function byQtyDesc(a: SkuTotal, b: SkuTotal): number {
  return b.qty - a.qty || b.value - a.value || a.sku.localeCompare(b.sku) || a.name.localeCompare(b.name, "vi");
}

type NamedAmount = Pick<DealerTotal, "name" | "totalAmount">;

function byAmountDesc(a: NamedAmount, b: NamedAmount): number {
  return b.totalAmount - a.totalAmount || a.name.localeCompare(b.name, "vi");
}

/**
 * Cộng các đơn thành bảng tổng hợp. `salesName` là tên hiển thị của từng sale (xem `salesNames`): mặc định lấy từ
 * chính các đơn đang cộng; truyền bảng tên của toàn bộ đơn hàng để một sale luôn hiện cùng một cách viết, dù đang
 * cộng nhóm đơn nào.
 */
export function summarizeOrders(
  entries: OrderCalc[],
  salesName: ReadonlyMap<string, string> = salesNames(entries.map((entry) => entry.order)),
): OrdersSummary {
  const items = new Map<string, SkuTotal>();
  const gifts = new Map<string, SkuTotal>();
  const dealers = new Map<string, DealerTotal>();
  const sales = new Map<string, SalesTotal>();

  for (const { order, calc } of entries) {
    for (const line of calc.lines) addSku(items, line.sku, line.name, line.qty, line.amount);
    for (const gift of calc.gifts) addSku(gifts, gift.sku, gift.name, gift.qty, gift.value);

    // Cùng một đại lý dù gõ khác chữ hoa/thường hay thừa khoảng trắng.
    const name = cleanName(order.customerName);
    const key = name.toLocaleLowerCase("vi");
    const dealer = dealers.get(key) ?? { name, orderCount: 0, totalAmount: 0, giftValue: 0 };
    dealer.orderCount += 1;
    dealer.totalAmount += calc.totalAmount;
    dealer.giftValue += calc.giftValue;
    dealers.set(key, dealer);

    // Cùng một sale dù gõ khác chữ hoa/thường, không dấu hay thừa khoảng trắng.
    const saleKey = salesKey(order.salesperson);
    const sale = sales.get(saleKey) ?? {
      name: salesName.get(saleKey) ?? cleanName(order.salesperson),
      orderCount: 0,
      totalQty: 0,
      totalAmount: 0,
      giftValue: 0,
    };
    sale.orderCount += 1;
    sale.totalQty += calc.totalQty;
    sale.totalAmount += calc.totalAmount;
    sale.giftValue += calc.giftValue;
    sales.set(saleKey, sale);
  }

  return {
    ...sumOrders(entries),
    items: [...items.values()].sort(byQtyDesc),
    gifts: [...gifts.values()].sort(byQtyDesc),
    dealers: [...dealers.values()].sort(byAmountDesc),
    sales: [...sales.values()].sort(byAmountDesc),
  };
}
