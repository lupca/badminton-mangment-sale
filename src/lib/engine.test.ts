// Tests for the calculation core (calculateOrder and its helpers).
// Every expected number is worked out by hand from the business rules, never by calling the engine,
// so a wrong formula cannot make its own test pass.
import { describe, expect, it } from "vitest";
import seed from "../seed/seed.json";
import type {
  BuyXGetYResult,
  BuyXGetYRule,
  CalcIssue,
  CalcResult,
  DB,
  DiscountResult,
  DiscountRule,
  GiftTier,
  OrderGift,
  OrderLine,
  ProductGroup,
  ProductItem,
  Program,
  Rule,
  TierGiftResult,
  TierGiftRule,
} from "../types";
import {
  calculateOrder,
  describeTierLimit,
  giftUnitValue,
  priceOf,
  ruleAcceptsChosenGifts,
  sortTiers,
  tierBudget,
  type OrderInput,
} from "./engine";
import { removeGroup } from "./programOps";

// ───────────────────────── Helpers ─────────────────────────

const db = seed as unknown as DB;

function seedProgram(id: string): Program {
  const program = db.programs.find((p) => p.id === id);
  if (!program) throw new Error(`Seed program not found: ${id}`);
  return structuredClone(program);
}

/** Order line copied from the catalogue, the way the order screen does it. Throws on an unknown SKU so a typo cannot pass silently. */
function buy(program: Program, groupId: string, sku: string, qty: number): OrderLine {
  const item = program.groups.find((g) => g.id === groupId)?.items.find((i) => i.sku === sku);
  if (!item) throw new Error(`SKU ${sku} not found in group ${groupId}`);
  return { groupId, sku: item.sku, name: item.name, retailPrice: item.retailPrice, wholesalePrice: item.wholesalePrice, qty };
}

/** Gift chosen by the rep for a rule, copied from the catalogue. */
function pick(program: Program, ruleId: string, groupId: string, sku: string, qty = 1): OrderGift {
  return { ...buy(program, groupId, sku, qty), ruleId };
}

function order(lines: OrderLine[], gifts: OrderGift[] = [], frozenRules?: Rule[]): OrderInput {
  return frozenRules ? { lines, gifts, frozenRules } : { lines, gifts };
}

const byLevel = (result: CalcResult, level: CalcIssue["level"]) => result.issues.filter((i) => i.level === level);
const errors = (result: CalcResult) => byLevel(result, "error");
const warnings = (result: CalcResult) => byLevel(result, "warning");
const infos = (result: CalcResult) => byLevel(result, "info");

function tierOf(result: CalcResult, ruleId: string): TierGiftResult {
  const found = result.rules.find((r) => r.ruleId === ruleId);
  if (!found || found.type !== "tier_gift") throw new Error(`No tier_gift result for ${ruleId}`);
  return found;
}
function discountOf(result: CalcResult, ruleId: string): DiscountResult {
  const found = result.rules.find((r) => r.ruleId === ruleId);
  if (!found || found.type !== "discount") throw new Error(`No discount result for ${ruleId}`);
  return found;
}
function bxgyOf(result: CalcResult, ruleId: string): BuyXGetYResult {
  const found = result.rules.find((r) => r.ruleId === ruleId);
  if (!found || found.type !== "buy_x_get_y") throw new Error(`No buy_x_get_y result for ${ruleId}`);
  return found;
}

// Synthetic building blocks for the rule-by-rule tests.
function item(sku: string, wholesalePrice: number, retailPrice = wholesalePrice): ProductItem {
  return { sku, name: `Sản phẩm ${sku}`, retailPrice, wholesalePrice };
}
function group(id: string, items: ProductItem[] = []): ProductGroup {
  return { id, name: `Danh mục ${id}`, items };
}
function makeProgram(groups: ProductGroup[], rules: Rule[]): Program {
  return {
    id: "p-test",
    name: "Chương trình thử",
    brand: "Li-Ning",
    startDate: null,
    endDate: null,
    note: "",
    groups,
    rules,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
  };
}
function line(groupId: string, sku: string, qty: number, wholesalePrice: number, retailPrice = wholesalePrice): OrderLine {
  return { groupId, sku, name: `Sản phẩm ${sku}`, retailPrice, wholesalePrice, qty };
}
function gift(
  ruleId: string,
  groupId: string,
  sku: string,
  qty: number,
  wholesalePrice: number,
  retailPrice = wholesalePrice,
): OrderGift {
  return { ruleId, groupId, sku, name: `Quà ${sku}`, retailPrice, wholesalePrice, qty };
}
function tier(min: number, limitValue: number, extra: Partial<GiftTier> = {}): GiftTier {
  return { id: `t-${min}`, min, limitType: "amount", limitValue, maxQty: null, allowedSkus: null, ...extra };
}
function tierRule(extra: Partial<TierGiftRule> = {}): TierGiftRule {
  return {
    id: "r-tier",
    type: "tier_gift",
    name: "Tặng theo doanh số",
    sourceGroupIds: ["g-src"],
    giftGroupId: "g-gift",
    giftPriceBasis: "wholesale",
    tiers: [tier(10_000_000, 1_000_000), tier(20_000_000, 2_500_000)],
    ...extra,
  };
}
function discountRule(extra: Partial<DiscountRule> = {}): DiscountRule {
  return {
    id: "r-disc",
    type: "discount",
    name: "Giảm giá",
    targetGroupIds: ["g-a"],
    discountPercent: 10,
    discountBasis: "wholesale",
    minQty: null,
    maxQty: null,
    requireGroupIds: [],
    requireMinQty: 0,
    ...extra,
  };
}
function bxgyRule(extra: Partial<BuyXGetYRule> = {}): BuyXGetYRule {
  return {
    id: "r-bxgy",
    type: "buy_x_get_y",
    name: "Mua X tặng Y",
    sourceGroupIds: ["g-a"],
    buyQty: 1,
    getQty: 1,
    giftMode: "same",
    giftGroupId: null,
    giftText: "",
    ...extra,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

// ───────────────────────── Seed: KM tháng 11/2026 ─────────────────────────

/** Hàng mua kèm là sản phẩm thêm: ở danh mục vừa được giảm vừa là hàng mua kèm, chỉ phần dư ngoài mức tối thiểu được giảm mới tính. */
function companionQty(
  rule: { targetGroupIds: string[]; requireGroupIds: string[]; minQty: number | null },
  qtyOf: (ids: string[]) => number,
): number {
  const both = rule.requireGroupIds.filter((id) => rule.targetGroupIds.includes(id));
  if (both.length === 0) return qtyOf(rule.requireGroupIds);
  const targetOnly = qtyOf(rule.targetGroupIds.filter((id) => !both.includes(id)));
  const reserved = Math.max(0, Math.max(rule.minQty ?? 1, 1) - targetOnly);
  return qtyOf(rule.requireGroupIds.filter((id) => !both.includes(id))) + Math.max(0, qtyOf(both) - reserved);
}

describe("seed program KM 11/2026 — gift tiers by revenue, gifts valued at RETAIL price", () => {
  const P = "seed-km-2026-11";
  const APPLY = "g-km11-apply";
  const GIFT = "g-km11-gift";
  const RULE = "r-km11-tier";

  it("15 × P-AYPR285-3 = 21.236.730 reaches the 20M tier; three gifts worth exactly 3.190.000 are accepted", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order(
        [buy(program, APPLY, "P-AYPR285-3", 15)],
        [
          pick(program, RULE, GIFT, "P-AYPT467-4"),
          pick(program, RULE, GIFT, "P-AYPT471-4"),
          pick(program, RULE, GIFT, "P-AYPT477-4"),
        ],
      ),
    );

    expect(result.totalQty).toBe(15);
    expect(result.totalWholesale).toBe(21_236_730);
    expect(result.totalAmount).toBe(21_236_730);
    expect(result.totalRetail).toBe(30_338_175);
    expect(result.discountAmount).toBe(0);
    expect(result.lines[0]).toMatchObject({ index: 0, qty: 15, unitPrice: 1_415_782, amount: 21_236_730, discountRuleId: null });

    const t = tierOf(result, RULE);
    expect(t.revenue).toBe(21_236_730);
    expect(t.tierIndex).toBe(1);
    expect(t.tier?.min).toBe(20_000_000);
    expect(t.budget).toBe(3_190_000);
    expect(t.used).toBe(3_190_000); // 1.070.000 + 1.070.000 + 1.050.000 at retail
    expect(t.remaining).toBe(0);
    expect(t.giftQty).toBe(3);
    expect(t.maxQty).toBeNull();
    expect(t.allowedSkus).toBeNull();
    expect(t.nextTier?.min).toBe(50_000_000);
    expect(t.amountToNextTier).toBe(28_763_270);
    expect(t.ok).toBe(true);

    expect(result.hasError).toBe(false);
    expect(errors(result)).toEqual([]);
    expect(warnings(result)).toEqual([]);
    expect(result.gifts).toHaveLength(3);
    expect(result.gifts.every((g) => g.auto === false && g.ruleId === RULE)).toBe(true);
    expect(result.giftQty).toBe(3);
    expect(result.giftValue).toBe(3_190_000);
    expect(result.orphanGiftIndexes).toEqual([]);
  });

  it("same order with 3 × P-AYPT399-4 (3.600.000) is over the budget by 410.000 → error, gifts still listed", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order([buy(program, APPLY, "P-AYPR285-3", 15)], [pick(program, RULE, GIFT, "P-AYPT399-4", 3)]),
    );
    const t = tierOf(result, RULE);
    expect(t.used).toBe(3_600_000);
    expect(t.budget).toBe(3_190_000);
    expect(t.remaining).toBe(-410_000);
    expect(t.ok).toBe(false);
    expect(result.hasError).toBe(true);
    expect(errors(result)).toHaveLength(1);
    expect(errors(result)[0].ruleId).toBe(RULE);
    expect(errors(result)[0].message).toContain("410.000 đ");
    // The UI still has to show what was chosen.
    expect(result.gifts).toEqual([
      { ruleId: RULE, sku: "P-AYPT399-4", name: "Khung vợt cầu lông 3D Calibar 001", qty: 3, unitValue: 1_200_000, value: 3_600_000, auto: false },
    ]);
  });

  it("8 × P-AYPR285-3 = 11.326.256 reaches the 10M tier: max 1.200.000, one gift, six allowed SKUs", () => {
    const program = seedProgram(P);
    const lines = [buy(program, APPLY, "P-AYPR285-3", 8)];

    const noGift = calculateOrder(program, order(lines));
    const t0 = tierOf(noGift, RULE);
    expect(t0.revenue).toBe(11_326_256);
    expect(t0.tierIndex).toBe(0);
    expect(t0.budget).toBe(1_200_000);
    expect(t0.maxQty).toBe(1);
    expect(t0.allowedSkus).toEqual(["P-AYPT399-4", "P-AYPT455-4", "P-AYPT457-4", "P-AYPT467-4", "P-AYPT471-4", "P-AYPT477-4"]);
    expect(t0.amountToNextTier).toBe(8_673_744);
    // Tier reached, nothing chosen → a warning, not an error.
    expect(noGift.hasError).toBe(false);
    expect(warnings(noGift)).toHaveLength(1);
    expect(warnings(noGift)[0].ruleId).toBe(RULE);

    // One allowed gift at exactly the budget.
    const ok = calculateOrder(program, order(lines, [pick(program, RULE, GIFT, "P-AYPT399-4")]));
    expect(ok.hasError).toBe(false);
    expect(warnings(ok)).toEqual([]);
    expect(tierOf(ok, RULE)).toMatchObject({ used: 1_200_000, remaining: 0, giftQty: 1, ok: true });
  });

  it("10M tier: every one of the six allowed SKUs is accepted on its own", () => {
    const program = seedProgram(P);
    const lines = [buy(program, APPLY, "P-AYPR285-3", 8)];
    for (const sku of ["P-AYPT399-4", "P-AYPT455-4", "P-AYPT457-4", "P-AYPT467-4", "P-AYPT471-4", "P-AYPT477-4"]) {
      const result = calculateOrder(program, order(lines, [pick(program, RULE, GIFT, sku)]));
      expect(result.hasError, sku).toBe(false);
    }
  });

  it("10M tier: P-AYPT563-4 (1.380.000, not in the allowed list) is rejected for both reasons", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order([buy(program, APPLY, "P-AYPR285-3", 8)], [pick(program, RULE, GIFT, "P-AYPT563-4")]),
    );
    expect(result.hasError).toBe(true);
    expect(tierOf(result, RULE).ok).toBe(false);
    const messages = errors(result).map((e) => e.message);
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.includes("180.000 đ"))).toBe(true); // 1.380.000 − 1.200.000
    expect(messages.some((m) => m.includes("P-AYPT563-4"))).toBe(true);
  });

  it("10M tier: the other three gift SKUs that are not in the allowed list are rejected too", () => {
    const program = seedProgram(P);
    const lines = [buy(program, APPLY, "P-AYPR285-3", 8)];
    for (const sku of ["P-AYPM394-4", "P-AYPP032-4", "P-AYPT749-4"]) {
      const result = calculateOrder(program, order(lines, [pick(program, RULE, GIFT, sku)]));
      expect(result.hasError, sku).toBe(true);
    }
  });

  it("10M tier: two gifts are rejected (max 1 gift, and 2.100.000 > 1.200.000)", () => {
    const program = seedProgram(P);
    const lines = [buy(program, APPLY, "P-AYPR285-3", 8)];

    const twoOfOne = calculateOrder(program, order(lines, [pick(program, RULE, GIFT, "P-AYPT477-4", 2)]));
    expect(twoOfOne.hasError).toBe(true);
    expect(tierOf(twoOfOne, RULE)).toMatchObject({ giftQty: 2, used: 2_100_000, remaining: -900_000, ok: false });
    expect(errors(twoOfOne)).toHaveLength(2); // over budget + over quantity

    const twoDifferent = calculateOrder(
      program,
      order(lines, [pick(program, RULE, GIFT, "P-AYPT467-4"), pick(program, RULE, GIFT, "P-AYPT477-4")]),
    );
    expect(twoDifferent.hasError).toBe(true);
    expect(tierOf(twoDifferent, RULE).giftQty).toBe(2);
  });

  it("revenue under 10.000.000 with a gift chosen → error", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order([buy(program, APPLY, "P-AYPR285-3", 7)], [pick(program, RULE, GIFT, "P-AYPT399-4")]),
    );
    const t = tierOf(result, RULE);
    expect(t.revenue).toBe(9_910_474);
    expect(t.tierIndex).toBe(-1);
    expect(t.tier).toBeNull();
    expect(t.budget).toBe(0);
    expect(t.ok).toBe(false);
    expect(result.hasError).toBe(true);
    expect(errors(result)).toHaveLength(1);
    expect(result.gifts).toHaveLength(1);
  });

  it("revenue under 10.000.000 with no gift → only the “mua thêm … để đạt mức” info", () => {
    const program = seedProgram(P);
    const result = calculateOrder(program, order([buy(program, APPLY, "P-AYPR285-3", 7)]));
    expect(result.hasError).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].level).toBe("info");
    expect(result.issues[0].ruleId).toBe(RULE);
    expect(result.issues[0].message).toMatch(/mua thêm 89\.526 đ để đạt mức 10\.000\.000 đ/);
    expect(tierOf(result, RULE)).toMatchObject({ tierIndex: -1, amountToNextTier: 89_526, ok: true });
  });

  it("items bought from the gift group are charged but do not count toward revenue", () => {
    const program = seedProgram(P);
    // 15 × 1.415.782 from the apply group + 10 × 966.000 bought from the gift group.
    const mixed = calculateOrder(
      program,
      order([buy(program, APPLY, "P-AYPR285-3", 15), buy(program, GIFT, "P-AYPT563-4", 10)]),
    );
    expect(mixed.totalAmount).toBe(21_236_730 + 9_660_000);
    expect(tierOf(mixed, RULE).revenue).toBe(21_236_730);
    expect(tierOf(mixed, RULE).tierIndex).toBe(1);

    // 30 × 966.000 = 28.980.000 bought only from the gift group: no tier at all.
    const giftGroupOnly = calculateOrder(program, order([buy(program, GIFT, "P-AYPT563-4", 30)]));
    expect(giftGroupOnly.totalAmount).toBe(28_980_000);
    expect(tierOf(giftGroupOnly, RULE)).toMatchObject({ revenue: 0, tierIndex: -1, budget: 0 });
    expect(giftGroupOnly.issues).toEqual([]);
  });

  it("revenue adds up over several SKUs of the apply group", () => {
    const program = seedProgram(P);
    // 7 × 1.415.782 + 1 × 687.273 = 10.597.747
    const result = calculateOrder(
      program,
      order([buy(program, APPLY, "P-AYPR285-3", 7), buy(program, APPLY, "P-AYPT307-4", 1)]),
    );
    expect(tierOf(result, RULE)).toMatchObject({ revenue: 10_597_747, tierIndex: 0, budget: 1_200_000 });
  });

  it.each([
    [9_999_999, -1, 0],
    [10_000_000, 0, 1_200_000],
    [19_999_999, 0, 1_200_000],
    [20_000_000, 1, 3_190_000],
    [49_999_999, 1, 3_190_000],
    [50_000_000, 2, 11_610_000],
    [119_999_999, 2, 11_610_000],
    [120_000_000, 3, 35_050_000],
    [199_999_999, 3, 35_050_000],
    [200_000_000, 4, 72_400_000],
    [1_000_000_000, 4, 72_400_000],
  ])("tier boundary: revenue %d → tier index %d, budget %d", (revenue, tierIndex, budget) => {
    const program = seedProgram(P);
    const result = calculateOrder(program, order([line(APPLY, "X-1", 1, revenue)]));
    const t = tierOf(result, RULE);
    expect(t.revenue).toBe(revenue);
    expect(t.tierIndex).toBe(tierIndex);
    expect(t.budget).toBe(budget);
  });

  it("from the 20M tier upward any gift of the gift group may be chosen, in any quantity within the budget", () => {
    const program = seedProgram(P);
    // 36 × 1.415.782 = 50.968.152 → 50M tier, budget 11.610.000. 8 × P-AYPM394-4 at retail 1.450.000 = 11.600.000.
    const lines = [buy(program, APPLY, "P-AYPR285-3", 36)];
    const within = calculateOrder(program, order(lines, [pick(program, RULE, GIFT, "P-AYPM394-4", 8)]));
    expect(tierOf(within, RULE)).toMatchObject({ revenue: 50_968_152, tierIndex: 2, used: 11_600_000, remaining: 10_000, ok: true });
    expect(within.hasError).toBe(false);

    const over = calculateOrder(program, order(lines, [pick(program, RULE, GIFT, "P-AYPM394-4", 9)]));
    expect(tierOf(over, RULE)).toMatchObject({ used: 13_050_000, remaining: -1_440_000, ok: false });
    expect(over.hasError).toBe(true);
  });

  it("a gift taken from the purchasable group instead of the gift group is rejected", () => {
    const program = seedProgram(P);
    // P-AYPT317-2 (retail 471.273) is well inside the 3.190.000 budget, but it is not a gift item.
    const result = calculateOrder(
      program,
      order([buy(program, APPLY, "P-AYPR285-3", 15)], [pick(program, RULE, APPLY, "P-AYPT317-2")]),
    );
    expect(result.hasError).toBe(true);
    expect(errors(result)).toHaveLength(1);
    expect(errors(result)[0].message).toContain("P-AYPT317-2");
  });
});

