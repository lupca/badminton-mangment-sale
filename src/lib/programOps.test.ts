// Tests for the pure program / rule operations shared by every screen.
import { describe, expect, it } from "vitest";
import seed from "../seed/seed.json";
import type { BuyXGetYRule, DB, DiscountRule, GiftTier, ProductItem, Program, Rule, RuleType, TierGiftRule } from "../types";
import { calculateOrder } from "./engine";
import {
  PRICE_BASIS_LABEL,
  RULE_TYPE_HINT,
  RULE_TYPE_LABEL,
  describeRule,
  describeTier,
  findItem,
  mergeItems,
  newGroup,
  newRule,
  newTier,
  programItemCount,
  removeGroup,
  ruleGroupIds,
  validateRule,
} from "./programOps";

const db = seed as unknown as DB;

function seedProgram(id: string): Program {
  const program = db.programs.find((p) => p.id === id);
  if (!program) throw new Error(`Seed program not found: ${id}`);
  return structuredClone(program);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

const item = (sku: string, name = `Sản phẩm ${sku}`, retailPrice = 150_000, wholesalePrice = 100_000): ProductItem => ({
  sku,
  name,
  retailPrice,
  wholesalePrice,
});

function tier(min: number, limitValue: number, extra: Partial<GiftTier> = {}): GiftTier {
  return { id: `t-${min}`, min, limitType: "amount", limitValue, maxQty: null, allowedSkus: null, ...extra };
}

/** A program in which every rule refers to every group in every field that can hold a group. */
function tangledProgram(): Program {
  const tierGift: TierGiftRule = {
    id: "r-tier",
    type: "tier_gift",
    name: "Tặng theo doanh số",
    sourceGroupIds: ["g1", "g2", "g3"],
    giftGroupId: "g2",
    giftPriceBasis: "retail",
    tiers: [tier(10_000_000, 1_000_000, { allowedSkus: ["A-1"] })],
  };
  const discount: DiscountRule = {
    id: "r-disc",
    type: "discount",
    name: "Giảm giá",
    targetGroupIds: ["g2", "g1"],
    discountPercent: 10,
    discountBasis: "wholesale",
    minQty: 2,
    maxQty: 4,
    requireGroupIds: ["g3", "g2"],
    requireMinQty: 1,
  };
  const sameGift: BuyXGetYRule = {
    id: "r-same",
    type: "buy_x_get_y",
    name: "Mua 1 tặng 1",
    sourceGroupIds: ["g2"],
    buyQty: 1,
    getQty: 1,
    giftMode: "same",
    giftGroupId: null,
    giftText: "",
  };
  const groupGift: BuyXGetYRule = {
    id: "r-group",
    type: "buy_x_get_y",
    name: "Mua 2 chọn 1",
    sourceGroupIds: ["g1", "g2"],
    buyQty: 2,
    getQty: 1,
    giftMode: "group",
    giftGroupId: "g2",
    giftText: "",
  };
  return {
    id: "p-test",
    name: "Chương trình thử",
    brand: "Li-Ning",
    startDate: null,
    endDate: null,
    note: "",
    groups: [
      { id: "g1", name: "Nhóm 1", items: [item("A-1")] },
      { id: "g2", name: "Nhóm 2", items: [item("B-1"), item("B-2")] },
      { id: "g3", name: "Nhóm 3", items: [] },
    ],
    rules: [tierGift, discount, sameGift, groupGift],
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
  };
}

// ───────────────────────── mergeItems ─────────────────────────

describe("mergeItems — upsert by SKU", () => {
  it("adds new SKUs at the end, in the order they come in, and keeps the existing order", () => {
    const existing = [item("A-1"), item("B-2"), item("C-3")];
    const merged = mergeItems(existing, [item("Z-9"), item("D-4")]);
    expect(merged.map((i) => i.sku)).toEqual(["A-1", "B-2", "C-3", "Z-9", "D-4"]);
  });

  it("an existing SKU keeps its position and takes the new name and prices", () => {
    const existing = [item("A-1"), item("B-2", "Tên cũ", 200_000, 140_000), item("C-3")];
    const merged = mergeItems(existing, [item("B-2", "Tên mới", 250_000, 175_000)]);
    expect(merged.map((i) => i.sku)).toEqual(["A-1", "B-2", "C-3"]);
    expect(merged[1]).toEqual({ sku: "B-2", name: "Tên mới", retailPrice: 250_000, wholesalePrice: 175_000 });
  });

  it("matches SKUs after normalisation: case, spaces and non-breaking spaces do not create duplicates", () => {
    const existing = [item("P-AYPR285-3", "Tên cũ")];
    const merged = mergeItems(existing, [
      item(" p-aypr285-3 ", "Lần 1"),
      item("P-AYPR 285-3", "Lần 2"),
      item(" P-AYPR285-3 ", "Lần 3"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ sku: "P-AYPR285-3", name: "Lần 3" });
  });

  it("stores new SKUs normalised", () => {
    expect(mergeItems([], [item("  av1f ")]).map((i) => i.sku)).toEqual(["AV1F"]);
  });

  it("an existing SKU that was stored un-normalised is still found, and comes out normalised", () => {
    const merged = mergeItems([item("av1f", "Tên cũ")], [item("AV1F", "Tên mới")]);
    expect(merged).toEqual([{ sku: "AV1F", name: "Tên mới", retailPrice: 150_000, wholesalePrice: 100_000 }]);
  });

  it("the same SKU twice in the incoming list gives one row; the last one wins", () => {
    const merged = mergeItems([item("A-1")], [item("N-1", "Lần 1", 1, 1), item("N-2"), item("n-1", "Lần 2", 2, 2)]);
    expect(merged.map((i) => i.sku)).toEqual(["A-1", "N-1", "N-2"]);
    expect(merged[1]).toEqual({ sku: "N-1", name: "Lần 2", retailPrice: 2, wholesalePrice: 2 });
  });

  it("ignores incoming rows without a SKU", () => {
    const merged = mergeItems([item("A-1")], [item(""), item("   "), item(" "), item("B-2")]);
    expect(merged.map((i) => i.sku)).toEqual(["A-1", "B-2"]);
  });

  it("keeps the unit and note of an existing item when the incoming row does not carry them", () => {
    const existing: ProductItem[] = [{ ...item("P-AYPT235-4V"), unit: "cây", note: "1 Kèm 3 tối đa kèm 5" }];
    const merged = mergeItems(existing, [item("P-AYPT235-4V", "Tên mới", 5_800_000, 4_060_000)]);
    expect(merged[0]).toEqual({
      sku: "P-AYPT235-4V",
      name: "Tên mới",
      retailPrice: 5_800_000,
      wholesalePrice: 4_060_000,
      unit: "cây",
      note: "1 Kèm 3 tối đa kèm 5",
    });
  });

  it("takes the unit and note of the incoming row when it has them", () => {
    const existing: ProductItem[] = [{ ...item("A-1"), unit: "cây", note: "cũ" }];
    const merged = mergeItems(existing, [{ ...item("A-1"), unit: "chiếc", note: "mới" }]);
    expect(merged[0]).toMatchObject({ unit: "chiếc", note: "mới" });
  });

  it("does not modify its inputs and returns new objects", () => {
    const existing = deepFreeze([item("A-1"), item("B-2")]);
    const incoming = deepFreeze([item("b-2", "Tên mới"), item("C-3")]);
    const merged = mergeItems(existing, incoming);
    expect(merged.map((i) => i.sku)).toEqual(["A-1", "B-2", "C-3"]);
    expect(merged[0]).not.toBe(existing[0]);
    expect(merged[0]).toEqual(existing[0]);
    expect(existing[1].name).toBe("Sản phẩm B-2");
  });

  it("merging nothing returns an equal copy; merging into nothing returns the incoming rows", () => {
    const existing = [item("A-1"), item("B-2")];
    expect(mergeItems(existing, [])).toEqual(existing);
    expect(mergeItems(existing, [])).not.toBe(existing);
    expect(mergeItems([], existing)).toEqual(existing);
  });

  it("re-importing the whole seed catalogue changes nothing", () => {
    for (const program of db.programs) {
      for (const g of program.groups) {
        expect(mergeItems(g.items, structuredClone(g.items)), `${program.id}/${g.id}`).toEqual(g.items);
      }
    }
  });
});

// ───────────────────────── removeGroup ─────────────────────────

describe("removeGroup", () => {
  it("removes the group and every reference to it in every kind of rule", () => {
    const result = removeGroup(tangledProgram(), "g2");
    expect(result.groups.map((g) => g.id)).toEqual(["g1", "g3"]);

    const [tierGift, discount, sameGift, groupGift] = result.rules as [TierGiftRule, DiscountRule, BuyXGetYRule, BuyXGetYRule];
    expect(tierGift.sourceGroupIds).toEqual(["g1", "g3"]);
    expect(tierGift.giftGroupId).toBeNull();
    expect(discount.targetGroupIds).toEqual(["g1"]);
    expect(discount.requireGroupIds).toEqual(["g3"]);
    expect(sameGift.sourceGroupIds).toEqual([]);
    expect(sameGift.giftGroupId).toBeNull();
    expect(groupGift.sourceGroupIds).toEqual(["g1"]);
    expect(groupGift.giftGroupId).toBeNull();

    for (const rule of result.rules) expect(ruleGroupIds(rule), rule.id).not.toContain("g2");
    // Nowhere in the whole program any more.
    expect(JSON.stringify(result)).not.toContain('"g2"');
  });

  it("keeps the rules themselves (same count, order, ids and settings) and the other groups untouched", () => {
    const before = tangledProgram();
    const result = removeGroup(before, "g3");
    expect(result.rules.map((r) => r.id)).toEqual(["r-tier", "r-disc", "r-same", "r-group"]);
    expect(result.groups).toEqual(before.groups.filter((g) => g.id !== "g3"));
    const discount = result.rules[1] as DiscountRule;
    expect(discount).toMatchObject({ discountPercent: 10, discountBasis: "wholesale", minQty: 2, maxQty: 4, requireMinQty: 1 });
    expect(discount.targetGroupIds).toEqual(["g2", "g1"]);
    expect(discount.requireGroupIds).toEqual(["g2"]);
    const tierGift = result.rules[0] as TierGiftRule;
    expect(tierGift.giftGroupId).toBe("g2");
    expect(tierGift.tiers).toEqual((before.rules[0] as TierGiftRule).tiers);
    expect(result).toMatchObject({ id: "p-test", name: "Chương trình thử", brand: "Li-Ning" });
  });

  it("does not modify the program it was given", () => {
    const program = deepFreeze(tangledProgram());
    expect(() => removeGroup(program, "g2")).not.toThrow();
    expect(program.groups).toHaveLength(3);
    expect((program.rules[0] as TierGiftRule).giftGroupId).toBe("g2");
  });

  it("an unknown group id changes nothing", () => {
    const program = tangledProgram();
    expect(removeGroup(program, "g-unknown")).toEqual(program);
  });

  it("seed KM 11: without the gift group the rule is flagged, and gifts already chosen are refused", () => {
    const program = seedProgram("seed-km-2026-11");
    const result = removeGroup(program, "g-km11-gift");
    const rule = result.rules[0] as TierGiftRule;
    expect(rule.giftGroupId).toBeNull();
    expect(rule.sourceGroupIds).toEqual(["g-km11-apply"]);
    expect(validateRule(rule, result.groups)).toEqual(["Chưa chọn danh mục quà."]);

    const gift = program.groups[1].items.find((i) => i.sku === "P-AYPT399-4")!;
    const apply = program.groups[0].items.find((i) => i.sku === "P-AYPR285-3")!;
    const calc = calculateOrder(result, {
      lines: [{ groupId: "g-km11-apply", ...apply, qty: 8 }],
      gifts: [{ ruleId: rule.id, groupId: "g-km11-gift", ...gift, qty: 1 }],
    });
    expect(calc.hasError).toBe(true);
  });

  it("seed Hè 2026: removing Danh mục 01 empties discount A and string gift B1, and leaves B2 without gift group", () => {
    const result = removeGroup(seedProgram("seed-km-2026-he"), "g-he-dm01");
    const [a, b1, b2] = result.rules as [DiscountRule, BuyXGetYRule, TierGiftRule];
    expect(a.targetGroupIds).toEqual([]);
    expect(a.requireGroupIds).toEqual(["g-he-dm03"]);
    expect(b1.sourceGroupIds).toEqual([]);
    expect(b2.sourceGroupIds).toEqual(["g-he-dm02"]);
    expect(b2.giftGroupId).toBeNull();
    expect(result.groups.map((g) => g.id)).toEqual(["g-he-dm02", "g-he-dm03"]);
    for (const rule of result.rules) expect(validateRule(rule, result.groups).length, rule.id).toBeGreaterThan(0);
  });
});

// ───────────────────────── ruleGroupIds / findItem / programItemCount ─────────────────────────

describe("ruleGroupIds", () => {
  it("lists every group a rule refers to", () => {
    const [tierGift, discount, sameGift, groupGift] = tangledProgram().rules;
    expect(ruleGroupIds(tierGift)).toEqual(["g1", "g2", "g3", "g2"]);
    expect(ruleGroupIds(discount)).toEqual(["g2", "g1", "g3", "g2"]);
    expect(ruleGroupIds(sameGift)).toEqual(["g2"]);
    expect(ruleGroupIds(groupGift)).toEqual(["g1", "g2", "g2"]);
  });

  it("seed rules", () => {
    const he = seedProgram("seed-km-2026-he");
    expect(he.rules.map(ruleGroupIds)).toEqual([
      ["g-he-dm01", "g-he-dm03"],
      ["g-he-dm01"],
      ["g-he-dm02", "g-he-dm01"],
    ]);
  });
});

describe("findItem", () => {
  const he = seedProgram("seed-km-2026-he");

  it("finds an item by group and SKU, ignoring case and spaces", () => {
    expect(findItem(he, "g-he-dm01", "P-AYPT417-5")).toMatchObject({ retailPrice: 2_356_364, wholesalePrice: 1_649_455 });
    expect(findItem(he, "g-he-dm01", "  p-aypt417-5 ")?.sku).toBe("P-AYPT417-5");
    expect(findItem(he, "g-he-dm01", "P-AYPT 417-5")?.sku).toBe("P-AYPT417-5");
  });

  it("only looks in the group that was asked for", () => {
    // P-AYPM444-3 is in Danh mục 03 (and 02) but not in Danh mục 01.
    expect(findItem(he, "g-he-dm03", "P-AYPM444-3")?.wholesalePrice).toBe(1_415_782);
    expect(findItem(he, "g-he-dm01", "P-AYPM444-3")).toBeUndefined();
    expect(findItem(he, "g-unknown", "P-AYPM444-3")).toBeUndefined();
    expect(findItem(he, "g-he-dm01", "")).toBeUndefined();
    expect(findItem(he, "g-he-dm01", "KHONG-CO")).toBeUndefined();
  });
});

describe("programItemCount", () => {
  it("counts the items of all groups", () => {
    expect(programItemCount(seedProgram("seed-km-2026-11"))).toBe(38);
    expect(programItemCount(seedProgram("seed-bang-gia-sau-ck"))).toBe(161);
    expect(programItemCount(seedProgram("seed-km-2026-he"))).toBe(152);
    expect(programItemCount({ groups: [] })).toBe(0);
  });
});

// ───────────────────────── describeTier / describeRule ─────────────────────────

describe("describeTier", () => {
  it("fixed amount with a next tier", () => {
    expect(describeTier(tier(20_000_000, 3_190_000), tier(50_000_000, 11_610_000))).toBe(
      "Từ 20.000.000 đ đến dưới 50.000.000 đ: tặng tối đa 3.190.000 đ",
    );
  });

  it("the top tier is open-ended", () => {
    expect(describeTier(tier(200_000_000, 72_400_000), null)).toBe("Từ 200.000.000 đ trở lên: tặng tối đa 72.400.000 đ");
  });

  it("percent of revenue", () => {
    expect(describeTier(tier(8_000_000, 15, { limitType: "percent" }), tier(20_000_000, 18, { limitType: "percent" }))).toBe(
      "Từ 8.000.000 đ đến dưới 20.000.000 đ: tặng tối đa 15% doanh số",
    );
  });

  it("mentions the quantity limit and the SKU restriction", () => {
    expect(
      describeTier(tier(10_000_000, 1_200_000, { maxQty: 1, allowedSkus: ["A", "B", "C", "D", "E", "F"] }), tier(20_000_000, 1)),
    ).toBe("Từ 10.000.000 đ đến dưới 20.000.000 đ: tặng tối đa 1.200.000 đ (tối đa 1 sản phẩm, chọn trong 6 mã)");
    expect(describeTier(tier(10_000_000, 1_200_000, { maxQty: 3 }), null)).toBe(
      "Từ 10.000.000 đ trở lên: tặng tối đa 1.200.000 đ (tối đa 3 sản phẩm)",
    );
    expect(describeTier(tier(10_000_000, 1_200_000, { allowedSkus: ["A", "B"] }), null)).toBe(
      "Từ 10.000.000 đ trở lên: tặng tối đa 1.200.000 đ (chọn trong 2 mã)",
    );
  });
});

describe("describeRule — the three seed programs", () => {
  it("KM 11/2026: revenue tiers, gifts valued at retail", () => {
    const program = seedProgram("seed-km-2026-11");
    expect(describeRule(program.rules[0], program.groups)).toEqual([
      "Doanh số tính từ «Danh mục hàng hóa áp dụng». Quà chọn trong «Danh mục hàng tặng», giá trị quà tính theo giá lẻ.",
      "Từ 10.000.000 đ đến dưới 20.000.000 đ: tặng tối đa 1.200.000 đ (tối đa 1 sản phẩm, chọn trong 6 mã)",
      "Từ 20.000.000 đ đến dưới 50.000.000 đ: tặng tối đa 3.190.000 đ",
      "Từ 50.000.000 đ đến dưới 120.000.000 đ: tặng tối đa 11.610.000 đ",
      "Từ 120.000.000 đ đến dưới 200.000.000 đ: tặng tối đa 35.050.000 đ",
      "Từ 200.000.000 đ trở lên: tặng tối đa 72.400.000 đ",
    ]);
  });

  it("Hè 2026: discount A, string gift B1, percent tiers B2", () => {
    const program = seedProgram("seed-km-2026-he");
    const [a, b1, b2] = program.rules;
    expect(describeRule(a, program.groups)).toEqual([
      "Giảm 45% trên giá lẻ cho «Danh mục 01 (vợt trung cấp)» khi mua từ 2 đến 4 sản phẩm «Danh mục 01 (vợt trung cấp)» và mua kèm ít nhất 1 sản phẩm «Danh mục 03 (vợt mua kèm)».",
    ]);
    expect(describeRule(b1, program.groups)).toEqual([
      "Cứ mua 1 sản phẩm «Danh mục 01 (vợt trung cấp)» được tặng 1 «Cước cầu lông LiNing N65» (trị giá 150.000 đ mỗi món).",
    ]);
    expect(describeRule(b2, program.groups)).toEqual([
      "Doanh số tính từ «Danh mục 02 (vợt cao cấp)». Quà chọn trong «Danh mục 01 (vợt trung cấp)», giá trị quà tính theo giá sỉ.",
      "Từ 8.000.000 đ đến dưới 20.000.000 đ: tặng tối đa 15% doanh số",
      "Từ 20.000.000 đ đến dưới 35.000.000 đ: tặng tối đa 18% doanh số",
      "Từ 35.000.000 đ đến dưới 50.000.000 đ: tặng tối đa 20% doanh số",
      "Từ 50.000.000 đ trở lên: tặng tối đa 27% doanh số",
    ]);
  });

  it("Bảng giá sau chiết khấu: Ashaway buy 1 get 1", () => {
    const program = seedProgram("seed-bang-gia-sau-ck");
    expect(describeRule(program.rules[0], program.groups)).toEqual([
      "Mua 1 tặng 1 cùng loại (tính theo từng mã), áp dụng cho «Ashaway».",
    ]);
  });
});

describe("describeRule — variants", () => {
  const groups = tangledProgram().groups;
  const discount = (extra: Partial<DiscountRule>): DiscountRule => ({
    id: "r",
    type: "discount",
    name: "Giảm giá",
    targetGroupIds: ["g1"],
    discountPercent: 10,
    discountBasis: "wholesale",
    minQty: null,
    maxQty: null,
    requireGroupIds: [],
    requireMinQty: 0,
    ...extra,
  });
  const bxgy = (extra: Partial<BuyXGetYRule>): BuyXGetYRule => ({
    id: "r",
    type: "buy_x_get_y",
    name: "Mua X tặng Y",
    sourceGroupIds: ["g1"],
    buyQty: 2,
    getQty: 1,
    giftMode: "same",
    giftGroupId: null,
    giftText: "",
    ...extra,
  });

  it("tiers are described in ascending order whatever their order in the rule", () => {
    const rule: TierGiftRule = {
      id: "r",
      type: "tier_gift",
      name: "Tặng",
      sourceGroupIds: ["g1"],
      giftGroupId: "g2",
      giftPriceBasis: "wholesale",
      tiers: [tier(50_000_000, 5_000_000), tier(10_000_000, 1_000_000), tier(20_000_000, 2_000_000)],
    };
    expect(describeRule(rule, groups)).toEqual([
      "Doanh số tính từ «Nhóm 1». Quà chọn trong «Nhóm 2», giá trị quà tính theo giá sỉ.",
      "Từ 10.000.000 đ đến dưới 20.000.000 đ: tặng tối đa 1.000.000 đ",
      "Từ 20.000.000 đ đến dưới 50.000.000 đ: tặng tối đa 2.000.000 đ",
      "Từ 50.000.000 đ trở lên: tặng tối đa 5.000.000 đ",
    ]);
  });

  it("discount: no condition, only a minimum, only a maximum, several target groups", () => {
    expect(describeRule(discount({}), groups)).toEqual(["Giảm 10% trên giá sỉ cho «Nhóm 1»."]);
    expect(describeRule(discount({ minQty: 3 }), groups)).toEqual([
      "Giảm 10% trên giá sỉ cho «Nhóm 1» khi mua từ 3 sản phẩm «Nhóm 1» trở lên.",
    ]);
    expect(describeRule(discount({ maxQty: 5 }), groups)).toEqual([
      "Giảm 10% trên giá sỉ cho «Nhóm 1» khi mua tối đa 5 sản phẩm «Nhóm 1».",
    ]);
    expect(describeRule(discount({ targetGroupIds: ["g1", "g2"], discountBasis: "retail", discountPercent: 12.5 }), groups)).toEqual([
      "Giảm 12,5% trên giá lẻ cho «Nhóm 1», «Nhóm 2».",
    ]);
  });

  it("discount: a companion requirement is only mentioned when it is really enforced", () => {
    expect(describeRule(discount({ requireGroupIds: ["g3"], requireMinQty: 2 }), groups)).toEqual([
      "Giảm 10% trên giá sỉ cho «Nhóm 1» khi mua kèm ít nhất 2 sản phẩm «Nhóm 3».",
    ]);
    expect(describeRule(discount({ requireGroupIds: ["g3"], requireMinQty: 0 }), groups)).toEqual(["Giảm 10% trên giá sỉ cho «Nhóm 1»."]);
    expect(describeRule(discount({ requireGroupIds: [], requireMinQty: 2 }), groups)).toEqual(["Giảm 10% trên giá sỉ cho «Nhóm 1»."]);
  });

  it("buy X get Y: same product, chosen from a group, named gift", () => {
    expect(describeRule(bxgy({}), groups)).toEqual(["Mua 2 tặng 1 cùng loại (tính theo từng mã), áp dụng cho «Nhóm 1»."]);
    expect(describeRule(bxgy({ giftMode: "group", giftGroupId: "g2" }), groups)).toEqual([
      "Cứ mua 2 sản phẩm «Nhóm 1» được chọn 1 quà trong «Nhóm 2».",
    ]);
    expect(describeRule(bxgy({ giftMode: "text", giftText: "Bao vợt" }), groups)).toEqual([
      "Cứ mua 2 sản phẩm «Nhóm 1» được tặng 1 «Bao vợt».",
    ]);
    expect(describeRule(bxgy({ giftMode: "text", giftText: "" }), groups)).toEqual([
      "Cứ mua 2 sản phẩm «Nhóm 1» được tặng 1 «quà tặng».",
    ]);
  });

  it("names a missing selection and a deleted group instead of crashing", () => {
    expect(describeRule(discount({ targetGroupIds: [] }), groups)).toEqual(["Giảm 10% trên giá sỉ cho (chưa chọn danh mục)."]);
    expect(describeRule(discount({ targetGroupIds: ["g-deleted"] }), groups)).toEqual(["Giảm 10% trên giá sỉ cho «danh mục đã xóa»."]);
    expect(describeRule(bxgy({ giftMode: "group", giftGroupId: null }), groups)).toEqual([
      "Cứ mua 2 sản phẩm «Nhóm 1» được chọn 1 quà trong (chưa chọn danh mục).",
    ]);
    const noTiers: TierGiftRule = {
      id: "r",
      type: "tier_gift",
      name: "Tặng",
      sourceGroupIds: [],
      giftGroupId: null,
      giftPriceBasis: "retail",
      tiers: [],
    };
    expect(describeRule(noTiers, groups)).toEqual([
      "Doanh số tính từ (chưa chọn danh mục). Quà chọn trong (chưa chọn danh mục), giá trị quà tính theo giá lẻ.",
    ]);
  });
});

// ───────────────────────── validateRule ─────────────────────────

describe("validateRule", () => {
  const groups = tangledProgram().groups;
  const [tierGift, discount, sameGift, groupGift] = tangledProgram().rules as [TierGiftRule, DiscountRule, BuyXGetYRule, BuyXGetYRule];
  const textGift: BuyXGetYRule = { ...sameGift, giftMode: "text", giftText: "Cước N65" };

  it("accepts every rule of the three seed programs", () => {
    for (const program of db.programs) {
      for (const rule of program.rules) expect(validateRule(rule, program.groups), `${program.id}/${rule.id}`).toEqual([]);
    }
  });

  it("accepts well-formed rules of every kind", () => {
    for (const rule of [tierGift, discount, sameGift, groupGift, textGift]) expect(validateRule(rule, groups), rule.id).toEqual([]);
  });

  it("a rule needs a name", () => {
    expect(validateRule({ ...discount, name: "" }, groups)).toEqual(["Chưa đặt tên quy tắc."]);
    expect(validateRule({ ...tierGift, name: "   " }, groups)).toEqual(["Chưa đặt tên quy tắc."]);
  });

  it("tier_gift: source groups, gift group and tiers are required — deleted groups do not count", () => {
    expect(validateRule({ ...tierGift, sourceGroupIds: [] }, groups)).toEqual(["Chưa chọn danh mục tính doanh số."]);
    expect(validateRule({ ...tierGift, sourceGroupIds: ["g-deleted"] }, groups)).toEqual(["Chưa chọn danh mục tính doanh số."]);
    expect(validateRule({ ...tierGift, giftGroupId: null }, groups)).toEqual(["Chưa chọn danh mục quà."]);
    expect(validateRule({ ...tierGift, giftGroupId: "g-deleted" }, groups)).toEqual(["Chưa chọn danh mục quà."]);
    expect(validateRule({ ...tierGift, tiers: [] }, groups)).toEqual(["Chưa có mức doanh số nào."]);
  });

  it("tier_gift: two tiers may not start at the same revenue", () => {
    expect(validateRule({ ...tierGift, tiers: [tier(10_000_000, 1), tier(20_000_000, 2), tier(10_000_000, 3)] }, groups)).toEqual([
      "Có hai mức trùng doanh số bắt đầu.",
    ]);
    expect(validateRule({ ...tierGift, tiers: [tier(20_000_000, 2), tier(10_000_000, 1)] }, groups)).toEqual([]);
  });

  it("tier_gift: every tier needs a positive limit, and a percent limit cannot exceed 100", () => {
    expect(validateRule({ ...tierGift, tiers: [tier(10_000_000, 0)] }, groups)).toEqual(["Có mức chưa nhập hạn mức quà."]);
    expect(validateRule({ ...tierGift, tiers: [tier(10_000_000, Number.NaN)] }, groups)).toEqual(["Có mức chưa nhập hạn mức quà."]);
    expect(validateRule({ ...tierGift, tiers: [tier(10_000_000, 101, { limitType: "percent" })] }, groups)).toEqual([
      "Hạn mức % không được quá 100.",
    ]);
    expect(validateRule({ ...tierGift, tiers: [tier(10_000_000, 100, { limitType: "percent" })] }, groups)).toEqual([]);
    // An amount above 100 is of course fine.
    expect(validateRule({ ...tierGift, tiers: [tier(10_000_000, 1_200_000)] }, groups)).toEqual([]);
  });

  it("discount: target group, a percent in (0, 100], and min ≤ max", () => {
    expect(validateRule({ ...discount, targetGroupIds: [] }, groups)).toEqual(["Chưa chọn danh mục được giảm giá."]);
    expect(validateRule({ ...discount, targetGroupIds: ["g-deleted"] }, groups)).toEqual(["Chưa chọn danh mục được giảm giá."]);
    for (const percent of [0, -5, 100.5, Number.NaN]) {
      expect(validateRule({ ...discount, discountPercent: percent }, groups), String(percent)).toEqual([
        "% giảm phải lớn hơn 0 và không quá 100.",
      ]);
    }
    expect(validateRule({ ...discount, discountPercent: 100 }, groups)).toEqual([]);
    expect(validateRule({ ...discount, discountPercent: 0.5 }, groups)).toEqual([]);
    expect(validateRule({ ...discount, minQty: 5, maxQty: 4 }, groups)).toEqual(["Số lượng tối thiểu đang lớn hơn số lượng tối đa."]);
    expect(validateRule({ ...discount, minQty: 4, maxQty: 4 }, groups)).toEqual([]);
    expect(validateRule({ ...discount, minQty: 5, maxQty: null }, groups)).toEqual([]);
    expect(validateRule({ ...discount, minQty: null, maxQty: 1 }, groups)).toEqual([]);
  });

  it("buy_x_get_y: source group, positive quantities, and what the chosen mode needs", () => {
    expect(validateRule({ ...sameGift, sourceGroupIds: [] }, groups)).toEqual(["Chưa chọn danh mục áp dụng."]);
    expect(validateRule({ ...sameGift, buyQty: 0 }, groups)).toEqual(["Số lượng mua và số lượng tặng phải lớn hơn 0."]);
    expect(validateRule({ ...sameGift, getQty: 0 }, groups)).toEqual(["Số lượng mua và số lượng tặng phải lớn hơn 0."]);
    expect(validateRule({ ...sameGift, buyQty: Number.NaN }, groups)).toEqual(["Số lượng mua và số lượng tặng phải lớn hơn 0."]);
    expect(validateRule({ ...groupGift, giftGroupId: null }, groups)).toEqual(["Chưa chọn danh mục quà."]);
    expect(validateRule({ ...groupGift, giftGroupId: "g-deleted" }, groups)).toEqual(["Chưa chọn danh mục quà."]);
    expect(validateRule({ ...textGift, giftText: "  " }, groups)).toEqual(["Chưa nhập tên món quà."]);
    // The gift group and gift text only matter in their own mode.
    expect(validateRule({ ...sameGift, giftGroupId: null, giftText: "" }, groups)).toEqual([]);
  });

  it("reports every problem of a rule at once", () => {
    const broken: TierGiftRule = { ...tierGift, name: "", sourceGroupIds: [], giftGroupId: null, tiers: [] };
    expect(validateRule(broken, groups)).toEqual([
      "Chưa đặt tên quy tắc.",
      "Chưa chọn danh mục tính doanh số.",
      "Chưa chọn danh mục quà.",
      "Chưa có mức doanh số nào.",
    ]);
  });

  it("a rule that validateRule accepts is never reported as misconfigured by the engine", () => {
    for (const program of db.programs) {
      expect(calculateOrder(program, { lines: [], gifts: [] }).issues, program.id).toEqual([]);
    }
    const custom = { ...tangledProgram(), rules: [tierGift, discount, sameGift, groupGift, { ...textGift, id: "r-text" }] };
    expect(calculateOrder(custom, { lines: [], gifts: [] }).issues).toEqual([]);
  });
});

// ───────────────────────── newGroup / newTier / newRule ─────────────────────────

describe("newGroup, newTier, newRule", () => {
  it("newGroup: an empty group with a fresh id", () => {
    const a = newGroup("Danh mục áp dụng");
    const b = newGroup("Danh mục quà");
    expect(a).toMatchObject({ name: "Danh mục áp dụng", items: [] });
    expect(a.id).toMatch(/^g/);
    expect(a.id).not.toBe(b.id);
  });

  it("newTier: a fixed-amount tier without restrictions", () => {
    const t = newTier(10_000_000, 1_200_000);
    expect(t).toMatchObject({ min: 10_000_000, limitType: "amount", limitValue: 1_200_000, maxQty: null, allowedSkus: null });
    expect(t.id).toMatch(/^t/);
    expect(newTier()).toMatchObject({ min: 0, limitValue: 0 });
    expect(newTier().id).not.toBe(newTier().id);
  });

  it("newRule picks the first groups of the program, so a new rule is valid right away", () => {
    const program = tangledProgram();
    const types: RuleType[] = ["tier_gift", "discount", "buy_x_get_y"];
    for (const type of types) {
      const rule = newRule(type, program);
      expect(rule.type).toBe(type);
      expect(rule.id).toMatch(/^r/);
      expect(validateRule(rule, program.groups), type).toEqual([]);
    }
    expect(newRule("tier_gift", program)).toMatchObject({ sourceGroupIds: ["g1"], giftGroupId: "g2", giftPriceBasis: "wholesale" });
    expect(newRule("discount", program)).toMatchObject({ targetGroupIds: ["g1"], minQty: null, maxQty: null, requireGroupIds: [] });
    expect(newRule("buy_x_get_y", program)).toMatchObject({ sourceGroupIds: ["g1"], buyQty: 1, getQty: 1, giftMode: "same" });
  });

  it("newRule on a program with a single group, or without any program, does not crash", () => {
    const one = { groups: [tangledProgram().groups[0]] };
    expect(newRule("tier_gift", one)).toMatchObject({ sourceGroupIds: ["g1"], giftGroupId: "g1" });
    for (const type of ["tier_gift", "discount", "buy_x_get_y"] as RuleType[]) {
      const rule: Rule = newRule(type);
      expect(ruleGroupIds(rule)).toEqual([]);
      expect(validateRule(rule, []).length).toBeGreaterThan(0);
    }
  });

  it("two new rules never share an id", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRule("discount").id));
    expect(ids.size).toBe(50);
  });
});

describe("labels", () => {
  it("every rule type has a label and a hint; both price bases have a label", () => {
    for (const type of ["tier_gift", "discount", "buy_x_get_y"] as RuleType[]) {
      expect(RULE_TYPE_LABEL[type]).toBeTruthy();
      expect(RULE_TYPE_HINT[type]).toBeTruthy();
    }
    expect(PRICE_BASIS_LABEL).toEqual({ retail: "giá lẻ", wholesale: "giá sỉ" });
  });
});
