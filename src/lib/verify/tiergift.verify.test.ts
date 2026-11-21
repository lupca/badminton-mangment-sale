// Independent verification of the «Tặng theo doanh số» rule (tier_gift).
// Expected values come from the business descriptions (types.ts field docs, rule-editor texts, the original
// display-only app in commit dec7139) and are hand-computed or produced by the oracle below — not from engine.ts.
import { describe, expect, it } from "vitest";
import seed from "../../seed/seed.json";
import type {
  BuyXGetYRule,
  DB,
  DiscountRule,
  GiftTier,
  OrderGift,
  OrderLine,
  Program,
  ProductGroup,
  ProductItem,
  Rule,
  TierGiftResult,
  TierGiftRule,
} from "../../types";
import { calculateOrder, type OrderInput } from "../engine";
import { formatVND } from "../format";

// ───────────────────────── helpers ─────────────────────────

const db = seed as unknown as DB;
const seedProgram = (id: string): Program => {
  const p = db.programs.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return structuredClone(p);
};
const itemOf = (p: Program, groupId: string, sku: string): ProductItem => {
  const it = p.groups.find((g) => g.id === groupId)?.items.find((i) => i.sku === sku);
  if (!it) throw new Error(`${sku} not in ${groupId}`);
  return it;
};
const line = (p: Program, groupId: string, sku: string, qty: number): OrderLine => {
  const i = itemOf(p, groupId, sku);
  return { groupId, sku, name: i.name, retailPrice: i.retailPrice, wholesalePrice: i.wholesalePrice, qty };
};
const gift = (p: Program, ruleId: string, groupId: string, sku: string, qty = 1): OrderGift => ({
  ...line(p, groupId, sku, qty),
  ruleId,
});
const rawLine = (groupId: string, sku: string, wholesalePrice: number, qty: number, retailPrice = wholesalePrice): OrderLine => ({
  groupId,
  sku,
  name: sku,
  retailPrice,
  wholesalePrice,
  qty,
});
const rawGift = (ruleId: string, groupId: string, sku: string, retailPrice: number, wholesalePrice: number, qty = 1): OrderGift => ({
  ruleId,
  groupId,
  sku,
  name: sku,
  retailPrice,
  wholesalePrice,
  qty,
});
const tierRes = (calc: ReturnType<typeof calculateOrder>, ruleId: string): TierGiftResult => {
  const r = calc.rules.find((x) => x.ruleId === ruleId);
  if (!r || r.type !== "tier_gift") throw new Error(`no tier result ${ruleId}`);
  return r;
};
const errorsOf = (calc: ReturnType<typeof calculateOrder>, ruleId: string) =>
  calc.issues.filter((i) => i.level === "error" && i.ruleId === ruleId);
const tier = (id: string, min: number, limitType: GiftTier["limitType"], limitValue: number, maxQty: number | null = null, allowedSkus: string[] | null = null): GiftTier => ({
  id,
  min,
  limitType,
  limitValue,
  maxQty,
  allowedSkus,
});

// Minimal synthetic program: source groups A, B; non-source C; gift groups G, H.
function mkProgram(rules: Rule[], extraGroups: ProductGroup[] = []): Program {
  const gItems: ProductItem[] = [
    { sku: "G1", name: "G1", retailPrice: 1_200_000, wholesalePrice: 840_000 },
    { sku: "G2", name: "G2", retailPrice: 1_070_000, wholesalePrice: 749_000 },
    { sku: "G3", name: "G3", retailPrice: 1_450_000, wholesalePrice: 1_015_000 },
  ];
  return {
    id: "p",
    name: "p",
    brand: "x",
    startDate: null,
    endDate: null,
    note: "",
    groups: [
      { id: "A", name: "A", items: [] },
      { id: "B", name: "B", items: [] },
      { id: "C", name: "C", items: [] },
      { id: "G", name: "G", items: gItems },
      { id: "H", name: "H", items: [{ sku: "H1", name: "H1", retailPrice: 500_000, wholesalePrice: 350_000 }] },
      ...extraGroups,
    ],
    rules,
    createdAt: "",
    updatedAt: "",
  };
}
const tg = (id: string, tiers: GiftTier[], over: Partial<TierGiftRule> = {}): TierGiftRule => ({
  id,
  type: "tier_gift",
  name: id,
  sourceGroupIds: ["A"],
  giftGroupId: "G",
  giftPriceBasis: "retail",
  tiers,
  ...over,
});

// ───────────────────────── oracle ─────────────────────────

/** Exact floor(revenue × percent / 100) for percents with up to 6 decimals (BigInt, no float). */
function exactPercentFloor(revenue: number, percent: number): number {
  const scaled = Math.round(percent * 1_000_000);
  return Number((BigInt(revenue) * BigInt(scaled)) / 100_000_000n);
}
const normSku = (s: string) => s.replace(/\s+/g, "").toUpperCase();

