// Các thao tác thuần trên chương trình / quy tắc — dùng chung cho mọi màn hình.
import type {
  GiftTier,
  ID,
  ProductGroup,
  ProductItem,
  Program,
  Rule,
  RuleType,
} from "../types";
import { formatPercent, formatVND, newId, normalizeSku } from "./format";
import { sortTiers } from "./engine";

export const RULE_TYPE_LABEL: Record<RuleType, string> = {
  tier_gift: "Đạt doanh số → tặng hàng",
  discount: "Giảm giá theo số lượng",
  buy_x_get_y: "Mua X tặng Y",
};

export const RULE_TYPE_HINT: Record<RuleType, string> = {
  tier_gift: "Đơn đạt mức doanh số thì được chọn quà, tổng giá trị quà không vượt hạn mức của mức đó.",
  discount: "Giảm % cho một danh mục khi mua đủ số lượng (và mua kèm danh mục khác nếu cần).",
  buy_x_get_y: "Cứ mua X sản phẩm thì tặng Y: tặng cùng loại, chọn trong danh mục quà, hoặc một món quà ghi bằng chữ.",
};

export const PRICE_BASIS_LABEL = { retail: "giá lẻ", wholesale: "giá sỉ" } as const;

export function newGroup(name: string): ProductGroup {
  return { id: newId("g"), name, items: [] };
}

export function newTier(min = 0, limitValue = 0): GiftTier {
  return { id: newId("t"), min, limitType: "amount", limitValue, maxQty: null, allowedSkus: null };
}

/** Quy tắc mới với giá trị mặc định hợp lý (chọn sẵn danh mục đầu tiên nếu có). */
export function newRule(type: RuleType, program?: Pick<Program, "groups">): Rule {
  const first = program?.groups[0]?.id;
  const second = program?.groups[1]?.id;
  const id = newId("r");
  if (type === "tier_gift") {
    return {
      id,
      type,
      name: "Mua hàng tặng hàng theo doanh số",
      sourceGroupIds: first ? [first] : [],
      giftGroupId: second ?? first ?? null,
      giftPriceBasis: "wholesale",
      tiers: [newTier(10_000_000, 1_000_000)],
    };
  }
  if (type === "discount") {
    return {
      id,
      type,
      name: "Giảm giá",
      targetGroupIds: first ? [first] : [],
      discountPercent: 10,
      discountBasis: "wholesale",
      minQty: null,
      maxQty: null,
      requireGroupIds: [],
      requireMinQty: 1,
    };
  }
  return {
    id,
    type,
    name: "Mua 1 tặng 1",
    sourceGroupIds: first ? [first] : [],
    buyQty: 1,
    getQty: 1,
    giftMode: "same",
    giftGroupId: null,
    giftText: "",
  };
}

/** Thêm/cập nhật theo mã hàng: mã đã có thì ghi đè tên và giá, mã mới thì thêm vào cuối. */
export function mergeItems(existing: ProductItem[], incoming: ProductItem[]): ProductItem[] {
  const result = existing.map((item) => ({ ...item }));
  const indexBySku = new Map(result.map((item, i) => [normalizeSku(item.sku), i]));
  for (const item of incoming) {
    const key = normalizeSku(item.sku);
    if (!key) continue;
    const at = indexBySku.get(key);
    if (at == null) {
      indexBySku.set(key, result.length);
      result.push({ ...item, sku: key });
    } else {
      result[at] = { ...result[at], ...item, sku: key };
    }
  }
  return result;
}

/** Các danh mục mà quy tắc đang tham chiếu. */
export function ruleGroupIds(rule: Rule): ID[] {
  if (rule.type === "tier_gift") return [...rule.sourceGroupIds, ...(rule.giftGroupId ? [rule.giftGroupId] : [])];
  if (rule.type === "discount") return [...rule.targetGroupIds, ...rule.requireGroupIds];
  return [...rule.sourceGroupIds, ...(rule.giftGroupId ? [rule.giftGroupId] : [])];
}

