// Independent verification: whole orders across rule combinations, order lifecycle and robustness.
//
// The oracle below hard-codes the business rules of the three real seed programs the way the original
// display app (git dec7139: src/promoData.ts, src/components/PromoCalculator.tsx) and the notices describe
// them — it never reads the rule objects, and never calls the engine — so a wrong formula in the engine
// or a wrong rule in seed.json cannot make it agree by construction.
//
// Tests marked `it.fails` document a suspected bug or an unclear intent; each carries a comment with the
// expected vs actual behaviour. They pass while the engine keeps its current behaviour.
import { describe, expect, it } from "vitest";
import type {
  BuyXGetYResult,
  CalcResult,
  DB,
  DiscountResult,
  DiscountRule,
  Order,
  OrderGift,
  OrderLine,
  Program,
  Rule,
  TierGiftResult,
  TierGiftRule,
} from "../../types";
import { calculateOrder } from "../engine";
import { removeGroup, validateRule } from "../programOps";
import { buildStore, normalizeDB, normalizeOrder, normalizeProgram, seedDB, type StoreBackend } from "../store";
import { SYNC_IDLE } from "../syncStatus";
import { buildCatalog, refreshPrices, removeGiftsAt, setGiftQty, setLineQty, stalePriceSkus } from "../../components/order/orderOps";
import { orderStockView } from "../../components/order/stockView";

// ───────────────────────── Seed data and helpers ─────────────────────────

const SEED = seedDB();
const prog = (id: string): Program => structuredClone(SEED.programs.find((p) => p.id === id)!);

const HE = "seed-km-2026-he";
const KM11 = "seed-km-2026-11";
const BG = "seed-bang-gia-sau-ck";
const DM01 = "g-he-dm01";
const DM02 = "g-he-dm02";
const DM03 = "g-he-dm03";
const APPLY = "g-km11-apply";
const KGIFT = "g-km11-gift";
const ASHAWAY = "g-bg-ashaway";

function item(p: Program, groupId: string, sku: string) {
  const it = p.groups.find((g) => g.id === groupId)?.items.find((i) => i.sku === sku);
  if (!it) throw new Error(`no ${sku} in ${groupId}`);
  return it;
}
function line(p: Program, groupId: string, sku: string, qty: number): OrderLine {
  const it = item(p, groupId, sku);
  return { groupId, sku, name: it.name, retailPrice: it.retailPrice, wholesalePrice: it.wholesalePrice, qty };
}
function gift(p: Program, ruleId: string, groupId: string, sku: string, qty: number): OrderGift {
  return { ...line(p, groupId, sku, qty), ruleId };
}
function order(programId: string, lines: OrderLine[], gifts: OrderGift[] = [], extra: Partial<Order> = {}): Order {
  return {
    id: "o-test",
    code: "DH-TEST",
    programId,
    customerName: "",
    customerPhone: "",
    salesperson: "",
    salespersonPhone: "",
    note: "",
    status: "draft",
    lines,
    gifts,
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
    ...extra,
  };
}
const ruleResult = <T,>(calc: CalcResult, ruleId: string) => calc.rules.find((r) => r.ruleId === ruleId) as T;

/** Same transformations as OrderEditPage.confirmOrder / reopenOrder. */
const confirm = (o: Order, p: Program | null): Order => ({
  ...o,
  status: "confirmed",
  frozenRules: structuredClone(o.frozenRules ?? p?.rules ?? []),
});
const reopen = (o: Order): Order => {
  const next: Order = { ...o, status: "draft" };
  delete next.frozenRules;
  return next;
};
/** What happens on every page load: JSON text → normalizeDB. */
const reload = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const shuffle = <T,>(xs: readonly T[]): T[] => {
    const a2 = [...xs];
    for (let i = a2.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a2[i], a2[j]] = [a2[j], a2[i]];
    }
    return a2;
  };
  return { next, int, pick, shuffle };
}

// ───────────────────────── Independent oracle for the three seed programs ─────────────────────────

const big = (n: number) => BigInt(n);
/** round-half-up(n × pct / 100) for whole numbers, exact. */
const roundPct = (n: number, pct: number) => Number((big(n) * big(pct) + 50n) / 100n);
const floorPct = (n: number, pct: number) => Number((big(n) * big(pct)) / 100n);

const KM11_ALLOWED_10M = ["P-AYPT399-4", "P-AYPT455-4", "P-AYPT457-4", "P-AYPT467-4", "P-AYPT471-4", "P-AYPT477-4"];
const KM11_TIERS: Array<[number, number]> = [
  [10_000_000, 1_200_000],
  [20_000_000, 3_190_000],
  [50_000_000, 11_610_000],
  [120_000_000, 35_050_000],
  [200_000_000, 72_400_000],
];
const HE_B2_TIERS: Array<[number, number]> = [
  [8_000_000, 15],
  [20_000_000, 18],
  [35_000_000, 20],
  [50_000_000, 27],
];

interface OracleGift {
  ruleId: string;
  sku: string;
  qty: number;
  value: number;
  auto: boolean;
}
interface Oracle {
  unit: number[];
  totalQty: number;
  totalRetail: number;
  totalWholesale: number;
  totalAmount: number;
  gifts: OracleGift[];
  hasError: boolean;
  orphans: number[];
  tier?: { ruleId: string; revenue: number; tierIndex: number; budget: number; used: number; giftQty: number; ok: boolean };
  discountEligible?: boolean;
  strings?: number;
}

function oracle(programId: string, o: Pick<Order, "lines" | "gifts">): Oracle {
  const q = o.lines.map((l) => l.qty);
  const unit = o.lines.map((l) => l.wholesalePrice);
  const qtyOf = (g: string) => o.lines.reduce((s, l) => (l.groupId === g ? s + l.qty : s), 0);
  const res: Partial<Oracle> = {};
  const gifts: OracleGift[] = [];
  let hasError = false;
  let acceptors: string[] = [];

  if (programId === HE) {
    // Ưu đãi A: 2–4 units of DM01 plus at least 1 unit of DM03 → every DM01 unit at retail × 55 %, if that is cheaper.
    const q1 = qtyOf(DM01);
    const eligible = q1 >= 2 && q1 <= 4 && qtyOf(DM03) >= 1;
    res.discountEligible = eligible;
    o.lines.forEach((l, i) => {
      if (eligible && l.groupId === DM01 && l.retailPrice > 0) {
        const d = roundPct(l.retailPrice, 55);
        if (d < unit[i]) unit[i] = d;
      }
    });
    // Ưu đãi B1: one N65 string per DM01 unit.
    res.strings = q1;
    if (q1 > 0) gifts.push({ ruleId: "r-he-b1", sku: "", qty: q1, value: 0, auto: true });
    // Ưu đãi B2: DM02 revenue → % budget; gifts from DM01 at wholesale.
    const revenue = o.lines.reduce((s, l, i) => (l.groupId === DM02 ? s + unit[i] * q[i] : s), 0);
    let tierIndex = -1;
    HE_B2_TIERS.forEach(([min], i) => {
      if (revenue > 0 && revenue >= min) tierIndex = i;
    });
    const budget = tierIndex >= 0 ? floorPct(revenue, HE_B2_TIERS[tierIndex][1]) : 0;
    const chosen = o.gifts.filter((g) => g.ruleId === "r-he-b2" && g.qty > 0);
    const used = chosen.reduce((s, g) => s + g.wholesalePrice * g.qty, 0);
    for (const g of chosen) gifts.push({ ruleId: "r-he-b2", sku: g.sku, qty: g.qty, value: g.wholesalePrice * g.qty, auto: false });
    const err =
      chosen.length > 0 &&
      (tierIndex < 0 || used > budget || chosen.some((g) => g.groupId !== DM01) || chosen.some((g) => g.wholesalePrice <= 0));
    hasError ||= err;
    res.tier = { ruleId: "r-he-b2", revenue, tierIndex, budget, used, giftQty: chosen.reduce((s, g) => s + g.qty, 0), ok: !err };
    acceptors = ["r-he-b2"];
  } else if (programId === KM11) {
    const revenue = o.lines.reduce((s, l, i) => (l.groupId === APPLY ? s + unit[i] * q[i] : s), 0);
    let tierIndex = -1;
    KM11_TIERS.forEach(([min], i) => {
      if (revenue > 0 && revenue >= min) tierIndex = i;
    });
    const budget = tierIndex >= 0 ? KM11_TIERS[tierIndex][1] : 0;
    const chosen = o.gifts.filter((g) => g.ruleId === "r-km11-tier" && g.qty > 0);
    const used = chosen.reduce((s, g) => s + g.retailPrice * g.qty, 0);
    const giftQty = chosen.reduce((s, g) => s + g.qty, 0);
    for (const g of chosen) gifts.push({ ruleId: "r-km11-tier", sku: g.sku, qty: g.qty, value: g.retailPrice * g.qty, auto: false });
    const err =
      chosen.length > 0 &&
      (tierIndex < 0 ||
        used > budget ||
        (tierIndex === 0 && giftQty > 1) ||
        (tierIndex === 0 && chosen.some((g) => !KM11_ALLOWED_10M.includes(g.sku))) ||
        chosen.some((g) => g.groupId !== KGIFT) ||
        chosen.some((g) => g.retailPrice <= 0));
    hasError ||= err;
    res.tier = { ruleId: "r-km11-tier", revenue, tierIndex, budget, used, giftQty, ok: !err };
    acceptors = ["r-km11-tier"];
  } else if (programId === BG) {
    // Ashaway: buy 1 get 1 of the same product, per product line, valued at wholesale.
    o.lines.forEach((l) => {
      if (l.groupId === ASHAWAY && l.qty > 0)
        gifts.push({ ruleId: "r-bg-ashaway", sku: l.sku, qty: l.qty, value: l.wholesalePrice * l.qty, auto: true });
    });
  }

  const orphans: number[] = [];
  o.gifts.forEach((g, i) => {
    if (g.qty > 0 && !acceptors.includes(g.ruleId)) orphans.push(i);
  });
  hasError ||= orphans.length > 0;

  return {
    ...res,
    unit,
    totalQty: q.reduce((s, x) => s + x, 0),
    totalRetail: o.lines.reduce((s, l) => s + l.retailPrice * l.qty, 0),
    totalWholesale: o.lines.reduce((s, l) => s + l.wholesalePrice * l.qty, 0),
    totalAmount: o.lines.reduce((s, l, i) => s + unit[i] * l.qty, 0),
    gifts,
    hasError,
    orphans,
  };
}