// ───────────────────────── Seed: Khuyến mại Hè 2026 ─────────────────────────

describe("seed program Khuyến mại Hè 2026 — discount A, string gift B1, percent tiers B2", () => {
  const P = "seed-km-2026-he";
  const DM01 = "g-he-dm01";
  const DM02 = "g-he-dm02";
  const DM03 = "g-he-dm03";
  const A = "r-he-a";
  const B1 = "r-he-b1";
  const B2 = "r-he-b2";
  const STRING = "Cước cầu lông LiNing N65";

  it("3 × P-AYPT417-5 (dm01) + 1 × P-AYPM444-3 (dm03): unit price 1.296.000, total 5.303.782, 3 strings", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order([buy(program, DM01, "P-AYPT417-5", 3), buy(program, DM03, "P-AYPM444-3", 1)]),
    );

    expect(result.lines[0]).toMatchObject({ unitPrice: 1_296_000, amount: 3_888_000, discountRuleId: A, discountPercent: 45 });
    expect(result.lines[1]).toMatchObject({ unitPrice: 1_415_782, amount: 1_415_782, discountRuleId: null, discountPercent: null });
    expect(result.totalQty).toBe(4);
    expect(result.totalAmount).toBe(5_303_782);
    expect(result.totalWholesale).toBe(6_364_147); // 3 × 1.649.455 + 1.415.782
    expect(result.totalRetail).toBe(9_091_637); // 3 × 2.356.364 + 2.022.545
    expect(result.discountAmount).toBe(1_060_365);

    const a = discountOf(result, A);
    expect(a).toMatchObject({ eligible: true, targetQty: 3, requireQty: 1, savedAmount: 1_060_365, ok: true });
    expect(a.reason).not.toBe("");

    expect(bxgyOf(result, B1)).toMatchObject({ giftMode: "text", sourceQty: 3, entitledQty: 3, ok: true });
    expect(result.gifts).toEqual([{ ruleId: B1, sku: "", name: STRING, qty: 3, unitValue: 150_000, value: 450_000, auto: true }]);
    expect(result.giftQty).toBe(3);
    expect(result.giftValue).toBe(450_000); // 3 strings × 150.000

    expect(tierOf(result, B2)).toMatchObject({ revenue: 0, tierIndex: -1, budget: 0 });
    expect(result.hasError).toBe(false);
    expect(result.issues).toEqual([]);
    // Results come back in the order of the program's rules.
    expect(result.rules.map((r) => r.ruleId)).toEqual([A, B1, B2]);
  });

  it("5 dm01 units (over the 2–4 window) → no discount, an info explains why, still 5 strings", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order([buy(program, DM01, "P-AYPT417-5", 5), buy(program, DM03, "P-AYPM444-3", 1)]),
    );
    expect(result.lines[0]).toMatchObject({ unitPrice: 1_649_455, discountRuleId: null, discountPercent: null });
    expect(result.totalAmount).toBe(9_663_057); // 5 × 1.649.455 + 1.415.782
    expect(result.discountAmount).toBe(0);
    expect(discountOf(result, A)).toMatchObject({ eligible: false, targetQty: 5, savedAmount: 0 });
    expect(result.hasError).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: "info", ruleId: A });
    expect(result.gifts).toEqual([{ ruleId: B1, sku: "", name: STRING, qty: 5, unitValue: 150_000, value: 750_000, auto: true }]);
  });

  it("3 dm01 units without any dm03 item → no discount, an info explains why", () => {
    const program = seedProgram(P);
    const result = calculateOrder(program, order([buy(program, DM01, "P-AYPT417-5", 3)]));
    expect(result.lines[0].unitPrice).toBe(1_649_455);
    expect(result.totalAmount).toBe(4_948_365);
    expect(discountOf(result, A)).toMatchObject({ eligible: false, targetQty: 3, requireQty: 0, savedAmount: 0 });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: "info", ruleId: A });
    expect(result.giftQty).toBe(3);
  });

  it.each([
    [1, false],
    [2, true],
    [3, true],
    [4, true],
    [5, false],
    [6, false],
  ])("discount A window: %d dm01 unit(s) + 1 dm03 → eligible = %s", (qty, eligible) => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order([buy(program, DM01, "P-AYPT417-5", qty), buy(program, DM03, "P-AYPM444-3", 1)]),
    );
    expect(discountOf(result, A).eligible).toBe(eligible);
    expect(result.lines[0].unitPrice).toBe(eligible ? 1_296_000 : 1_649_455);
    expect(infos(result).some((i) => i.ruleId === A)).toBe(!eligible);
  });

  it("the 2–4 window counts the dm01 quantity over all SKUs together", () => {
    const program = seedProgram(P);
    const four = calculateOrder(
      program,
      order([
        buy(program, DM01, "P-AYPT417-5", 2),
        buy(program, DM01, "P-AYPU109-4", 2),
        buy(program, DM03, "P-AYPM444-3", 1),
      ]),
    );
    expect(discountOf(four, A)).toMatchObject({ eligible: true, targetQty: 4 });
    expect(four.lines.map((l) => l.unitPrice)).toEqual([1_296_000, 513_000, 1_415_782]);
    // (1.649.455 − 1.296.000) × 2 + (652.909 − 513.000) × 2
    expect(discountOf(four, A).savedAmount).toBe(986_728);

    const five = calculateOrder(
      program,
      order([
        buy(program, DM01, "P-AYPT417-5", 3),
        buy(program, DM01, "P-AYPU109-4", 2),
        buy(program, DM03, "P-AYPM444-3", 1),
      ]),
    );
    expect(discountOf(five, A)).toMatchObject({ eligible: false, targetQty: 5 });
    expect(five.lines.map((l) => l.unitPrice)).toEqual([1_649_455, 652_909, 1_415_782]);
  });

  it("known discounted prices of the old system (gia_sau_giam)", () => {
    const program = seedProgram(P);
    const expected: Record<string, number> = {
      "P-AYPT417-5": 1_296_000,
      "P-AYPU109-4": 513_000,
      "P-AYPU077-4": 1_107_000,
      "P-AYPJ008-4": 891_000,
    };
    for (const [sku, price] of Object.entries(expected)) {
      const result = calculateOrder(
        program,
        order([buy(program, DM01, sku, 2), buy(program, DM03, "P-AYPM444-3", 1)]),
      );
      expect(result.lines[0].unitPrice, sku).toBe(price);
    }
  });

  it("every dm01 item is sold at round(retail × 0.55) under discount A, and that is below wholesale", () => {
    const program = seedProgram(P);
    const dm01 = program.groups.find((g) => g.id === DM01)!;
    expect(dm01.items).toHaveLength(48);
    for (const product of dm01.items) {
      const result = calculateOrder(
        program,
        order([buy(program, DM01, product.sku, 2), buy(program, DM03, "P-AYPM444-3", 1)]),
      );
      // Integer arithmetic, half rounds up — independent of the engine's own formula.
      const expected = Math.floor((product.retailPrice * 55 + 50) / 100);
      expect(result.lines[0].unitPrice, product.sku).toBe(expected);
      expect(result.lines[0].unitPrice, product.sku).toBeLessThan(product.wholesalePrice);
      expect(result.lines[0].amount, product.sku).toBe(expected * 2);
      expect(result.lines[0].discountRuleId, product.sku).toBe(A);
    }
  });

  it("B1: every dm01 unit earns one string, whatever the SKU; dm02 and dm03 units earn none", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order([
        buy(program, DM01, "P-AYPT417-5", 6),
        buy(program, DM01, "P-AYPJ008-4", 1),
        buy(program, DM02, "P-AYPS053-1", 2),
        buy(program, DM03, "P-AYPM444-3", 4),
      ]),
    );
    expect(bxgyOf(result, B1)).toMatchObject({ sourceQty: 7, entitledQty: 7 });
    expect(result.gifts).toEqual([{ ruleId: B1, sku: "", name: STRING, qty: 7, unitValue: 150_000, value: 1_050_000, auto: true }]);
  });

  it("B2: 5 × P-AYPT417-5 bought as dm02 = 8.247.275 → 15% = 1.237.091; gifts from dm01 are valued at WHOLESALE", () => {
    const program = seedProgram(P);
    const lines = [buy(program, DM02, "P-AYPT417-5", 5)];

    const noGift = calculateOrder(program, order(lines));
    const t = tierOf(noGift, B2);
    expect(t).toMatchObject({ revenue: 8_247_275, tierIndex: 0, budget: 1_237_091, giftPriceBasis: "wholesale", giftGroupId: DM01 });
    expect(t.amountToNextTier).toBe(11_752_725);
    expect(noGift.gifts).toEqual([]); // dm02 units earn no strings
    expect(warnings(noGift)).toHaveLength(1); // tier reached, nothing chosen

    // P-AYPJ008-4: wholesale 1.134.000 fits, although its retail price 1.620.000 would not.
    const fits = calculateOrder(program, order(lines, [pick(program, B2, DM01, "P-AYPJ008-4")]));
    expect(fits.hasError).toBe(false);
    expect(tierOf(fits, B2)).toMatchObject({ used: 1_134_000, remaining: 103_091, giftQty: 1, ok: true });
    expect(fits.gifts).toEqual([
      { ruleId: B2, sku: "P-AYPJ008-4", name: "Khung vợt cầu lông 80TF", qty: 1, unitValue: 1_134_000, value: 1_134_000, auto: false },
    ]);

    // 2 × P-AYPU109-4 at wholesale 652.909 = 1.305.818 → over by 68.727.
    const over = calculateOrder(program, order(lines, [pick(program, B2, DM01, "P-AYPU109-4", 2)]));
    expect(over.hasError).toBe(true);
    expect(tierOf(over, B2)).toMatchObject({ used: 1_305_818, remaining: -68_727, ok: false });
    expect(errors(over)[0].message).toContain("68.727 đ");
  });

  it.each([
    [7_999_999, -1, 0],
    [8_000_000, 0, 1_200_000],
    [19_999_999, 0, 2_999_999], // 15% = 2.999.999,85 → rounded down
    [20_000_000, 1, 3_600_000],
    [34_999_999, 1, 6_299_999], // 18% = 6.299.999,82
    [35_000_000, 2, 7_000_000],
    [49_999_999, 2, 9_999_999], // 20% = 9.999.999,8
    [50_000_000, 3, 13_500_000],
    [123_456_789, 3, 33_333_333], // 27% = 33.333.333,03
  ])("B2 percent tiers: dm02 revenue %d → tier index %d, budget %d", (revenue, tierIndex, budget) => {
    const program = seedProgram(P);
    const result = calculateOrder(program, order([line(DM02, "X-1", 1, revenue)]));
    expect(tierOf(result, B2)).toMatchObject({ revenue, tierIndex, budget });
  });

  it("the same SKU bought under dm01 and under dm02 is handled per line: discount + strings for dm01, revenue for dm02", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order(
        [
          buy(program, DM01, "P-AYPT417-5", 3),
          buy(program, DM02, "P-AYPT417-5", 5),
          buy(program, DM03, "P-AYPM444-3", 1),
        ],
        [pick(program, B2, DM01, "P-AYPJ008-4")],
      ),
    );
    expect(result.lines.map((l) => l.unitPrice)).toEqual([1_296_000, 1_649_455, 1_415_782]);
    expect(result.totalAmount).toBe(13_551_057); // 3.888.000 + 8.247.275 + 1.415.782
    expect(discountOf(result, A)).toMatchObject({ eligible: true, targetQty: 3 });
    expect(bxgyOf(result, B1).entitledQty).toBe(3);
    expect(tierOf(result, B2)).toMatchObject({ revenue: 8_247_275, budget: 1_237_091, used: 1_134_000, ok: true });
    expect(result.hasError).toBe(false);
    expect(result.gifts.map((g) => [g.ruleId, g.qty, g.auto])).toEqual([
      [B1, 3, true],
      [B2, 1, false],
    ]);
    expect(result.giftQty).toBe(4);
    expect(result.giftValue).toBe(1_584_000); // 3 strings × 150.000 + wholesale 1.134.000
  });
});

