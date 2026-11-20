// Engine tính đơn hàng theo quy tắc khuyến mãi. Hàm thuần, không phụ thuộc giao diện.
import type {
  BuyXGetYResult,
  BuyXGetYRule,
  CalcGift,
  CalcIssue,
  CalcLine,
  CalcResult,
  DiscountResult,
  DiscountRule,
  GiftTier,
  ID,
  Order,
  OrderGift,
  PriceBasis,
  Program,
  Rule,
  RuleResult,
  TierGiftResult,
  TierGiftRule,
} from "../types";
import { formatPercent, formatVND, normalizeSku } from "./format";

export type OrderInput = Pick<Order, "lines" | "gifts"> & { frozenRules?: Rule[] };

export function priceOf(item: { retailPrice: number; wholesalePrice: number }, basis: PriceBasis): number {
  return basis === "retail" ? item.retailPrice : item.wholesalePrice;
}

export function sortTiers(tiers: GiftTier[]): GiftTier[] {
  return [...tiers].sort((a, b) => a.min - b.min);
}

/**
 * n × percent / 100, đúng tới từng đồng. Nhân chia thẳng bằng số thực bị lệch 1 đ ở các trường hợp sát ranh giới
 * (vd 12.000.000 × 2,3 / 100 = 275.999,99… thay vì 276.000; 1.000.050 × (1 − 55/100) = 450.022,49… thay vì 450.022,5),
 * nên % được đổi về phần vạn (số nguyên) rồi mới nhân. Chỉ khi % có quá 2 chữ số lẻ mới phải tính bằng số thực.
 */
function percentOf(n: number, percent: number): number {
  const scaled = percent * 100;
  const hundredths = Math.round(scaled);
  if (Math.abs(scaled - hundredths) > 1e-7) return (n * percent) / 100;
  return (n * hundredths) / 10000;
}

/** Hạn mức quà (đ) của một mức với doanh số cho trước. Hạn mức không hợp lệ (NaN, âm) coi như 0 — không được tặng gì. */
export function tierBudget(tier: GiftTier, revenue: number): number {
  const budget = tier.limitType === "percent" ? Math.floor(percentOf(revenue, tier.limitValue)) : tier.limitValue;
  return Number.isFinite(budget) && budget > 0 ? budget : 0;
}

/** "tặng tối đa 3.190.000 đ" hoặc "tặng tối đa 15% doanh số". */
export function describeTierLimit(tier: GiftTier): string {
  return tier.limitType === "percent"
    ? `tặng tối đa ${formatPercent(tier.limitValue)} doanh số`
    : `tặng tối đa ${formatVND(tier.limitValue)}`;
}

/** Quy tắc này có cho sale tự chọn quà không. */
export function ruleAcceptsChosenGifts(rule: Rule): boolean {
  return rule.type === "tier_gift" || (rule.type === "buy_x_get_y" && rule.giftMode === "group");
}

/** Giá trị 1 đơn vị quà theo cách tính của quy tắc. */
export function giftUnitValue(rule: Rule, gift: { retailPrice: number; wholesalePrice: number }): number {
  return rule.type === "tier_gift" ? priceOf(gift, rule.giftPriceBasis) : gift.wholesalePrice;
}