interface OracleTier {
  revenue: number;
  tierId: string | null;
  nextTierId: string | null;
  amountToNextTier: number;
  budget: number;
  used: number;
  giftQty: number;
  ok: boolean;
  hint: string | null; // the "mua thêm … để đạt mức …" text expected among info issues
  noGiftWarning: boolean;
}

function oracleTier(rule: TierGiftRule, lineAmounts: { groupId: string; amount: number }[], gifts: OrderGift[]): OracleTier {
  const revenue = lineAmounts.filter((l) => rule.sourceGroupIds.includes(l.groupId)).reduce((s, l) => s + l.amount, 0);
  const sorted = [...rule.tiers].sort((a, b) => a.min - b.min);
  // reached = tier with the largest min that revenue still meets; no purchase → nothing reached
  const reachable = revenue > 0 ? sorted.filter((t) => revenue >= t.min) : [];
  const reached = reachable.length ? reachable[reachable.length - 1] : null;
  const next = sorted.find((t) => t.min > revenue) ?? null; // the next tier the dealer can still climb to
  let budget = 0;
  if (reached) {
    const b = reached.limitType === "percent" ? exactPercentFloor(revenue, reached.limitValue) : reached.limitValue;
    budget = Number.isFinite(b) && b > 0 ? b : 0;
  }
  const mine = gifts.filter((g) => g.ruleId === rule.id && g.qty > 0);
  const unit = (g: OrderGift) => (rule.giftPriceBasis === "retail" ? g.retailPrice : g.wholesalePrice);
  const used = mine.reduce((s, g) => s + unit(g) * g.qty, 0);
  const giftQty = mine.reduce((s, g) => s + g.qty, 0);
  let ok = true;
  if (mine.length) {
    if (!reached) ok = false;
    else {
      if (used > budget) ok = false;
      if (reached.maxQty != null && giftQty > reached.maxQty) ok = false;
      if (reached.allowedSkus && mine.some((g) => !reached.allowedSkus!.map(normSku).includes(normSku(g.sku)))) ok = false;
    }
    if (!rule.giftGroupId || mine.some((g) => g.groupId !== rule.giftGroupId)) ok = false;
    if (mine.some((g) => unit(g) <= 0)) ok = false;
  }
  return {
    revenue,
    tierId: reached?.id ?? null,
    nextTierId: next?.id ?? null,
    amountToNextTier: next ? Math.max(0, next.min - revenue) : 0,
    budget,
    used,
    giftQty,
    ok,
    hint: next && revenue > 0 ? `mua thêm ${formatVND(next.min - revenue)} để đạt mức ${formatVND(next.min)}` : null,
    noGiftWarning: !!reached && budget > 0 && mine.length === 0,
  };
}

function expectMatchesOracle(calc: ReturnType<typeof calculateOrder>, rule: TierGiftRule, o: OracleTier, ctx: string) {
  const r = tierRes(calc, rule.id);
  const got = {
    revenue: r.revenue,
    tierId: r.tier?.id ?? null,
    nextTierId: r.nextTier?.id ?? null,
    amountToNextTier: r.amountToNextTier,
    budget: r.budget,
    used: r.used,
    remaining: r.remaining,
    giftQty: r.giftQty,
    ok: r.ok,
    maxQty: r.maxQty,
    tierIndex: r.tierIndex,
  };
  const reached = rule.tiers.find((t) => t.id === o.tierId) ?? null;
  const want = {
    revenue: o.revenue,
    tierId: o.tierId,
    nextTierId: o.nextTierId,
    amountToNextTier: o.amountToNextTier,
    budget: o.budget,
    used: o.used,
    remaining: o.budget - o.used,
    giftQty: o.giftQty,
    ok: o.ok,
    maxQty: reached?.maxQty ?? null,
    tierIndex: reached ? r.tiers.findIndex((t) => t.id === reached.id) : -1,
  };
  expect(got, ctx).toEqual(want);
  // tiers returned sorted ascending
  for (let i = 1; i < r.tiers.length; i++) expect(r.tiers[i].min).toBeGreaterThanOrEqual(r.tiers[i - 1].min);
  const ruleIssues = calc.issues.filter((i) => i.ruleId === rule.id);
  const hints = ruleIssues.filter((i) => i.level === "info" && i.message.includes("mua thêm"));
  if (o.hint) {
    expect(hints.length, ctx).toBe(1);
    expect(hints[0].message, ctx).toContain(o.hint);
  } else expect(hints.length, ctx).toBe(0);
  expect(ruleIssues.some((i) => i.level === "error"), ctx).toBe(!o.ok);
  expect(ruleIssues.some((i) => i.level === "warning" && i.message.includes("chưa chọn quà")), ctx).toBe(o.noGiftWarning);
}

// ───────────────────────── (a) seed promotion KM 11/2026 ─────────────────────────