// ───────────────────────── Seed: Bảng giá sau chiết khấu ─────────────────────────

describe("seed program Bảng giá sau chiết khấu — Ashaway buy 1 get 1 of the same product", () => {
  const P = "seed-bang-gia-sau-ck";
  const ASHAWAY = "g-bg-ashaway";
  const RULE = "r-bg-ashaway";

  it("3 × AV1F → 3 free AV1F, valued at wholesale", () => {
    const program = seedProgram(P);
    const result = calculateOrder(program, order([buy(program, ASHAWAY, "AV1F", 3)]));
    expect(result.totalAmount).toBe(3_450_000);
    expect(result.gifts).toEqual([
      { ruleId: RULE, sku: "AV1F", name: "Khung vợt cầu lông Flexred", qty: 3, unitValue: 1_150_000, value: 3_450_000, auto: true },
    ]);
    expect(result.giftQty).toBe(3);
    expect(result.giftValue).toBe(3_450_000);
    expect(bxgyOf(result, RULE)).toMatchObject({ giftMode: "same", sourceQty: 3, entitledQty: 3, ok: true });
    expect(result.issues).toEqual([]);
    expect(result.hasError).toBe(false);
  });

  it("each Ashaway line gets its own free units; the other groups get nothing", () => {
    const program = seedProgram(P);
    const result = calculateOrder(
      program,
      order([
        buy(program, "g-bg-thuong", "P-AYPH044-3", 4),
        buy(program, ASHAWAY, "AV1F", 3),
        buy(program, "g-bg-kem", "P-AYPT235-4V", 2),
        buy(program, "g-bg-muc2", "P-AYPJ008-4", 5),
        buy(program, ASHAWAY, "AVPTX", 2),
      ]),
    );
    expect(result.gifts.map((g) => [g.sku, g.qty, g.value])).toEqual([
      ["AV1F", 3, 3_450_000],
      ["AVPTX", 2, 3_600_000],
    ]);
    expect(bxgyOf(result, RULE)).toMatchObject({ sourceQty: 5, entitledQty: 5 });
    // 4 × 549.818 + 3 × 1.150.000 + 2 × 4.054.909 + 5 × 972.000 + 2 × 1.800.000
    expect(result.totalAmount).toBe(22_219_090);
    expect(result.discountAmount).toBe(0);
  });

  it("an order without Ashaway items gets no gift and no issue", () => {
    const program = seedProgram(P);
    const result = calculateOrder(program, order([buy(program, "g-bg-thuong", "P-AYPH044-3", 10)]));
    expect(result.gifts).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(bxgyOf(result, RULE)).toMatchObject({ sourceQty: 0, entitledQty: 0 });
  });
});

// ───────────────────────── Order lines ─────────────────────────

describe("order lines and totals", () => {
  const program = makeProgram([group("g-a")], []);

  it("an empty order is all zeros and has no issue", () => {
    const result = calculateOrder(program, order([]));
    expect(result).toEqual({
      lines: [],
      totalQty: 0,
      totalRetail: 0,
      totalWholesale: 0,
      discountAmount: 0,
      totalAmount: 0,
      gifts: [],
      giftQty: 0,
      giftValue: 0,
      rules: [],
      issues: [],
      hasError: false,
      orphanGiftIndexes: [],
    });
  });

  it("the line price defaults to the wholesale price", () => {
    const result = calculateOrder(program, order([line("g-a", "A", 3, 100_000, 150_000)]));
    expect(result.lines).toEqual([
      {
        index: 0,
        groupId: "g-a",
        sku: "A",
        name: "Sản phẩm A",
        qty: 3,
        retailPrice: 150_000,
        wholesalePrice: 100_000,
        unitPrice: 100_000,
        amount: 300_000,
        discountRuleId: null,
        discountPercent: null,
      },
    ]);
    expect(result.totalRetail).toBe(450_000);
    expect(result.totalWholesale).toBe(300_000);
    expect(result.totalAmount).toBe(300_000);
  });

  it("qty 0, negative, NaN and Infinity count as 0; fractional quantities are rounded down; lines keep their position", () => {
    const bad = (qty: unknown) => ({ ...line("g-a", "A", 1, 100_000, 150_000), qty: qty as number });
    const result = calculateOrder(
      program,
      order([bad(3), bad(0), bad(-2), bad(Number.NaN), bad(2.9), bad("4"), bad(Number.POSITIVE_INFINITY), bad(0.5), bad(null), bad(undefined)]),
    );
    expect(result.lines.map((l) => l.qty)).toEqual([3, 0, 0, 0, 2, 4, 0, 0, 0, 0]);
    expect(result.lines.map((l) => l.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.lines.map((l) => l.amount)).toEqual([300_000, 0, 0, 0, 200_000, 400_000, 0, 0, 0, 0]);
    expect(result.totalQty).toBe(9);
    expect(result.totalWholesale).toBe(900_000);
    expect(result.totalRetail).toBe(1_350_000);
    expect(result.totalAmount).toBe(900_000);
    expect(Number.isFinite(result.totalAmount)).toBe(true);
    expect(result.hasError).toBe(false);
  });

  it("negative and NaN prices count as 0, fractional prices are rounded to whole đồng", () => {
    const withPrices = (wholesalePrice: unknown, retailPrice: unknown): OrderLine => ({
      ...line("g-a", "A", 2, 0),
      wholesalePrice: wholesalePrice as number,
      retailPrice: retailPrice as number,
    });
    const result = calculateOrder(
      program,
      order([withPrices(-5, -1), withPrices(Number.NaN, Number.NaN), withPrices(100.4, 150.5), withPrices("250000", "300000")]),
    );
    expect(result.lines.map((l) => l.wholesalePrice)).toEqual([0, 0, 100, 250_000]);
    expect(result.lines.map((l) => l.retailPrice)).toEqual([0, 0, 151, 300_000]);
    expect(result.lines.map((l) => l.amount)).toEqual([0, 0, 200, 500_000]);
    expect(result.totalAmount).toBe(500_200);
  });

  it("totals stay exact for a large order", () => {
    // 1.000 lines × 999 units × 2.130.545 đ
    const lines = Array.from({ length: 1000 }, (_, i) => line("g-a", `SKU-${i}`, 999, 2_130_545, 3_043_636));
    const result = calculateOrder(program, order(lines));
    expect(result.totalQty).toBe(999_000);
    expect(result.totalAmount).toBe(2_128_414_455_000);
    expect(result.totalRetail).toBe(3_040_592_364_000);
  });
});

// ───────────────────────── Discount ─────────────────────────

describe("discount rule", () => {
  const groups = [group("g-a"), group("g-b"), group("g-c")];

  it("gives percent off the wholesale price to every line of the target groups, and to no other line", () => {
    const program = makeProgram(groups, [discountRule({ targetGroupIds: ["g-a", "g-c"] })]);
    const result = calculateOrder(
      program,
      order([line("g-a", "A", 2, 100_000, 150_000), line("g-b", "B", 3, 100_000, 150_000), line("g-c", "C", 1, 200_000, 300_000)]),
    );
    expect(result.lines.map((l) => l.unitPrice)).toEqual([90_000, 100_000, 180_000]);
    expect(result.lines.map((l) => l.discountRuleId)).toEqual(["r-disc", null, "r-disc"]);
    expect(result.lines.map((l) => l.discountPercent)).toEqual([10, null, 10]);
    expect(result.totalWholesale).toBe(700_000);
    expect(result.totalAmount).toBe(660_000);
    expect(result.discountAmount).toBe(40_000);
    expect(discountOf(result, "r-disc")).toMatchObject({ eligible: true, targetQty: 3, savedAmount: 40_000 });
    expect(result.issues).toEqual([]);
  });

  it("percent off the retail price: 45% of 2.356.364 leaves 1.296.000 (1.296.000,2 rounded)", () => {
    const program = makeProgram(groups, [discountRule({ discountPercent: 45, discountBasis: "retail" })]);
    const result = calculateOrder(program, order([line("g-a", "A", 1, 1_649_455, 2_356_364)]));
    expect(result.lines[0].unitPrice).toBe(1_296_000);
    expect(discountOf(result, "r-disc").savedAmount).toBe(353_455);
  });

  it("rounds to the nearest đồng: 12,5% off 1.415.782 = 1.238.809,25 → 1.238.809; 33% off 1.000.000 = 670.000", () => {
    const program = makeProgram(groups, [discountRule({ discountPercent: 12.5 })]);
    expect(calculateOrder(program, order([line("g-a", "A", 1, 1_415_782)])).lines[0].unitPrice).toBe(1_238_809);
    const third = makeProgram(groups, [discountRule({ discountPercent: 33 })]);
    expect(calculateOrder(third, order([line("g-a", "A", 1, 1_000_000)])).lines[0].unitPrice).toBe(670_000);
    // 1.415.783 × 0,875 = 1.238.810,125 → 1.238.810
    expect(calculateOrder(program, order([line("g-a", "A", 1, 1_415_783)])).lines[0].unitPrice).toBe(1_238_810);
  });

  it("minQty is inclusive and counts the whole target group", () => {
    const program = makeProgram(groups, [discountRule({ minQty: 3 })]);
    const two = calculateOrder(program, order([line("g-a", "A", 1, 100_000), line("g-a", "B", 1, 100_000)]));
    expect(discountOf(two, "r-disc")).toMatchObject({ eligible: false, targetQty: 2 });
    expect(two.lines.map((l) => l.unitPrice)).toEqual([100_000, 100_000]);
    expect(infos(two)).toHaveLength(1);

    const three = calculateOrder(program, order([line("g-a", "A", 1, 100_000), line("g-a", "B", 2, 100_000)]));
    expect(discountOf(three, "r-disc")).toMatchObject({ eligible: true, targetQty: 3 });
    expect(three.lines.map((l) => l.unitPrice)).toEqual([90_000, 90_000]);
    expect(three.issues).toEqual([]);
  });

  it("maxQty is inclusive; one unit more loses the discount on every unit", () => {
    const program = makeProgram(groups, [discountRule({ maxQty: 4 })]);
    const four = calculateOrder(program, order([line("g-a", "A", 4, 100_000)]));
    expect(discountOf(four, "r-disc").eligible).toBe(true);
    expect(four.totalAmount).toBe(360_000);

    const five = calculateOrder(program, order([line("g-a", "A", 5, 100_000)]));
    expect(discountOf(five, "r-disc")).toMatchObject({ eligible: false, targetQty: 5, savedAmount: 0 });
    expect(five.totalAmount).toBe(500_000);
    expect(infos(five)).toHaveLength(1);
    expect(infos(five)[0].ruleId).toBe("r-disc");
  });

  it("lines with quantity 0 count neither toward the target quantity nor toward the required quantity", () => {
    const program = makeProgram(groups, [discountRule({ minQty: 2, requireGroupIds: ["g-b"], requireMinQty: 1 })]);
    const result = calculateOrder(
      program,
      order([line("g-a", "A", 2, 100_000), line("g-a", "Z", 0, 100_000), line("g-b", "B", 0, 100_000)]),
    );
    expect(discountOf(result, "r-disc")).toMatchObject({ eligible: false, targetQty: 2, requireQty: 0 });
    expect(result.totalAmount).toBe(200_000);
  });

  it("the companion requirement: requireMinQty is inclusive and counts all required groups together", () => {
    const program = makeProgram(groups, [discountRule({ requireGroupIds: ["g-b", "g-c"], requireMinQty: 2 })]);
    const one = calculateOrder(program, order([line("g-a", "A", 1, 100_000), line("g-b", "B", 1, 50_000)]));
    expect(discountOf(one, "r-disc")).toMatchObject({ eligible: false, requireQty: 1 });
    expect(one.lines[0].unitPrice).toBe(100_000);

    const two = calculateOrder(
      program,
      order([line("g-a", "A", 1, 100_000), line("g-b", "B", 1, 50_000), line("g-c", "C", 1, 50_000)]),
    );
    expect(discountOf(two, "r-disc")).toMatchObject({ eligible: true, requireQty: 2 });
    expect(two.lines.map((l) => l.unitPrice)).toEqual([90_000, 50_000, 50_000]);
  });

  it("no companion requirement when requireMinQty is 0 or requireGroupIds is empty", () => {
    const zero = makeProgram(groups, [discountRule({ requireGroupIds: ["g-b"], requireMinQty: 0 })]);
    expect(discountOf(calculateOrder(zero, order([line("g-a", "A", 1, 100_000)])), "r-disc").eligible).toBe(true);
    const empty = makeProgram(groups, [discountRule({ requireGroupIds: [], requireMinQty: 5 })]);
    expect(discountOf(calculateOrder(empty, order([line("g-a", "A", 1, 100_000)])), "r-disc").eligible).toBe(true);
  });

  it("nothing bought in the target groups → not eligible, and no issue at all", () => {
    const program = makeProgram(groups, [discountRule({ minQty: 2, requireGroupIds: ["g-b"], requireMinQty: 1 })]);
    const result = calculateOrder(program, order([line("g-b", "B", 5, 100_000)]));
    const d = discountOf(result, "r-disc");
    expect(d).toMatchObject({ eligible: false, targetQty: 0, savedAmount: 0 });
    expect(d.reason).not.toBe("");
    expect(result.issues).toEqual([]);
    expect(result.totalAmount).toBe(500_000);
  });

  it("the info of a rule that is not met names every missing condition", () => {
    const program = makeProgram(groups, [discountRule({ minQty: 3, requireGroupIds: ["g-b"], requireMinQty: 2 })]);
    const result = calculateOrder(program, order([line("g-a", "A", 1, 100_000)]));
    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0];
    expect(issue).toMatchObject({ level: "info", ruleId: "r-disc" });
    expect(issue.message).toContain("Danh mục g-a");
    expect(issue.message).toContain("Danh mục g-b");
    expect(discountOf(result, "r-disc").reason).not.toBe("");
  });

  it("two rules on the same group: each line gets the lowest price, whatever the order of the rules", () => {
    const tenWholesale = discountRule({ id: "r-w", discountPercent: 10, discountBasis: "wholesale" });
    const thirtyRetail = discountRule({ id: "r-r", discountPercent: 30, discountBasis: "retail" });
    // X: wholesale 100.000, retail 150.000 → 90.000 by r-w, 105.000 by r-r → r-w wins.
    // Y: wholesale 100.000, retail 110.000 → 90.000 by r-w,  77.000 by r-r → r-r wins.
    const lines = [line("g-a", "X", 2, 100_000, 150_000), line("g-a", "Y", 3, 100_000, 110_000)];

    for (const rules of [
      [tenWholesale, thirtyRetail],
      [thirtyRetail, tenWholesale],
    ]) {
      const result = calculateOrder(makeProgram(groups, rules), order(lines));
      expect(result.lines.map((l) => l.unitPrice)).toEqual([90_000, 77_000]);
      expect(result.lines.map((l) => l.discountRuleId)).toEqual(["r-w", "r-r"]);
      expect(result.lines.map((l) => l.discountPercent)).toEqual([10, 30]);
      expect(discountOf(result, "r-w")).toMatchObject({ eligible: true, savedAmount: 20_000 });
      expect(discountOf(result, "r-r")).toMatchObject({ eligible: true, savedAmount: 69_000 });
      expect(result.totalAmount).toBe(411_000);
      expect(result.discountAmount).toBe(89_000);
      expect(result.rules.map((r) => r.ruleId)).toEqual(rules.map((r) => r.id));
    }
  });

  it("two rules: one that is not eligible never lowers the price", () => {
    const big = discountRule({ id: "r-big", discountPercent: 50, minQty: 10 });
    const small = discountRule({ id: "r-small", discountPercent: 5 });
    const result = calculateOrder(makeProgram(groups, [big, small]), order([line("g-a", "A", 2, 100_000)]));
    expect(result.lines[0]).toMatchObject({ unitPrice: 95_000, discountRuleId: "r-small" });
    expect(discountOf(result, "r-big")).toMatchObject({ eligible: false, savedAmount: 0 });
    expect(discountOf(result, "r-small")).toMatchObject({ eligible: true, savedAmount: 10_000 });
  });

  it("a discount on the retail price that ends above wholesale never raises the price", () => {
    // 20% off retail 150.000 = 120.000, but the dealer already pays wholesale 100.000.
    const program = makeProgram(groups, [discountRule({ discountPercent: 20, discountBasis: "retail" })]);
    const result = calculateOrder(program, order([line("g-a", "A", 4, 100_000, 150_000)]));
    expect(result.lines[0]).toMatchObject({ unitPrice: 100_000, amount: 400_000, discountRuleId: null, discountPercent: null });
    expect(result.discountAmount).toBe(0);
    expect(discountOf(result, "r-disc").savedAmount).toBe(0);
    expect(result.hasError).toBe(false);
    // The conditions are met, but nothing was reduced: the explanation must not claim the discount was applied.
    expect(discountOf(result, "r-disc").eligible).toBe(true);
    expect(discountOf(result, "r-disc").reason).not.toMatch(/Đã áp dụng/);
  });

  it("the explanation says “applied” only for a rule that really lowered a price", () => {
    // 10% off wholesale gives 90.000; 30% off retail 150.000 gives 105.000 → the second rule changes nothing.
    const winner = discountRule({ id: "r-w", discountPercent: 10, discountBasis: "wholesale" });
    const loser = discountRule({ id: "r-r", discountPercent: 30, discountBasis: "retail" });
    const result = calculateOrder(makeProgram(groups, [winner, loser]), order([line("g-a", "X", 2, 100_000, 150_000)]));
    expect(discountOf(result, "r-w")).toMatchObject({ eligible: true, savedAmount: 20_000 });
    expect(discountOf(result, "r-w").reason).toMatch(/Đã áp dụng giảm 10% trên giá sỉ/);
    expect(discountOf(result, "r-r")).toMatchObject({ eligible: true, savedAmount: 0 });
    expect(discountOf(result, "r-r").reason).not.toMatch(/Đã áp dụng/);
    expect(discountOf(result, "r-r").reason).not.toBe("");
  });

  it("a discount on the retail price that lands exactly on wholesale changes nothing", () => {
    // 50% off retail 200.000 = 100.000 = wholesale.
    const program = makeProgram(groups, [discountRule({ discountPercent: 50, discountBasis: "retail" })]);
    const result = calculateOrder(program, order([line("g-a", "A", 1, 100_000, 200_000)]));
    expect(result.lines[0]).toMatchObject({ unitPrice: 100_000, discountRuleId: null });
    expect(result.discountAmount).toBe(0);
  });

  it.each([0, -10, 101, Number.NaN])("discountPercent %d is a configuration problem: warning, prices untouched", (percent) => {
    const program = makeProgram(groups, [discountRule({ discountPercent: percent })]);
    const result = calculateOrder(program, order([line("g-a", "A", 2, 100_000)]));
    expect(result.lines[0]).toMatchObject({ unitPrice: 100_000, discountRuleId: null });
    expect(result.totalAmount).toBe(200_000);
    expect(discountOf(result, "r-disc")).toMatchObject({ eligible: false, savedAmount: 0 });
    expect(warnings(result)).toHaveLength(1);
    expect(warnings(result)[0].ruleId).toBe("r-disc");
    expect(result.hasError).toBe(false);
  });

  it("a rule without target groups is a configuration problem: warning, no crash", () => {
    const program = makeProgram(groups, [discountRule({ targetGroupIds: [] })]);
    const result = calculateOrder(program, order([line("g-a", "A", 2, 100_000)]));
    expect(result.totalAmount).toBe(200_000);
    expect(discountOf(result, "r-disc").eligible).toBe(false);
    expect(warnings(result)).toHaveLength(1);
  });

  it("the discounted amount is what counts as revenue for a gift tier", () => {
    // 105 × 100.000 = 10.500.000 at wholesale, but 10% off leaves 9.450.000 — under the 10M tier.
    const withDiscount = makeProgram(
      [group("g-a"), group("g-gift")],
      [tierRule({ sourceGroupIds: ["g-a"] }), discountRule()],
    );
    const result = calculateOrder(withDiscount, order([line("g-a", "A", 105, 100_000)]));
    expect(result.totalAmount).toBe(9_450_000);
    expect(tierOf(result, "r-tier")).toMatchObject({ revenue: 9_450_000, tierIndex: -1, amountToNextTier: 550_000 });

    const withoutDiscount = makeProgram([group("g-a"), group("g-gift")], [tierRule({ sourceGroupIds: ["g-a"] })]);
    expect(tierOf(calculateOrder(withoutDiscount, order([line("g-a", "A", 105, 100_000)])), "r-tier")).toMatchObject({
      revenue: 10_500_000,
      tierIndex: 0,
    });
  });
});