const giftKey = (g: { ruleId: string; sku: string; qty: number; value: number; auto: boolean }) =>
  `${g.ruleId}|${g.sku}|${g.qty}|${g.value}|${g.auto}`;

function compareWithOracle(programId: string, p: Program, o: Order, label = "") {
  const calc = calculateOrder(p, o);
  const want = oracle(programId, o);
  const ctx = `${label} ${JSON.stringify({ lines: o.lines.map((l) => [l.groupId, l.sku, l.qty]), gifts: o.gifts.map((g) => [g.ruleId, g.groupId, g.sku, g.qty]) })}`;
  expect(calc.lines.map((l) => l.unitPrice), ctx).toEqual(want.unit);
  expect(calc.totalQty, ctx).toBe(want.totalQty);
  expect(calc.totalRetail, ctx).toBe(want.totalRetail);
  expect(calc.totalWholesale, ctx).toBe(want.totalWholesale);
  expect(calc.totalAmount, ctx).toBe(want.totalAmount);
  expect(calc.discountAmount, ctx).toBe(want.totalWholesale - want.totalAmount);
  expect(calc.gifts.map(giftKey).sort(), ctx).toEqual(want.gifts.map(giftKey).sort());
  expect(calc.orphanGiftIndexes, ctx).toEqual(want.orphans);
  expect(calc.hasError, ctx).toBe(want.hasError);
  if (want.tier) {
    const t = ruleResult<TierGiftResult>(calc, want.tier.ruleId);
    expect(
      { ruleId: t.ruleId, revenue: t.revenue, tierIndex: t.tierIndex, budget: t.budget, used: t.used, giftQty: t.giftQty, ok: t.ok },
      ctx,
    ).toEqual(want.tier);
  }
  if (want.discountEligible != null) expect(ruleResult<DiscountResult>(calc, "r-he-a").eligible, ctx).toBe(want.discountEligible);
  if (want.strings != null) expect(ruleResult<BuyXGetYResult>(calc, "r-he-b1").entitledQty, ctx).toBe(want.strings);
  return calc;
}

// ───────────────────────── Generic invariants ─────────────────────────

const isMoney = (n: number) => Number.isSafeInteger(n) && n >= 0;

function checkInvariants(calc: CalcResult, o: Pick<Order, "gifts">, rules: Rule[], ctx = "") {
  for (const l of calc.lines) {
    for (const v of [l.qty, l.retailPrice, l.wholesalePrice, l.unitPrice, l.amount]) expect(isMoney(v), `${ctx} line ${JSON.stringify(l)}`).toBe(true);
    expect(l.amount, ctx).toBe(l.unitPrice * l.qty);
    expect(l.unitPrice, ctx).toBeLessThanOrEqual(l.wholesalePrice); // a promotion never raises a price
    if (l.discountRuleId == null) expect(l.unitPrice, ctx).toBe(l.wholesalePrice);
  }
  for (const v of [calc.totalQty, calc.totalRetail, calc.totalWholesale, calc.totalAmount, calc.discountAmount, calc.giftQty, calc.giftValue])
    expect(isMoney(v), `${ctx} totals`).toBe(true);
  expect(calc.totalAmount).toBe(calc.lines.reduce((s, l) => s + l.amount, 0));
  expect(calc.totalQty).toBe(calc.lines.reduce((s, l) => s + l.qty, 0));
  expect(calc.totalWholesale).toBe(calc.lines.reduce((s, l) => s + l.wholesalePrice * l.qty, 0));
  expect(calc.discountAmount).toBe(calc.totalWholesale - calc.totalAmount);
  for (const g of calc.gifts) {
    expect(Number.isSafeInteger(g.qty) && g.qty > 0, ctx).toBe(true);
    expect(isMoney(g.unitValue) && isMoney(g.value), ctx).toBe(true);
    expect(g.value).toBe(g.unitValue * g.qty);
  }
  expect(calc.giftQty).toBe(calc.gifts.reduce((s, g) => s + g.qty, 0));
  expect(calc.giftValue).toBe(calc.gifts.reduce((s, g) => s + g.value, 0));
  expect(calc.rules.map((r) => r.ruleId)).toEqual(rules.map((r) => r.id));
  for (const r of calc.rules) {
    if (r.type === "tier_gift") {
      expect(isMoney(r.budget) && isMoney(r.used) && isMoney(r.revenue), `${ctx} ${r.budget} ${r.used} ${r.revenue}`).toBe(true);
      expect(r.remaining).toBe(r.budget - r.used);
      expect(r.tierIndex).toBeGreaterThanOrEqual(-1);
      expect(r.tierIndex).toBeLessThan(Math.max(1, r.tiers.length));
      expect(isMoney(r.amountToNextTier)).toBe(true);
    } else if (r.type === "buy_x_get_y") {
      expect(isMoney(r.entitledQty) && isMoney(r.chosenQty)).toBe(true);
      if (r.giftMode === "group") expect(r.remainingQty).toBe(r.entitledQty - r.chosenQty);
    } else {
      expect(isMoney(r.savedAmount)).toBe(true);
    }
  }
  expect(calc.hasError).toBe(calc.issues.some((i) => i.level === "error"));
  const levels = calc.issues.map((i) => ({ error: 0, warning: 1, info: 2 })[i.level]);
  expect(levels).toEqual([...levels].sort((a, b) => a - b));
  for (const i of calc.orphanGiftIndexes) expect(i >= 0 && i < o.gifts.length).toBe(true);
  expect(calc.orphanGiftIndexes).toEqual([...calc.orphanGiftIndexes].sort((a, b) => a - b));
}

/** Everything about a result that must not depend on the order of lines, gifts, rules or groups. */
function orderFreeView(calc: CalcResult) {
  const lines = calc.lines.map((l) => `${l.groupId}|${l.sku}|${l.qty}|${l.wholesalePrice}|${l.unitPrice}|${l.amount}`).sort();
  const rules = calc.rules
    .map((r) => {
      if (r.type === "discount") return [r.ruleId, r.eligible, r.targetQty, r.requireQty];
      if (r.type === "tier_gift") return [r.ruleId, r.revenue, r.tierIndex, r.budget, r.used, r.giftQty, r.ok];
      return [r.ruleId, r.sourceQty, r.entitledQty, r.chosenQty, r.ok];
    })
    .map((x) => JSON.stringify(x))
    .sort();
  const count = (lv: string) => calc.issues.filter((i) => i.level === lv).length;
  return {
    totals: [calc.totalQty, calc.totalRetail, calc.totalWholesale, calc.totalAmount, calc.discountAmount, calc.giftQty, calc.giftValue],
    savedTotal: calc.rules.reduce((s, r) => (r.type === "discount" ? s + r.savedAmount : s), 0),
    lines,
    rules,
    gifts: calc.gifts.map(giftKey).sort(),
    hasError: calc.hasError,
    issues: [count("error"), count("warning"), count("info")],
    orphanCount: calc.orphanGiftIndexes.length,
  };
}

// ───────────────────────── Random order generators ─────────────────────────

