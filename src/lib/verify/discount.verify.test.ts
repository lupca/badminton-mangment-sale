// Independent verification of the «Giảm giá» (discount) rule and of how line prices and order totals are derived.
//
// The expected behaviour comes from the business descriptions, not from engine.ts:
//  - types.ts: "Đơn giá sau giảm = giá gốc × (1 − %)"; "Tổng số lượng mua ở danh mục đích phải >= minQty và <= maxQty
//    (null = không ràng buộc)"; "Phải mua kèm ít nhất requireMinQty sản phẩm ở các danh mục này (rỗng = không yêu cầu)";
//    "Mọi số tiền đều là VND (đồng), số nguyên"; totals: discountAmount = totalWholesale − totalAmount.
//  - DiscountRuleForm.tsx: example price uses Math.round(price × (1 − %/100)); "Nếu giá sỉ của sản phẩm còn thấp hơn mức
//    này thì đơn vẫn tính theo giá sỉ" (→ unit = min(giá sỉ, giá sau giảm)); empty min/max box = no bound on that side;
//    no require group ticked = no requirement; require qty 0 = requirement not in force.
//  - Original display-only app (git dec7139): Ưu đãi A = 2–4 units of DM01 (both inclusive) + ≥1 unit of DM03, 45% off
//    the RETAIL price; over 4 units → no discount at all ("vượt quá hạn gói 02-04 cái … tách dòng đơn"); its hard-coded
//    gia_sau_giam equals round(retail × 0.55) for every DM01 item.
//  - Default selling price of a line is the wholesale price (README / original app: totals start from don_gia_ban_buon).
//
// The oracle below is written from those statements only. Run: npx vitest run src/lib/verify/discount.verify.test.ts
import { describe, expect, it } from "vitest";
import seed from "../../seed/seed.json";
import type {
  BuyXGetYRule,
  CalcResult,
  DB,
  DiscountResult,
  DiscountRule,
  OrderLine,
  ProductGroup,
  Program,
  Rule,
  TierGiftResult,
  TierGiftRule,
} from "../../types";
import { calculateOrder, type OrderInput } from "../engine";

// ───────────────────────── helpers ─────────────────────────

function grp(id: string): ProductGroup {
  return { id, name: `DM ${id}`, items: [] };
}
function prog(rules: Rule[], groupIds = ["A", "B", "C"]): Program {
  return {
    id: "p",
    name: "P",
    brand: "Li-Ning",
    startDate: null,
    endDate: null,
    note: "",
    groups: groupIds.map(grp),
    rules,
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
  };
}
/** line(group, sku, qty, wholesale, retail) */
function ln(groupId: string, sku: string, qty: number, wholesalePrice: number, retailPrice = wholesalePrice): OrderLine {
  return { groupId, sku, name: sku, retailPrice, wholesalePrice, qty };
}
function disc(extra: Partial<DiscountRule> = {}): DiscountRule {
  return {
    id: "d1",
    type: "discount",
    name: "Giảm",
    targetGroupIds: ["A"],
    discountPercent: 10,
    discountBasis: "wholesale",
    minQty: null,
    maxQty: null,
    requireGroupIds: [],
    requireMinQty: 0,
    ...extra,
  };
}
function ord(lines: OrderLine[], frozenRules?: Rule[]): OrderInput {
  return frozenRules ? { lines, gifts: [], frozenRules } : { lines, gifts: [] };
}
function dres(r: CalcResult, id = "d1"): DiscountResult {
  const x = r.rules.find((y) => y.ruleId === id);
  if (!x || x.type !== "discount") throw new Error("no discount result " + id);
  return x;
}

// ───────────────────────── oracle ─────────────────────────

const qtyOf = (q: unknown) => {
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; // no negative / fractional units
};
const moneyOf = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; // whole đồng, no negative prices
};

/** round(base × (100 − p) / 100) to the nearest đồng, .5 up, computed exactly (p with up to 6 decimals). */
function discountedUnit(base: number, percent: number): number {
  const micro = BigInt(Math.round(percent * 1_000_000)); // percent in millionths
  const SCALE = 100_000_000n; // 100 % in millionths
  const num = BigInt(base) * (SCALE - micro);
  return Number((num * 2n + SCALE) / (2n * SCALE));
}

interface OLine {
  qty: number;
  unit: number;
  amount: number;
  ruleId: string | null;
  percent: number | null;
}
interface ORule {
  id: string;
  eligible: boolean;
  targetQty: number;
  requireQty: number;
  savedAmount: number;
}
interface Oracle {
  lines: OLine[];
  totalQty: number;
  totalRetail: number;
  totalWholesale: number;
  totalAmount: number;
  discountAmount: number;
  rules: ORule[];
}