// ───────────────────────── Tier gift ─────────────────────────

describe("tier_gift rule", () => {
  const groups = [group("g-src"), group("g-gift"), group("g-other")];
  /** One line in the source group worth exactly `revenue`. */
  const revenueLine = (revenue: number) => line("g-src", "S", 1, revenue);

  it("tiers given in any order are sorted by min; the reached tier is the highest one with revenue ≥ min", () => {
    const rule = tierRule({ tiers: [tier(50_000_000, 5_000_000), tier(10_000_000, 1_000_000), tier(20_000_000, 2_000_000)] });
    const program = makeProgram(groups, [rule]);
    const result = calculateOrder(program, order([revenueLine(25_000_000)]));
    const t = tierOf(result, "r-tier");
    expect(t.tiers.map((x) => x.min)).toEqual([10_000_000, 20_000_000, 50_000_000]);
    expect(t.tierIndex).toBe(1);
    expect(t.tier?.min).toBe(20_000_000);
    expect(t.budget).toBe(2_000_000);
    expect(t.nextTier?.min).toBe(50_000_000);
    expect(t.amountToNextTier).toBe(25_000_000);
    // The rule itself is not reordered.
    expect(rule.tiers.map((x) => x.min)).toEqual([50_000_000, 10_000_000, 20_000_000]);
  });

  it.each([
    [1, -1, 0, 9_999_999],
    [9_999_999, -1, 0, 1],
    [10_000_000, 0, 1_000_000, 10_000_000],
    [10_000_001, 0, 1_000_000, 9_999_999],
    [19_999_999, 0, 1_000_000, 1],
    [20_000_000, 1, 2_500_000, 0],
    [999_999_999, 1, 2_500_000, 0],
  ])("boundary: revenue %d → tier index %d, budget %d, %d to the next tier", (revenue, tierIndex, budget, toNext) => {
    const program = makeProgram(groups, [tierRule()]);
    const t = tierOf(calculateOrder(program, order([revenueLine(revenue)])), "r-tier");
    expect(t.tierIndex).toBe(tierIndex);
    expect(t.budget).toBe(budget);
    expect(t.amountToNextTier).toBe(toNext);
  });

  it("no tier when revenue is 0, even with a tier that starts at 0; and no issue for an order that buys nothing there", () => {
    const program = makeProgram(groups, [tierRule({ tiers: [tier(0, 500_000), tier(10_000_000, 1_000_000)] })]);
    const result = calculateOrder(program, order([line("g-other", "O", 3, 100_000)]));
    const t = tierOf(result, "r-tier");
    expect(t).toMatchObject({ revenue: 0, tierIndex: -1, tier: null, budget: 0, used: 0, remaining: 0, giftQty: 0, ok: true });
    expect(t.nextTier?.min).toBe(0);
    expect(result.issues).toEqual([]);

    // One đồng of revenue reaches the tier that starts at 0.
    expect(tierOf(calculateOrder(program, order([revenueLine(1)])), "r-tier")).toMatchObject({ tierIndex: 0, budget: 500_000 });
  });

  it("the highest tier has no next tier and gives no “buy more” info", () => {
    const program = makeProgram(groups, [tierRule()]);
    const result = calculateOrder(program, order([revenueLine(30_000_000)], [gift("r-tier", "g-gift", "Q", 1, 2_500_000)]));
    const t = tierOf(result, "r-tier");
    expect(t.nextTier).toBeNull();
    expect(t.amountToNextTier).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("a tier reached with a next tier above gives one info with the missing amount", () => {
    const program = makeProgram(groups, [tierRule()]);
    const result = calculateOrder(program, order([revenueLine(12_345_678)], [gift("r-tier", "g-gift", "Q", 1, 500_000)]));
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: "info", ruleId: "r-tier" });
    expect(result.issues[0].message).toMatch(/mua thêm 7\.654\.322 đ để đạt mức 20\.000\.000 đ/);
  });

  it("percent budget = revenue × percent / 100, rounded down", () => {
    const rule = tierRule({ tiers: [tier(1_000_000, 15, { limitType: "percent" })] });
    const program = makeProgram(groups, [rule]);
    // 9.999.999 × 15% = 1.499.999,85
    expect(tierOf(calculateOrder(program, order([revenueLine(9_999_999)])), "r-tier").budget).toBe(1_499_999);
    // 8.247.275 × 15% = 1.237.091,25
    expect(tierOf(calculateOrder(program, order([revenueLine(8_247_275)])), "r-tier").budget).toBe(1_237_091);
    // 10.000.000 × 15% = 1.500.000 exactly
    expect(tierOf(calculateOrder(program, order([revenueLine(10_000_000)])), "r-tier").budget).toBe(1_500_000);
  });

  it("a gift worth exactly the percent budget is fine, one đồng more is not", () => {
    const rule = tierRule({ tiers: [tier(1_000_000, 15, { limitType: "percent" })] });
    const program = makeProgram(groups, [rule]);
    const exact = calculateOrder(program, order([revenueLine(9_999_999)], [gift("r-tier", "g-gift", "Q", 1, 1_499_999)]));
    expect(exact.hasError).toBe(false);
    expect(tierOf(exact, "r-tier")).toMatchObject({ used: 1_499_999, remaining: 0, ok: true });
    const over = calculateOrder(program, order([revenueLine(9_999_999)], [gift("r-tier", "g-gift", "Q", 1, 1_500_000)]));
    expect(over.hasError).toBe(true);
    expect(tierOf(over, "r-tier")).toMatchObject({ used: 1_500_000, remaining: -1, ok: false });
  });

  it("gift value follows giftPriceBasis: retail or wholesale price × quantity", () => {
    const gifts = [gift("r-tier", "g-gift", "Q1", 2, 300_000, 450_000), gift("r-tier", "g-gift", "Q2", 1, 200_000, 250_000)];
    const lines = [revenueLine(10_000_000)]; // budget 1.000.000

    const wholesale = calculateOrder(makeProgram(groups, [tierRule({ giftPriceBasis: "wholesale" })]), order(lines, gifts));
    expect(tierOf(wholesale, "r-tier")).toMatchObject({ used: 800_000, remaining: 200_000, giftQty: 3, ok: true });
    expect(wholesale.gifts.map((g) => [g.sku, g.qty, g.unitValue, g.value])).toEqual([
      ["Q1", 2, 300_000, 600_000],
      ["Q2", 1, 200_000, 200_000],
    ]);
    expect(wholesale.giftValue).toBe(800_000);
    expect(wholesale.hasError).toBe(false);

    const retail = calculateOrder(makeProgram(groups, [tierRule({ giftPriceBasis: "retail" })]), order(lines, gifts));
    expect(tierOf(retail, "r-tier")).toMatchObject({ used: 1_150_000, remaining: -150_000, ok: false });
    expect(retail.gifts.map((g) => g.unitValue)).toEqual([450_000, 250_000]);
    expect(retail.hasError).toBe(true);
  });

  it("budget: equal is fine, one đồng over is an error", () => {
    const program = makeProgram(groups, [tierRule()]);
    const lines = [revenueLine(10_000_000)];
    const equal = calculateOrder(program, order(lines, [gift("r-tier", "g-gift", "Q", 4, 250_000)]));
    expect(equal.hasError).toBe(false);
    expect(tierOf(equal, "r-tier")).toMatchObject({ used: 1_000_000, remaining: 0, ok: true });

    const over = calculateOrder(program, order(lines, [gift("r-tier", "g-gift", "Q", 1, 1_000_001)]));
    expect(errors(over)).toHaveLength(1);
    expect(errors(over)[0].ruleId).toBe("r-tier");
    expect(tierOf(over, "r-tier")).toMatchObject({ used: 1_000_001, remaining: -1, ok: false });
  });

  it("maxQty: equal is fine, one more is an error; null means no quantity limit", () => {
    const limited = makeProgram(groups, [tierRule({ tiers: [tier(10_000_000, 1_000_000, { maxQty: 2 })] })]);
    const lines = [revenueLine(10_000_000)];
    const two = calculateOrder(limited, order(lines, [gift("r-tier", "g-gift", "Q1", 1, 1_000), gift("r-tier", "g-gift", "Q2", 1, 1_000)]));
    expect(two.hasError).toBe(false);
    expect(tierOf(two, "r-tier")).toMatchObject({ giftQty: 2, maxQty: 2, ok: true });

    const three = calculateOrder(limited, order(lines, [gift("r-tier", "g-gift", "Q1", 2, 1_000), gift("r-tier", "g-gift", "Q2", 1, 1_000)]));
    expect(errors(three)).toHaveLength(1);
    expect(tierOf(three, "r-tier")).toMatchObject({ giftQty: 3, ok: false });

    const unlimited = makeProgram(groups, [tierRule()]);
    const many = calculateOrder(unlimited, order(lines, [gift("r-tier", "g-gift", "Q1", 1000, 1_000)]));
    expect(many.hasError).toBe(false);
    expect(tierOf(many, "r-tier")).toMatchObject({ giftQty: 1000, used: 1_000_000, maxQty: null });
  });

  it("allowedSkus: only listed SKUs may be chosen, compared without regard to case and spaces", () => {
    const rule = tierRule({ tiers: [tier(10_000_000, 1_000_000, { allowedSkus: ["P-AYPT399-4", " p-aypt455-4 "] })] });
    const program = makeProgram(groups, [rule]);
    const lines = [revenueLine(10_000_000)];

    const listed = calculateOrder(
      program,
      order(lines, [gift("r-tier", "g-gift", "p-aypt399-4", 1, 1_000), gift("r-tier", "g-gift", "P-AYPT455-4", 1, 1_000)]),
    );
    expect(listed.hasError).toBe(false);

    const notListed = calculateOrder(
      program,
      order(lines, [gift("r-tier", "g-gift", "P-AYPT399-4", 1, 1_000), gift("r-tier", "g-gift", "P-AYPT563-4", 1, 1_000)]),
    );
    expect(errors(notListed)).toHaveLength(1);
    expect(errors(notListed)[0].message).toContain("P-AYPT563-4");
    expect(errors(notListed)[0].message).not.toContain("P-AYPT399-4");
    expect(tierOf(notListed, "r-tier").ok).toBe(false);
  });

  it("an empty allowedSkus list is read literally — nothing may be chosen (the rule editor stores null for “all”, never [])", () => {
    // Documents the current reading. Whether [] should rather mean “no restriction” is a product decision.
    const rule = tierRule({ tiers: [tier(10_000_000, 1_000_000, { allowedSkus: [] })] });
    const program = makeProgram(groups, [rule]);
    const result = calculateOrder(program, order([revenueLine(10_000_000)], [gift("r-tier", "g-gift", "Q", 1, 1_000)]));
    expect(result.hasError).toBe(true);
    expect(tierOf(result, "r-tier").allowedSkus).toEqual([]);
  });

  it("a tier whose limit is not a usable number gives no budget, so gifts are refused rather than unlimited", () => {
    for (const limitValue of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      for (const limitType of ["amount", "percent"] as const) {
        const rule = tierRule({ tiers: [tier(10_000_000, limitValue, { limitType })] });
        const result = calculateOrder(
          makeProgram(groups, [rule]),
          order([revenueLine(10_000_000)], [gift("r-tier", "g-gift", "Q", 5, 1_000)]),
        );
        const t = tierOf(result, "r-tier");
        expect(t.budget, `${limitType} ${limitValue}`).toBe(0);
        expect(t.ok, `${limitType} ${limitValue}`).toBe(false);
        expect(result.hasError, `${limitType} ${limitValue}`).toBe(true);
      }
    }
  });

  it("the restrictions of a lower tier no longer apply once a higher tier is reached", () => {
    const rule = tierRule({
      tiers: [tier(10_000_000, 1_000_000, { maxQty: 1, allowedSkus: ["ONLY-1"] }), tier(20_000_000, 2_500_000)],
    });
    const program = makeProgram(groups, [rule]);
    const result = calculateOrder(
      program,
      order([revenueLine(20_000_000)], [gift("r-tier", "g-gift", "ANY-1", 2, 500_000), gift("r-tier", "g-gift", "ANY-2", 3, 500_000)]),
    );
    expect(result.hasError).toBe(false);
    expect(tierOf(result, "r-tier")).toMatchObject({ used: 2_500_000, remaining: 0, giftQty: 5, maxQty: null, allowedSkus: null });
  });

  it("a gift from another group than giftGroupId is an error", () => {
    const program = makeProgram(groups, [tierRule()]);
    const result = calculateOrder(
      program,
      order([revenueLine(10_000_000)], [gift("r-tier", "g-gift", "Q1", 1, 1_000), gift("r-tier", "g-other", "Q2", 1, 1_000)]),
    );
    expect(errors(result)).toHaveLength(1);
    expect(errors(result)[0].message).toContain("Q2");
    expect(errors(result)[0].message).not.toContain("Q1");
    expect(tierOf(result, "r-tier").ok).toBe(false);
    // Still listed, so the UI can show and remove it.
    expect(result.gifts.map((g) => g.sku)).toEqual(["Q1", "Q2"]);
  });

  it("gifts chosen with no tier reached are an error, but they are still returned", () => {
    const program = makeProgram(groups, [tierRule()]);
    const result = calculateOrder(program, order([revenueLine(5_000_000)], [gift("r-tier", "g-gift", "Q", 2, 100_000)]));
    expect(errors(result)).toHaveLength(1);
    expect(errors(result)[0].ruleId).toBe("r-tier");
    expect(tierOf(result, "r-tier")).toMatchObject({ tierIndex: -1, budget: 0, used: 200_000, remaining: -200_000, giftQty: 2, ok: false });
    expect(result.gifts).toEqual([{ ruleId: "r-tier", sku: "Q", name: "Quà Q", qty: 2, unitValue: 100_000, value: 200_000, auto: false }]);
    expect(result.orphanGiftIndexes).toEqual([]);
  });

  it("gifts chosen while nothing was bought in the source groups are an error", () => {
    const program = makeProgram(groups, [tierRule()]);
    const result = calculateOrder(program, order([], [gift("r-tier", "g-gift", "Q", 1, 100_000)]));
    expect(result.hasError).toBe(true);
    expect(errors(result)).toHaveLength(1);
  });

  it("tier reached and no gift chosen → one warning; gift rows with quantity 0 count as not chosen", () => {
    const program = makeProgram(groups, [tierRule()]);
    const lines = [revenueLine(20_000_000)];
    const none = calculateOrder(program, order(lines));
    expect(none.issues).toHaveLength(1);
    expect(none.issues[0]).toMatchObject({ level: "warning", ruleId: "r-tier" });
    expect(none.hasError).toBe(false);
    expect(tierOf(none, "r-tier").ok).toBe(true);

    const zeroQty = calculateOrder(program, order(lines, [gift("r-tier", "g-gift", "Q", 0, 100_000)]));
    expect(zeroQty.issues).toHaveLength(1);
    expect(zeroQty.issues[0].level).toBe("warning");
    expect(zeroQty.gifts).toEqual([]);
    expect(zeroQty.orphanGiftIndexes).toEqual([]);
  });

  it("a reached tier whose budget is 0 đ does not ask the rep to choose a gift", () => {
    const program = makeProgram(groups, [tierRule({ tiers: [tier(1_000_000, 0, { limitType: "percent" })] })]);
    const result = calculateOrder(program, order([revenueLine(5_000_000)]));
    expect(tierOf(result, "r-tier")).toMatchObject({ tierIndex: 0, budget: 0, ok: true });
    expect(result.issues).toEqual([]);
  });

  it("gift quantities that are negative, NaN or fractional are sanitised like line quantities", () => {
    const program = makeProgram(groups, [tierRule()]);
    const result = calculateOrder(
      program,
      order(
        [revenueLine(10_000_000)],
        [
          gift("r-tier", "g-gift", "Q1", -3, 100_000),
          gift("r-tier", "g-gift", "Q2", Number.NaN, 100_000),
          gift("r-tier", "g-gift", "Q3", 2.9, 100_000),
        ],
      ),
    );
    expect(result.gifts.map((g) => [g.sku, g.qty, g.value])).toEqual([["Q3", 2, 200_000]]);
    expect(tierOf(result, "r-tier")).toMatchObject({ giftQty: 2, used: 200_000 });
    expect(result.orphanGiftIndexes).toEqual([]);
  });

  it("two tier rules are independent: each one only sees its own revenue and its own gifts", () => {
    const first = tierRule({ id: "r-1", name: "Quy tắc 1", sourceGroupIds: ["g-src"] });
    const second = tierRule({ id: "r-2", name: "Quy tắc 2", sourceGroupIds: ["g-other"], tiers: [tier(1_000_000, 300_000)] });
    const program = makeProgram(groups, [first, second]);
    const result = calculateOrder(
      program,
      order(
        [revenueLine(10_000_000), line("g-other", "O", 1, 1_500_000)],
        [gift("r-1", "g-gift", "Q1", 1, 900_000), gift("r-2", "g-gift", "Q2", 1, 400_000)],
      ),
    );
    expect(tierOf(result, "r-1")).toMatchObject({ revenue: 10_000_000, used: 900_000, ok: true });
    expect(tierOf(result, "r-2")).toMatchObject({ revenue: 1_500_000, budget: 300_000, used: 400_000, ok: false });
    expect(errors(result)).toHaveLength(1);
    expect(errors(result)[0].ruleId).toBe("r-2");
  });

  it("revenue adds several source groups, and ignores every other group", () => {
    const program = makeProgram(groups, [tierRule({ sourceGroupIds: ["g-src", "g-other"] })]);
    const result = calculateOrder(
      program,
      order([line("g-src", "S", 2, 3_000_000), line("g-other", "O", 1, 4_500_000), line("g-gift", "G", 10, 9_000_000)]),
    );
    expect(tierOf(result, "r-tier")).toMatchObject({ revenue: 10_500_000, tierIndex: 0 });
    expect(result.totalAmount).toBe(100_500_000);
  });

  it("missing configuration: no source group, no gift group or no tier → warning, no crash, gifts refused", () => {
    const lines = [revenueLine(50_000_000)];
    const chosen = [gift("r-tier", "g-gift", "Q", 1, 1_000)];

    for (const broken of [tierRule({ sourceGroupIds: [] }), tierRule({ tiers: [] }), tierRule({ giftGroupId: null })]) {
      const program = makeProgram(groups, [broken]);
      const empty = calculateOrder(program, order(lines));
      expect(warnings(empty).some((w) => w.ruleId === "r-tier")).toBe(true);
      expect(empty.hasError).toBe(false);

      // A rule that is not fully set up must not hand out gifts.
      const withGift = calculateOrder(program, order(lines, chosen));
      expect(withGift.hasError).toBe(true);
      expect(tierOf(withGift, "r-tier").ok).toBe(false);
    }
  });

  it("a rule without tiers reports no tier and no next tier", () => {
    const program = makeProgram(groups, [tierRule({ tiers: [] })]);
    const t = tierOf(calculateOrder(program, order([revenueLine(50_000_000)])), "r-tier");
    expect(t).toMatchObject({ tiers: [], tierIndex: -1, tier: null, nextTier: null, amountToNextTier: 0, budget: 0 });
  });
});