function safeQty(qty: unknown): number {
  const n = Number(qty);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function safeMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Tính một đơn hàng. Quy tắc lấy từ `order.frozenRules` (đơn đã chốt) nếu có, ngược lại từ chương trình.
 * Thứ tự: (1) giảm giá từng dòng → (2) doanh số & mức quà → (3) mua X tặng Y → (4) tổng hợp.
 */
export function calculateOrder(program: Program | null | undefined, order: OrderInput): CalcResult {
  const rules: Rule[] = order.frozenRules ?? program?.rules ?? [];
  const groups = program?.groups ?? [];
  const issues: CalcIssue[] = [];
  const addIssue = (level: CalcIssue["level"], ruleId: ID | null, message: string) => {
    issues.push({ level, ruleId, message });
  };
  const namesOf = (ids: ID[]): string =>
    ids.map((id) => `«${groups.find((g) => g.id === id)?.name ?? "danh mục đã xóa"}»`).join(", ");

  // ── 1. Dòng hàng, mặc định tính theo giá sỉ ──
  const lines: CalcLine[] = order.lines.map((l, index) => ({
    index,
    groupId: l.groupId,
    sku: l.sku,
    name: l.name,
    qty: safeQty(l.qty),
    retailPrice: safeMoney(l.retailPrice),
    wholesalePrice: safeMoney(l.wholesalePrice),
    unitPrice: safeMoney(l.wholesalePrice),
    amount: 0,
    discountRuleId: null,
    discountPercent: null,
  }));
  const qtyIn = (ids: ID[]): number => lines.reduce((sum, l) => (ids.includes(l.groupId) ? sum + l.qty : sum), 0);

  if (!program) {
    addIssue("warning", null, "Chương trình của đơn này không còn tồn tại.");
  } else {
    // Dòng thuộc danh mục đã xóa mà quy tắc đang áp dụng vẫn tính tới (đơn đã chốt giữ bản chụp quy tắc) thì vẫn được
    // tính khuyến mãi như lúc chốt — chỉ cảnh báo những dòng thực sự không còn quy tắc nào tính.
    const countedByRules = new Set<ID>(
      rules.flatMap((rule) =>
        rule.type === "discount" ? [...rule.targetGroupIds, ...rule.requireGroupIds] : rule.sourceGroupIds,
      ),
    );
    const missing = lines.filter(
      (l) => l.qty > 0 && !groups.some((g) => g.id === l.groupId) && !countedByRules.has(l.groupId),
    );
    if (missing.length > 0) {
      addIssue(
        "warning",
        null,
        `Danh mục của ${missing.length} dòng hàng (${missing.map((l) => l.sku).join(", ")}) đã bị xóa khỏi chương trình — các dòng này không được tính khuyến mãi.`,
      );
    }
  }
  // Giá bán mặc định là giá sỉ: dòng không có giá sỉ đang được tính 0 đ, phải báo để sale không chốt nhầm.
  const unpriced = lines.filter((l) => l.qty > 0 && l.wholesalePrice === 0);
  if (unpriced.length > 0) {
    addIssue(
      "warning",
      null,
      `${unpriced.length} dòng hàng chưa có giá sỉ nên đang tính 0 đ: ${unpriced.map((l) => l.sku).join(", ")}.`,
    );
  }

  // ── 2. Giảm giá: mỗi dòng nhận mức giá thấp nhất trong các quy tắc đủ điều kiện ──
  const discountStates = new Map<ID, Omit<DiscountResult, "savedAmount" | "ok" | "type" | "ruleId" | "ruleName">>();
  for (const rule of rules) {
    if (rule.type !== "discount") continue;
    discountStates.set(rule.id, evaluateDiscount(rule, lines, qtyIn, namesOf, addIssue));
  }
  for (const line of lines) line.amount = line.unitPrice * line.qty;

  // ── 3. Kết quả từng quy tắc + quà ──
  const gifts: CalcGift[] = [];
  const usedGiftIndexes = new Set<number>();
  const ruleResults: RuleResult[] = [];

  for (const rule of rules) {
    if (rule.type === "discount") {
      const state = discountStates.get(rule.id)!;
      const savedAmount = lines.reduce(
        (sum, l) => (l.discountRuleId === rule.id ? sum + (l.wholesalePrice - l.unitPrice) * l.qty : sum),
        0,
      );
      // Đủ điều kiện nhưng không dòng nào thực sự được giảm (giá sau giảm không thấp hơn giá sỉ, hoặc quy tắc khác cho giá
      // thấp hơn): không được báo là "đã áp dụng".
      const applied = lines.some((l) => l.qty > 0 && l.discountRuleId === rule.id);
      const reason =
        state.eligible && !applied
          ? "Đủ điều kiện, nhưng không dòng nào được giảm thêm vì giá sau giảm không thấp hơn giá đang tính."
          : state.reason;
      ruleResults.push({ type: "discount", ruleId: rule.id, ruleName: rule.name, ...state, reason, savedAmount, ok: true });
    } else if (rule.type === "tier_gift") {
      ruleResults.push(evaluateTierGift(rule, lines, order.gifts, gifts, usedGiftIndexes, namesOf, addIssue));
    } else {
      ruleResults.push(evaluateBuyXGetY(rule, lines, order.gifts, gifts, usedGiftIndexes, qtyIn, addIssue));
    }
  }

  // ── 4. Quà không còn quy tắc tương ứng ──
  const orphanGiftIndexes: number[] = [];
  order.gifts.forEach((g, index) => {
    if (!usedGiftIndexes.has(index) && safeQty(g.qty) > 0) orphanGiftIndexes.push(index);
  });
  if (orphanGiftIndexes.length > 0) {
    addIssue(
      "error",
      null,
      `Có ${orphanGiftIndexes.length} quà tặng không còn hợp lệ (quy tắc đã bị xóa hoặc đổi kiểu) — hãy xóa các quà này.`,
    );
  }

  // ── 5. Tổng hợp ──
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const totalRetail = lines.reduce((s, l) => s + l.retailPrice * l.qty, 0);
  const totalWholesale = lines.reduce((s, l) => s + l.wholesalePrice * l.qty, 0);
  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  const order3: Record<CalcIssue["level"], number> = { error: 0, warning: 1, info: 2 };
  const sortedIssues = issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => order3[a.issue.level] - order3[b.issue.level] || a.i - b.i)
    .map((x) => x.issue);

  return {
    lines,
    totalQty,
    totalRetail,
    totalWholesale,
    discountAmount: totalWholesale - totalAmount,
    totalAmount,
    gifts,
    giftQty: gifts.reduce((s, g) => s + g.qty, 0),
    giftValue: gifts.reduce((s, g) => s + g.value, 0),
    rules: ruleResults,
    issues: sortedIssues,
    hasError: sortedIssues.some((i) => i.level === "error"),
    orphanGiftIndexes,
  };
}