function randomSeedOrder(r: ReturnType<typeof rng>, p: Program): Order {
  const lines: OrderLine[] = [];
  for (const g of p.groups) {
    const k = r.pick([0, 0, 1, 1, 2, 3]);
    for (const it of r.shuffle(g.items).slice(0, k)) {
      const qty = r.next() < 0.75 ? r.pick([0, 1, 1, 1, 2, 2, 3, 4, 5]) : r.int(1, 40);
      lines.push({ groupId: g.id, sku: it.sku, name: it.name, retailPrice: it.retailPrice, wholesalePrice: it.wholesalePrice, qty });
    }
  }
  const gifts: OrderGift[] = [];
  const giftRules = p.rules.filter((x): x is TierGiftRule => x.type === "tier_gift");
  for (const rule of giftRules) {
    const n = r.pick([0, 0, 1, 1, 2, 3]);
    const fromGroup = p.groups.find((g) => g.id === rule.giftGroupId)!;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const group = r.next() < 0.9 ? fromGroup : r.pick(p.groups);
      const it = r.pick(group.items);
      if (seen.has(it.sku)) continue;
      seen.add(it.sku);
      gifts.push({ ruleId: rule.id, groupId: group.id, sku: it.sku, name: it.name, retailPrice: it.retailPrice, wholesalePrice: it.wholesalePrice, qty: r.pick([0, 1, 1, 1, 2, 3]) });
    }
  }
  if (r.next() < 0.08) {
    // a gift row left behind by a deleted rule, or pointing at a rule that takes no chosen gift
    const g = r.pick(p.groups);
    const it = r.pick(g.items);
    gifts.push({ ruleId: r.pick(["r-deleted", ...p.rules.map((x) => x.id)]), groupId: g.id, sku: it.sku, name: it.name, retailPrice: it.retailPrice, wholesalePrice: it.wholesalePrice, qty: r.int(1, 2) });
  }
  return order(p.id, r.shuffle(lines), gifts);
}

/** Untrusted raw program (as from an old file / localStorage), with valid and broken rules of every type. */
function randomRawProgram(r: ReturnType<typeof rng>, uniqueIds = true): any {
  const groupIds = ["g1", "g2", "g3", "g4"];
  const price = () => r.pick<any>([0, 1, 999, 50_000, 652_909, 1_415_782, 2_356_364, 5_105_455, -10, NaN, "1296000", null, 12.6]);
  const skus = ["A1", "A2", "B1", "B2", "C1", "SHARED"];
  const groups = groupIds.map((id) => ({
    id,
    name: id,
    items: r.shuffle(skus).slice(0, r.int(1, 5)).map((sku) => ({ sku, name: sku, retailPrice: price(), wholesalePrice: price() })),
  }));
  const gid = () => r.pick(["g1", "g2", "g3", "g4", "g-gone"]);
  const ids = (max = 2) => Array.from({ length: r.int(0, max) }, gid);
  const num = () => r.pick<any>([0, 1, 2, 3, 5, 10, null, -1, 2.5, NaN, "2", ""]);
  const rules = Array.from({ length: r.int(0, 5) }, (_, i) => {
    const id = uniqueIds ? `r${i}` : r.pick(["r0", "r1"]);
    const type = r.pick(["discount", "discount", "tier_gift", "tier_gift", "buy_x_get_y", "buy_x_get_y", "bogus"]);
    if (type === "discount")
      return { id, type, name: id, targetGroupIds: ids(), discountPercent: r.pick<any>([10, 45, 33.333, 0, 100, 150, -5, NaN, "20"]), discountBasis: r.pick(["retail", "wholesale", "x"]), minQty: num(), maxQty: num(), requireGroupIds: ids(1), requireMinQty: num() };
    if (type === "tier_gift")
      return {
        id, type, name: id, sourceGroupIds: ids(), giftGroupId: r.pick([gid(), null]), giftPriceBasis: r.pick(["retail", "wholesale"]),
        tiers: Array.from({ length: r.int(0, 3) }, (_, k) => {
          const limitType = r.pick(["amount", "percent"]);
          // fractional / astronomically large AMOUNT limits are covered by a separate it.fails below
          const limitValue = limitType === "amount" ? r.pick<any>([0, 15, 1_200_000, -3, NaN, "500000"]) : r.pick<any>([0, 15, 18.5, 33.333, 120, -3, NaN]);
          return { id: `t${k}`, min: r.pick<any>([0, 1000, 1_000_000, 5_000_000, 20_000_000, -1, NaN]), limitType, limitValue, maxQty: r.pick<any>([null, 0, 1, 3, "2"]), allowedSkus: r.pick<any>([null, [], ["a1", "B1 "], ["SHARED"]]) };
        }),
      };
    if (type === "buy_x_get_y")
      return { id, type, name: id, sourceGroupIds: ids(), buyQty: num(), getQty: num(), giftMode: r.pick(["same", "group", "text", "zzz"]), giftGroupId: r.pick([gid(), null]), giftText: r.pick(["", " N65 ", "Cước"]) };
    return { id, type, name: id };
  });
  return { id: "p-rand", name: "rand", groups, rules };
}

function randomRawOrder(r: ReturnType<typeof rng>, p: Program): any {
  const qty = () => r.pick<any>([0, 1, 2, 3, 4, 5, 12, 100, "3", " 4 ", "2.9", "abc", null, -2, 2.7, Infinity, NaN, "1e2"]);
  const lines = Array.from({ length: r.int(0, 8) }, () => {
    const g = r.next() < 0.9 && p.groups.length ? r.pick(p.groups) : { id: "g-gone", items: [{ sku: "OLD1", name: "old", retailPrice: 100_000, wholesalePrice: 70_000 }] };
    const it = r.pick(g.items.length ? g.items : [{ sku: "X", name: "x", retailPrice: 0, wholesalePrice: 0 }]);
    return { groupId: g.id, sku: r.next() < 0.1 ? it.sku.toLowerCase() + " " : it.sku, name: it.name, retailPrice: r.next() < 0.1 ? "abc" : it.retailPrice, wholesalePrice: it.wholesalePrice, qty: qty() };
  });
  const ruleIds = [...p.rules.map((x) => x.id), "r-gone"];
  const gifts = Array.from({ length: r.int(0, 4) }, () => {
    const g = p.groups.length ? r.pick(p.groups) : { id: "g-gone", items: [] as any[] };
    const it = g.items.length ? r.pick(g.items) : { sku: "G", name: "g", retailPrice: 1000, wholesalePrice: 700 };
    return { ruleId: r.pick(ruleIds), groupId: g.id, sku: it.sku, name: it.name, retailPrice: it.retailPrice, wholesalePrice: it.wholesalePrice, qty: qty() };
  });
  return { id: "o", programId: p.id, status: r.pick(["draft", "confirmed"]), lines, gifts };
}

// ═════════════════════════ (a) Hand-computed full orders ═════════════════════════