// ───────────────────────── Buy X get Y ─────────────────────────

describe("buy_x_get_y rule", () => {
  const groups = [group("g-a"), group("g-b"), group("g-gift")];

  describe("giftMode same", () => {
    it.each([
      [1, 1, 3, 3],
      [2, 1, 5, 2],
      [2, 1, 1, 0],
      [2, 1, 4, 2],
      [3, 2, 7, 4],
      [5, 1, 4, 0],
      [10, 3, 25, 6],
    ])("buy %d get %d with quantity %d → %d free", (buyQty, getQty, qty, free) => {
      const program = makeProgram(groups, [bxgyRule({ buyQty, getQty })]);
      const result = calculateOrder(program, order([line("g-a", "A", qty, 100_000, 150_000)]));
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ sourceQty: qty, entitledQty: free, chosenQty: 0, remainingQty: 0, giftGroupId: null, ok: true });
      if (free === 0) {
        expect(result.gifts).toEqual([]);
      } else {
        expect(result.gifts).toEqual([
          { ruleId: "r-bxgy", sku: "A", name: "Sản phẩm A", qty: free, unitValue: 100_000, value: 100_000 * free, auto: true },
        ]);
      }
      expect(result.totalAmount).toBe(100_000 * qty); // free units are not charged
      expect(result.issues).toEqual([]);
    });

    it("is counted per line, never pooled over different products", () => {
      const program = makeProgram(groups, [bxgyRule({ buyQty: 2, getQty: 1 })]);
      const result = calculateOrder(
        program,
        order([line("g-a", "A", 1, 100_000), line("g-a", "B", 1, 100_000), line("g-a", "C", 5, 200_000), line("g-b", "D", 8, 100_000)]),
      );
      expect(result.gifts.map((g) => [g.sku, g.qty, g.value])).toEqual([["C", 2, 400_000]]);
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ sourceQty: 7, entitledQty: 2 });
    });

    it("free units are valued at wholesale even when the line itself was discounted", () => {
      const program = makeProgram(groups, [discountRule({ discountPercent: 20 }), bxgyRule()]);
      const result = calculateOrder(program, order([line("g-a", "A", 2, 100_000, 150_000)]));
      expect(result.lines[0].unitPrice).toBe(80_000);
      expect(result.gifts).toEqual([
        { ruleId: "r-bxgy", sku: "A", name: "Sản phẩm A", qty: 2, unitValue: 100_000, value: 200_000, auto: true },
      ]);
    });

    it("gift rows pointing at a “same” rule are orphans: the rep cannot choose there", () => {
      const program = makeProgram(groups, [bxgyRule()]);
      const result = calculateOrder(program, order([line("g-a", "A", 2, 100_000)], [gift("r-bxgy", "g-gift", "Q", 1, 50_000)]));
      expect(result.orphanGiftIndexes).toEqual([0]);
      expect(result.hasError).toBe(true);
      expect(result.gifts.map((g) => g.sku)).toEqual(["A"]);
    });
  });

  describe("giftMode text", () => {
    it("pools the quantity of all source groups: floor(total / buyQty) × getQty of the named gift, worth 0", () => {
      const program = makeProgram(groups, [bxgyRule({ giftMode: "text", giftText: "Cước N65", sourceGroupIds: ["g-a", "g-b"], buyQty: 3, getQty: 1 })]);
      const result = calculateOrder(
        program,
        order([line("g-a", "A", 1, 100_000), line("g-b", "B", 2, 100_000), line("g-gift", "G", 30, 100_000)]),
      );
      expect(result.gifts).toEqual([{ ruleId: "r-bxgy", sku: "", name: "Cước N65", qty: 1, unitValue: 0, value: 0, auto: true }]);
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ giftMode: "text", sourceQty: 3, entitledQty: 1, giftGroupId: null, ok: true });
      expect(result.giftValue).toBe(0);
      expect(result.issues).toEqual([]);
    });

    it.each([
      [2, 3, 5, 6],
      [2, 3, 1, 0],
      [1, 2, 4, 8],
      [4, 1, 11, 2],
    ])("buy %d get %d with total quantity %d → %d", (buyQty, getQty, qty, entitled) => {
      const program = makeProgram(groups, [bxgyRule({ giftMode: "text", giftText: "Bao vợt", buyQty, getQty })]);
      const result = calculateOrder(program, order([line("g-a", "A", qty, 100_000)]));
      expect(bxgyOf(result, "r-bxgy").entitledQty).toBe(entitled);
      expect(result.giftQty).toBe(entitled);
      expect(result.gifts).toHaveLength(entitled > 0 ? 1 : 0);
    });

    it("an unnamed text gift still shows up under a generic name; surrounding spaces are trimmed", () => {
      const unnamed = makeProgram(groups, [bxgyRule({ giftMode: "text", giftText: "   " })]);
      expect(calculateOrder(unnamed, order([line("g-a", "A", 1, 100_000)])).gifts[0].name).toBe("Quà tặng");
      const padded = makeProgram(groups, [bxgyRule({ giftMode: "text", giftText: "  Cước N65 " })]);
      expect(calculateOrder(padded, order([line("g-a", "A", 1, 100_000)])).gifts[0].name).toBe("Cước N65");
    });

    it("without giftTextValue a text gift is worth 0 đ", () => {
      const rule = bxgyRule({ giftMode: "text", giftText: "Cước N65", buyQty: 1, getQty: 1 });
      expect("giftTextValue" in rule).toBe(false);
      const result = calculateOrder(makeProgram(groups, [rule]), order([line("g-a", "A", 2, 100_000)]));
      expect(result.gifts).toEqual([{ ruleId: "r-bxgy", sku: "", name: "Cước N65", qty: 2, unitValue: 0, value: 0, auto: true }]);
      expect(result.giftValue).toBe(0);
    });

    it("giftTextValue 150.000 with 3 entitled → unit 150.000, value 450.000, giftValue 450.000; amount to pay unchanged", () => {
      const plain = bxgyRule({ giftMode: "text", giftText: "Cước N65", buyQty: 1, getQty: 1 });
      const valued = bxgyRule({ giftMode: "text", giftText: "Cước N65", buyQty: 1, getQty: 1, giftTextValue: 150_000 });
      const lines = [line("g-a", "A", 3, 100_000)];
      const without = calculateOrder(makeProgram(groups, [plain]), order(lines));
      const result = calculateOrder(makeProgram(groups, [valued]), order(lines));
      expect(bxgyOf(result, "r-bxgy").entitledQty).toBe(3);
      expect(result.gifts).toEqual([
        { ruleId: "r-bxgy", sku: "", name: "Cước N65", qty: 3, unitValue: 150_000, value: 450_000, auto: true },
      ]);
      expect(result.giftQty).toBe(3);
      expect(result.giftValue).toBe(450_000);
      expect(result.totalAmount).toBe(300_000);
      expect(result.totalAmount).toBe(without.totalAmount);
      expect(result.discountAmount).toBe(without.discountAmount);
    });
  });

  describe("giftMode group", () => {
    const rule = bxgyRule({ giftMode: "group", giftGroupId: "g-gift", buyQty: 2, getQty: 1 });
    const program = makeProgram(groups, [rule]);
    const lines = [line("g-a", "A", 3, 100_000), line("g-a", "B", 4, 100_000)]; // 7 bought → 3 gifts

    it("entitlement is floor(total source quantity / buyQty) × getQty; nothing chosen yet → warning", () => {
      const result = calculateOrder(program, order(lines));
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ giftMode: "group", sourceQty: 7, entitledQty: 3, chosenQty: 0, remainingQty: 3, giftGroupId: "g-gift", ok: true });
      expect(result.gifts).toEqual([]);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ level: "warning", ruleId: "r-bxgy" });
      expect(result.hasError).toBe(false);
    });

    it("fewer gifts than entitled → warning; chosen gifts are returned at wholesale value, auto = false", () => {
      const result = calculateOrder(program, order(lines, [gift("r-bxgy", "g-gift", "Q1", 2, 50_000, 80_000)]));
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ entitledQty: 3, chosenQty: 2, remainingQty: 1, ok: true });
      expect(result.gifts).toEqual([{ ruleId: "r-bxgy", sku: "Q1", name: "Quà Q1", qty: 2, unitValue: 50_000, value: 100_000, auto: false }]);
      expect(warnings(result)).toHaveLength(1);
      expect(result.hasError).toBe(false);
    });

    it("exactly the entitled number → no issue", () => {
      const result = calculateOrder(
        program,
        order(lines, [gift("r-bxgy", "g-gift", "Q1", 2, 50_000), gift("r-bxgy", "g-gift", "Q2", 1, 70_000)]),
      );
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ entitledQty: 3, chosenQty: 3, remainingQty: 0, ok: true });
      expect(result.issues).toEqual([]);
      expect(result.giftQty).toBe(3);
      expect(result.giftValue).toBe(170_000);
    });

    it("more gifts than entitled → error", () => {
      const result = calculateOrder(program, order(lines, [gift("r-bxgy", "g-gift", "Q1", 4, 50_000)]));
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ entitledQty: 3, chosenQty: 4, remainingQty: -1, ok: false });
      expect(errors(result)).toHaveLength(1);
      expect(errors(result)[0].ruleId).toBe("r-bxgy");
      expect(result.hasError).toBe(true);
      expect(result.gifts).toHaveLength(1); // still shown
    });

    it("gifts chosen with nothing entitled → error", () => {
      const result = calculateOrder(program, order([line("g-a", "A", 1, 100_000)], [gift("r-bxgy", "g-gift", "Q1", 1, 50_000)]));
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ entitledQty: 0, chosenQty: 1, ok: false });
      expect(result.hasError).toBe(true);
    });

    it("a gift from another group than the rule's gift group is an error", () => {
      const result = calculateOrder(
        program,
        order(lines, [gift("r-bxgy", "g-gift", "Q1", 2, 50_000), gift("r-bxgy", "g-b", "X9", 1, 50_000)]),
      );
      expect(errors(result)).toHaveLength(1);
      expect(errors(result)[0].message).toContain("X9");
      expect(bxgyOf(result, "r-bxgy").ok).toBe(false);
    });

    it("nothing bought and nothing chosen → no issue", () => {
      const result = calculateOrder(program, order([line("g-b", "B", 9, 100_000)]));
      expect(result.issues).toEqual([]);
      expect(bxgyOf(result, "r-bxgy")).toMatchObject({ sourceQty: 0, entitledQty: 0, chosenQty: 0, remainingQty: 0 });
    });
  });

  describe("missing configuration", () => {
    const broken: Array<[string, BuyXGetYRule]> = [
      ["buyQty 0", bxgyRule({ buyQty: 0 })],
      ["getQty 0", bxgyRule({ getQty: 0 })],
      ["negative buyQty", bxgyRule({ buyQty: -2 })],
      ["NaN buyQty", bxgyRule({ buyQty: Number.NaN })],
      ["no source group", bxgyRule({ sourceGroupIds: [] })],
      ["text mode, buyQty 0", bxgyRule({ giftMode: "text", giftText: "Cước", buyQty: 0 })],
      ["group mode without gift group", bxgyRule({ giftMode: "group", giftGroupId: null })],
      ["group mode, buyQty 0", bxgyRule({ giftMode: "group", giftGroupId: "g-gift", buyQty: 0 })],
    ];
    it.each(broken)("%s → one warning, no gift, no crash, finite numbers", (_label, rule) => {
      const program = makeProgram(groups, [rule]);
      const result = calculateOrder(program, order([line("g-a", "A", 5, 100_000)]));
      expect(result.gifts).toEqual([]);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ level: "warning", ruleId: "r-bxgy" });
      const r = bxgyOf(result, "r-bxgy");
      expect(r.entitledQty).toBe(0);
      expect(Number.isFinite(r.entitledQty) && Number.isFinite(r.remainingQty) && Number.isFinite(result.giftQty)).toBe(true);
      expect(result.totalAmount).toBe(500_000);
    });

    it("“same” and “text” rules never expose a gift group, even when a stale giftGroupId is left on the rule", () => {
      for (const giftMode of ["same", "text"] as const) {
        const program = makeProgram(groups, [bxgyRule({ giftMode, giftText: "Cước N65", giftGroupId: "g-gift" })]);
        const result = calculateOrder(program, order([line("g-a", "A", 2, 100_000)]));
        expect(bxgyOf(result, "r-bxgy").giftGroupId, giftMode).toBeNull();
        expect(result.issues, giftMode).toEqual([]);
        expect(result.giftQty, giftMode).toBe(2);
      }
    });

    it("group mode that is not set up refuses chosen gifts", () => {
      const program = makeProgram(groups, [bxgyRule({ giftMode: "group", giftGroupId: null })]);
      const result = calculateOrder(program, order([line("g-a", "A", 5, 100_000)], [gift("r-bxgy", "g-gift", "Q", 1, 50_000)]));
      expect(result.hasError).toBe(true);
      expect(bxgyOf(result, "r-bxgy").ok).toBe(false);
    });
  });
});

