// Các thao tác thuần trên đơn hàng cho màn hình tính đơn — không phụ thuộc giao diện.
import type {
  BuyXGetYRule,
  CalcLine,
  ID,
  Order,
  OrderGift,
  OrderLine,
  ProductGroup,
  ProductItem,
  Program,
  Rule,
  Settings,
  TierGiftRule,
} from "../../types";
import { giftUnitValue } from "../../lib/engine";
import { normalizeSku } from "../../lib/format";

/** Phần của một mặt hàng được chép vào dòng hàng / quà. */
export type PricedItem = Pick<ProductItem, "sku" | "name" | "retailPrice" | "wholesalePrice">;

/** Khóa của một mã hàng trong một danh mục. Mã đã chuẩn hóa không chứa khoảng trắng nên hai khóa khác nhau không thể trùng. */
export function lineKey(groupId: ID, sku: string): string {
  return `${normalizeSku(sku)} ${groupId}`;
}

/** Chữ để tìm một mặt hàng: mã (kèm dạng bỏ gạch nối, vd AYPR2853) và tên. */
export function itemSearchText(item: Pick<ProductItem, "sku" | "name">): string {
  return `${item.sku} ${item.sku.replace(/-/g, "")} ${item.name}`;
}

export interface CatalogEntry {
  item: ProductItem;
  /** Thứ tự của mã trong chương trình (theo danh mục rồi theo dòng). */
  rank: number;
}

/** Mọi mặt hàng hiện có của chương trình, tra theo `lineKey`. */
export type Catalog = ReadonlyMap<string, CatalogEntry>;

export function buildCatalog(program: Program | null): Catalog {
  const catalog = new Map<string, CatalogEntry>();
  for (const group of program?.groups ?? []) {
    for (const item of group.items) {
      const key = lineKey(group.id, item.sku);
      if (!catalog.has(key)) catalog.set(key, { item, rank: catalog.size });
    }
  }
  return catalog;
}

/**
 * Danh mục được chọn mua: mọi danh mục trừ danh mục chỉ dùng làm quà
 * (có quy tắc lấy quà từ đó và không quy tắc nào tính doanh số / giảm giá / yêu cầu mua kèm trên đó).
 */
export function purchasableGroups(program: Program | null, rules: Rule[]): ProductGroup[] {
  if (!program) return [];
  const giftIds = new Set<ID>();
  const buyIds = new Set<ID>();
  for (const rule of rules) {
    if (rule.type === "discount") {
      for (const id of rule.targetGroupIds) buyIds.add(id);
      for (const id of rule.requireGroupIds) buyIds.add(id);
      continue;
    }
    for (const id of rule.sourceGroupIds) buyIds.add(id);
    const takesGiftsFromGroup = rule.type === "tier_gift" || rule.giftMode === "group";
    if (takesGiftsFromGroup && rule.giftGroupId) giftIds.add(rule.giftGroupId);
  }
  return program.groups.filter((group) => !giftIds.has(group.id) || buyIds.has(group.id));
}

/** Đặt số lượng một dòng hàng: thêm dòng mới (chép tên và giá từ danh mục), đổi số lượng, hoặc bỏ dòng khi về 0. */
export function setLineQty(order: Order, groupId: ID, item: PricedItem, qty: number): Order {
  const key = lineKey(groupId, item.sku);
  const lines: OrderLine[] = [];
  let placed = false;
  for (const line of order.lines) {
    if (lineKey(line.groupId, line.sku) !== key) {
      lines.push(line);
      continue;
    }
    // Dữ liệu cũ có thể trùng (danh mục, mã): chỉ giữ lại một dòng.
    if (!placed && qty > 0) lines.push({ ...line, qty });
    placed = true;
  }
  if (!placed && qty > 0) {
    lines.push({
      groupId,
      sku: item.sku,
      name: item.name,
      retailPrice: item.retailPrice,
      wholesalePrice: item.wholesalePrice,
      qty,
    });
  }
  return { ...order, lines };
}