function oracle(program: Program | null, input: OrderInput): Oracle {
  const rules = input.frozenRules ?? program?.rules ?? [];
  const L = input.lines.map((l) => {
    const qty = qtyOf(l.qty);
    const w = moneyOf(l.wholesalePrice);
    return { groupId: l.groupId, qty, w, r: moneyOf(l.retailPrice), unit: w, ruleId: null as string | null, percent: null as number | null };
  });
  const sumQty = (ids: string[]) => L.reduce((s, l) => (ids.includes(l.groupId) ? s + l.qty : s), 0);
  const ruleOut: ORule[] = [];
  for (const rule of rules) {
    if (rule.type !== "discount") continue;
    const p = Number(rule.discountPercent);
    const targetQty = sumQty(rule.targetGroupIds);
    const needReq = rule.requireGroupIds.length > 0 && rule.requireMinQty > 0;
    // Hàng mua kèm là sản phẩm thêm (chủ dự án chọn 2026-11-21): ở danh mục chung, chỉ phần dư ngoài mức tối thiểu được giảm.
    const both = rule.requireGroupIds.filter((id) => rule.targetGroupIds.includes(id));
    const reserved = Math.max(0, Math.max(rule.minQty ?? 1, 1) - sumQty(rule.targetGroupIds.filter((id) => !both.includes(id))));
    const requireQty = !needReq
      ? 0
      : both.length === 0
        ? sumQty(rule.requireGroupIds)
        : sumQty(rule.requireGroupIds.filter((id) => !both.includes(id))) + Math.max(0, sumQty(both) - reserved);
    const configured = rule.targetGroupIds.length > 0 && p > 0 && p <= 100;
    const eligible =
      configured &&
      targetQty > 0 &&
      (rule.minQty == null || targetQty >= rule.minQty) &&
      (rule.maxQty == null || targetQty <= rule.maxQty) &&
      (!needReq || requireQty >= rule.requireMinQty);
    if (eligible) {
      for (const l of L) {
        if (!rule.targetGroupIds.includes(l.groupId)) continue;
        const base = rule.discountBasis === "retail" ? l.r : l.w;
        if (base <= 0) continue; // no base price → cannot discount, stays at wholesale
        const d = discountedUnit(base, p);
        if (d < l.unit) {
          // lowest price wins; on a tie the earlier rule keeps the line
          l.unit = d;
          l.ruleId = rule.id;
          l.percent = p;
        }
      }
    }
    ruleOut.push({ id: rule.id, eligible, targetQty, requireQty, savedAmount: 0 });
  }
  for (const o of ruleOut) {
    o.savedAmount = L.reduce((s, l) => (l.ruleId === o.id ? s + (l.w - l.unit) * l.qty : s), 0);
  }
  const lines = L.map((l) => ({ qty: l.qty, unit: l.unit, amount: l.unit * l.qty, ruleId: l.ruleId, percent: l.percent }));
  const totalWholesale = L.reduce((s, l) => s + l.w * l.qty, 0);
  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  return {
    lines,
    totalQty: L.reduce((s, l) => s + l.qty, 0),
    totalRetail: L.reduce((s, l) => s + l.r * l.qty, 0),
    totalWholesale,
    totalAmount,
    discountAmount: totalWholesale - totalAmount,
    rules: ruleOut,
  };
}

function compare(program: Program | null, input: OrderInput, ctx = "") {
  const got = calculateOrder(program, input);
  const exp = oracle(program, input);
  const g = {
    lines: got.lines.map((l) => ({
      qty: l.qty,
      unit: l.unitPrice,
      amount: l.amount,
      // a line with qty 0 carries no money; its attribution is irrelevant (UI drops qty-0 lines)
      ruleId: l.qty > 0 ? l.discountRuleId : null,
      percent: l.qty > 0 ? l.discountPercent : null,
    })),
    totalQty: got.totalQty,
    totalRetail: got.totalRetail,
    totalWholesale: got.totalWholesale,
    totalAmount: got.totalAmount,
    discountAmount: got.discountAmount,
    rules: got.rules
      .filter((r): r is DiscountResult => r.type === "discount")
      .map((r) => ({ id: r.ruleId, eligible: r.eligible, targetQty: r.targetQty, requireQty: r.requireQty, savedAmount: r.savedAmount })),
  };
  const e = {
    ...exp,
    lines: exp.lines.map((l) => (l.qty > 0 ? l : { ...l, ruleId: null, percent: null })),
  };
  // qty-0 lines: compare unit price only when they have qty (the unit of a qty-0 line is cosmetic)
  g.lines.forEach((l, i) => {
    if (l.qty === 0) {
      l.unit = e.lines[i].unit;
    }
  });
  expect(g, ctx).toEqual(e);
  return got;
}

// ───────────────────────── seeded PRNG ─────────────────────────

