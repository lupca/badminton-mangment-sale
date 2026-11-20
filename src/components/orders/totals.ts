// Cộng dồn kết quả tính của nhiều đơn hàng: tổng chung, theo mã hàng bán, theo mã quà và theo đại lý.
import { normalizeSku } from "../../lib/format";
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

export interface OrdersSummary extends OrderTotals {
  items: SkuTotal[]; // nhiều số lượng nhất đứng trước
  gifts: SkuTotal[]; // nhiều số lượng nhất đứng trước
  dealers: DealerTotal[]; // thanh toán nhiều nhất đứng trước
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

export function summarizeOrders(entries: OrderCalc[]): OrdersSummary {
  const items = new Map<string, SkuTotal>();
  const gifts = new Map<string, SkuTotal>();
  const dealers = new Map<string, DealerTotal>();

  for (const { order, calc } of entries) {
    for (const line of calc.lines) addSku(items, line.sku, line.name, line.qty, line.amount);
    for (const gift of calc.gifts) addSku(gifts, gift.sku, gift.name, gift.qty, gift.value);

    // Cùng một đại lý dù gõ khác chữ hoa/thường hay thừa khoảng trắng.
    const name = order.customerName.trim().replace(/\s+/g, " ");
    const key = name.toLocaleLowerCase("vi");
    const dealer = dealers.get(key) ?? { name, orderCount: 0, totalAmount: 0, giftValue: 0 };
    dealer.orderCount += 1;
    dealer.totalAmount += calc.totalAmount;
    dealer.giftValue += calc.giftValue;
    dealers.set(key, dealer);
  }

  return {
    ...sumOrders(entries),
    items: [...items.values()].sort(byQtyDesc),
    gifts: [...gifts.values()].sort(byQtyDesc),
    dealers: [...dealers.values()].sort(
      (a, b) => b.totalAmount - a.totalAmount || a.name.localeCompare(b.name, "vi"),
    ),
  };
}