describe("(a) hand-computed whole orders on the seed programs", () => {
  it("Hè 2026: discount A + strings B1 + 18 % gift budget B2 in one order, exact VND", () => {
    const p = prog(HE);
    const o = order(
      HE,
      [
        line(p, DM01, "P-AYPT417-5", 2), // retail 2.356.364 × 55 % = 1.296.000,2 → 1.296.000
        line(p, DM01, "P-AYPU109-4", 1), // retail 932.727 × 55 % = 512.999,85 → 513.000
        line(p, DM03, "P-AYPM444-3", 1), // 1.415.782 at wholesale
        line(p, DM02, "P-AYPT243-4V", 5), // 3.573.819 × 5 = 17.869.095
        line(p, DM02, "P-AYPP028-1", 1), // 3.161.455
      ],
      [gift(p, "r-he-b2", DM01, "P-AYPT417-5", 1), gift(p, "r-he-b2", DM01, "P-AYPU109-4", 3)],
    );
    const calc = calculateOrder(p, o);
    expect(calc.lines.map((l) => l.unitPrice)).toEqual([1_296_000, 513_000, 1_415_782, 3_573_819, 3_161_455]);
    expect(calc.totalQty).toBe(10);
    expect(calc.totalRetail).toBe(37_711_639);
    expect(calc.totalWholesale).toBe(26_398_151);
    expect(calc.totalAmount).toBe(25_551_332);
    expect(calc.discountAmount).toBe(846_819);
    expect(ruleResult<DiscountResult>(calc, "r-he-a").savedAmount).toBe(846_819);
    const b2 = ruleResult<TierGiftResult>(calc, "r-he-b2");
    expect([b2.revenue, b2.tierIndex, b2.budget, b2.used, b2.remaining, b2.amountToNextTier]).toEqual([21_030_550, 1, 3_785_499, 3_608_182, 177_317, 13_969_450]);
    expect(ruleResult<BuyXGetYResult>(calc, "r-he-b1").entitledQty).toBe(3);
    expect(calc.giftQty).toBe(3 + 1 + 3);
    expect(calc.giftValue).toBe(3_608_182);
    expect(calc.hasError).toBe(false);
    compareWithOracle(HE, p, o);
  });

  it("Hè 2026: same order, gifts worth 4.467.273 > budget 3.785.499 → error; totals unchanged", () => {
    const p = prog(HE);
    const lines = [
      line(p, DM01, "P-AYPT417-5", 2),
      line(p, DM01, "P-AYPU109-4", 1),
      line(p, DM03, "P-AYPM444-3", 1),
      line(p, DM02, "P-AYPT243-4V", 5),
      line(p, DM02, "P-AYPP028-1", 1),
    ];
    const o = order(HE, lines, [gift(p, "r-he-b2", DM01, "P-AYPU109-4", 2), gift(p, "r-he-b2", DM01, "P-AYPP028-1", 1)]);
    const calc = calculateOrder(p, o);
    expect(calc.totalAmount).toBe(25_551_332);
    expect(ruleResult<TierGiftResult>(calc, "r-he-b2").used).toBe(4_467_273);
    expect(ruleResult<TierGiftResult>(calc, "r-he-b2").remaining).toBe(-681_774);
    expect(calc.hasError).toBe(true);
    compareWithOracle(HE, p, o);
  });

  it("Hè 2026: the 2–4 window and the DM03 companion switch the discount on and off for the whole DM01 group", () => {
    const p = prog(HE);
    const four = line(p, DM01, "P-AYPT417-5", 4);
    const companion = line(p, DM03, "P-AYPM444-3", 1);
    expect(calculateOrder(p, order(HE, [four])).totalAmount).toBe(6_597_820); // 1.649.455 × 4
    expect(calculateOrder(p, order(HE, [four, companion])).totalAmount).toBe(5_184_000 + 1_415_782);
    const five = calculateOrder(p, order(HE, [{ ...four, qty: 5 }, companion]));
    expect(five.totalAmount).toBe(8_247_275 + 1_415_782);
    expect(ruleResult<BuyXGetYResult>(five, "r-he-b1").entitledQty).toBe(5);
    // a DM03 line with quantity 0 does not count as the companion
    expect(calculateOrder(p, order(HE, [four, { ...companion, qty: 0 }])).totalAmount).toBe(6_597_820);
  });

  it("KM 11/2026: 50M tier (11.610.000 at RETAIL) with gift-group items also bought; stock demand adds lines and gifts", () => {
    const p = prog(KM11);
    const o = order(
      KM11,
      [line(p, APPLY, "P-AYPT065-4", 20), line(p, APPLY, "P-AYPR291-5", 5), line(p, KGIFT, "P-AYPT563-4", 2)],
      [gift(p, "r-km11-tier", KGIFT, "P-AYPM394-4", 4), gift(p, "r-km11-tier", KGIFT, "P-AYPT563-4", 4)],
    );
    const calc = calculateOrder(p, o);
    expect(calc.totalAmount).toBe(52_549_625);
    expect(calc.totalRetail).toBe(75_070_900);
    expect(calc.discountAmount).toBe(0);
    const t = ruleResult<TierGiftResult>(calc, "r-km11-tier");
    expect([t.revenue, t.tierIndex, t.budget, t.used, t.remaining, t.amountToNextTier]).toEqual([50_617_625, 2, 11_610_000, 11_320_000, 290_000, 69_382_375]);
    expect(calc.hasError).toBe(false);
    compareWithOracle(KM11, p, o);
    const view = orderStockView({ bySku: { "P-AYPT563-4": 5 }, updatedAt: null }, 5, "draft", calc)!;
    expect(view.warnings).toEqual([{ sku: "P-AYPT563-4", name: expect.any(String), ordered: 6, stock: 5, level: "over", giftQty: 4 }]);
    expect(orderStockView({ bySku: { "P-AYPT563-4": 5 }, updatedAt: null }, 5, "confirmed", calc)).toBeNull();
  });

  it("Bảng giá sau CK: Ashaway buy-1-get-1 next to groups without any rule", () => {
    const p = prog(BG);
    const o = order(BG, [
      line(p, ASHAWAY, "AV1F", 3),
      line(p, ASHAWAY, "AV200", 1),
      line(p, "g-bg-thuong", "P-AYPH044-3", 10),
      line(p, "g-bg-muc2", "P-AYPM394-4", 2),
    ]);
    const calc = calculateOrder(p, o);
    expect(calc.totalAmount).toBe(11_406_544);
    expect(calc.discountAmount).toBe(0);
    expect(calc.gifts.map((g) => [g.sku, g.qty, g.value])).toEqual([
      ["AV1F", 3, 3_450_000],
      ["AV200", 1, 750_000],
    ]);
    expect(calc.issues).toEqual([]);
    compareWithOracle(BG, p, o);
    // stock counts free units too: 3 bought + 3 free
    const view = orderStockView({ bySku: { AV1F: 5 }, updatedAt: null }, 5, "draft", calc)!;
    expect(view.warnings.map((w) => [w.sku, w.ordered, w.giftQty])).toEqual([["AV1F", 6, 3]]);
  });

  it("Hè 2026: a SKU bought in DM01 and DM02 and also chosen as a DM01 gift is one stock demand", () => {
    const p = prog(HE);
    const o = order(
      HE,
      [line(p, DM01, "P-AYPT417-5", 2), line(p, DM03, "P-AYPM444-3", 1), line(p, DM02, "P-AYPT417-5", 6)],
      [gift(p, "r-he-b2", DM01, "P-AYPT417-5", 1)],
    );
    const calc = compareWithOracle(HE, p, o);
    // DM02 revenue 6 × 1.649.455 = 9.896.730 → 15 % = 1.484.509; gift 1.649.455 → over budget
    expect(ruleResult<TierGiftResult>(calc, "r-he-b2").budget).toBe(1_484_509);
    expect(calc.hasError).toBe(true);
    const view = orderStockView({ bySku: { "P-AYPT417-5": 8 }, updatedAt: null }, 5, "draft", calc)!;
    expect(view.warnings.map((w) => [w.sku, w.ordered, w.giftQty])).toEqual([["P-AYPT417-5", 9, 1]]);
  });

  it("every seed DM01 item: discounted price equals the old system's gia_sau_giam (all 48 from git dec7139)", () => {
    // sku → gia_sau_giam copied from git show dec7139:src/productsData.ts (RAW_CATALOG_1)
    const old: Record<string, number> = { "P-AYPT417-5": 1296000, "P-AYPU109-4": 513000, "P-AYPP028-1": 2484000, "P-AYPU077-4": 1107000, "P-AYPJ008-4": 891000, "P-AYPM394-4": 783000, "P-AYPP032-4": 729000, "P-AYPP042-3": 1112400, "P-AYPR289-3": 1112400, "P-AYPT293-3": 648000, "P-AYPT299-5": 621000, "P-AYPT301-5": 621000, "P-AYPT349-3": 1242000, "P-AYPT357-3": 675000, "P-AYPT357-4": 675000, "P-AYPT361-4": 486000, "P-AYPT361-5": 486000, "P-AYPT365-5": 486000, "P-AYPT377-3": 621000, "P-AYPT399-4": 648000, "P-AYPT401-3": 648000, "P-AYPT411-3": 1242000, "P-AYPT455-4": 648000, "P-AYPT457-4": 648000, "P-AYPT467-4": 577800, "P-AYPT471-4": 577800, "P-AYPT477-4": 567000, "P-AYPT481-4": 621000, "P-AYPT563-4": 745200, "P-AYPT749-4": 756000, "P-AYPU043-4": 486000, "P-AYPU049-4": 1134000, "P-AYPU049-5": 1134000, "P-AYPU051-4": 1134000, "P-AYPT059-4": 1674000, "P-AYPT061-4": 1674000, "P-AYPT293-4A": 648000, "P-AYPT413-3": 1242000, "P-AYPT423-4": 496800, "P-AYPT465-3": 675000, "P-AYPU009-3": 1431000, "P-AYPU011-3": 1215000, "P-AYPJ008-4A": 891000, "P-AYPP032-4E": 729000, "P-AYPT293-3A": 648000, "P-AYPT467-4E": 648000, "P-AYPT471-4E": 648000, "P-AYPT437-6V": 1323000 };
    const p = prog(HE);
    const dm01 = p.groups.find((g) => g.id === DM01)!.items;
    expect(dm01.length).toBe(48);
    for (const it of dm01) {
      const calc = calculateOrder(p, order(HE, [line(p, DM01, it.sku, 2), line(p, DM03, "P-AYPM444-3", 1)]));
      expect(calc.lines[0].unitPrice, it.sku).toBe(old[it.sku]);
    }
  });
});

// ═════════════════════════ (b) Oracle vs engine, randomized + demo orders ═════════════════════════

describe("(b) whole-order oracle vs calculateOrder", () => {
  it("every demo order matches the oracle; confirmed demo orders are error-free and frozen to the current rules", () => {
    for (const o of SEED.orders) {
      const p = SEED.programs.find((x) => x.id === o.programId)!;
      compareWithOracle(o.programId, p, o, o.id);
      if (o.status === "confirmed") {
        expect(o.frozenRules, o.id).toEqual(p.rules);
        expect(calculateOrder(p, o).hasError, o.id).toBe(false);
      }
    }
  });

  for (const [pid, seed] of [[HE, 11], [KM11, 22], [BG, 33]] as const) {
    it(`2.000 random orders of ${pid}: unit prices, totals, tiers, gifts, errors agree; invariants hold; order-free`, () => {
      const p = prog(pid);
      const r = rng(seed);
      let reachedTier = 0;
      let discounted = 0;
      for (let n = 0; n < 2000; n++) {
        const o = randomSeedOrder(r, p);
        const calc = compareWithOracle(pid, p, o, `#${n}`);
        checkInvariants(calc, o, p.rules, `#${n}`);
        if (calc.rules.some((x) => x.type === "tier_gift" && x.tierIndex >= 0)) reachedTier++;
        if (calc.discountAmount > 0) discounted++;
        // permutations of lines, gifts, rules and groups
        const shuffledProgram = { ...p, rules: r.shuffle(p.rules), groups: r.shuffle(p.groups) };
        const shuffledOrder = { ...o, lines: r.shuffle(o.lines), gifts: r.shuffle(o.gifts) };
        expect(orderFreeView(calculateOrder(shuffledProgram, shuffledOrder))).toEqual(orderFreeView(calc));
        // normalising (what every reload does) changes nothing
        expect(calculateOrder(normalizeProgram(reload(p)), normalizeOrder(reload(o)))).toEqual(calc);
      }
      // the generator really exercises the promotions
      if (pid !== BG) expect(reachedTier).toBeGreaterThan(200);
      if (pid === HE) expect(discounted).toBeGreaterThan(50);
    });
  }
});