/** Xóa một danh mục và gỡ mọi tham chiếu tới nó trong các quy tắc. */
export function removeGroup(program: Program, groupId: ID): Program {
  const without = (ids: ID[]) => ids.filter((id) => id !== groupId);
  const rules = program.rules.map((rule): Rule => {
    if (rule.type === "tier_gift") {
      return {
        ...rule,
        sourceGroupIds: without(rule.sourceGroupIds),
        giftGroupId: rule.giftGroupId === groupId ? null : rule.giftGroupId,
      };
    }
    if (rule.type === "discount") {
      return { ...rule, targetGroupIds: without(rule.targetGroupIds), requireGroupIds: without(rule.requireGroupIds) };
    }
    return {
      ...rule,
      sourceGroupIds: without(rule.sourceGroupIds),
      giftGroupId: rule.giftGroupId === groupId ? null : rule.giftGroupId,
    };
  });
  return { ...program, groups: program.groups.filter((g) => g.id !== groupId), rules };
}

export function findItem(program: Pick<Program, "groups">, groupId: ID, sku: string): ProductItem | undefined {
  const key = normalizeSku(sku);
  return program.groups.find((g) => g.id === groupId)?.items.find((item) => normalizeSku(item.sku) === key);
}

export function programItemCount(program: Pick<Program, "groups">): number {
  return program.groups.reduce((sum, g) => sum + g.items.length, 0);
}

function groupNames(ids: ID[], groups: ProductGroup[]): string {
  if (ids.length === 0) return "(chưa chọn danh mục)";
  return ids.map((id) => `«${groups.find((g) => g.id === id)?.name ?? "danh mục đã xóa"}»`).join(", ");
}