type AddIssue = (level: CalcIssue["level"], ruleId: ID | null, message: string) => void;

function evaluateDiscount(
  rule: DiscountRule,
  lines: CalcLine[],
  qtyIn: (ids: ID[]) => number,
  namesOf: (ids: ID[]) => string,
  addIssue: AddIssue,
): { eligible: boolean; reason: string; targetQty: number; requireQty: number } {
  const targetQty = qtyIn(rule.targetGroupIds);
  const needRequire = rule.requireGroupIds.length > 0 && rule.requireMinQty > 0;
  const requireQty = needRequire ? qtyIn(rule.requireGroupIds) : 0;
  const percent = Number(rule.discountPercent);

  if (rule.targetGroupIds.length === 0 || !(percent > 0) || percent > 100) {
    addIssue("warning", rule.id, `${rule.name}: quy tắc chưa cấu hình đủ (thiếu danh mục được giảm hoặc % giảm không hợp lệ).`);
    return { eligible: false, reason: "Quy tắc chưa cấu hình đủ.", targetQty, requireQty };
  }
  const targetNames = namesOf(rule.targetGroupIds);
  if (targetQty === 0) {
    return { eligible: false, reason: `Chưa mua sản phẩm nào thuộc ${targetNames}.`, targetQty, requireQty };
  }

  const missing: string[] = [];
  if (rule.minQty != null && targetQty < rule.minQty) {
    missing.push(`cần mua ít nhất ${rule.minQty} sản phẩm ${targetNames} (đang có ${targetQty})`);
  }
  if (rule.maxQty != null && targetQty > rule.maxQty) {
    missing.push(`chỉ áp dụng khi mua tối đa ${rule.maxQty} sản phẩm ${targetNames} (đang có ${targetQty})`);
  }
  if (needRequire && requireQty < rule.requireMinQty) {
    missing.push(
      `cần mua kèm ít nhất ${rule.requireMinQty} sản phẩm ${namesOf(rule.requireGroupIds)} (đang có ${requireQty})`,
    );
  }
  if (missing.length > 0) {
    const reason = `Chưa đạt: ${missing.join("; ")}.`;
    addIssue("info", rule.id, `${rule.name} — ${reason}`);
    return { eligible: false, reason, targetQty, requireQty };
  }

  const basisLabel = rule.discountBasis === "retail" ? "giá lẻ" : "giá sỉ";
  const noBasisPrice: string[] = [];
  for (const line of lines) {
    if (!rule.targetGroupIds.includes(line.groupId)) continue;
    const base = rule.discountBasis === "retail" ? line.retailPrice : line.wholesalePrice;
    if (base <= 0) {
      // Không có giá gốc thì không tính được giá sau giảm — không được coi "giảm x% của 0 đ" là 0 đ (cho không hàng).
      if (line.qty > 0 && line.unitPrice > 0) noBasisPrice.push(line.sku);
      continue;
    }
    const discounted = Math.round(percentOf(base, 100 - percent));
    if (discounted < line.unitPrice) {
      line.unitPrice = discounted;
      line.discountRuleId = rule.id;
      line.discountPercent = percent;
    }
  }
  if (noBasisPrice.length > 0) {
    addIssue(
      "warning",
      rule.id,
      `${rule.name}: mã ${noBasisPrice.join(", ")} chưa có ${basisLabel} nên không tính được giá sau giảm — các dòng này vẫn tính theo giá sỉ.`,
    );
  }
  return { eligible: true, reason: `Đã áp dụng giảm ${formatPercent(percent)} trên ${basisLabel} cho ${targetNames}.`, targetQty, requireQty };
}