// ───────────────────────── Orphan gifts ─────────────────────────

describe("orphan gifts", () => {
  const groups = [group("g-src"), group("g-gift"), group("g-a")];

  it("gifts whose rule no longer exists are reported by position, with one error, and left out of the gifts", () => {
    const program = makeProgram(groups, [tierRule()]);
    const result = calculateOrder(
      program,
      order(
        [line("g-src", "S", 1, 10_000_000)],
        [
          gift("r-deleted", "g-gift", "Q0", 1, 100_000),
          gift("r-tier", "g-gift", "Q1", 1, 100_000),
          gift("r-other", "g-gift", "Q2", 3, 100_000),
        ],
      ),
    );
    expect(result.orphanGiftIndexes).toEqual([0, 2]);
    expect(errors(result)).toHaveLength(1);
    expect(errors(result)[0].ruleId).toBeNull();
    expect(result.hasError).toBe(true);
    expect(result.gifts.map((g) => g.sku)).toEqual(["Q1"]);
    expect(result.giftQty).toBe(1);
    expect(result.giftValue).toBe(100_000);
    // The rule that still exists is unaffected.
    expect(tierOf(result, "r-tier")).toMatchObject({ used: 100_000, giftQty: 1, ok: true });
  });

  it("a gift pointing at a rule that does not take chosen gifts (discount, same, text) is an orphan", () => {
    const program = makeProgram(groups, [
      discountRule({ id: "r-d", targetGroupIds: ["g-a"] }),
      bxgyRule({ id: "r-same", giftMode: "same" }),
      bxgyRule({ id: "r-text", giftMode: "text", giftText: "Cước" }),
    ]);
    const result = calculateOrder(
      program,
      order(
        [line("g-a", "A", 1, 100_000)],
        [gift("r-d", "g-gift", "Q0", 1, 1_000), gift("r-same", "g-gift", "Q1", 1, 1_000), gift("r-text", "g-gift", "Q2", 1, 1_000)],
      ),
    );
    expect(result.orphanGiftIndexes).toEqual([0, 1, 2]);
    expect(errors(result)).toHaveLength(1);
    // Only the automatic gifts remain.
    expect(result.gifts.every((g) => g.auto)).toBe(true);
  });

  it("with no program and no frozen rules every chosen gift is an orphan", () => {
    const result = calculateOrder(null, order([line("g-a", "A", 1, 100_000)], [gift("r-x", "g-gift", "Q", 2, 1_000)]));
    expect(result.orphanGiftIndexes).toEqual([0]);
    expect(result.gifts).toEqual([]);
    expect(result.hasError).toBe(true);
  });

  it("a gift row with quantity 0 is ignored, not reported", () => {
    const program = makeProgram(groups, []);
    const result = calculateOrder(program, order([], [gift("r-deleted", "g-gift", "Q", 0, 1_000)]));
    expect(result.orphanGiftIndexes).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.hasError).toBe(false);
  });
});

// ───────────────────────── Where the rules come from ─────────────────────────

describe("rule source: frozen rules, missing program, deleted groups", () => {
  const HE = "seed-km-2026-he";

  it("frozenRules win over the program's current rules", () => {
    const program = seedProgram(HE);
    const lines = [buy(program, "g-he-dm01", "P-AYPT417-5", 3), buy(program, "g-he-dm03", "P-AYPM444-3", 1)];
    const frozen = structuredClone(program.rules);

    // The program is edited after the order was confirmed: discount A is now only 20% off wholesale.
    const edited = structuredClone(program);
    const a = edited.rules.find((r) => r.id === "r-he-a") as DiscountRule;
    a.discountPercent = 20;
    a.discountBasis = "wholesale";

    // A draft follows the edited program: 1.649.455 × 0,8 = 1.319.564.
    expect(calculateOrder(edited, order(lines)).lines[0].unitPrice).toBe(1_319_564);
    // The confirmed order keeps the rules it was confirmed with.
    const confirmed = calculateOrder(edited, order(lines, [], frozen));
    expect(confirmed.lines[0].unitPrice).toBe(1_296_000);
    expect(confirmed.totalAmount).toBe(5_303_782);
    expect(confirmed.giftQty).toBe(3);
  });

  it("frozenRules still apply after every rule was removed from the program", () => {
    const program = seedProgram(HE);
    const lines = [buy(program, "g-he-dm01", "P-AYPT417-5", 3), buy(program, "g-he-dm03", "P-AYPM444-3", 1)];
    const frozen = structuredClone(program.rules);
    const emptied = { ...program, rules: [] };
    expect(calculateOrder(emptied, order(lines)).totalAmount).toBe(6_364_147);
    expect(calculateOrder(emptied, order(lines, [], frozen)).totalAmount).toBe(5_303_782);
  });

  it("an empty frozenRules list means “no rule”, it does not fall back to the program", () => {
    const program = seedProgram(HE);
    const lines = [buy(program, "g-he-dm01", "P-AYPT417-5", 3), buy(program, "g-he-dm03", "P-AYPM444-3", 1)];
    const result = calculateOrder(program, { lines, gifts: [], frozenRules: [] });
    expect(result.rules).toEqual([]);
    expect(result.totalAmount).toBe(6_364_147);
    expect(result.gifts).toEqual([]);
  });

  it.each([null, undefined])("program = %s does not crash: lines are charged at wholesale and a warning says so", (missing) => {
    const result = calculateOrder(missing, order([line("g-a", "A", 2, 100_000, 150_000)]));
    expect(result.totalAmount).toBe(200_000);
    expect(result.totalRetail).toBe(300_000);
    expect(result.rules).toEqual([]);
    expect(result.gifts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: "warning", ruleId: null });
    expect(result.hasError).toBe(false);
  });

  it("program = null with frozenRules: the confirmed order is still calculated from its own rules", () => {
    const program = seedProgram(HE);
    const lines = [buy(program, "g-he-dm01", "P-AYPT417-5", 3), buy(program, "g-he-dm03", "P-AYPM444-3", 1)];
    const result = calculateOrder(null, order(lines, [], structuredClone(program.rules)));
    expect(result.totalAmount).toBe(5_303_782);
    expect(result.giftQty).toBe(3);
    expect(result.hasError).toBe(false);
    expect(warnings(result)).toHaveLength(1);
  });

  it("a confirmed order keeps its promotions when its group is deleted from the program afterwards, and is not told otherwise", () => {
    const program = seedProgram(HE);
    const lines = [buy(program, "g-he-dm01", "P-AYPT417-5", 3), buy(program, "g-he-dm03", "P-AYPM444-3", 1)];
    const frozen = structuredClone(program.rules);
    const afterDelete = removeGroup(program, "g-he-dm01");

    // Confirmed: calculated from the rules it was confirmed with — nothing to warn about.
    const confirmed = calculateOrder(afterDelete, order(lines, [], frozen));
    expect(confirmed.lines[0]).toMatchObject({ unitPrice: 1_296_000, discountRuleId: "r-he-a" });
    expect(confirmed.totalAmount).toBe(5_303_782);
    expect(confirmed.giftQty).toBe(3);
    expect(confirmed.issues).toEqual([]);

    // The same lines on a draft follow the program as it is now: no promotion, and a warning that names the SKU.
    const draft = calculateOrder(afterDelete, order(lines));
    expect(draft.totalAmount).toBe(6_364_147);
    expect(draft.gifts).toEqual([]);
    const about = warnings(draft).filter((w) => w.ruleId === null);
    expect(about).toHaveLength(1);
    expect(about[0].message).toContain("P-AYPT417-5");
    expect(about[0].message).not.toContain("P-AYPM444-3");
    expect(draft.hasError).toBe(false);
  });

  it("lines whose group was deleted are still charged, earn nothing, and are named in a warning", () => {
    const program = makeProgram(
      [group("g-a"), group("g-gift")],
      [discountRule(), bxgyRule({ id: "r-same" }), tierRule({ sourceGroupIds: ["g-a"] })],
    );
    const result = calculateOrder(
      program,
      order([line("g-a", "A", 1, 100_000), line("g-deleted", "GONE-1", 2, 300_000), line("g-deleted", "ZERO-1", 0, 300_000)]),
    );
    expect(result.lines.map((l) => l.unitPrice)).toEqual([90_000, 300_000, 300_000]);
    expect(result.totalAmount).toBe(690_000);
    expect(result.gifts.map((g) => g.sku)).toEqual(["A"]);
    expect(tierOf(result, "r-tier").revenue).toBe(90_000);
    const about = warnings(result).filter((w) => w.ruleId === null);
    expect(about).toHaveLength(1);
    expect(about[0].message).toContain("GONE-1");
    expect(about[0].message).not.toContain("ZERO-1"); // nothing ordered on that line
    expect(result.hasError).toBe(false);
  });
});