/** Đặt số lượng một quà sale chọn. Quà duy nhất theo (quy tắc, mã hàng); về 0 thì bỏ. */
export function setGiftQty(order: Order, ruleId: ID, groupId: ID, item: PricedItem, qty: number): Order {
  const sku = normalizeSku(item.sku);
  const fresh: OrderGift = {
    ruleId,
    groupId,
    sku: item.sku,
    name: item.name,
    retailPrice: item.retailPrice,
    wholesalePrice: item.wholesalePrice,
    qty,
  };
  const gifts: OrderGift[] = [];
  let placed = false;
  for (const gift of order.gifts) {
    if (gift.ruleId !== ruleId || normalizeSku(gift.sku) !== sku) {
      gifts.push(gift);
      continue;
    }
    // Quà cùng mã nhưng thuộc danh mục khác (quy tắc đã đổi danh mục quà) được thay bằng bản chép mới.
    if (!placed && qty > 0) gifts.push(gift.groupId === groupId ? { ...gift, qty } : fresh);
    placed = true;
  }
  if (!placed && qty > 0) gifts.push(fresh);
  return { ...order, gifts };
}

/** Thông tin sale của máy (phần của thiết lập được tự ghi vào mỗi đơn mới). */
export type SaleProfile = Pick<Settings, "salesperson" | "salespersonPhone">;

/**
 * Thông tin sale trên đơn nên được mời lưu lại cho các đơn sau; null = không mời.
 * Chỉ mời khi máy này chưa lưu tên sale, đơn còn là nháp và sale đã gõ tên vào đơn. Tên và số điện thoại được bỏ
 * khoảng trắng thừa ở hai đầu.
 */
export function saleProfileToOffer(
  settings: Pick<Settings, "salesperson">,
  order: Pick<Order, "status" | "salesperson" | "salespersonPhone">,
): SaleProfile | null {
  const salesperson = order.salesperson.trim();
  if (order.status !== "draft" || settings.salesperson.trim() !== "" || salesperson === "") return null;
  return { salesperson, salespersonPhone: order.salespersonPhone.trim() };
}

export function removeGiftsAt(order: Order, indexes: number[]): Order {
  if (indexes.length === 0) return order;
  const drop = new Set(indexes);
  return { ...order, gifts: order.gifts.filter((_, index) => !drop.has(index)) };
}

export interface SkuQtyMatch {
  groupId: ID;
  item: ProductItem;
  qty: number;
}

/**
 * Tìm mã hàng dán vào trong các danh mục được chọn mua. Mã có ở nhiều danh mục thì ưu tiên danh mục
 * mà đơn đang có mã đó, nếu không thì lấy danh mục đầu tiên chứa nó — các mã như vậy được trả về trong
 * `ambiguous` (kèm tên danh mục đã chọn) để báo cho sale.
 */
export function matchSkuQty(
  lines: OrderLine[],
  groups: ProductGroup[],
  rows: Array<{ sku: string; qty: number }>,
): { matches: SkuQtyMatch[]; notFound: string[]; ambiguous: Array<{ sku: string; groupName: string }> } {
  const ordered = new Set(lines.filter((line) => line.qty > 0).map((line) => lineKey(line.groupId, line.sku)));
  const matches: SkuQtyMatch[] = [];
  const notFound: string[] = [];
  const ambiguous: Array<{ sku: string; groupName: string }> = [];
  for (const row of rows) {
    const sku = normalizeSku(row.sku);
    const found = groups.flatMap((group) => {
      const item = group.items.find((candidate) => normalizeSku(candidate.sku) === sku);
      return item ? [{ group, item }] : [];
    });
    const pick = found.find((candidate) => ordered.has(lineKey(candidate.group.id, sku))) ?? found[0];
    if (!pick) {
      notFound.push(row.sku);
      continue;
    }
    matches.push({ groupId: pick.group.id, item: pick.item, qty: row.qty });
    if (found.length > 1) ambiguous.push({ sku: pick.item.sku, groupName: pick.group.name });
  }
  return { matches, notFound, ambiguous };
}

/** Các dòng có số lượng mà mã hàng không còn nằm trong danh mục được chọn mua (`sellable`). */
export function orphanLines(lines: CalcLine[], catalog: Catalog, sellable: ProductGroup[]): CalcLine[] {
  const sellableIds = new Set(sellable.map((group) => group.id));
  return lines.filter(
    (line) => line.qty > 0 && !(sellableIds.has(line.groupId) && catalog.has(lineKey(line.groupId, line.sku))),
  );
}