// ═════════════════════════ Robustness on untrusted data ═════════════════════════

describe("robustness: random garbage programs and orders through normalizeProgram / normalizeOrder", () => {
  it("3.000 random cases: never throws, all money is whole non-negative VND, invariants and order-independence hold", () => {
    const r = rng(2026);
    for (let n = 0; n < 3000; n++) {
      const p = normalizeProgram(randomRawProgram(r));
      const rawOrder = randomRawOrder(r, p);
      const o = normalizeOrder(rawOrder);
      const calc = calculateOrder(p, o);
      checkInvariants(calc, o, p.rules, `#${n}`);
      expect(calculateOrder(p, o)).toEqual(calc); // idempotent
      expect(normalizeOrder(reload(o))).toEqual(o); // normalising is idempotent
      // the engine is as defensive as normalizeOrder: raw and normalised orders give the same totals
      // (raw lines always have a SKU here, so no line is dropped by normalisation)
      const raw = calculateOrder(p, rawOrder);
      expect([raw.totalQty, raw.totalAmount, raw.totalWholesale, raw.giftValue], `#${n}`).toEqual([calc.totalQty, calc.totalAmount, calc.totalWholesale, calc.giftValue]);
      const shuffled = calculateOrder({ ...p, rules: r.shuffle(p.rules), groups: r.shuffle(p.groups) }, { ...o, lines: r.shuffle(o.lines), gifts: r.shuffle(o.gifts) });
      expect(orderFreeView(shuffled), `#${n}`).toEqual(orderFreeView(calc));
      // confirming freezes the result exactly
      expect(calculateOrder(p, confirm(o, p))).toEqual(calc);
      expect(calculateOrder({ ...p, rules: [] }, normalizeOrder(reload(confirm(o, p))))).toEqual({ ...calc });
    }
  });

  // Robustness (low; only reachable via imported/hand-edited JSON — the editor uses a money input): an "amount"
  // tier limit is used verbatim, never rounded to whole đồng. normalizeTier keeps 1.200.000,7 and tierBudget returns
  // it, so budget/remaining are fractional (and 1e300 passes Number.isFinite). Percent budgets ARE floored.
  // Expected: budget 1.200.000 (whole VND); actual: 1.200.000,7.
  it("[fixed] robustness: a fractional fixed-amount tier limit is rounded down to whole đồng", () => {
    const p = normalizeProgram({
      groups: [{ id: "g1", items: [{ sku: "A", retailPrice: 100, wholesalePrice: 100 }] }],
      rules: [{ id: "r", type: "tier_gift", sourceGroupIds: ["g1"], giftGroupId: "g1", tiers: [{ min: 0, limitType: "amount", limitValue: 1_200_000.7 }] }],
    });
    const calc = calculateOrder(p, { lines: [{ groupId: "g1", sku: "A", name: "", retailPrice: 100, wholesalePrice: 100, qty: 1 }], gifts: [] });
    expect(Number.isSafeInteger(ruleResult<TierGiftResult>(calc, "r").budget)).toBe(true);
  });

  it("no program at all (deleted / unknown): lines charged at wholesale, every gift orphaned, a warning", () => {
    const p = prog(HE);
    const o = order(HE, [line(p, DM01, "P-AYPT417-5", 3), line(p, DM03, "P-AYPM444-3", 1)], [gift(p, "r-he-b2", DM01, "P-AYPU109-4", 1)]);
    const calc = calculateOrder(null, o);
    expect(calc.totalAmount).toBe(1_649_455 * 3 + 1_415_782);
    expect(calc.gifts).toEqual([]);
    expect(calc.orphanGiftIndexes).toEqual([0]);
    expect(calc.hasError).toBe(true);
    // the same order confirmed keeps its promotions without the program
    const frozen = calculateOrder(null, confirm(o, p));
    expect(frozen.totalAmount).toBe(1_296_000 * 3 + 1_415_782);
    expect(frozen.orphanGiftIndexes).toEqual([]);
  });

  it("normalizeOrder turns old saved quantities into whole numbers the same way the engine reads them", () => {
    const p = prog(HE);
    const base = line(p, DM01, "P-AYPT417-5", 1);
    const qtys: Array<[unknown, number]> = [["3", 3], [" 4 ", 4], ["2.9", 2], [2.7, 2], ["1e2", 100], ["abc", 0], [null, 0], [undefined, 0], [-2, 0], [NaN, 0], [Infinity, 0], ["", 0], [true, 1]];
    for (const [raw, want] of qtys) {
      const o = normalizeOrder({ lines: [{ ...base, qty: raw }], gifts: [] });
      expect(o.lines[0].qty, String(raw)).toBe(want);
      expect(calculateOrder(p, { lines: [{ ...base, qty: raw as number }], gifts: [] }).lines[0].qty, String(raw)).toBe(want);
    }
    // prices saved as numeric strings are kept; Vietnamese-formatted strings are not numbers → 0 đ with a warning
    const o = normalizeOrder({ lines: [{ ...base, wholesalePrice: "1649455" }, { ...base, groupId: DM02, wholesalePrice: "1.649.455" }] });
    expect(o.lines.map((l) => l.wholesalePrice)).toEqual([1_649_455, 0]);
    expect(calculateOrder(p, o).issues.some((i) => i.message.includes("chưa có giá sỉ"))).toBe(true);
  });

  it("performance: 1.000 lines × all three Hè rules + 200 gifts is well under 50 ms", () => {
    const p = prog(HE);
    const r = rng(7);
    const all = p.groups.flatMap((g) => g.items.map((it) => ({ g: g.id, it })));
    const lines: OrderLine[] = Array.from({ length: 1000 }, (_, i) => {
      const { g, it } = all[i % all.length];
      return { groupId: g, sku: it.sku, name: it.name, retailPrice: it.retailPrice, wholesalePrice: it.wholesalePrice, qty: r.int(1, 50) };
    });
    const dm01 = p.groups.find((g) => g.id === DM01)!.items;
    const gifts: OrderGift[] = Array.from({ length: 200 }, (_, i) => ({ ...line(p, DM01, dm01[i % dm01.length].sku, 1), ruleId: "r-he-b2" }));
    const o = order(HE, lines, gifts);
    calculateOrder(p, o); // warm-up
    const times: number[] = [];
    for (let k = 0; k < 15; k++) {
      const t = performance.now();
      const calc = calculateOrder(p, o);
      times.push(performance.now() - t);
      checkInvariants(calc, o, p.rules);
    }
    times.sort((a, b) => a - b);
    expect(times[7]).toBeLessThan(50);
    // and it still adds up at that size
    compareWithOracle(HE, p, o);
  });

  it("quantities large enough for a real distributor (1.000 lines × 10.000 units) stay exact integers", () => {
    const p = prog(KM11);
    const its = p.groups.find((g) => g.id === APPLY)!.items;
    const lines = Array.from({ length: 1000 }, (_, i) => ({ ...line(p, APPLY, its[i % its.length].sku, 10_000) }));
    const calc = calculateOrder(p, order(KM11, lines));
    expect(Number.isSafeInteger(calc.totalAmount)).toBe(true);
    expect(calc.totalAmount).toBe(lines.reduce((s, l) => s + l.wholesalePrice * 10_000, 0));
    expect(ruleResult<TierGiftResult>(calc, "r-km11-tier").tierIndex).toBe(4);
  });

  // Low confidence / low impact: there is no upper bound on a quantity, so an absurd typo (e.g. 1e12 pasted
  // into a qty cell, or an imported file) produces totals beyond Number.MAX_SAFE_INTEGER that are no longer
  // exact đồng. Expected: rejected/capped or warned; actual: silently computed (1e12 × 3.043.636 ≈ 3e18).
  it.fails("ambiguity: absurd quantities should not produce non-exact (unsafe-integer) money", () => {
    const p = prog(KM11);
    const calc = calculateOrder(p, order(KM11, [line(p, APPLY, "P-AYPT065-4", 1e12)]));
    expect(Number.isSafeInteger(calc.totalRetail)).toBe(true);
  });
});

// ═════════════════════════ Order lifecycle ═════════════════════════