// ───────────────────────── Issues ─────────────────────────

describe("issues", () => {
  it("are returned errors first, then warnings, then infos", () => {
    const program = seedProgram("seed-km-2026-he");
    const result = calculateOrder(
      program,
      order(
        [
          buy(program, "g-he-dm01", "P-AYPT417-5", 5), // discount A not met → info
          buy(program, "g-he-dm02", "P-AYPS053-1", 3), // 9.072.000 → B2 tier reached, nothing chosen → warning + info
        ],
        [gift("r-gone", "g-he-dm01", "Q", 1, 1_000)], // orphan → error
      ),
    );
    const levels = result.issues.map((i) => i.level);
    expect(levels).toEqual(["error", "warning", "info", "info"]);
    expect(result.hasError).toBe(true);
  });

  it("hasError is true exactly when there is an error issue", () => {
    const program = seedProgram("seed-km-2026-11");
    const warningOnly = calculateOrder(program, order([buy(program, "g-km11-apply", "P-AYPR285-3", 8)]));
    expect(warningOnly.issues.some((i) => i.level === "warning")).toBe(true);
    expect(warningOnly.hasError).toBe(false);
  });
});

// ───────────────────────── Purity ─────────────────────────

describe("calculateOrder is a pure function", () => {
  it("does not modify the program or the order (deep-frozen inputs)", () => {
    for (const id of ["seed-km-2026-11", "seed-km-2026-he", "seed-bang-gia-sau-ck"]) {
      const program = deepFreeze(seedProgram(id));
      const lines = program.groups.flatMap((g) => g.items.slice(0, 3).map((i) => buy(program, g.id, i.sku, 3)));
      const tierRuleOfProgram = program.rules.find((r) => r.type === "tier_gift") as TierGiftRule | undefined;
      const gifts = tierRuleOfProgram
        ? [pick(program, tierRuleOfProgram.id, tierRuleOfProgram.giftGroupId!, program.groups.find((g) => g.id === tierRuleOfProgram.giftGroupId)!.items[0].sku)]
        : [];
      const input = deepFreeze(order(lines, gifts, structuredClone(program.rules)));
      expect(() => calculateOrder(program, input)).not.toThrow();
    }
  });

  it("gives the same result when called twice", () => {
    const program = seedProgram("seed-km-2026-he");
    const input = order(
      [buy(program, "g-he-dm01", "P-AYPT417-5", 3), buy(program, "g-he-dm02", "P-AYPS053-1", 4), buy(program, "g-he-dm03", "P-AYPM444-3", 1)],
      [pick(program, "r-he-b2", "g-he-dm01", "P-AYPU109-4")],
    );
    expect(calculateOrder(program, input)).toEqual(calculateOrder(program, input));
  });
});

// ───────────────────────── Exported helpers ─────────────────────────

describe("engine helpers", () => {
  it("priceOf picks the retail or the wholesale price", () => {
    const product = { retailPrice: 150_000, wholesalePrice: 100_000 };
    expect(priceOf(product, "retail")).toBe(150_000);
    expect(priceOf(product, "wholesale")).toBe(100_000);
  });

  it("sortTiers sorts ascending by min without touching the input", () => {
    const tiers = [tier(50, 1), tier(10, 1), tier(20, 1)];
    expect(sortTiers(tiers).map((t) => t.min)).toEqual([10, 20, 50]);
    expect(tiers.map((t) => t.min)).toEqual([50, 10, 20]);
    expect(sortTiers([])).toEqual([]);
  });

  it("tierBudget: fixed amount, or percent of revenue rounded down", () => {
    expect(tierBudget(tier(10_000_000, 1_200_000), 99_999_999)).toBe(1_200_000);
    expect(tierBudget(tier(8_000_000, 15, { limitType: "percent" }), 8_247_275)).toBe(1_237_091);
    expect(tierBudget(tier(8_000_000, 27, { limitType: "percent" }), 50_000_000)).toBe(13_500_000);
    expect(tierBudget(tier(8_000_000, 12.5, { limitType: "percent" }), 1_000_001)).toBe(125_000); // 125.000,125
    expect(tierBudget(tier(8_000_000, 15, { limitType: "percent" }), 0)).toBe(0);
    // A limit that is not a usable number is no budget at all.
    expect(tierBudget(tier(8_000_000, Number.NaN), 50_000_000)).toBe(0);
    expect(tierBudget(tier(8_000_000, Number.NaN, { limitType: "percent" }), 50_000_000)).toBe(0);
    expect(tierBudget(tier(8_000_000, -5), 50_000_000)).toBe(0);
  });

  it("describeTierLimit words the limit of a tier", () => {
    expect(describeTierLimit(tier(10_000_000, 3_190_000))).toBe("tặng tối đa 3.190.000 đ");
    expect(describeTierLimit(tier(8_000_000, 15, { limitType: "percent" }))).toBe("tặng tối đa 15% doanh số");
  });

  it("ruleAcceptsChosenGifts: tier_gift and buy_x_get_y in group mode only", () => {
    expect(ruleAcceptsChosenGifts(tierRule())).toBe(true);
    expect(ruleAcceptsChosenGifts(bxgyRule({ giftMode: "group", giftGroupId: "g-gift" }))).toBe(true);
    expect(ruleAcceptsChosenGifts(bxgyRule({ giftMode: "same" }))).toBe(false);
    expect(ruleAcceptsChosenGifts(bxgyRule({ giftMode: "text" }))).toBe(false);
    expect(ruleAcceptsChosenGifts(discountRule())).toBe(false);
  });

  it("giftUnitValue: the tier rule's price basis, wholesale for everything else", () => {
    const product = { retailPrice: 150_000, wholesalePrice: 100_000 };
    expect(giftUnitValue(tierRule({ giftPriceBasis: "retail" }), product)).toBe(150_000);
    expect(giftUnitValue(tierRule({ giftPriceBasis: "wholesale" }), product)).toBe(100_000);
    expect(giftUnitValue(bxgyRule({ giftMode: "group", giftGroupId: "g-gift" }), product)).toBe(100_000);
  });

  it("giftUnitValue agrees with what calculateOrder charges against the budget", () => {
    const program = seedProgram("seed-km-2026-11");
    const rule = program.rules[0];
    const chosen = pick(program, rule.id, "g-km11-gift", "P-AYPT563-4");
    const result = calculateOrder(program, order([buy(program, "g-km11-apply", "P-AYPR285-3", 15)], [chosen]));
    expect(result.gifts[0].unitValue).toBe(giftUnitValue(rule, chosen));
    expect(result.gifts[0].unitValue).toBe(1_380_000);
  });
});

// ───────────────────────── Exact percent arithmetic ─────────────────────────

describe("percent arithmetic is exact to the đồng (no binary floating-point drift)", () => {
  const groups = [group("g-a"), group("g-src"), group("g-gift")];

  it.each([
    // [basis price, percent off, expected price] — each product ends on exactly ,5 and must round up.
    [1_000_050, 55, 450_023], // 450.022,5
    [2_022_550, 55, 910_148], // 910.147,5
    [471_250, 7, 438_263], // 438.262,5
    [250, 7, 233], // 232,5
    [150, 33, 101], // 100,5
    [1_000_090, 65, 350_032], // 350.031,5
    [2_200, 12.25, 1_931], // 1.930,5
  ])("price %d đ less %s percent → %d đ", (price, percent, expected) => {
    const program = makeProgram(groups, [discountRule({ discountPercent: percent })]);
    const result = calculateOrder(program, order([line("g-a", "A", 1, price)]));
    expect(result.lines[0].unitPrice).toBe(expected);
  });

  it.each([
    // [revenue, percent, expected budget] — each product is a whole number of đồng.
    [12_000_000, 2.3, 276_000],
    [8_000_000, 4.1, 328_000],
    [3_000_000, 1.15, 34_500],
    [50_000_000, 2.3, 1_150_000],
    [10_000_000, 12.3, 1_230_000],
  ])("revenue %d đ at %s percent → budget %d đ, and a gift of exactly that value is accepted", (revenue, percent, expected) => {
    const rule = tierRule({ tiers: [tier(1_000_000, percent, { limitType: "percent" })] });
    expect(tierBudget(rule.tiers[0], revenue)).toBe(expected);
    const program = makeProgram(groups, [rule]);
    const result = calculateOrder(program, order([line("g-src", "S", 1, revenue)], [gift("r-tier", "g-gift", "Q", 1, expected)]));
    expect(tierOf(result, "r-tier")).toMatchObject({ budget: expected, used: expected, remaining: 0, ok: true });
    expect(result.hasError).toBe(false);
  });
});

// ───────────────────────── Missing price data ─────────────────────────

describe("missing price data must never turn into free goods", () => {
  const groups = [group("g-a"), group("g-b"), group("g-src"), group("g-gift")];

  it("a retail-price discount leaves a line without retail price at wholesale, and says so", () => {
    // “45% off retail” of an unknown retail price is not 0 đ.
    const program = makeProgram(groups, [discountRule({ discountPercent: 45, discountBasis: "retail" })]);
    const result = calculateOrder(
      program,
      order([line("g-a", "NO-RETAIL", 2, 1_649_455, 0), line("g-a", "PRICED-1", 1, 1_649_455, 2_356_364)]),
    );
    expect(result.lines[0]).toMatchObject({ unitPrice: 1_649_455, amount: 3_298_910, discountRuleId: null, discountPercent: null });
    expect(result.lines[1]).toMatchObject({ unitPrice: 1_296_000, discountRuleId: "r-disc" });
    expect(result.totalAmount).toBe(4_594_910);
    expect(discountOf(result, "r-disc").savedAmount).toBe(353_455);
    const about = warnings(result).filter((w) => w.ruleId === "r-disc");
    expect(about).toHaveLength(1);
    expect(about[0].message).toContain("NO-RETAIL");
    expect(about[0].message).not.toContain("PRICED-1");
    expect(result.hasError).toBe(false);
  });

  it("a line without wholesale price is charged 0 đ — the engine must at least warn about it", () => {
    const program = makeProgram(groups, []);
    const result = calculateOrder(
      program,
      order([line("g-a", "NO-PRICE", 3, 0, 2_000_000), line("g-a", "OK", 1, 100_000), line("g-a", "NOT-ORDERED", 0, 0)]),
    );
    expect(result.totalAmount).toBe(100_000);
    expect(warnings(result)).toHaveLength(1);
    expect(warnings(result)[0].message).toContain("NO-PRICE");
    expect(warnings(result)[0].message).not.toContain("NOT-ORDERED");
    expect(result.hasError).toBe(false);
  });

  it("a gift without a price under the rule's basis cannot be valued → error instead of an unlimited free gift", () => {
    const lines = [line("g-src", "S", 1, 10_000_000)]; // budget 1.000.000
    // Valued at retail, but the gift item has no retail price: 1.000 units would cost “0 đ” of budget.
    const retail = makeProgram(groups, [tierRule({ giftPriceBasis: "retail" })]);
    const noRetail = calculateOrder(retail, order(lines, [gift("r-tier", "g-gift", "NO-RETAIL", 1000, 840_000, 0)]));
    expect(noRetail.hasError).toBe(true);
    expect(tierOf(noRetail, "r-tier").ok).toBe(false);
    expect(errors(noRetail)).toHaveLength(1);
    expect(errors(noRetail)[0].message).toContain("NO-RETAIL");

    // The same gift is fine for a rule that values gifts at wholesale.
    const wholesale = makeProgram(groups, [tierRule({ giftPriceBasis: "wholesale" })]);
    const fine = calculateOrder(wholesale, order(lines, [gift("r-tier", "g-gift", "NO-RETAIL", 1, 840_000, 0)]));
    expect(fine.hasError).toBe(false);
  });
});

// ───────────────────────── Randomised comparison with a reference implementation ─────────────────────────
// A second, deliberately plain implementation of the written business rules (exact integer arithmetic, no shared
// code with the engine) is run against the engine on a few thousand generated orders. Fixed seeds: every run
// tests the same orders, and a failure names the case to replay.

/** Small seeded generator (mulberry32). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Summary {
  unitPrices: number[];
  amounts: number[];
  winners: Array<string | null>;
  totalQty: number;
  totalRetail: number;
  totalWholesale: number;
  totalAmount: number;
  discountAmount: number;
  rules: Array<Record<string, unknown>>;
  gifts: Array<[string, string, number, number, boolean]>;
  giftQty: number;
  giftValue: number;
  orphans: number[];
  issueCounts: Record<string, number>;
  hasError: boolean;
}

const issueKey = (level: CalcIssue["level"], ruleId: string | null) => `${level}|${ruleId ?? "-"}`;

function summarize(result: CalcResult): Summary {
  const issueCounts: Record<string, number> = {};
  for (const issue of result.issues) {
    const key = issueKey(issue.level, issue.ruleId);
    issueCounts[key] = (issueCounts[key] ?? 0) + 1;
  }
  return {
    unitPrices: result.lines.map((l) => l.unitPrice),
    amounts: result.lines.map((l) => l.amount),
    winners: result.lines.map((l) => l.discountRuleId),
    totalQty: result.totalQty,
    totalRetail: result.totalRetail,
    totalWholesale: result.totalWholesale,
    totalAmount: result.totalAmount,
    discountAmount: result.discountAmount,
    rules: result.rules.map((r) => {
      if (r.type === "discount") return { id: r.ruleId, eligible: r.eligible, targetQty: r.targetQty, savedAmount: r.savedAmount };
      if (r.type === "tier_gift") {
        return { id: r.ruleId, revenue: r.revenue, tierIndex: r.tierIndex, budget: r.budget, used: r.used, remaining: r.remaining, giftQty: r.giftQty, ok: r.ok };
      }
      return { id: r.ruleId, sourceQty: r.sourceQty, entitledQty: r.entitledQty, chosenQty: r.chosenQty, remainingQty: r.remainingQty, ok: r.ok };
    }),
    gifts: result.gifts.map((g) => [g.ruleId, g.sku, g.qty, g.value, g.auto]),
    giftQty: result.giftQty,
    giftValue: result.giftValue,
    orphans: result.orphanGiftIndexes,
    issueCounts,
    hasError: result.hasError,
  };
}

/** price × (100 − percent) / 100, half a đồng rounds up. `percent` has at most two decimals. */
function exactPriceAfterDiscount(price: number, percent: number): number {
  return Number((BigInt(price) * BigInt(10000 - Math.round(percent * 100)) + 5000n) / 10000n);
}

/** amount × percent / 100 rounded down. `percent` has at most two decimals. */
function exactShare(amount: number, percent: number): number {
  return Number((BigInt(amount) * BigInt(Math.round(percent * 100))) / 10000n);
}