/** Mô tả một mức quà: "Từ 10.000.000 đ đến dưới 20.000.000 đ: tặng tối đa 1.200.000 đ (tối đa 1 sản phẩm, chọn trong 6 mã)". */
export function describeTier(tier: GiftTier, nextTier: GiftTier | null): string {
  const range = nextTier
    ? `Từ ${formatVND(tier.min)} đến dưới ${formatVND(nextTier.min)}`
    : `Từ ${formatVND(tier.min)} trở lên`;
  const limit =
    tier.limitType === "percent"
      ? `tặng tối đa ${formatPercent(tier.limitValue)} doanh số`
      : `tặng tối đa ${formatVND(tier.limitValue)}`;
  const extras: string[] = [];
  if (tier.maxQty != null) extras.push(`tối đa ${tier.maxQty} sản phẩm`);
  if (tier.allowedSkus) extras.push(`chọn trong ${tier.allowedSkus.length} mã`);
  return `${range}: ${limit}${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

/** Mô tả quy tắc bằng tiếng Việt, mỗi phần tử là một dòng. Dùng ở trang chương trình, trang đơn và bản in. */
export function describeRule(rule: Rule, groups: ProductGroup[]): string[] {
  if (rule.type === "tier_gift") {
    const tiers = sortTiers(rule.tiers);
    return [
      `Doanh số tính từ ${groupNames(rule.sourceGroupIds, groups)}. Quà chọn trong ${groupNames(
        rule.giftGroupId ? [rule.giftGroupId] : [],
        groups,
      )}, giá trị quà tính theo ${PRICE_BASIS_LABEL[rule.giftPriceBasis]}.`,
      ...tiers.map((tier, i) => describeTier(tier, tiers[i + 1] ?? null)),
    ];
  }
  if (rule.type === "discount") {
    const target = groupNames(rule.targetGroupIds, groups);
    const conditions: string[] = [];
    if (rule.minQty != null && rule.maxQty != null) conditions.push(`mua từ ${rule.minQty} đến ${rule.maxQty} sản phẩm ${target}`);
    else if (rule.minQty != null) conditions.push(`mua từ ${rule.minQty} sản phẩm ${target} trở lên`);
    else if (rule.maxQty != null) conditions.push(`mua tối đa ${rule.maxQty} sản phẩm ${target}`);
    if (rule.requireGroupIds.length > 0 && rule.requireMinQty > 0) {
      conditions.push(`mua kèm ít nhất ${rule.requireMinQty} sản phẩm ${groupNames(rule.requireGroupIds, groups)}`);
    }
    return [
      `Giảm ${formatPercent(rule.discountPercent)} trên ${PRICE_BASIS_LABEL[rule.discountBasis]} cho ${target}${
        conditions.length ? ` khi ${conditions.join(" và ")}` : ""
      }.`,
    ];
  }
  const source = groupNames(rule.sourceGroupIds, groups);
  if (rule.giftMode === "same") {
    return [`Mua ${rule.buyQty} tặng ${rule.getQty} cùng loại (tính theo từng mã), áp dụng cho ${source}.`];
  }
  if (rule.giftMode === "text") {
    const value = rule.giftTextValue ? ` (trị giá ${formatVND(rule.giftTextValue)} mỗi món)` : "";
    return [`Cứ mua ${rule.buyQty} sản phẩm ${source} được tặng ${rule.getQty} «${rule.giftText || "quà tặng"}»${value}.`];
  }
  return [
    `Cứ mua ${rule.buyQty} sản phẩm ${source} được chọn ${rule.getQty} quà trong ${groupNames(
      rule.giftGroupId ? [rule.giftGroupId] : [],
      groups,
    )}.`,
  ];
}

/** Các lỗi cấu hình của quy tắc (rỗng = hợp lệ). Hiển thị trong trình sửa quy tắc. */
export function validateRule(rule: Rule, groups: ProductGroup[]): string[] {
  const problems: string[] = [];
  const exists = (id: ID | null) => !!id && groups.some((g) => g.id === id);
  if (!rule.name.trim()) problems.push("Chưa đặt tên quy tắc.");
  if (rule.type === "tier_gift") {
    if (rule.sourceGroupIds.filter(exists).length === 0) problems.push("Chưa chọn danh mục tính doanh số.");
    if (!exists(rule.giftGroupId)) problems.push("Chưa chọn danh mục quà.");
    if (rule.tiers.length === 0) problems.push("Chưa có mức doanh số nào.");
    const mins = rule.tiers.map((t) => t.min);
    if (new Set(mins).size !== mins.length) problems.push("Có hai mức trùng doanh số bắt đầu.");
    if (rule.tiers.some((t) => !(t.limitValue > 0))) problems.push("Có mức chưa nhập hạn mức quà.");
    if (rule.tiers.some((t) => t.limitType === "percent" && t.limitValue > 100)) problems.push("Hạn mức % không được quá 100.");
  } else if (rule.type === "discount") {
    if (rule.targetGroupIds.filter(exists).length === 0) problems.push("Chưa chọn danh mục được giảm giá.");
    if (!(rule.discountPercent > 0) || rule.discountPercent > 100) problems.push("% giảm phải lớn hơn 0 và không quá 100.");
    if (rule.minQty != null && rule.maxQty != null && rule.minQty > rule.maxQty) {
      problems.push("Số lượng tối thiểu đang lớn hơn số lượng tối đa.");
    }
  } else {
    if (rule.sourceGroupIds.filter(exists).length === 0) problems.push("Chưa chọn danh mục áp dụng.");
    if (!(rule.buyQty > 0) || !(rule.getQty > 0)) problems.push("Số lượng mua và số lượng tặng phải lớn hơn 0.");
    if (rule.giftMode === "group" && !exists(rule.giftGroupId)) problems.push("Chưa chọn danh mục quà.");
    if (rule.giftMode === "text" && !rule.giftText.trim()) problems.push("Chưa nhập tên món quà.");
  }
  return problems;
}