function evaluateTierGift(
  rule: TierGiftRule,
  lines: CalcLine[],
  orderGifts: OrderGift[],
  gifts: CalcGift[],
  usedGiftIndexes: Set<number>,
  namesOf: (ids: ID[]) => string,
  addIssue: AddIssue,
): TierGiftResult {
  const tiers = sortTiers(rule.tiers);
  const revenue = lines.reduce((sum, l) => (rule.sourceGroupIds.includes(l.groupId) ? sum + l.amount : sum), 0);

  let tierIndex = -1;
  if (revenue > 0) {
    tiers.forEach((t, i) => {
      if (revenue >= t.min) tierIndex = i;
    });
  }
  const tier = tierIndex >= 0 ? tiers[tierIndex] : null;
  const nextTier = tiers[tierIndex + 1] ?? null;
  const budget = tier ? tierBudget(tier, revenue) : 0;

  let used = 0;
  let giftQty = 0;
  const chosen: OrderGift[] = [];
  orderGifts.forEach((g, index) => {
    if (g.ruleId !== rule.id) return;
    usedGiftIndexes.add(index);
    const qty = safeQty(g.qty);
    if (qty === 0) return;
    const unitValue = safeMoney(priceOf(g, rule.giftPriceBasis));
    chosen.push(g);
    used += unitValue * qty;
    giftQty += qty;
    gifts.push({ ruleId: rule.id, sku: g.sku, name: g.name, qty, unitValue, value: unitValue * qty, auto: false });
  });

  let ok = true;
  const error = (message: string) => {
    ok = false;
    addIssue("error", rule.id, `${rule.name}: ${message}`);
  };

  if (rule.sourceGroupIds.length === 0 || !rule.giftGroupId || tiers.length === 0) {
    addIssue("warning", rule.id, `${rule.name}: quy tắc chưa cấu hình đủ (thiếu danh mục tính doanh số, danh mục quà hoặc các mức).`);
  }

  if (chosen.length > 0) {
    if (!tier) {
      error(
        tiers.length > 0
          ? `chưa đạt mức doanh số tối thiểu ${formatVND(tiers[0].min)} nên chưa được chọn quà.`
          : "quy tắc chưa có mức doanh số nào nên chưa được chọn quà.",
      );
    } else {
      if (used > budget) {
        error(`quà đã chọn ${formatVND(used)} vượt hạn mức ${formatVND(budget)} (vượt ${formatVND(used - budget)}).`);
      }
      if (tier.maxQty != null && giftQty > tier.maxQty) {
        error(`mức này chỉ được chọn tối đa ${tier.maxQty} sản phẩm quà (đang chọn ${giftQty}).`);
      }
      if (tier.allowedSkus) {
        const allowed = new Set(tier.allowedSkus.map(normalizeSku));
        const bad = chosen.filter((g) => !allowed.has(normalizeSku(g.sku)));
        if (bad.length > 0) {
          error(`mã ${bad.map((g) => g.sku).join(", ")} không nằm trong danh sách quà của mức này.`);
        }
      }
    }
    if (rule.giftGroupId) {
      const wrongGroup = chosen.filter((g) => g.groupId !== rule.giftGroupId);
      if (wrongGroup.length > 0) {
        error(`mã ${wrongGroup.map((g) => g.sku).join(", ")} không thuộc danh mục quà ${namesOf([rule.giftGroupId])}.`);
      }
    } else {
      // Quy tắc không (còn) danh mục quà — vd danh mục quà vừa bị xóa — thì quà đã chọn không còn hợp lệ.
      error("quy tắc chưa chọn danh mục quà nên chưa được chọn quà.");
    }
    // Quà không có giá theo cách tính của quy tắc sẽ có giá trị 0 đ và chọn bao nhiêu cũng không vượt hạn mức.
    const unpriced = chosen.filter((g) => safeMoney(priceOf(g, rule.giftPriceBasis)) === 0);
    if (unpriced.length > 0) {
      error(
        `mã ${unpriced.map((g) => g.sku).join(", ")} chưa có ${
          rule.giftPriceBasis === "retail" ? "giá lẻ" : "giá sỉ"
        } nên không tính được giá trị quà.`,
      );
    }
  } else if (tier && budget > 0) {
    addIssue(
      "warning",
      rule.id,
      `${rule.name}: đã đạt mức ${formatVND(tier.min)} nhưng chưa chọn quà (được ${describeTierLimit(tier)}${
        tier.limitType === "percent" ? ` = ${formatVND(budget)}` : ""
      }).`,
    );
  }

  if (nextTier && revenue > 0) {
    addIssue(
      "info",
      rule.id,
      `${rule.name}: mua thêm ${formatVND(nextTier.min - revenue)} để đạt mức ${formatVND(nextTier.min)} (${describeTierLimit(nextTier)}).`,
    );
  }

  return {
    type: "tier_gift",
    ruleId: rule.id,
    ruleName: rule.name,
    revenue,
    tiers,
    tierIndex,
    tier,
    nextTier,
    amountToNextTier: nextTier ? Math.max(0, nextTier.min - revenue) : 0,
    budget,
    used,
    remaining: budget - used,
    giftQty,
    maxQty: tier?.maxQty ?? null,
    allowedSkus: tier?.allowedSkus ?? null,
    giftGroupId: rule.giftGroupId,
    giftPriceBasis: rule.giftPriceBasis,
    ok,
  };
}