describe("KM tháng 11/2026 — Mua vợt tặng vợt theo doanh số (seed, retail basis)", () => {
  const P = seedProgram("seed-km-2026-11");
  const R = "r-km11-tier";
  const APPLY = "g-km11-apply";
  const GIFT = "g-km11-gift";
  const SKU = "P-AYPR285-3"; // wholesale 1.415.782
  const calc = (qty: number, gifts: OrderGift[] = []) => calculateOrder(P, { lines: [line(P, APPLY, SKU, qty)], gifts });

  it("7 × 1.415.782 = 9.910.474 → no tier; hint: mua thêm 89.526 đ để đạt mức 10.000.000 đ", () => {
    const c = calc(7);
    const r = tierRes(c, R);
    expect(r.revenue).toBe(9_910_474);
    expect(r.tier).toBeNull();
    expect(r.budget).toBe(0);
    expect(r.amountToNextTier).toBe(89_526);
    expect(c.issues.some((i) => i.message.includes("mua thêm 89.526 đ để đạt mức 10.000.000 đ"))).toBe(true);
    expect(c.hasError).toBe(false);
  });

  it("8 × = 11.326.256 → tier 10M: budget 1.200.000, max 1 gift, 6 allowed SKUs; next: 8.673.744 to 20M", () => {
    const c = calc(8, [gift(P, R, GIFT, "P-AYPT399-4")]);
    const r = tierRes(c, R);
    expect(r.revenue).toBe(11_326_256);
    expect(r.tier?.id).toBe("t-km11-1");
    expect(r.budget).toBe(1_200_000);
    expect(r.used).toBe(1_200_000); // retail
    expect(r.remaining).toBe(0);
    expect(r.maxQty).toBe(1);
    expect(r.allowedSkus).toHaveLength(6);
    expect(r.amountToNextTier).toBe(8_673_744);
    expect(r.ok).toBe(true);
    expect(c.hasError).toBe(false);
    expect(c.giftQty).toBe(1);
    expect(c.giftValue).toBe(1_200_000);
  });

  it("tier 10M: a non-allowed SKU P-AYPT563-4 (1.380.000 retail) is an error (exceeds AND not allowed)", () => {
    const c = calc(8, [gift(P, R, GIFT, "P-AYPT563-4")]);
    const r = tierRes(c, R);
    expect(r.used).toBe(1_380_000);
    expect(r.remaining).toBe(-180_000);
    expect(r.ok).toBe(false);
    expect(errorsOf(c, R).length).toBe(2);
    expect(c.hasError).toBe(true);
  });

  it("tier 10M: 2 × P-AYPT477-4 (2 × 1.050.000) → error on both qty and budget", () => {
    const c = calc(8, [gift(P, R, GIFT, "P-AYPT477-4", 2)]);
    const r = tierRes(c, R);
    expect(r.used).toBe(2_100_000);
    expect(r.giftQty).toBe(2);
    expect(errorsOf(c, R).length).toBe(2);
  });

  it("15 × = 21.236.730 → tier 20M: 3.190.000, any gift SKU, no qty limit: 1.200.000+1.070.000+... exactly 3.190.000 is ok", () => {
    // 1.070.000 + 1.070.000 + 1.050.000 = 3.190.000 exactly
    const c = calc(15, [gift(P, R, GIFT, "P-AYPT467-4"), gift(P, R, GIFT, "P-AYPT471-4"), gift(P, R, GIFT, "P-AYPT477-4")]);
    const r = tierRes(c, R);
    expect(r.revenue).toBe(21_236_730);
    expect(r.tier?.id).toBe("t-km11-2");
    expect(r.budget).toBe(3_190_000);
    expect(r.used).toBe(3_190_000);
    expect(r.ok).toBe(true);
    expect(r.amountToNextTier).toBe(50_000_000 - 21_236_730);
    // non-allowed at tier 1 SKU now ok
    const c2 = calc(15, [gift(P, R, GIFT, "P-AYPM394-4", 2)]); // 2.900.000
    expect(tierRes(c2, R).ok).toBe(true);
    // 1 đ over → error
    const c3 = calc(15, [gift(P, R, GIFT, "P-AYPM394-4", 2), { ...gift(P, R, GIFT, "P-AYPT477-4"), retailPrice: 290_001 }]);
    expect(tierRes(c3, R).remaining).toBe(-1);
    expect(tierRes(c3, R).ok).toBe(false);
  });

  it("order shrinks from tier 20M back to tier 10M: gifts stay in the order and are flagged (error), not dropped", () => {
    const gifts = [gift(P, R, GIFT, "P-AYPM394-4", 2)];
    expect(calc(15, gifts).hasError).toBe(false);
    const c = calc(14, gifts); // 19.820.948
    const r = tierRes(c, R);
    expect(r.revenue).toBe(19_820_948);
    expect(r.tier?.id).toBe("t-km11-1");
    expect(r.used).toBe(2_900_000);
    expect(errorsOf(c, R).length).toBe(3); // budget, qty, not allowed
    expect(c.gifts).toHaveLength(1); // still listed
    expect(c.giftValue).toBe(2_900_000);
    // shrinks below 10M → "chưa đạt mức" error
    const c0 = calc(7, gifts);
    expect(tierRes(c0, R).tier).toBeNull();
    expect(errorsOf(c0, R)).toHaveLength(1);
    expect(errorsOf(c0, R)[0].message).toContain("chưa đạt mức doanh số tối thiểu 10.000.000 đ");
  });

  it("boundaries: revenue exactly 10.000.000 reaches tier 1; 9.999.999 does not; 200.000.000 reaches the top tier (72.400.000)", () => {
    const at = (amount: number) => tierRes(calculateOrder(P, { lines: [rawLine(APPLY, "X", amount, 1)], gifts: [] }), R);
    expect(at(10_000_000).tier?.id).toBe("t-km11-1");
    expect(at(10_000_000).amountToNextTier).toBe(10_000_000);
    expect(at(9_999_999).tier).toBeNull();
    expect(at(9_999_999).amountToNextTier).toBe(1);
    expect(at(19_999_999).tier?.id).toBe("t-km11-1");
    expect(at(20_000_000).tier?.id).toBe("t-km11-2");
    expect(at(200_000_000).budget).toBe(72_400_000);
    expect(at(200_000_000).nextTier).toBeNull();
    expect(at(200_000_000).amountToNextTier).toBe(0);
  });

  it("frozen rules of a confirmed order are used, not the edited program", () => {
    const frozen = structuredClone(P.rules);
    const edited = structuredClone(P);
    (edited.rules[0] as TierGiftRule).tiers[0].limitValue = 500_000;
    (edited.rules[0] as TierGiftRule).tiers[0].min = 12_000_000;
    const gifts = [gift(P, R, GIFT, "P-AYPT399-4")];
    const live = calculateOrder(edited, { lines: [line(P, APPLY, SKU, 8)], gifts });
    expect(tierRes(live, R).tier).toBeNull();
    expect(live.hasError).toBe(true);
    const confirmed = calculateOrder(edited, { lines: [line(P, APPLY, SKU, 8)], gifts, frozenRules: frozen });
    expect(tierRes(confirmed, R).budget).toBe(1_200_000);
    expect(confirmed.hasError).toBe(false);
  });
});