function storeFor(db: DB) {
  const ref = { current: db };
  const backend: StoreBackend = {
    mode: "local",
    saveOk: true,
    sync: SYNC_IDLE,
    newOrderCode: () => "DH-NEW",
    addOrder: async (o) => {
      ref.current = { ...ref.current, orders: [o, ...ref.current.orders] };
      return o;
    },
    updateSettings: () => {},
    flushNow: async () => true,
  };
  const store = () => buildStore(ref.current, ref, (next) => (ref.current = next), backend);
  return { ref, store };
}

describe("lifecycle: confirm freezes the rules, reopen recalculates, programs edited afterwards", () => {
  const heOrder = (p: Program, id: string) =>
    order(
      HE,
      [line(p, DM01, "P-AYPT417-5", 3), line(p, DM03, "P-AYPM444-3", 1), line(p, DM02, "P-AYPT243-4V", 6)],
      [gift(p, "r-he-b2", DM01, "P-AYPU109-4", 4)],
      { id },
    );

  it("editing every rule of the program changes a draft but not a confirmed order (through the store, with reloads)", () => {
    const p = prog(HE);
    const db: DB = { ...SEED, programs: [p], orders: [heOrder(p, "draft"), confirm(heOrder(p, "conf"), p)] };
    const { ref, store } = storeFor(normalizeDB(reload(db)));
    const before = calculateOrder(p, heOrder(p, "x"));
    // DM02 revenue 21.442.914 → 18 % = 3.859.724; gifts 4 × 652.909 = 2.611.636; 3 × 1.296.000 + 1.415.782
    expect(before.totalAmount).toBe(3 * 1_296_000 + 1_415_782 + 6 * 3_573_819);
    expect(ruleResult<TierGiftResult>(before, "r-he-b2").budget).toBe(3_859_724);

    store().updateProgram(HE, (prg) => ({
      ...prg,
      rules: prg.rules.map((rule): Rule => {
        if (rule.type === "discount") return { ...rule, discountPercent: 30 };
        if (rule.type === "tier_gift") return { ...rule, tiers: rule.tiers.map((t) => ({ ...t, limitValue: 5 })) };
        return { ...rule, buyQty: 3 };
      }),
    }));
    const after = normalizeDB(reload(ref.current));
    const live = after.programs[0];
    const draft = calculateOrder(live, after.orders.find((o) => o.id === "draft")!);
    const conf = calculateOrder(live, after.orders.find((o) => o.id === "conf")!);
    expect(conf.totalAmount).toBe(before.totalAmount);
    expect(conf.rules).toEqual(before.rules);
    expect(conf.gifts).toEqual(before.gifts);
    // draft: 30 % off retail 2.356.364 = 1.649.454,8 → 1.649.455 = wholesale → no discount at all
    expect(draft.totalAmount).toBe(3 * 1_649_455 + 1_415_782 + 6 * 3_573_819);
    expect(ruleResult<TierGiftResult>(draft, "r-he-b2").budget).toBe(1_072_145); // 5 % of 21.442.914 rounded down
    expect(draft.hasError).toBe(true); // 2.611.636 of gifts > 1.072.145
    expect(ruleResult<BuyXGetYResult>(draft, "r-he-b1").entitledQty).toBe(1); // floor(3 / 3)
  });

  it("deleting rules, the companion group or the gift group after confirming does not touch the confirmed order", () => {
    const p = prog(HE);
    const conf = confirm(heOrder(p, "c"), p);
    const want = calculateOrder(p, conf);
    expect(want.hasError).toBe(false);
    const variants: Program[] = [
      { ...p, rules: [] },
      removeGroup(p, DM03),
      removeGroup(p, DM01),
      removeGroup(removeGroup(removeGroup(p, DM01), DM02), DM03),
    ];
    for (const v of variants) {
      const got = calculateOrder(v, normalizeOrder(reload(conf)));
      expect(orderFreeView(got)).toEqual(orderFreeView(want));
      expect(got.issues.filter((i) => i.level !== "info")).toEqual(want.issues.filter((i) => i.level !== "info"));
    }
  });

  it("the same deletions on a DRAFT: rule gone → gift orphaned; gift group gone → gifts rejected", () => {
    const p = prog(HE);
    const draft = heOrder(p, "d");
    const noB2 = calculateOrder({ ...p, rules: p.rules.filter((x) => x.id !== "r-he-b2") }, draft);
    expect(noB2.orphanGiftIndexes).toEqual([0]);
    expect(noB2.gifts.every((g) => g.ruleId !== "r-he-b2")).toBe(true);
    expect(noB2.hasError).toBe(true);
    const cleaned = removeGiftsAt(draft, noB2.orphanGiftIndexes);
    expect(calculateOrder({ ...p, rules: p.rules.filter((x) => x.id !== "r-he-b2") }, cleaned).hasError).toBe(false);

    const noGiftGroup = calculateOrder(removeGroup(p, DM01), draft);
    expect(ruleResult<TierGiftResult>(noGiftGroup, "r-he-b2").ok).toBe(false);
    // DM01 lines stay charged at wholesale, no longer discounted, and are reported
    expect(noGiftGroup.totalAmount).toBe(3 * 1_649_455 + 1_415_782 + 6 * 3_573_819);
    expect(noGiftGroup.issues.some((i) => i.message.includes("đã bị xóa khỏi chương trình"))).toBe(true);
  });

  // Unclear intent (medium confidence that it surprises a manager): deleting the companion group DM03 makes
  // removeGroup drop it from requireGroupIds, and an empty requireGroupIds means "no companion needed".
  // So deleting the group a discount REQUIRES makes the discount EASIER to get, silently — validateRule does
  // not flag a discount whose companion list became empty. Repro: draft 3 × P-AYPT417-5 in DM01, no DM03 line.
  // Before deleting DM03: 3 × 1.649.455 = 4.948.365 (no discount). After removeGroup(DM03): 3 × 1.296.000 =
  // 3.888.000 (45 % applied). Expected: condition kept unmet (or the rule flagged invalid).
  it.fails("unclear intent: deleting the companion (required) group should not grant the discount", () => {
    const p = prog(HE);
    const o = order(HE, [line(p, DM01, "P-AYPT417-5", 3)]);
    expect(calculateOrder(p, o).totalAmount).toBe(4_948_365);
    const edited = removeGroup(p, DM03);
    const flagged = validateRule(edited.rules.find((x) => x.id === "r-he-a")!, edited.groups).length > 0;
    expect(flagged || calculateOrder(edited, o).totalAmount === 4_948_365).toBe(true);
  });

  it("reopen drops the frozen rules: the order is recalculated against the current program", () => {
    const p = prog(HE);
    const conf = confirm(heOrder(p, "c"), p);
    const edited: Program = { ...p, rules: p.rules.map((x) => (x.type === "discount" ? { ...x, discountPercent: 50 } : x)) };
    expect(calculateOrder(edited, conf).totalAmount).toBe(3 * 1_296_000 + 1_415_782 + 6 * 3_573_819);
    const reopened = reopen(conf);
    expect(reopened.frozenRules).toBeUndefined();
    // 50 % of 2.356.364 = 1.178.182
    expect(calculateOrder(edited, reopened).totalAmount).toBe(3 * 1_178_182 + 1_415_782 + 6 * 3_573_819);
    // confirm → reopen without any program change is a no-op on the numbers
    expect(calculateOrder(p, reopen(confirm(heOrder(p, "c2"), p)))).toEqual(calculateOrder(p, heOrder(p, "c2")));
    // re-confirming freezes the new rules
    expect(confirm(reopened, edited).frozenRules).toEqual(edited.rules);
  });

  it("duplicating a confirmed order gives a draft on the CURRENT rules (frozen rules are not copied)", async () => {
    const p = prog(HE);
    const conf = confirm(heOrder(p, "c"), p);
    const edited: Program = { ...p, rules: p.rules.filter((x) => x.type !== "discount") };
    const { store } = storeFor({ ...SEED, programs: [edited], orders: [conf] });
    const copy = (await store().duplicateOrder("c"))!;
    expect(copy.status).toBe("draft");
    expect(copy.frozenRules).toBeUndefined();
    expect(calculateOrder(edited, copy).totalAmount).toBe(3 * 1_649_455 + 1_415_782 + 6 * 3_573_819);
    expect(calculateOrder(edited, conf).totalAmount).toBe(3 * 1_296_000 + 1_415_782 + 6 * 3_573_819);
  });

  it("a confirmed order without frozenRules (legacy data) follows the live rules — status alone does not freeze", () => {
    const p = prog(HE);
    const legacy = { ...heOrder(p, "l"), status: "confirmed" as const };
    const edited: Program = { ...p, rules: [] };
    expect(calculateOrder(edited, normalizeOrder(reload(legacy))).totalAmount).toBe(3 * 1_649_455 + 1_415_782 + 6 * 3_573_819);
  });
});

// ═════════════════════════ Price refresh ═════════════════════════