/** The business rules, written out as plainly as possible. Expects clean input: whole quantities ≥ 0, prices > 0. */
function reference(program: Program, input: OrderInput): Summary {
  const rules = input.frozenRules ?? program.rules;
  const lines = input.lines.map((l) => ({ ...l, unit: l.wholesalePrice, winner: null as string | null }));
  const qtyOf = (groupIds: string[]) => lines.filter((l) => groupIds.includes(l.groupId)).reduce((sum, l) => sum + l.qty, 0);
  const issueCounts: Record<string, number> = {};
  const issue = (level: CalcIssue["level"], ruleId: string | null) => {
    const key = issueKey(level, ruleId);
    issueCounts[key] = (issueCounts[key] ?? 0) + 1;
  };

  // Discounts first: every line of the target groups takes the lowest price any eligible rule offers.
  const discounts = new Map<string, { eligible: boolean; targetQty: number }>();
  for (const rule of rules) {
    if (rule.type !== "discount") continue;
    const targetQty = qtyOf(rule.targetGroupIds);
    const configured = rule.targetGroupIds.length > 0 && rule.discountPercent > 0 && rule.discountPercent <= 100;
    let eligible = false;
    if (!configured) {
      issue("warning", rule.id);
    } else if (targetQty > 0) {
      const needsCompanion = rule.requireGroupIds.length > 0 && rule.requireMinQty > 0;
      eligible =
        (rule.minQty == null || targetQty >= rule.minQty) &&
        (rule.maxQty == null || targetQty <= rule.maxQty) &&
        (!needsCompanion || companionQty(rule, qtyOf) >= rule.requireMinQty);
      if (!eligible) issue("info", rule.id);
    }
    discounts.set(rule.id, { eligible, targetQty });
    if (!eligible) continue;
    for (const l of lines) {
      if (!rule.targetGroupIds.includes(l.groupId)) continue;
      const price = exactPriceAfterDiscount(rule.discountBasis === "retail" ? l.retailPrice : l.wholesalePrice, rule.discountPercent);
      if (price < l.unit) {
        l.unit = price;
        l.winner = rule.id;
      }
    }
  }

  const gifts: Summary["gifts"] = [];
  const ruleSummaries: Summary["rules"] = [];
  for (const rule of rules) {
    if (rule.type === "discount") {
      const state = discounts.get(rule.id)!;
      const savedAmount = lines.filter((l) => l.winner === rule.id).reduce((sum, l) => sum + (l.wholesalePrice - l.unit) * l.qty, 0);
      ruleSummaries.push({ id: rule.id, eligible: state.eligible, targetQty: state.targetQty, savedAmount });
    } else if (rule.type === "tier_gift") {
      const revenue = lines.filter((l) => rule.sourceGroupIds.includes(l.groupId)).reduce((sum, l) => sum + l.unit * l.qty, 0);
      const tiers = [...rule.tiers].sort((a, b) => a.min - b.min);
      let tierIndex = -1;
      if (revenue > 0) tiers.forEach((t, i) => (tierIndex = revenue >= t.min ? i : tierIndex));
      const reached = tierIndex >= 0 ? tiers[tierIndex] : null;
      const budget = !reached ? 0 : reached.limitType === "amount" ? reached.limitValue : exactShare(revenue, reached.limitValue);
      const chosen = input.gifts.filter((g) => g.ruleId === rule.id && g.qty > 0);
      const valueOf = (g: OrderGift) => (rule.giftPriceBasis === "retail" ? g.retailPrice : g.wholesalePrice) * g.qty;
      const used = chosen.reduce((sum, g) => sum + valueOf(g), 0);
      const giftQty = chosen.reduce((sum, g) => sum + g.qty, 0);
      let errorCount = 0;
      if (chosen.length > 0) {
        if (!reached) errorCount++;
        else {
          if (used > budget) errorCount++;
          if (reached.maxQty != null && giftQty > reached.maxQty) errorCount++;
          if (reached.allowedSkus && chosen.some((g) => !reached.allowedSkus!.includes(g.sku))) errorCount++;
        }
        if (!rule.giftGroupId || chosen.some((g) => g.groupId !== rule.giftGroupId)) errorCount++;
      }
      for (let i = 0; i < errorCount; i++) issue("error", rule.id);
      if (rule.sourceGroupIds.length === 0 || !rule.giftGroupId || tiers.length === 0) issue("warning", rule.id);
      if (chosen.length === 0 && reached && budget > 0) issue("warning", rule.id);
      if (tiers[tierIndex + 1] && revenue > 0) issue("info", rule.id);
      for (const g of chosen) gifts.push([rule.id, g.sku, g.qty, valueOf(g), false]);
      ruleSummaries.push({ id: rule.id, revenue, tierIndex, budget, used, remaining: budget - used, giftQty, ok: errorCount === 0 });
    } else {
      const sourceQty = qtyOf(rule.sourceGroupIds);
      const configured =
        rule.buyQty > 0 && rule.getQty > 0 && rule.sourceGroupIds.length > 0 && (rule.giftMode !== "group" || rule.giftGroupId != null);
      if (!configured) issue("warning", rule.id);
      let entitledQty = 0;
      let chosenQty = 0;
      let ok = true;
      if (rule.giftMode === "same") {
        // Theo từng mã: cộng số lượng của mã đó ở mọi dòng thuộc danh mục nguồn; quà tính theo giá sỉ thấp nhất.
        const perSku = new Map<string, { sku: string; qty: number; price: number }>();
        for (const l of configured ? lines : []) {
          if (!rule.sourceGroupIds.includes(l.groupId) || l.qty <= 0) continue;
          const key = l.sku.trim().toUpperCase();
          const e = perSku.get(key);
          if (e) {
            e.qty += l.qty;
            e.price = Math.min(e.price, l.wholesalePrice);
          } else perSku.set(key, { sku: l.sku, qty: l.qty, price: l.wholesalePrice });
        }
        for (const e of perSku.values()) {
          const free = Math.floor(e.qty / rule.buyQty) * rule.getQty;
          if (free === 0) continue;
          entitledQty += free;
          gifts.push([rule.id, e.sku, free, e.price * free, true]);
        }
      } else {
        entitledQty = configured ? Math.floor(sourceQty / rule.buyQty) * rule.getQty : 0;
        if (rule.giftMode === "text") {
          if (entitledQty > 0) gifts.push([rule.id, "", entitledQty, (rule.giftTextValue ?? 0) * entitledQty, true]);
        } else {
          const chosen = input.gifts.filter((g) => g.ruleId === rule.id && g.qty > 0);
          chosenQty = chosen.reduce((sum, g) => sum + g.qty, 0);
          for (const g of chosen) gifts.push([rule.id, g.sku, g.qty, g.wholesalePrice * g.qty, false]);
          if (chosenQty > entitledQty) {
            issue("error", rule.id);
            ok = false;
          } else if (chosenQty < entitledQty) {
            issue("warning", rule.id);
          }
          if (rule.giftGroupId && chosen.some((g) => g.groupId !== rule.giftGroupId)) {
            issue("error", rule.id);
            ok = false;
          }
        }
      }
      const remainingQty = rule.giftMode === "group" ? entitledQty - chosenQty : 0;
      ruleSummaries.push({ id: rule.id, sourceQty, entitledQty, chosenQty, remainingQty, ok });
    }
  }

  const takesChosenGifts = new Set(
    rules.filter((r) => r.type === "tier_gift" || (r.type === "buy_x_get_y" && r.giftMode === "group")).map((r) => r.id),
  );
  const orphans = input.gifts.flatMap((g, index) => (g.qty > 0 && !takesChosenGifts.has(g.ruleId) ? [index] : []));
  if (orphans.length > 0) issue("error", null);

  const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((total, l) => total + f(l), 0);
  const totalWholesale = sum((l) => l.wholesalePrice * l.qty);
  const totalAmount = sum((l) => l.unit * l.qty);
  return {
    unitPrices: lines.map((l) => l.unit),
    amounts: lines.map((l) => l.unit * l.qty),
    winners: lines.map((l) => l.winner),
    totalQty: sum((l) => l.qty),
    totalRetail: sum((l) => l.retailPrice * l.qty),
    totalWholesale,
    totalAmount,
    discountAmount: totalWholesale - totalAmount,
    rules: ruleSummaries,
    gifts,
    giftQty: gifts.reduce((total, g) => total + g[2], 0),
    giftValue: gifts.reduce((total, g) => total + g[3], 0),
    orphans,
    issueCounts,
    hasError: Object.keys(issueCounts).some((key) => key.startsWith("error|")),
  };
}

/** A random program (4 groups × 6 items, 1–5 rules, some of them misconfigured on purpose) and a random order for it. */
function randomCase(seed: number): { program: Program; input: OrderInput } {
  const random = seededRandom(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const oneOf = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const chance = (p: number) => random() < p;
  const someOf = <T,>(values: readonly T[], p: number): T[] => values.filter(() => chance(p));

  const groups: ProductGroup[] = Array.from({ length: 4 }, (_, g) => ({
    id: `g${g}`,
    name: `Danh mục ${g}`,
    items: Array.from({ length: 6 }, (_, i) => {
      // Prices in steps of 10 đ, so that "exactly half a đồng" results do occur.
      const retailPrice = int(30_000, 300_000) * 10;
      const wholesalePrice = oneOf([Math.round(retailPrice * 0.7), retailPrice, Math.round(retailPrice * 0.55), retailPrice - 10]);
      return { sku: `S${g}-${i}`, name: `Sản phẩm ${g}.${i}`, retailPrice, wholesalePrice };
    }),
  }));
  const groupIds = groups.map((g) => g.id);

  const rules: Rule[] = Array.from({ length: int(1, 5) }, (_, r): Rule => {
    const id = `r${r}`;
    const kind = oneOf(["discount", "discount", "tier_gift", "tier_gift", "buy_x_get_y", "buy_x_get_y"] as const);
    if (kind === "discount") {
      return {
        id,
        type: "discount",
        name: `Giảm giá ${r}`,
        targetGroupIds: someOf(groupIds, 0.45),
        discountPercent: oneOf([5, 7, 10, 12.5, 15, 20, 33, 45, 55, 2.25, 67, 100, 0, 150]),
        discountBasis: oneOf(["retail", "wholesale"] as const),
        minQty: chance(0.5) ? null : int(1, 6),
        maxQty: chance(0.5) ? null : int(2, 12),
        requireGroupIds: someOf(groupIds, 0.25),
        requireMinQty: int(0, 3),
      };
    }
    if (kind === "tier_gift") {
      const giftGroupId = chance(0.1) ? null : oneOf(groupIds);
      const giftSkus = groups.find((g) => g.id === giftGroupId)?.items.map((i) => i.sku) ?? [];
      const mins = [...new Set(Array.from({ length: int(0, 4) }, () => int(0, 20) * 500_000))];
      return {
        id,
        type: "tier_gift",
        name: `Tặng theo doanh số ${r}`,
        sourceGroupIds: someOf(groupIds, 0.5),
        giftGroupId,
        giftPriceBasis: oneOf(["retail", "wholesale"] as const),
        tiers: mins.map((min, t) => {
          const percent = chance(0.4);
          return {
            id: `${id}-t${t}`,
            min,
            limitType: percent ? "percent" : "amount",
            limitValue: percent ? oneOf([5, 10, 12.5, 15, 2.3, 27, 4.1]) : int(0, 300) * 10_000,
            maxQty: chance(0.6) ? null : int(1, 4),
            allowedSkus: chance(0.7) ? null : someOf(giftSkus, 0.5),
          };
        }),
      };
    }
    const giftMode = oneOf(["same", "text", "group"] as const);
    return {
      id,
      type: "buy_x_get_y",
      name: `Mua X tặng Y ${r}`,
      sourceGroupIds: someOf(groupIds, 0.5),
      buyQty: oneOf([0, 1, 1, 2, 2, 3, 5]),
      getQty: oneOf([0, 1, 1, 1, 2, 3]),
      giftMode,
      giftGroupId: giftMode === "group" && chance(0.85) ? oneOf(groupIds) : null,
      giftText: chance(0.8) ? "Cước N65" : "",
      ...(giftMode === "text" && chance(0.5) ? { giftTextValue: int(1, 30) * 10_000 } : {}),
    };
  });

  const copy = (groupId: string, product: ProductItem, qty: number): OrderLine => ({
    groupId,
    sku: product.sku,
    name: product.name,
    retailPrice: product.retailPrice,
    wholesalePrice: product.wholesalePrice,
    qty,
  });
  const lines = Array.from({ length: int(0, 9) }, () => {
    const g = oneOf(groups);
    return copy(g.id, oneOf(g.items), oneOf([0, 1, 1, 2, 2, 3, 4, 5, 8, 13, 40]));
  });

  const gifts: OrderGift[] = [];
  for (const rule of rules) {
    if (rule.type === "discount") continue;
    if (rule.type === "buy_x_get_y" && rule.giftMode !== "group" && !chance(0.1)) continue;
    for (let n = int(0, 3); n > 0; n--) {
      // Mostly from the rule's gift group, sometimes from another group.
      const g = chance(0.85) ? (groups.find((x) => x.id === rule.giftGroupId) ?? oneOf(groups)) : oneOf(groups);
      gifts.push({ ...copy(g.id, oneOf(g.items), oneOf([0, 1, 1, 1, 2, 3, 6])), ruleId: rule.id });
    }
  }
  if (chance(0.1)) {
    const g = oneOf(groups);
    gifts.push({ ...copy(g.id, oneOf(g.items), int(0, 2)), ruleId: "r-deleted" });
  }

  const program = makeProgram(groups, rules);
  // One order in five is a confirmed one that carries its own copy of the rules while the program has none left.
  if (chance(0.2)) return { program: { ...program, rules: [] }, input: { lines, gifts, frozenRules: rules } };
  return { program, input: { lines, gifts } };
}

describe("randomised comparison with a reference implementation of the business rules", () => {
  it("agrees on prices, totals, rule results, gifts, orphans and issue counts for 3.000 generated orders", () => {
    const seen = { discounted: 0, tierReached: 0, withError: 0, withAutoGift: 0, orphan: 0 };
    for (let seed = 1; seed <= 3000; seed++) {
      const { program, input } = randomCase(seed);
      const result = calculateOrder(program, input);
      expect(summarize(result), `generated case ${seed}`).toEqual(reference(program, input));
      // Issues always come back errors first, then warnings, then infos.
      const rank = { error: 0, warning: 1, info: 2 };
      const ranks = result.issues.map((i) => rank[i.level]);
      expect([...ranks].sort((a, b) => a - b), `generated case ${seed}`).toEqual(ranks);

      if (result.lines.some((l) => l.discountRuleId)) seen.discounted++;
      if (result.rules.some((r) => r.type === "tier_gift" && r.tierIndex >= 0)) seen.tierReached++;
      if (result.hasError) seen.withError++;
      if (result.gifts.some((g) => g.auto)) seen.withAutoGift++;
      if (result.orphanGiftIndexes.length > 0) seen.orphan++;
    }
    // The generator really exercises every part of the engine.
    expect(seen.discounted).toBeGreaterThan(200);
    expect(seen.tierReached).toBeGreaterThan(200);
    expect(seen.withError).toBeGreaterThan(200);
    expect(seen.withAutoGift).toBeGreaterThan(200);
    expect(seen.orphan).toBeGreaterThan(50);
  });
});