// ───────────────────────── (a) seed promotion Ưu đãi B2 ─────────────────────────

describe("Khuyến mại Hè 2026 — Ưu đãi B2 (percent of DM02 revenue, wholesale gift value)", () => {
  const P = seedProgram("seed-km-2026-he");
  const B2 = "r-he-b2";
  const DM01 = "g-he-dm01";
  const DM02 = "g-he-dm02";
  const DM03 = "g-he-dm03";
  const SKU = "P-AYPP028-1"; // wholesale 3.161.455
  const calc = (qty: number, gifts: OrderGift[] = [], extra: OrderLine[] = []) =>
    calculateOrder(P, { lines: [line(P, DM02, SKU, qty), ...extra], gifts });

  it("2 × = 6.322.910 → no tier; hint mua thêm 1.677.090 đ để đạt mức 8.000.000 đ (tặng tối đa 15% doanh số)", () => {
    const c = calc(2);
    expect(tierRes(c, B2).revenue).toBe(6_322_910);
    expect(tierRes(c, B2).tier).toBeNull();
    expect(c.issues.some((i) => i.message.includes("mua thêm 1.677.090 đ để đạt mức 8.000.000 đ (tặng tối đa 15% doanh số)"))).toBe(true);
  });

  it("3 × = 9.484.365 → 15% = 1.422.654,75 → budget 1.422.654; 2 × P-AYPU109-4 (wholesale 652.909) ok, 3 × over by 536.073", () => {
    const ok = calc(3, [gift(P, B2, DM01, "P-AYPU109-4", 2)]);
    const r = tierRes(ok, B2);
    expect(r.revenue).toBe(9_484_365);
    expect(r.budget).toBe(1_422_654);
    expect(r.used).toBe(1_305_818);
    expect(r.ok).toBe(true);
    const over = calc(3, [gift(P, B2, DM01, "P-AYPU109-4", 3)]);
    expect(tierRes(over, B2).used).toBe(1_958_727);
    expect(tierRes(over, B2).remaining).toBe(-536_073);
    expect(errorsOf(over, B2)[0].message).toContain("vượt 536.073 đ");
  });

  it("7 × = 22.130.185 → 18% = 3.983.433; 16 × = 50.583.280 → 27% = 13.657.485 and top tier", () => {
    const r7 = tierRes(calc(7), B2);
    expect(r7.budget).toBe(3_983_433);
    expect(r7.amountToNextTier).toBe(12_869_815);
    const r16 = tierRes(calc(16), B2);
    expect(r16.tier?.id).toBe("t-he-4");
    expect(r16.budget).toBe(13_657_485);
    expect(r16.nextTier).toBeNull();
  });

  it("exact boundaries 8M/20M/35M/50M: 15/18/20/27% exact; min − 1 stays on lower tier (floor)", () => {
    const at = (amount: number) => tierRes(calculateOrder(P, { lines: [rawLine(DM02, "X", amount, 1)], gifts: [] }), B2);
    expect([at(8_000_000).budget, at(20_000_000).budget, at(35_000_000).budget, at(50_000_000).budget]).toEqual([
      1_200_000, 3_600_000, 7_000_000, 13_500_000,
    ]);
    expect(at(7_999_999).tier).toBeNull();
    expect(at(19_999_999).budget).toBe(2_999_999); // 15% of 19.999.999 = 2.999.999,85
    expect(at(34_999_999).budget).toBe(6_299_999); // 18% = 6.299.999,82
    expect(at(49_999_999).budget).toBe(9_999_999); // 20% = 9.999.999,8
  });

  it("same SKU bought in DM01 (discounted by Ưu đãi A) does not count to B2; only DM02 lines count", () => {
    // P-AYPT417-5 is in DM01 and DM02. 2 in DM01 + 1 DM03 → discount A active on DM01 lines.
    const c = calculateOrder(P, {
      lines: [line(P, DM01, "P-AYPT417-5", 2), line(P, DM03, "P-AYPM444-3", 1), line(P, DM02, "P-AYPT417-5", 5)],
      gifts: [],
    });
    expect(c.lines[0].discountPercent).toBe(45);
    expect(tierRes(c, B2).revenue).toBe(5 * 1_649_455); // 8.247.275
    expect(tierRes(c, B2).budget).toBe(1_237_091); // floor(1.237.091,25)
  });

  it("B2 gifts are valued at WHOLESALE (original app: don_gia_ban_buon), not retail and not the 45% price", () => {
    const c = calc(3, [gift(P, B2, DM01, "P-AYPT417-5", 1)]);
    expect(tierRes(c, B2).used).toBe(1_649_455);
    expect(c.gifts[0].unitValue).toBe(1_649_455);
  });

  it("B1 text gifts and B2 chosen gifts add up in giftQty; giftValue includes the text gift at its giftTextValue (150.000 đ)", () => {
    const c = calculateOrder(P, {
      lines: [line(P, DM02, SKU, 3), line(P, DM01, "P-AYPU109-4", 1)],
      gifts: [gift(P, B2, DM01, "P-AYPU109-4", 2)],
    });
    expect(c.giftQty).toBe(3); // 1 N65 + 2 rackets
    expect(c.giftValue).toBe(1_455_818); // 1 N65 × 150.000 + 2 × 652.909 wholesale
    expect(c.hasError).toBe(false);
  });
});