function mulberry32(seedN: number) {
  let a = seedN >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═════════════════════════ concrete hand-computed examples ═════════════════════════

const db = seed as unknown as DB;
function seedProg(id: string): Program {
  const p = db.programs.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return structuredClone(p);
}
function buy(p: Program, groupId: string, sku: string, qty: number): OrderLine {
  const it = p.groups.find((g) => g.id === groupId)!.items.find((i) => i.sku === sku)!;
  if (!it) throw new Error(sku);
  return { groupId, sku, name: it.name, retailPrice: it.retailPrice, wholesalePrice: it.wholesalePrice, qty };
}

describe("seed «Khuyến mại Hè 2026» — Ưu đãi A (45% on retail, 2–4 DM01 + ≥1 DM03)", () => {
  const he = seedProg("seed-km-2026-he");

  it("2×Aeronaut 6000I + 1×Axforce10 + 1 DM03 → 1.296.000 / 513.000, total 4.520.782", () => {
    // retail 2.356.364 × 0,55 = 1.296.000,2 → 1.296.000 ; 932.727 × 0,55 = 512.999,85 → 513.000 (both = old app's gia_sau_giam)
    const r = calculateOrder(
      he,
      ord([
        buy(he, "g-he-dm01", "P-AYPT417-5", 2),
        buy(he, "g-he-dm01", "P-AYPU109-4", 1),
        buy(he, "g-he-dm03", "P-AYPM444-3", 1),
      ]),
    );
    expect(r.lines.map((l) => l.unitPrice)).toEqual([1_296_000, 513_000, 1_415_782]);
    expect(r.lines.map((l) => l.amount)).toEqual([2_592_000, 513_000, 1_415_782]);
    expect(r.totalQty).toBe(4);
    expect(r.totalRetail).toBe(2 * 2_356_364 + 932_727 + 2_022_545); // 7.668.000
    expect(r.totalWholesale).toBe(5_367_601); // 2×1.649.455 + 652.909 + 1.415.782
    expect(r.totalAmount).toBe(4_520_782);
    expect(r.discountAmount).toBe(846_819);
    expect(dres(r, "r-he-a")).toMatchObject({ eligible: true, targetQty: 3, requireQty: 1, savedAmount: 846_819 });
    // B1 strings: one per DM01 racket, not affected by the discount
    expect(r.gifts.filter((g) => g.ruleId === "r-he-b1").reduce((s, g) => s + g.qty, 0)).toBe(3);
  });

  it("every DM01 SKU, bought 2× with 1 DM03, is priced exactly round(retail × 0,55)", () => {
    const dm01 = he.groups.find((g) => g.id === "g-he-dm01")!.items;
    const dm03 = he.groups.find((g) => g.id === "g-he-dm03")!.items[0];
    for (const it of dm01) {
      const r = calculateOrder(he, ord([buy(he, "g-he-dm01", it.sku, 2), buy(he, "g-he-dm03", dm03.sku, 1)]));
      const expected = Math.min(it.wholesalePrice, discountedUnit(it.retailPrice, 45));
      expect(r.lines[0].unitPrice, it.sku).toBe(expected);
      expect(r.lines[0].amount, it.sku).toBe(2 * expected);
    }
  });

  it.each([
    [1, false],
    [2, true],
    [4, true],
    [5, false],
  ])("%d DM01 units + 1 DM03 → eligible=%s (bounds inclusive, whole rule off above 4)", (q, ok) => {
    const r = calculateOrder(he, ord([buy(he, "g-he-dm01", "P-AYPT417-5", q), buy(he, "g-he-dm03", "P-AYPM444-3", 1)]));
    expect(dres(r, "r-he-a").eligible).toBe(ok);
    expect(r.lines[0].unitPrice).toBe(ok ? 1_296_000 : 1_649_455);
  });

  it("3 DM01 without DM03 → no discount, and an info issue for rule A", () => {
    const r = calculateOrder(he, ord([buy(he, "g-he-dm01", "P-AYPT417-5", 3)]));
    expect(dres(r, "r-he-a")).toMatchObject({ eligible: false, targetQty: 3, requireQty: 0, savedAmount: 0 });
    expect(r.totalAmount).toBe(3 * 1_649_455);
    expect(r.issues.some((i) => i.ruleId === "r-he-a" && i.level === "info")).toBe(true);
  });

  it("B2 tier revenue is computed after discounts (DM02 not discounted → revenue = DM02 wholesale)", () => {
    const dm02 = he.groups.find((g) => g.id === "g-he-dm02")!.items[0];
    const r = calculateOrder(
      he,
      ord([buy(he, "g-he-dm01", "P-AYPT417-5", 2), buy(he, "g-he-dm03", "P-AYPM444-3", 1), buy(he, "g-he-dm02", dm02.sku, 10)]),
    );
    const b2 = r.rules.find((x) => x.ruleId === "r-he-b2") as TierGiftResult;
    expect(b2.revenue).toBe(10 * dm02.wholesalePrice);
  });
});

describe("discount basics (hand-computed)", () => {
  it("wholesale basis: 10% off 150.000 sỉ = 135.000; other groups untouched", () => {
    const r = compare(prog([disc()]), ord([ln("A", "a", 3, 150_000, 200_000), ln("B", "b", 2, 80_000)]));
    expect(r.lines.map((l) => l.unitPrice)).toEqual([135_000, 80_000]);
    expect(r.totalAmount).toBe(565_000);
    expect(r.discountAmount).toBe(45_000);
    expect(r.totalRetail).toBe(760_000);
  });

  it("retail basis: 40% off lẻ 200.000 = 120.000 < sỉ 150.000 → 120.000", () => {
    const r = compare(prog([disc({ discountPercent: 40, discountBasis: "retail" })]), ord([ln("A", "a", 1, 150_000, 200_000)]));
    expect(r.lines[0].unitPrice).toBe(120_000);
  });

  it("retail basis whose result is above wholesale: stays at wholesale, rule eligible but nothing applied", () => {
    const r = compare(prog([disc({ discountPercent: 20, discountBasis: "retail" })]), ord([ln("A", "a", 1, 150_000, 200_000)]));
    expect(r.lines[0].unitPrice).toBe(150_000); // 160.000 > 150.000
    expect(r.lines[0].discountRuleId).toBeNull();
    expect(dres(r)).toMatchObject({ eligible: true, savedAmount: 0 });
    expect(dres(r).reason).toMatch(/không dòng nào/);
  });

  it("rounding is per unit, nearest đồng, .5 up — then × qty (not rounded per line)", () => {
    // 1.001 × 0,5 = 500,5 → 501 per unit; × 3 = 1.503 (per-line rounding would give round(1.501,5)=1.502)
    const r = compare(prog([disc({ discountPercent: 50 })]), ord([ln("A", "a", 3, 1_001)]));
    expect(r.lines[0].unitPrice).toBe(501);
    expect(r.lines[0].amount).toBe(1_503);
    // 999 × 0,5 = 499,5 → 500
    expect(compare(prog([disc({ discountPercent: 50 })]), ord([ln("A", "a", 1, 999)])).lines[0].unitPrice).toBe(500);
    // 1.000.050 × 0,55 = 550.027,5 → 550.028 (float would give 550.027,4999…)
    expect(compare(prog([disc({ discountPercent: 45 })]), ord([ln("A", "a", 1, 1_000_050)])).lines[0].unitPrice).toBe(550_028);
  });

  it("odd percents: 33,3% of 1.000.000 → 667.000; 12,5% of 7 → 6,125 → 6; 99,99% of 1.000.000 → 100", () => {
    expect(compare(prog([disc({ discountPercent: 33.3 })]), ord([ln("A", "a", 1, 1_000_000)])).lines[0].unitPrice).toBe(667_000);
    expect(compare(prog([disc({ discountPercent: 12.5 })]), ord([ln("A", "a", 1, 7)])).lines[0].unitPrice).toBe(6);
    expect(compare(prog([disc({ discountPercent: 99.99 })]), ord([ln("A", "a", 1, 1_000_000)])).lines[0].unitPrice).toBe(100);
    // 3 decimals: 33,333% of 1.000.000 → 666.670
    expect(compare(prog([disc({ discountPercent: 33.333 })]), ord([ln("A", "a", 1, 1_000_000)])).lines[0].unitPrice).toBe(666_670);
  });

  it("100% → unit 0 (allowed by the editor: >0 and ≤100); 0%, 101%, negative, NaN → rule not configured, warning", () => {
    const full = compare(prog([disc({ discountPercent: 100 })]), ord([ln("A", "a", 2, 150_000)]));
    expect(full.totalAmount).toBe(0);
    expect(full.discountAmount).toBe(300_000);
    for (const p of [0, 101, -5, Number.NaN]) {
      const r = compare(prog([disc({ discountPercent: p })]), ord([ln("A", "a", 2, 150_000)]));
      expect(r.totalAmount, String(p)).toBe(300_000);
      expect(dres(r).eligible).toBe(false);
      expect(r.issues.some((i) => i.level === "warning" && i.ruleId === "d1"), String(p)).toBe(true);
    }
  });

  it("min/max bounds: null = no bound; both inclusive; above max the whole rule is off (not 'first N units')", () => {
    const P = prog([disc({ minQty: 2, maxQty: 4 })]);
    expect(compare(P, ord([ln("A", "a", 1, 100_000)])).totalAmount).toBe(100_000);
    expect(compare(P, ord([ln("A", "a", 1, 100_000), ln("A", "b", 1, 100_000)])).totalAmount).toBe(180_000);
    expect(compare(P, ord([ln("A", "a", 4, 100_000)])).totalAmount).toBe(360_000);
    expect(compare(P, ord([ln("A", "a", 5, 100_000)])).totalAmount).toBe(500_000);
    expect(compare(prog([disc({ maxQty: 4 })]), ord([ln("A", "a", 1, 100_000)])).totalAmount).toBe(90_000);
    expect(compare(prog([disc({ minQty: 2 })]), ord([ln("A", "a", 1000, 100_000)])).totalAmount).toBe(90_000_000);
  });

  it("several target groups: quantities are summed across them", () => {
    const P = prog([disc({ targetGroupIds: ["A", "B"], minQty: 3 })]);
    const r = compare(P, ord([ln("A", "a", 2, 100_000), ln("B", "b", 1, 50_000), ln("C", "c", 5, 10_000)]));
    expect(r.lines.map((l) => l.unitPrice)).toEqual([90_000, 45_000, 10_000]);
    expect(dres(r).targetQty).toBe(3);
  });

  it("same SKU in two groups: handled per (group, line); only the target-group line is discounted, both count where they belong", () => {
    const P = prog([disc({ minQty: 2, requireGroupIds: ["B"], requireMinQty: 1 })]);
    const r = compare(P, ord([ln("A", "X", 2, 100_000), ln("B", "X", 1, 100_000)]));
    expect(r.lines.map((l) => l.unitPrice)).toEqual([90_000, 100_000]);
    expect(dres(r)).toMatchObject({ targetQty: 2, requireQty: 1 });
  });

  it("requirement: requireMinQty 0 or no require group = no requirement; otherwise ≥ requireMinQty units in require groups", () => {
    expect(compare(prog([disc({ requireGroupIds: ["B"], requireMinQty: 0 })]), ord([ln("A", "a", 1, 100)])).totalAmount).toBe(90);
    expect(compare(prog([disc({ requireGroupIds: [], requireMinQty: 3 })]), ord([ln("A", "a", 1, 100)])).totalAmount).toBe(90);
    const P = prog([disc({ requireGroupIds: ["B", "C"], requireMinQty: 2 })]);
    expect(compare(P, ord([ln("A", "a", 1, 100), ln("B", "b", 1, 10)])).totalAmount).toBe(110);
    expect(compare(P, ord([ln("A", "a", 1, 100), ln("B", "b", 1, 10), ln("C", "c", 1, 10)])).totalAmount).toBe(110);
  });

  it("two discount rules on the same line: the lower price wins, not stacked (10% then 20% ≠ 28%)", () => {
    const P = prog([disc({ id: "d1", discountPercent: 10 }), disc({ id: "d2", discountPercent: 20 })]);
    const r = compare(P, ord([ln("A", "a", 1, 100_000)]));
    expect(r.lines[0].unitPrice).toBe(80_000);
    expect(r.lines[0].discountRuleId).toBe("d2");
    expect(dres(r, "d1")).toMatchObject({ eligible: true, savedAmount: 0 });
    expect(dres(r, "d2").savedAmount).toBe(20_000);
    // order of rules does not change the price
    const Q = prog([disc({ id: "d2", discountPercent: 20 }), disc({ id: "d1", discountPercent: 10 })]);
    expect(calculateOrder(Q, ord([ln("A", "a", 1, 100_000)])).lines[0].unitPrice).toBe(80_000);
  });

  it("retail-basis rule vs wholesale-basis rule on the same line: lower absolute price wins", () => {
    // retail 45% of 200.000 = 110.000 ; wholesale 20% of 150.000 = 120.000 → 110.000
    const P = prog([
      disc({ id: "w", discountPercent: 20, discountBasis: "wholesale" }),
      disc({ id: "r", discountPercent: 45, discountBasis: "retail" }),
    ]);
    const r = compare(P, ord([ln("A", "a", 2, 150_000, 200_000)]));
    expect(r.lines[0].unitPrice).toBe(110_000);
    expect(r.lines[0].discountRuleId).toBe("r");
  });

  it("other rule types do not consume target units: buy-1-get-1 and text gifts leave the discounted price alone; tier revenue uses discounted amount", () => {
    const b: BuyXGetYRule = { id: "b", type: "buy_x_get_y", name: "b", sourceGroupIds: ["A"], buyQty: 1, getQty: 1, giftMode: "same", giftGroupId: null, giftText: "" };
    const t: TierGiftRule = {
      id: "t",
      type: "tier_gift",
      name: "t",
      sourceGroupIds: ["A"],
      giftGroupId: "C",
      giftPriceBasis: "wholesale",
      tiers: [{ id: "t1", min: 1, limitType: "percent", limitValue: 10, maxQty: null, allowedSkus: null }],
    };
    const r = compare(prog([b, t, disc({ discountPercent: 30 })]), ord([ln("A", "a", 3, 100_000)]));
    expect(r.lines[0].unitPrice).toBe(70_000);
    expect(r.totalAmount).toBe(210_000);
    expect((r.rules.find((x) => x.ruleId === "t") as TierGiftResult).revenue).toBe(210_000);
    // result order follows program order even though discounts are evaluated first
    expect(r.rules.map((x) => x.ruleId)).toEqual(["b", "t", "d1"]);
  });

  it("quantities: 0, negative, NaN, Infinity → 0; 2,9 → 2; they do not count toward min", () => {
    const P = prog([disc({ minQty: 2 })]);
    const r = compare(
      P,
      ord([ln("A", "a", 0, 100), ln("A", "b", -3, 100), ln("A", "c", Number.NaN, 100), ln("A", "d", Number.POSITIVE_INFINITY, 100), ln("A", "e", 1.9, 100)]),
    );
    expect(r.totalQty).toBe(1);
    expect(dres(r)).toMatchObject({ eligible: false, targetQty: 1 });
    const r2 = compare(P, ord([ln("A", "e", 2.9, 100)]));
    expect(r2.totalQty).toBe(2);
    expect(r2.totalAmount).toBe(180);
  });

  it("zero / missing prices: retail-basis with no retail → stays at wholesale with a warning; no wholesale → 0 đ with a warning", () => {
    const r = compare(prog([disc({ discountBasis: "retail", discountPercent: 45 })]), ord([ln("A", "a", 1, 100_000, 0)]));
    expect(r.lines[0].unitPrice).toBe(100_000);
    expect(r.issues.some((i) => i.level === "warning" && i.ruleId === "d1")).toBe(true);
    const z = compare(prog([disc()]), ord([ln("A", "a", 2, 0, 0)]));
    expect(z.totalAmount).toBe(0);
    expect(z.issues.some((i) => i.level === "warning" && /giá sỉ/.test(i.message))).toBe(true);
  });

  it("fractional / negative prices are normalised to whole đồng before discounting", () => {
    // wholesale 100.000,6 → 100.001 ; 10% → 90.000,9 → 90.001
    const r = compare(prog([disc()]), ord([ln("A", "a", 1, 100_000.6, -5)]));
    expect(r.lines[0].wholesalePrice).toBe(100_001);
    expect(r.lines[0].unitPrice).toBe(90_001);
    expect(r.totalRetail).toBe(0);
  });

  it("empty order: all totals 0, rule not eligible, no info issue", () => {
    const r = compare(prog([disc({ minQty: 2 })]), ord([]));
    expect([r.totalQty, r.totalRetail, r.totalWholesale, r.totalAmount, r.discountAmount]).toEqual([0, 0, 0, 0, 0]);
    expect(dres(r).eligible).toBe(false);
    expect(r.issues).toEqual([]);
  });

  it("frozenRules win over the program's current rules (confirmed order keeps its prices)", () => {
    const P = prog([disc({ discountPercent: 50 })]);
    const frozen = [disc({ discountPercent: 10 })];
    expect(compare(P, ord([ln("A", "a", 1, 100_000)], frozen)).totalAmount).toBe(90_000);
    // empty snapshot = no rules at all (not a fallback to current rules)
    expect(compare(P, ord([ln("A", "a", 1, 100_000)], [])).totalAmount).toBe(100_000);
  });

  it("missing program: warning; without snapshot no discount; with snapshot the frozen discount still applies", () => {
    const r = compare(null, ord([ln("A", "a", 1, 100_000)]));
    expect(r.totalAmount).toBe(100_000);
    expect(r.issues.some((i) => i.level === "warning" && i.ruleId === null)).toBe(true);
    expect(compare(null, ord([ln("A", "a", 1, 100_000)], [disc()])).totalAmount).toBe(90_000);
  });

  it("huge but safe quantities stay exact (1.000.000 units × 1.296.000 đ)", () => {
    const r = compare(prog([disc({ discountPercent: 45, discountBasis: "retail" })]), ord([ln("A", "a", 1_000_000, 1_649_455, 2_356_364)]));
    expect(r.totalAmount).toBe(1_296_000_000_000);
    expect(Number.isSafeInteger(r.totalAmount)).toBe(true);
  });

  // ─── ambiguities / suspected issues ───

  // AMBIGUITY: a group that is both a target and a require group lets the same units satisfy "mua kèm".
  // "Phải mua kèm" (buy along with) reads as *additional* products; the engine double-counts. Business intent unclear.
  // With targets [A,B], require [B] ≥1, minQty 2: buying 2 units of B alone is eligible and B (the "kèm" item) is discounted.
  it("[decided] overlapping target and require groups: the companion item must be an extra unit", () => {
    const P = prog([disc({ targetGroupIds: ["A", "B"], minQty: 2, requireGroupIds: ["B"], requireMinQty: 1 })]);
    const two = calculateOrder(P, ord([ln("B", "b", 2, 100_000)]));
    expect(dres(two)).toMatchObject({ eligible: false, targetQty: 2, requireQty: 0 });
    expect(two.totalAmount).toBe(200_000);
    const three = calculateOrder(P, ord([ln("B", "b", 3, 100_000)]));
    expect(dres(three)).toMatchObject({ eligible: true, targetQty: 3, requireQty: 1 });
    expect(three.totalAmount).toBe(270_000);
    // A unit from the target-only group fills the minimum, so one B is already extra.
    const mixed = calculateOrder(P, ord([ln("A", "a", 1, 100_000), ln("B", "b", 2, 100_000)]));
    expect(dres(mixed)).toMatchObject({ eligible: true, requireQty: 1 });
  });

  // The engine marks qty-0 target lines as discounted (discountRuleId / discountPercent set). Harmless in the UI because
  // setLineQty removes qty-0 lines, but stored/imported data with qty 0 would print "(đã giảm …)" on a 0-unit line.
  it("documented: a qty-0 line in an eligible target group still gets discountRuleId (cosmetic)", () => {
    const r = calculateOrder(prog([disc()]), ord([ln("A", "a", 1, 100), ln("A", "z", 0, 100)]));
    expect(r.lines[1].discountRuleId).toBe("d1");
    expect(r.lines[1].amount).toBe(0);
  });

  // Unsafe-integer totals: qty × price beyond 2^53 loses precision silently. Not realistic for dealer orders.
  it("documented: totals above Number.MAX_SAFE_INTEGER are not exact and no issue is raised", () => {
    const r = calculateOrder(prog([]), ord([ln("A", "a", 9_007_199_254, 1_000_001)]));
    expect(Number.isSafeInteger(r.totalAmount)).toBe(false);
    expect(r.issues.length).toBe(0);
  });
});

// ═════════════════════════ randomized property tests vs the oracle ═════════════════════════

const PERCENTS = [10, 12.5, 33.3, 45, 50, 55, 7.25, 99.99, 100, 1, 0.01, 0, 101, -10, 33.333, 66.667, 15.55];
const QTYS = [0, 1, 1, 2, 2, 3, 4, 5, 7, 10, -1, 2.7, 0.5];
const GROUPS = ["A", "B", "C", "D"];

function randomCase(rand: () => number) {
  const pickOne = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const subset = () => GROUPS.filter(() => rand() < 0.4);
  const priceR = () => {
    const kind = rand();
    if (kind < 0.05) return 0;
    if (kind < 0.1) return Math.floor(rand() * 2000); // tiny prices — rounding matters most
    if (kind < 0.15) return Math.floor(rand() * 1_000_000) + 0.5; // fractional input
    return Math.floor(rand() * 5_000_000) + 1;
  };
  const nRules = 1 + Math.floor(rand() * 3);
  const rules: Rule[] = [];
  for (let i = 0; i < nRules; i++) {
    const minQ = rand() < 0.4 ? null : Math.floor(rand() * 5);
    const maxQ = rand() < 0.4 ? null : Math.floor(rand() * 8) + 1;
    rules.push(
      disc({
        id: `d${i}`,
        targetGroupIds: rand() < 0.05 ? [] : subset().length ? subset() : [pickOne(GROUPS)],
        discountPercent: rand() < 0.3 ? Math.floor(rand() * 100) + 1 : pickOne(PERCENTS),
        discountBasis: rand() < 0.5 ? "retail" : "wholesale",
        minQty: minQ,
        maxQty: maxQ,
        requireGroupIds: rand() < 0.5 ? [] : subset(),
        requireMinQty: Math.floor(rand() * 3),
      }),
    );
  }
  if (rand() < 0.3) {
    rules.splice(Math.floor(rand() * rules.length), 0, {
      id: "bx",
      type: "buy_x_get_y",
      name: "bx",
      sourceGroupIds: [pickOne(GROUPS)],
      buyQty: 2,
      getQty: 1,
      giftMode: "same",
      giftGroupId: null,
      giftText: "",
    });
  }
  if (rand() < 0.3) {
    rules.push({
      id: "tg",
      type: "tier_gift",
      name: "tg",
      sourceGroupIds: [pickOne(GROUPS)],
      giftGroupId: "D",
      giftPriceBasis: "retail",
      tiers: [{ id: "t", min: 1_000_000, limitType: "percent", limitValue: 10, maxQty: null, allowedSkus: null }],
    });
  }
  const nLines = Math.floor(rand() * 8);
  const lines: OrderLine[] = [];
  for (let i = 0; i < nLines; i++) {
    const w = priceR();
    // retail usually above wholesale, sometimes below or missing
    const rr = rand();
    const r = rr < 0.1 ? 0 : rr < 0.2 ? Math.floor(w * 0.9) : Math.round(w * (1 + rand()));
    lines.push(ln(pickOne(GROUPS), `S${Math.floor(rand() * 4)}`, pickOne(QTYS), w, r));
  }
  return { rules, lines };
}

describe("rounding sweep at exact .5 boundaries", () => {
  // For each percent, find prices where price × (100 − p) / 100 is exactly x,5 — the case where float error flips rounding.
  const PCTS = [45, 55, 12.5, 2.3, 33.3, 15.55, 7.25, 33.333, 12.345, 0.125, 66.667, 7.125];
  it.each(PCTS)("%s%% — the first 300 exact-half prices round up, same as the oracle", (p) => {
    const micro = BigInt(Math.round(p * 1_000_000));
    const SCALE = 100_000_000n;
    let found = 0;
    for (let base = 1; base < 5_000_000 && found < 300; base++) {
      const num = BigInt(base) * (SCALE - micro);
      if (num % SCALE !== SCALE / 2n) continue;
      found++;
      const r2 = calculateOrder(prog([disc({ discountPercent: p })]), ord([ln("A", "a", 1, base)]));
      expect(r2.lines[0].unitPrice, `${p}% of ${base}`).toBe(Math.min(base, discountedUnit(base, p)));
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("randomized: calculateOrder matches the oracle", () => {
  it("4000 random orders (seed 20261121), live program rules", () => {
    const rand = mulberry32(20261121);
    let eligibleSeen = 0;
    let appliedSeen = 0;
    for (let n = 0; n < 4000; n++) {
      const { rules, lines } = randomCase(rand);
      const P = prog(rules, GROUPS);
      const got = compare(P, ord(lines), `case ${n}: ${JSON.stringify({ rules, lines })}`);
      eligibleSeen += got.rules.filter((r) => r.type === "discount" && r.eligible).length;
      appliedSeen += got.lines.filter((l) => l.discountRuleId && l.qty > 0).length;
    }
    // make sure the generator exercises the interesting paths
    expect(eligibleSeen).toBeGreaterThan(1000);
    expect(appliedSeen).toBeGreaterThan(1000);
  });

  it("1000 random orders evaluated through frozenRules with a program whose rules differ", () => {
    const rand = mulberry32(42);
    for (let n = 0; n < 1000; n++) {
      const { rules, lines } = randomCase(rand);
      const decoy = prog([disc({ targetGroupIds: GROUPS, discountPercent: 90 })], GROUPS);
      compare(decoy, ord(lines, rules), `frozen case ${n}`);
    }
  });

  it("invariants over 3000 random orders: totals consistent, discount never raises a price, Σ savedAmount = discountAmount, line order irrelevant", () => {
    const rand = mulberry32(7);
    for (let n = 0; n < 3000; n++) {
      const { rules, lines } = randomCase(rand);
      const P = prog(rules, GROUPS);
      const r = calculateOrder(P, ord(lines));
      const ctx = `inv case ${n}`;
      expect(r.totalQty, ctx).toBe(r.lines.reduce((s, l) => s + l.qty, 0));
      expect(r.totalAmount, ctx).toBe(r.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0));
      expect(r.discountAmount, ctx).toBe(r.totalWholesale - r.totalAmount);
      expect(r.discountAmount, ctx).toBeGreaterThanOrEqual(0);
      for (const l of r.lines) {
        expect(Number.isInteger(l.unitPrice), ctx).toBe(true);
        expect(l.unitPrice, ctx).toBeLessThanOrEqual(l.wholesalePrice);
        expect(l.unitPrice, ctx).toBeGreaterThanOrEqual(0);
        expect(l.amount, ctx).toBe(l.unitPrice * l.qty);
        if (l.discountRuleId == null) expect(l.unitPrice, ctx).toBe(l.wholesalePrice);
      }
      const saved = r.rules.reduce((s, x) => (x.type === "discount" ? s + x.savedAmount : s), 0);
      expect(saved, ctx).toBe(r.discountAmount);
      // permuting the lines permutes the results but keeps totals
      const perm = [...lines].reverse();
      const r2 = calculateOrder(P, ord(perm));
      expect(r2.totalAmount, ctx).toBe(r.totalAmount);
      expect([...r2.lines].reverse().map((l) => l.unitPrice), ctx).toEqual(r.lines.map((l) => l.unitPrice));
      // permuting the rules does not change any price (lowest wins), only tie attribution
      const r3 = calculateOrder(prog([...rules].reverse(), GROUPS), ord(lines));
      expect(r3.lines.map((l) => l.unitPrice), ctx).toEqual(r.lines.map((l) => l.unitPrice));
    }
  });
});