function evaluateBuyXGetY(
  rule: BuyXGetYRule,
  lines: CalcLine[],
  orderGifts: OrderGift[],
  gifts: CalcGift[],
  usedGiftIndexes: Set<number>,
  qtyIn: (ids: ID[]) => number,
  addIssue: AddIssue,
): BuyXGetYResult {
  const buyQty = safeQty(rule.buyQty);
  const getQty = safeQty(rule.getQty);
  const sourceQty = qtyIn(rule.sourceGroupIds);
  const result: BuyXGetYResult = {
    type: "buy_x_get_y",
    ruleId: rule.id,
    ruleName: rule.name,
    giftMode: rule.giftMode,
    sourceQty,
    entitledQty: 0,
    chosenQty: 0,
    remainingQty: 0,
    giftGroupId: rule.giftMode === "group" ? rule.giftGroupId : null,
    ok: true,
  };

  const configured =
    buyQty > 0 && getQty > 0 && rule.sourceGroupIds.length > 0 && (rule.giftMode !== "group" || !!rule.giftGroupId);
  if (!configured) {
    addIssue("warning", rule.id, `${rule.name}: quy tắc chưa cấu hình đủ (thiếu danh mục hoặc số lượng mua/tặng).`);
  }

  if (rule.giftMode === "same") {
    if (configured) {
      for (const line of lines) {
        if (!rule.sourceGroupIds.includes(line.groupId)) continue;
        const free = Math.floor(line.qty / buyQty) * getQty;
        if (free <= 0) continue;
        result.entitledQty += free;
        gifts.push({
          ruleId: rule.id,
          sku: line.sku,
          name: line.name,
          qty: free,
          unitValue: line.wholesalePrice,
          value: line.wholesalePrice * free,
          auto: true,
        });
      }
    }
    return result;
  }

  const entitled = configured ? Math.floor(sourceQty / buyQty) * getQty : 0;
  result.entitledQty = entitled;

  if (rule.giftMode === "text") {
    if (entitled > 0) {
      gifts.push({
        ruleId: rule.id,
        sku: "",
        name: rule.giftText.trim() || "Quà tặng",
        qty: entitled,
        unitValue: 0,
        value: 0,
        auto: true,
      });
    }
    return result;
  }

  // giftMode === "group": sale chọn quà trong danh mục quà
  const wrongGroup: string[] = [];
  orderGifts.forEach((g, index) => {
    if (g.ruleId !== rule.id) return;
    usedGiftIndexes.add(index);
    const qty = safeQty(g.qty);
    if (qty === 0) return;
    const unitValue = safeMoney(g.wholesalePrice);
    result.chosenQty += qty;
    if (rule.giftGroupId && g.groupId !== rule.giftGroupId) wrongGroup.push(g.sku);
    gifts.push({ ruleId: rule.id, sku: g.sku, name: g.name, qty, unitValue, value: unitValue * qty, auto: false });
  });
  result.remainingQty = entitled - result.chosenQty;

  if (result.chosenQty > entitled) {
    result.ok = false;
    addIssue("error", rule.id, `${rule.name}: đã chọn ${result.chosenQty} quà nhưng chỉ được tặng ${entitled}.`);
  } else if (result.chosenQty < entitled) {
    addIssue("warning", rule.id, `${rule.name}: còn được chọn thêm ${entitled - result.chosenQty} quà.`);
  }
  if (wrongGroup.length > 0) {
    result.ok = false;
    addIssue("error", rule.id, `${rule.name}: mã ${wrongGroup.join(", ")} không thuộc danh mục quà của quy tắc.`);
  }
  return result;
}