// ───────────────────────── targeted rule semantics ─────────────────────────

describe("tier_gift semantics on synthetic programs", () => {
  it("revenue = after-discount amount of source groups only (discount on A lowers revenue below a tier)", () => {
    const disc: DiscountRule = {
      id: "d",
      type: "discount",
      name: "d",
      targetGroupIds: ["A"],
      discountPercent: 10,
      discountBasis: "wholesale",
      minQty: null,
      maxQty: null,
      requireGroupIds: [],
      requireMinQty: 0,
    };
    const rule = tg("t", [tier("t1", 10_000_000, "amount", 1_000_000)]);
    const p = mkProgram([disc, rule]);
    const c = calculateOrder(p, { lines: [rawLine("A", "a", 1_000_000, 10), rawLine("C", "c", 5_000_000, 3)], gifts: [] });
    expect(tierRes(c, "t").revenue).toBe(9_000_000);
    expect(tierRes(c, "t").tier).toBeNull();
    expect(tierRes(c, "t").amountToNextTier).toBe(1_000_000);
  });

  it("unsorted tiers: highest min reached wins regardless of input order", () => {
    const rule = tg("t", [tier("t3", 30_000_000, "amount", 3), tier("t1", 10_000_000, "amount", 1), tier("t2", 20_000_000, "amount", 2)]);
    const c = calculateOrder(mkProgram([rule]), { lines: [rawLine("A", "a", 25_000_000, 1)], gifts: [] });
    const r = tierRes(c, "t");
    expect(r.tier?.id).toBe("t2");
    expect(r.nextTier?.id).toBe("t3");
    expect(r.tiers.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(rule.tiers.map((t) => t.id)).toEqual(["t3", "t1", "t2"]); // input untouched
  });

  // Ambiguity: two tiers with the same min. Engine silently picks the one listed LAST in the rule, no warning.
  it("duplicate mins: engine picks the last-listed one without warning (documented ambiguity)", () => {
    const rule = tg("t", [tier("big", 10_000_000, "amount", 5_000_000), tier("small", 10_000_000, "amount", 1_000_000)]);
    const c = calculateOrder(mkProgram([rule]), { lines: [rawLine("A", "a", 10_000_000, 1)], gifts: [] });
    expect(tierRes(c, "t").tier?.id).toBe("small");
    expect(c.issues.some((i) => i.ruleId === "t" && /trùng/.test(i.message))).toBe(false);
  });
  it.skip("AMBIGUITY: duplicate tier mins should be flagged as a configuration warning (or highest limit chosen)", () => {
    const rule = tg("t", [tier("big", 10_000_000, "amount", 5_000_000), tier("small", 10_000_000, "amount", 1_000_000)]);
    const c = calculateOrder(mkProgram([rule]), { lines: [rawLine("A", "a", 10_000_000, 1)], gifts: [] });
    expect(c.issues.some((i) => i.ruleId === "t" && i.level === "warning")).toBe(true);
  });

  it("maxQty null = unlimited qty; maxQty 2 → 3 gifts is error even within budget", () => {
    const mk = (maxQty: number | null) => mkProgram([tg("t", [tier("t1", 1, "amount", 10_000_000, maxQty)])]);
    const order: OrderInput = { lines: [rawLine("A", "a", 5_000_000, 1)], gifts: [rawGift("t", "G", "G2", 1_070_000, 749_000, 3)] };
    expect(calculateOrder(mk(null), order).hasError).toBe(false);
    const c = calculateOrder(mk(2), order);
    expect(tierRes(c, "t").ok).toBe(false);
    expect(errorsOf(c, "t")[0].message).toContain("tối đa 2 sản phẩm quà (đang chọn 3)");
  });

  it("allowedSkus is matched case/space-insensitively; null = whole gift group", () => {
    const p = mkProgram([tg("t", [tier("t1", 1, "amount", 10_000_000, null, [" g1 "])])]);
    const ok = calculateOrder(p, { lines: [rawLine("A", "a", 5_000_000, 1)], gifts: [rawGift("t", "G", "G1", 1_200_000, 840_000)] });
    expect(ok.hasError).toBe(false);
    const bad = calculateOrder(p, { lines: [rawLine("A", "a", 5_000_000, 1)], gifts: [rawGift("t", "G", "G2", 1_070_000, 749_000)] });
    expect(errorsOf(bad, "t")[0].message).toContain("G2");
  });

  it("gift whose groupId is not the rule's gift group → error even if within budget", () => {
    const p = mkProgram([tg("t", [tier("t1", 1, "amount", 10_000_000)])]);
    const c = calculateOrder(p, { lines: [rawLine("A", "a", 5_000_000, 1)], gifts: [rawGift("t", "H", "H1", 500_000, 350_000)] });
    expect(tierRes(c, "t").ok).toBe(false);
    expect(c.hasError).toBe(true);
  });

  // BUG (UI/engine mismatch): the gift picker (orderOps.buildGiftRows) marks a chosen gift whose SKU is no longer in
  // the gift group's item list as «Không còn được chọn» (invalid), but the engine accepts it (only groupId is
  // compared), so hasError stays false and the order can be confirmed with that gift at its stale snapshot price.
  it("[fixed] gift with the right groupId but a SKU not in the gift group's items is an error", () => {
    const p = mkProgram([tg("t", [tier("t1", 1, "amount", 10_000_000)])]);
    const c = calculateOrder(p, { lines: [rawLine("A", "a", 5_000_000, 1)], gifts: [rawGift("t", "G", "GONE-99", 900_000, 600_000)] });
    expect(tierRes(c, "t").ok).toBe(false);
  });

  it("gift values use the gift's snapshot prices on the chosen basis (retail vs wholesale)", () => {
    const g = rawGift("t", "G", "G1", 1_200_000, 840_000, 2);
    const r = (basis: "retail" | "wholesale") =>
      tierRes(calculateOrder(mkProgram([tg("t", [tier("t1", 1, "amount", 10_000_000)], { giftPriceBasis: basis })]), { lines: [rawLine("A", "a", 1, 1)], gifts: [g] }), "t");
    expect(r("retail").used).toBe(2_400_000);
    expect(r("wholesale").used).toBe(1_680_000);
  });

  it("gift with no price on the rule's basis is an error (would otherwise be free of budget)", () => {
    const p = mkProgram([tg("t", [tier("t1", 1, "amount", 10_000_000)])]);
    const c = calculateOrder(p, { lines: [rawLine("A", "a", 5_000_000, 1)], gifts: [rawGift("t", "G", "G1", 0, 840_000)] });
    expect(tierRes(c, "t").ok).toBe(false);
  });

  it("multiple tier rules are independent: own revenue, own budget, own gifts", () => {
    const r1 = tg("t1", [tier("a1", 5_000_000, "amount", 1_000_000)], { sourceGroupIds: ["A"] });
    const r2 = tg("t2", [tier("b1", 5_000_000, "percent", 10)], { sourceGroupIds: ["A", "B"], giftGroupId: "H", giftPriceBasis: "wholesale" });
    const c = calculateOrder(mkProgram([r1, r2]), {
      lines: [rawLine("A", "a", 3_000_000, 2), rawLine("B", "b", 1_000_000, 4)],
      gifts: [rawGift("t1", "G", "G2", 1_070_000, 749_000), rawGift("t2", "H", "H1", 500_000, 350_000, 2)],
    });
    expect(tierRes(c, "t1").revenue).toBe(6_000_000);
    expect(tierRes(c, "t1").ok).toBe(false); // 1.070.000 > 1.000.000
    expect(tierRes(c, "t2").revenue).toBe(10_000_000);
    expect(tierRes(c, "t2").budget).toBe(1_000_000);
    expect(tierRes(c, "t2").used).toBe(700_000);
    expect(tierRes(c, "t2").ok).toBe(true);
    expect(c.giftQty).toBe(3);
    expect(c.giftValue).toBe(1_070_000 + 700_000);
  });

  it("buy_x_get_y 'same' auto gifts do not touch tier revenue/budget but add to giftQty/giftValue", () => {
    const bx: BuyXGetYRule = { id: "bx", type: "buy_x_get_y", name: "bx", sourceGroupIds: ["A"], buyQty: 2, getQty: 1, giftMode: "same", giftGroupId: null, giftText: "" };
    const c = calculateOrder(mkProgram([bx, tg("t", [tier("t1", 1_000_000, "amount", 500_000)])]), {
      lines: [rawLine("A", "a", 300_000, 5)],
      gifts: [rawGift("t", "G", "G2", 400_000, 280_000)],
    });
    expect(tierRes(c, "t").revenue).toBe(1_500_000); // free rackets are not revenue
    expect(tierRes(c, "t").used).toBe(400_000);
    expect(c.giftQty).toBe(3); // 2 auto + 1 chosen
    expect(c.giftValue).toBe(2 * 300_000 + 400_000);
  });

  it("negative / zero limit → budget 0, any gift is error, no 'chưa chọn quà' warning", () => {
    const p = mkProgram([tg("t", [tier("t1", 1, "amount", -5)])]);
    const empty = calculateOrder(p, { lines: [rawLine("A", "a", 5_000_000, 1)], gifts: [] });
    expect(tierRes(empty, "t").budget).toBe(0);
    expect(empty.issues.some((i) => i.message.includes("chưa chọn quà"))).toBe(false);
    expect(calculateOrder(p, { lines: [rawLine("A", "a", 5_000_000, 1)], gifts: [rawGift("t", "G", "G1", 1, 1)] }).hasError).toBe(true);
  });

  it("revenue 0 never reaches a tier, even one with min 0", () => {
    const p = mkProgram([tg("t", [tier("t0", 0, "amount", 1_000_000)])]);
    const c = calculateOrder(p, { lines: [rawLine("C", "c", 5_000_000, 1)], gifts: [] });
    expect(tierRes(c, "t").tier).toBeNull();
    expect(c.hasError).toBe(false);
  });

  // Minor: % budgets with more than 2 decimals fall back to float and can lose 1 đ.
  // 10.000.000 × 1,005% = 100.500 exactly, engine gives 100.499. The UI PercentInput accepts any decimals.
  it("[fixed] 1,005% of 10.000.000 is exactly 100.500 đ", () => {
    const p = mkProgram([tg("t", [tier("t1", 1, "percent", 1.005)])]);
    const c = calculateOrder(p, { lines: [rawLine("A", "a", 10_000_000, 1)], gifts: [] });
    expect(tierRes(c, "t").budget).toBe(100_500);
  });

  // Doc mismatch: CalcResult.gifts is documented as "toàn bộ quà hợp lệ" but invalid chosen gifts are included,
  // so giftValue/giftQty count gifts that are in error. Accepted while hasError blocks confirmation; documented here.
  it("invalid chosen gifts are still counted in calc.gifts/giftValue (doc says 'hợp lệ')", () => {
    const p = mkProgram([tg("t", [tier("t1", 10_000_000, "amount", 1_000_000)])]);
    const c = calculateOrder(p, { lines: [rawLine("A", "a", 1_000_000, 1)], gifts: [rawGift("t", "G", "G1", 1_200_000, 840_000)] });
    expect(c.hasError).toBe(true);
    expect(c.giftValue).toBe(1_200_000);
  });
});

// ───────────────────────── (b) randomized property test ─────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("randomized: engine agrees with the oracle on 4000 orders", () => {
  it("revenue, tier, next tier, budget, used, qty, ok, hints, warnings, hasError, giftQty/giftValue", () => {
    const rnd = mulberry32(20261121);
    const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const pickOne = <T,>(xs: T[]) => xs[int(0, xs.length - 1)];
    const giftItems = mkProgram([]).groups.find((g) => g.id === "G")!.items;
    const stats = { orders: 0, reached: 0, errors: 0, boundary: 0, withGifts: 0 };

    for (let iter = 0; iter < 4000; iter++) {
      // lines
      const lines: OrderLine[] = [];
      const nLines = int(0, 6);
      for (let i = 0; i < nLines; i++) {
        const w = rnd() < 0.05 ? 0 : int(1, 5_000) * (rnd() < 0.5 ? 1000 : 1) + int(0, 999);
        lines.push(rawLine(pickOne(["A", "B", "C"]), `L${i}`, w, int(0, 12), Math.round(w * 1.4)));
      }
      const useDiscount = rnd() < 0.3;
      const pct = int(5, 60);
      const lineAmounts = lines.map((l) => {
        let unit = l.wholesalePrice;
        if (useDiscount && l.groupId === "A" && l.wholesalePrice > 0) {
          const d = Math.round((l.wholesalePrice * (100 - pct)) / 100);
          if (d < unit) unit = d;
        }
        return { groupId: l.groupId, amount: unit * l.qty };
      });

      // rules
      const nRules = int(1, 2);
      const rules: TierGiftRule[] = [];
      for (let r = 0; r < nRules; r++) {
        const sources = pickOne([["A"], ["B"], ["A", "B"], ["A", "C"]]);
        const revenue = lineAmounts.filter((l) => sources.includes(l.groupId)).reduce((s, l) => s + l.amount, 0);
        const mins = new Set<number>();
        const nTiers = int(1, 4);
        while (mins.size < nTiers) mins.add(int(1, 60) * 500_000 + (rnd() < 0.3 ? int(1, 499_999) : 0));
        const minList = [...mins];
        if (rnd() < 0.25 && revenue > 0) minList[int(0, minList.length - 1)] = revenue + pickOne([0, 1, -1]);
        if (new Set(minList).size !== minList.length || minList.some((m) => m <= 0)) continue; // keep mins distinct & positive
        const tiers: GiftTier[] = minList.map((min, k) => {
          const percent = rnd() < 0.5;
          return tier(
            `r${r}t${k}`,
            min,
            percent ? "percent" : "amount",
            percent ? int(100, 3000) / 100 : int(0, 8_000) * 1000,
            rnd() < 0.5 ? null : int(1, 4),
            rnd() < 0.6 ? null : giftItems.filter(() => rnd() < 0.6).map((g) => (rnd() < 0.3 ? ` ${g.sku.toLowerCase()} ` : g.sku)),
          );
        }).filter((t) => !t.allowedSkus || t.allowedSkus.length > 0);
        if (tiers.length === 0) continue;
        rules.push(
          tg(`r${r}`, tiers, {
            sourceGroupIds: sources,
            giftGroupId: rnd() < 0.9 ? "G" : "H",
            giftPriceBasis: rnd() < 0.5 ? "retail" : "wholesale",
          }),
        );
      }
      if (rules.length === 0) continue;

      // gifts (unique per (ruleId, sku))
      const gifts: OrderGift[] = [];
      const seen = new Set<string>();
      const nGifts = int(0, 4);
      for (let i = 0; i < nGifts; i++) {
        const ruleId = rnd() < 0.05 ? "gone" : pickOne(rules).id;
        const fromH = rnd() < 0.1;
        const item = fromH ? { sku: "H1", retailPrice: 500_000, wholesalePrice: 350_000 } : pickOne(giftItems);
        const key = `${ruleId}|${item.sku}`;
        if (seen.has(key)) continue;
        seen.add(key);
        gifts.push(rawGift(ruleId, fromH ? "H" : "G", item.sku, rnd() < 0.03 ? 0 : item.retailPrice, item.wholesalePrice, int(0, 3)));
      }

      const disc: DiscountRule = {
        id: "disc",
        type: "discount",
        name: "disc",
        targetGroupIds: ["A"],
        discountPercent: pct,
        discountBasis: "wholesale",
        minQty: null,
        maxQty: null,
        requireGroupIds: [],
        requireMinQty: 0,
      };
      const programRules: Rule[] = useDiscount ? [disc, ...rules] : [...rules];
      const program = mkProgram(rnd() < 0.2 ? [] : programRules);
      const frozen = program.rules.length === 0;
      const calc = calculateOrder(program, frozen ? { lines, gifts, frozenRules: programRules } : { lines, gifts });

      const ctx = `iter ${iter}`;
      let anyError = false;
      for (const rule of rules) {
        const o = oracleTier(rule, lineAmounts, gifts);
        expectMatchesOracle(calc, rule, o, `${ctx} rule ${rule.id} ${JSON.stringify({ rule, lines, gifts, useDiscount, pct })}`);
        if (!o.ok) anyError = true;
        if (o.tierId) stats.reached++;
        if (rule.tiers.some((t) => t.min === o.revenue || t.min === o.revenue + 1)) stats.boundary++;
      }
      const orphan = gifts.some((g) => g.ruleId === "gone" && g.qty > 0);
      expect(calc.hasError, ctx).toBe(anyError || orphan);
      stats.orders++;
      if (anyError) stats.errors++;
      if (gifts.length) stats.withGifts++;
      const counted = gifts.filter((g) => g.ruleId !== "gone" && g.qty > 0);
      expect(calc.giftQty, ctx).toBe(counted.reduce((s, g) => s + g.qty, 0));
      const valueOf = (g: OrderGift) => {
        const rule = rules.find((r) => r.id === g.ruleId)!;
        return (rule.giftPriceBasis === "retail" ? g.retailPrice : g.wholesalePrice) * g.qty;
      };
      expect(calc.giftValue, ctx).toBe(counted.reduce((s, g) => s + valueOf(g), 0));
    }
    // the generator really exercises the interesting paths
    expect(stats.orders).toBeGreaterThan(3000);
    expect(stats.reached).toBeGreaterThan(500);
    expect(stats.errors).toBeGreaterThan(300);
    expect(stats.boundary).toBeGreaterThan(200);
    expect(stats.withGifts).toBeGreaterThan(1500);
  });
});