/** Các dòng có số lượng, xếp theo thứ tự danh mục của chương trình (mã không còn trong danh mục xếp cuối). */
export function linesInCatalogOrder(lines: CalcLine[], catalog: Catalog): CalcLine[] {
  const rankOf = (line: CalcLine) => catalog.get(lineKey(line.groupId, line.sku))?.rank ?? Number.MAX_SAFE_INTEGER;
  return lines.filter((line) => line.qty > 0).sort((a, b) => rankOf(a) - rankOf(b) || a.index - b.index);
}

/** Mã của các dòng hàng / quà mà giá chép vào đơn lúc nhập đã khác giá hiện tại trong danh mục. */
export function stalePriceSkus(order: Order, catalog: Catalog): string[] {
  const stale = [...order.lines, ...order.gifts].filter((entry) => {
    const current = catalog.get(lineKey(entry.groupId, entry.sku))?.item;
    return (
      entry.qty > 0 &&
      current != null &&
      (current.retailPrice !== entry.retailPrice || current.wholesalePrice !== entry.wholesalePrice)
    );
  });
  return [...new Set(stale.map((entry) => entry.sku))];
}

/** Chép lại tên và giá hiện tại của danh mục vào các dòng hàng và quà của đơn. */
export function refreshPrices(order: Order, catalog: Catalog): Order {
  const refresh = <Entry extends OrderLine>(entry: Entry): Entry => {
    const current = catalog.get(lineKey(entry.groupId, entry.sku))?.item;
    if (!current) return entry;
    return { ...entry, name: current.name, retailPrice: current.retailPrice, wholesalePrice: current.wholesalePrice };
  };
  return { ...order, lines: order.lines.map(refresh), gifts: order.gifts.map(refresh) };
}

/** Một dòng trong bảng chọn quà. */
export interface GiftRow extends PricedItem {
  /** Danh mục ghi vào quà khi chọn. */
  groupId: ID;
  unitValue: number;
  qty: number;
  /** Đã chọn từ trước nhưng hiện không còn được chọn: ngoài danh sách của mức, danh mục quà đã đổi, hoặc chưa đủ điều kiện nhận quà. */
  invalid: boolean;
}

/**
 * Các dòng của bảng chọn quà cho một quy tắc: quà đã chọn mà không còn được chọn (xếp trước, để sale bỏ đi),
 * rồi tới các mã được chọn trong danh mục quà. `giftGroup` để trống khi đơn chưa đủ điều kiện nhận quà.
 */
export function buildGiftRows(
  rule: TierGiftRule | BuyXGetYRule,
  giftGroup: ProductGroup | undefined,
  allowedSkus: string[] | null,
  gifts: OrderGift[],
): GiftRow[] {
  const chosen = gifts.filter((gift) => gift.ruleId === rule.id && gift.qty > 0);
  const allowed = allowedSkus ? new Set(allowedSkus.map(normalizeSku)) : null;
  const matched = new Set<OrderGift>();
  const seen = new Set<string>();
  const options: GiftRow[] = [];
  if (giftGroup) {
    for (const item of giftGroup.items) {
      const sku = normalizeSku(item.sku);
      if (seen.has(sku) || (allowed && !allowed.has(sku))) continue;
      seen.add(sku);
      const gift = chosen.find((g) => g.groupId === giftGroup.id && normalizeSku(g.sku) === sku);
      if (gift) matched.add(gift);
      const priced = gift ?? item; // quà đã chọn giữ giá tại lúc chọn, đúng với số engine đang tính
      options.push({
        sku: item.sku,
        name: item.name,
        retailPrice: priced.retailPrice,
        wholesalePrice: priced.wholesalePrice,
        groupId: giftGroup.id,
        unitValue: giftUnitValue(rule, priced),
        qty: gift?.qty ?? 0,
        invalid: false,
      });
    }
  }
  const leftovers = chosen
    .filter((gift) => !matched.has(gift))
    .map(
      (gift): GiftRow => ({
        sku: gift.sku,
        name: gift.name,
        retailPrice: gift.retailPrice,
        wholesalePrice: gift.wholesalePrice,
        groupId: gift.groupId,
        unitValue: giftUnitValue(rule, gift),
        qty: gift.qty,
        invalid: true,
      }),
    );
  return [...leftovers, ...options];
}