describe("price refresh («Cập nhật giá theo danh mục») and stale prices", () => {
  it("only the changed (group, SKU) is stale; refreshing re-prices lines AND gifts, and is idempotent", () => {
    const p = prog(HE);
    const o = order(
      HE,
      [line(p, DM01, "P-AYPT417-5", 2), line(p, DM03, "P-AYPM444-3", 1), line(p, DM02, "P-AYPT417-5", 6)],
      [gift(p, "r-he-b2", DM01, "P-AYPU109-4", 2)],
    );
    // new catalog: P-AYPT417-5 in DM02 only gets a new wholesale price; P-AYPU109-4 in DM01 a new retail+wholesale
    const edited: Program = {
      ...p,
      groups: p.groups.map((g) => ({
        ...g,
        items: g.items.map((it) =>
          g.id === DM02 && it.sku === "P-AYPT417-5"
            ? { ...it, wholesalePrice: 1_700_000 }
            : g.id === DM01 && it.sku === "P-AYPU109-4"
              ? { ...it, retailPrice: 1_000_000, wholesalePrice: 700_000 }
              : it,
        ),
      })),
    };
    const catalog = buildCatalog(edited);
    expect(stalePriceSkus(o, catalog).sort()).toEqual(["P-AYPT417-5", "P-AYPU109-4"]);
    const before = calculateOrder(edited, o);
    expect(ruleResult<TierGiftResult>(before, "r-he-b2").revenue).toBe(6 * 1_649_455); // order keeps copied prices
    const fresh = refreshPrices(o, catalog);
    expect(fresh.lines[0]).toEqual(o.lines[0]); // DM01 copy of the same SKU untouched
    expect(fresh.lines[2].wholesalePrice).toBe(1_700_000);
    expect(fresh.gifts[0].wholesalePrice).toBe(700_000);
    const after = calculateOrder(edited, fresh);
    const b2 = ruleResult<TierGiftResult>(after, "r-he-b2");
    expect([b2.revenue, b2.tierIndex, b2.budget, b2.used]).toEqual([10_200_000, 0, 1_530_000, 1_400_000]);
    expect(after.totalAmount).toBe(2 * 1_296_000 + 1_415_782 + 10_200_000);
    expect(stalePriceSkus(fresh, catalog)).toEqual([]);
    expect(refreshPrices(fresh, catalog)).toEqual(fresh);
  });

  it("a SKU removed from the catalog keeps its copied price on refresh; its line still earns promotions (only the UI flags it)", () => {
    const p = prog(HE);
    const o = order(HE, [line(p, DM01, "P-AYPT417-5", 3), line(p, DM03, "P-AYPM444-3", 1)]);
    const edited: Program = { ...p, groups: p.groups.map((g) => (g.id === DM01 ? { ...g, items: g.items.filter((it) => it.sku !== "P-AYPT417-5") } : g)) };
    const fresh = refreshPrices(o, buildCatalog(edited));
    expect(fresh).toEqual(o);
    const calc = calculateOrder(edited, fresh);
    // documented current behaviour: the engine keys on the group only, so a de-listed SKU is still discounted
    expect(calc.lines[0].unitPrice).toBe(1_296_000);
    expect(calc.issues.filter((i) => i.level !== "info")).toEqual([]);
  });

  it("refreshing a gift's price can push a valid choice over budget (gift keeps its price until refreshed)", () => {
    const p = prog(KM11);
    const o = order(KM11, [line(p, APPLY, "P-AYPR285-3", 15)], [gift(p, "r-km11-tier", KGIFT, "P-AYPM394-4", 2)]);
    expect(calculateOrder(p, o).hasError).toBe(false); // 2 × 1.450.000 = 2.900.000 ≤ 3.190.000
    const edited: Program = { ...p, groups: p.groups.map((g) => (g.id === KGIFT ? { ...g, items: g.items.map((it) => (it.sku === "P-AYPM394-4" ? { ...it, retailPrice: 1_600_000 } : it)) } : g)) };
    expect(calculateOrder(edited, o).hasError).toBe(false);
    expect(calculateOrder(edited, refreshPrices(o, buildCatalog(edited))).hasError).toBe(true); // 3.200.000 > 3.190.000
  });
});

// ═════════════════════════ Invalid / incomplete rules (validateRule vs engine) ═════════════════════════

describe("rules that validateRule reports as invalid: what calculateOrder does with them", () => {
  const p0 = prog(HE);
  const withRule = (rule: Rule): Program => ({ ...p0, rules: [rule] });
  const base = order(HE, [line(p0, DM01, "P-AYPT417-5", 3), line(p0, DM03, "P-AYPM444-3", 1), line(p0, DM02, "P-AYPT243-4V", 6)]);
  const discount = p0.rules.find((x) => x.id === "r-he-a") as DiscountRule;
  const tier = p0.rules.find((x) => x.id === "r-he-b2") as TierGiftRule;
  const wholesale = 3 * 1_649_455 + 1_415_782 + 6 * 3_573_819;

  it("discount with 0 %, > 100 % or no target: invalid, ignored by the engine with a warning", () => {
    for (const bad of [{ discountPercent: 0 }, { discountPercent: 150 }, { targetGroupIds: [] }] as Partial<DiscountRule>[]) {
      const rule = { ...discount, ...bad };
      expect(validateRule(rule, p0.groups).length).toBeGreaterThan(0);
      const calc = calculateOrder(withRule(rule), base);
      expect(calc.totalAmount).toBe(wholesale);
      expect(calc.issues.some((i) => i.level === "warning" && i.ruleId === "r-he-a")).toBe(true);
    }
  });

  it("discount 100 % is VALID and gives the DM01 lines away for 0 đ (no warning)", () => {
    const rule = { ...discount, discountPercent: 100 };
    expect(validateRule(rule, p0.groups)).toEqual([]);
    const calc = calculateOrder(withRule(rule), base);
    expect(calc.lines[0].amount).toBe(0);
    expect(calc.totalAmount).toBe(1_415_782 + 6 * 3_573_819);
  });

  it("discount with minQty > maxQty: invalid; the engine reports it as a purchase condition not met (no config warning)", () => {
    const rule = { ...discount, minQty: 5, maxQty: 3 };
    expect(validateRule(rule, p0.groups)).toContain("Số lượng tối thiểu đang lớn hơn số lượng tối đa.");
    const calc = calculateOrder(withRule(rule), base);
    expect(calc.totalAmount).toBe(wholesale);
    expect(calc.issues.map((i) => i.level)).toEqual(["info"]);
  });

  it("tier with percent limit > 100: invalid, but the engine still grants a budget above the revenue", () => {
    const rule = { ...tier, tiers: [{ ...tier.tiers[0], limitValue: 150 }] };
    expect(validateRule(rule, p0.groups)).toContain("Hạn mức % không được quá 100.");
    const calc = calculateOrder(withRule(rule), base);
    const t = ruleResult<TierGiftResult>(calc, "r-he-b2");
    expect(t.budget).toBe(Math.floor((t.revenue * 150) / 100));
    expect(calc.issues.some((i) => i.level === "warning" && i.message.includes("chưa cấu hình"))).toBe(false);
  });

  it("tier without limit (0): invalid; budget 0, no gift prompt, any chosen gift is an error", () => {
    const rule = { ...tier, tiers: tier.tiers.map((t) => ({ ...t, limitValue: 0 })) };
    expect(validateRule(rule, p0.groups)).toContain("Có mức chưa nhập hạn mức quà.");
    expect(calculateOrder(withRule(rule), base).issues.filter((i) => i.level !== "info")).toEqual([]);
    expect(calculateOrder(withRule(rule), { ...base, gifts: [gift(p0, "r-he-b2", DM01, "P-AYPU109-4", 1)] }).hasError).toBe(true);
  });

  // Unclear intent (low impact): two tiers with the same `min` are invalid, and which one applies depends on the
  // order they were typed in (stable sort keeps the later one). Repro: tiers [min 8M → 10 %, min 8M → 20 %] vs the
  // reverse, DM02 revenue 21.442.914 → budget 4.288.582 vs 2.144.291.
  it.fails("unclear intent: duplicate tier minimums make the result depend on tier order", () => {
    const t1 = { ...tier.tiers[0], id: "a", min: 8_000_000, limitValue: 10 };
    const t2 = { ...tier.tiers[0], id: "b", min: 8_000_000, limitValue: 20 };
    const one = calculateOrder(withRule({ ...tier, tiers: [t1, t2] }), base);
    const two = calculateOrder(withRule({ ...tier, tiers: [t2, t1] }), base);
    expect(ruleResult<TierGiftResult>(one, "r-he-b2").budget).toBe(ruleResult<TierGiftResult>(two, "r-he-b2").budget);
  });

  it("buy_x_get_y with 0 quantities / no source / group mode without gift group: invalid, warning, no gift", () => {
    const b1 = p0.rules.find((x) => x.id === "r-he-b1")!;
    for (const bad of [{ buyQty: 0 }, { getQty: 0 }, { sourceGroupIds: [] }, { giftMode: "group", giftGroupId: null }] as const) {
      const rule = { ...b1, ...bad } as Rule;
      expect(validateRule(rule, p0.groups).length).toBeGreaterThan(0);
      const calc = calculateOrder(withRule(rule), base);
      expect(calc.gifts).toEqual([]);
      expect(calc.issues.some((i) => i.level === "warning" && i.ruleId === "r-he-b1")).toBe(true);
    }
    // text gift without a name: invalid, but the engine still hands out "Quà tặng"
    const unnamed = { ...b1, giftText: "  " } as Rule;
    expect(validateRule(unnamed, p0.groups)).toContain("Chưa nhập tên món quà.");
    expect(calculateOrder(withRule(unnamed), base).gifts.map((g) => [g.name, g.qty])).toEqual([["Quà tặng", 3]]);
  });

  it("a rule pointing only at groups that no longer exist: invalid, engine treats it as configured but it matches nothing", () => {
    const rule = { ...discount, targetGroupIds: ["g-gone"], requireGroupIds: [] };
    expect(validateRule(rule, p0.groups)).toContain("Chưa chọn danh mục được giảm giá.");
    const calc = calculateOrder(withRule(rule), base);
    expect(calc.totalAmount).toBe(wholesale);
    expect(calc.issues).toEqual([]);
  });
});

