// Các phép sửa thuần trên một chương trình, dùng trong màn hình sửa chương trình.
import type { ID, ProductGroup, ProductItem, Program, Rule } from "../../types";
import { normalizeSku } from "../../lib/format";

/** Sửa chương trình đang mở bằng một hàm thuần. Thay đổi được lưu tự động. */
export type UpdateProgram = (fn: (program: Program) => Program) => void;

export function updateGroup(program: Program, groupId: ID, fn: (group: ProductGroup) => ProductGroup): Program {
  return { ...program, groups: program.groups.map((group) => (group.id === groupId ? fn(group) : group)) };
}

export function replaceRule(program: Program, rule: Rule): Program {
  return { ...program, rules: program.rules.map((r) => (r.id === rule.id ? rule : r)) };
}

/** Thay sản phẩm đang có mã `sku` trong danh mục bằng `next` (mã mới có thể khác mã cũ). */
export function replaceItem(program: Program, groupId: ID, sku: string, next: ProductItem): Program {
  const replaced = updateGroup(program, groupId, (group) => ({
    ...group,
    items: group.items.map((item) => (item.sku === sku ? next : item)),
  }));
  return sku === next.sku ? replaced : renameAllowedSku(replaced, groupId, sku, next.sku);
}

/** Đổi mã `from` thành `to` trong «mã quà được chọn» của các quy tắc đang lấy quà từ danh mục `groupId`. */
function renameAllowedSku(program: Program, groupId: ID, from: string, to: string): Program {
  const rules = program.rules.map((rule): Rule => {
    if (rule.type !== "tier_gift" || rule.giftGroupId !== groupId) return rule;
    return {
      ...rule,
      tiers: rule.tiers.map((tier) =>
        tier.allowedSkus ? { ...tier, allowedSkus: tier.allowedSkus.map((sku) => (sku === from ? to : sku)) } : tier,
      ),
    };
  });
  return { ...program, rules };
}

/**
 * Giữ cho «mã quà được chọn» của từng mức luôn nằm trong danh mục quà hiện tại. Chạy sau mọi lần sửa, nên xóa mã
 * hàng, nhập lại danh mục hay đổi danh mục quà đều không để lại mã thừa. Mức không còn mã nào thì trở về «tất cả».
 */
export function pruneAllowedSkus(program: Program): Program {
  let changed = false;
  const rules = program.rules.map((rule): Rule => {
    if (rule.type !== "tier_gift" || rule.tiers.every((tier) => !tier.allowedSkus)) return rule;
    const giftGroup = program.groups.find((group) => group.id === rule.giftGroupId);
    const giftSkus = new Set(giftGroup?.items.map((item) => normalizeSku(item.sku)));
    const tiers = rule.tiers.map((tier) => {
      if (!tier.allowedSkus) return tier;
      const kept = tier.allowedSkus.filter((sku) => giftSkus.has(normalizeSku(sku)));
      if (kept.length > 0 && kept.length === tier.allowedSkus.length) return tier;
      changed = true;
      return { ...tier, allowedSkus: kept.length > 0 ? kept : null };
    });
    return { ...rule, tiers };
  });
  return changed ? { ...program, rules } : program;
}