// ═════════════════════════ Rule interactions: order (in)dependence and duplicates ═════════════════════════

describe("rule interactions", () => {
  it("two discount rules on overlapping groups: price = the lowest, independent of rule order", () => {
    const p = prog(HE);
    const a = p.rules.find((x) => x.id === "r-he-a") as DiscountRule;
    const extra: DiscountRule = { ...a, id: "r-x", name: "x", targetGroupIds: [DM01, DM02], discountPercent: 10, discountBasis: "wholesale", minQty: null, maxQty: null, requireGroupIds: [] };
    const o = order(HE, [line(p, DM01, "P-AYPT417-5", 3), line(p, DM03, "P-AYPM444-3", 1), line(p, DM02, "P-AYPT243-4V", 2)]);
    for (const rules of [[a, extra], [extra, a]]) {
      const calc = calculateOrder({ ...p, rules }, o);
      // DM01: min(1.296.000, 1.484.510) ; DM02: 90 % of 3.573.819 = 3.216.437,1 → 3.216.437
      expect(calc.lines.map((l) => l.unitPrice)).toEqual([1_296_000, 1_415_782, 3_216_437]);
      expect(calc.lines.map((l) => l.discountRuleId)).toEqual(["r-he-a", null, "r-x"]);
    }
  });

  // Cosmetic (low impact): when two discount rules give exactly the same price, the credit ("savedAmount" and
  // "Đã áp dụng" vs "Đủ điều kiện, nhưng không dòng nào được giảm thêm") goes to whichever rule is listed first.
  // Totals are unaffected. Repro: two identical 10 % rules r1/r2 on DM02 → r1 saves 714.764 and r2 0, swapped → reverse.
  it.fails("cosmetic: savedAmount attribution between equally good discount rules depends on rule order", () => {
    const p = prog(HE);
    const a = p.rules.find((x) => x.id === "r-he-a") as DiscountRule;
    const r1: DiscountRule = { ...a, id: "r1", targetGroupIds: [DM02], discountPercent: 10, discountBasis: "wholesale", minQty: null, maxQty: null, requireGroupIds: [] };
    const r2: DiscountRule = { ...r1, id: "r2" };
    const o = order(HE, [line(p, DM02, "P-AYPT243-4V", 2)]);
    const saved = (rules: Rule[]) => ruleResult<DiscountResult>(calculateOrder({ ...p, rules }, o), "r1").savedAmount;
    expect(saved([r1, r2])).toBe(saved([r2, r1]));
  });

  it("gifts never feed back into promotions: DM01 rackets chosen as B2 gifts earn no B1 string and do not count for A", () => {
    const p = prog(HE);
    const o = order(HE, [line(p, DM01, "P-AYPT417-5", 1), line(p, DM03, "P-AYPM444-3", 1), line(p, DM02, "P-AYPT243-4V", 6)], [gift(p, "r-he-b2", DM01, "P-AYPU109-4", 3)]);
    const calc = calculateOrder(p, o);
    expect(ruleResult<DiscountResult>(calc, "r-he-a").eligible).toBe(false); // 1 DM01 unit only
    expect(ruleResult<BuyXGetYResult>(calc, "r-he-b1").entitledQty).toBe(1);
  });

  it("discounted DM01 amounts would count as tier revenue if DM01 were a source (amount after discount)", () => {
    const p = prog(HE);
    const b2 = p.rules.find((x) => x.id === "r-he-b2") as TierGiftRule;
    const prg = { ...p, rules: p.rules.map((x) => (x.id === "r-he-b2" ? { ...b2, sourceGroupIds: [DM01, DM02] } : x)) };
    const calc = calculateOrder(prg, order(HE, [line(p, DM01, "P-AYPT417-5", 4), line(p, DM03, "P-AYPM444-3", 1), line(p, DM02, "P-AYPT243-4V", 1)]));
    expect(ruleResult<TierGiftResult>(calc, "r-he-b2").revenue).toBe(4 * 1_296_000 + 3_573_819);
  });

  // Unclear intent (medium): the "same" mode is documented as "tặng chính sản phẩm đó (tính theo từng mã)" — per
  // SKU — but the engine counts per LINE. normalizeOrder does not merge duplicate (group, SKU) lines, and the code
  // itself says old data can contain them (orderOps.setLineQty: "Dữ liệu cũ có thể trùng (danh mục, mã)").
  // Repro, rule "mua 2 tặng 1" on Ashaway: lines AV1F×1 + AV1F×1 → 0 free; one line AV1F×2 → 1 free.
  it("[fixed] buy-2-get-1 'same' gives the same gift when one SKU is split over two lines", () => {
    const p = prog(BG);
    const rule = { ...p.rules[0], buyQty: 2 } as Rule;
    const prg = { ...p, rules: [rule] };
    const split = calculateOrder(prg, normalizeOrder({ lines: [line(p, ASHAWAY, "AV1F", 1), line(p, ASHAWAY, "AV1F", 1)] }));
    const merged = calculateOrder(prg, order(BG, [line(p, ASHAWAY, "AV1F", 2)]));
    expect(merged.giftQty).toBe(1);
    expect(split.giftQty).toBe(merged.giftQty);
  });

  // Unclear intent (low): the same SKU in two source groups of one "same" rule (DM01 and DM02 of Hè share all 48
  // SKUs) is also counted per line, not per SKU. Repro: mua 2 tặng 1 on [DM01, DM02], P-AYPT417-5 ×1 in each → 0 free.
  it("[fixed] 'same' rule over two groups sharing a SKU counts per SKU", () => {
    const p = prog(HE);
    const rule: Rule = { id: "r-same", type: "buy_x_get_y", name: "m2t1", sourceGroupIds: [DM01, DM02], buyQty: 2, getQty: 1, giftMode: "same", giftGroupId: null, giftText: "" };
    const calc = calculateOrder({ ...p, rules: [rule] }, order(HE, [line(p, DM01, "P-AYPT417-5", 1), line(p, DM02, "P-AYPT417-5", 1)]));
    expect(calc.giftQty).toBe(1);
  });

  // Robustness (low): normalizeProgram does not de-duplicate rule ids (possible only via hand-edited/imported JSON).
  // Two tier rules with the same id both claim every gift row of that id → gift value counted twice.
  // Repro: KM11 tier rule duplicated with same id, one 2 × P-AYPM394-4 gift → giftValue 5.800.000 instead of 2.900.000.
  it.fails("robustness: duplicate rule ids from imported data double-count chosen gifts", () => {
    const p = normalizeProgram(reload({ ...prog(KM11), rules: [prog(KM11).rules[0], prog(KM11).rules[0]] }));
    const calc = calculateOrder(p, order(KM11, [line(p, APPLY, "P-AYPR285-3", 15)], [gift(p, "r-km11-tier", KGIFT, "P-AYPM394-4", 2)]));
    expect(calc.giftValue).toBe(2_900_000);
  });

  it("setLineQty / setGiftQty keep (group, SKU) and (rule, SKU) unique, so UI edits cannot create the split above", () => {
    const p = prog(BG);
    const it = item(p, ASHAWAY, "AV1F");
    let o = order(BG, [line(p, ASHAWAY, "AV1F", 1), line(p, ASHAWAY, "AV1F", 1)]);
    o = setLineQty(o, ASHAWAY, it, 2);
    expect(o.lines).toHaveLength(1);
    expect(calculateOrder(p, o).giftQty).toBe(2);
    const k = prog(KM11);
    let g = order(KM11, [line(k, APPLY, "P-AYPR285-3", 15)]);
    g = setGiftQty(g, "r-km11-tier", KGIFT, item(k, KGIFT, "P-AYPM394-4"), 1);
    g = setGiftQty(g, "r-km11-tier", KGIFT, { ...item(k, KGIFT, "P-AYPM394-4"), sku: "p-aypm394-4 " }, 2);
    expect(g.gifts.map((x) => x.qty)).toEqual([2]);
  });
});
