// Independent verification of the «Mua X tặng Y» rule (type "buy_x_get_y") in all three gift modes.
//
// Expected behaviour is derived from the business descriptions, not from engine.ts:
//  - types.ts: "same = tặng chính sản phẩm đó (tính theo từng mã, vd «mua 1 tặng 1»)",
//              "group = được chọn quà trong danh mục giftGroupId (tính trên tổng số lượng mua)",
//              "text = tặng món quà ghi bằng chữ giftText, không có trong danh mục (vd «Cước N65»)".
//  - Rule form: "Cứ mua X sản phẩm thuộc: <danh mục áp dụng> được tặng Y quà."
//  - describeRule: "Mua X tặng Y cùng loại (tính theo từng mã)", "Cứ mua X sản phẩm … được chọn Y quà trong …".
//  - validateRule: "Số lượng mua và số lượng tặng phải lớn hơn 0", group mode needs a gift group.
//  - Original display-only app (git dec7139): B1 "mỗi khung vợt Catalog 01 tặng 01 sợi cước N65" (text gift),
//    Ashaway "Mua 1 tặng 1"; gift budgets valued "theo đơn giá bán buôn" (wholesale).
//  - CalcResult/CalcGift docs: giftQty/giftValue are sums over calc.gifts; unitValue × qty = value;
//    auto = system gift, false = sale-chosen; orphanGiftIndexes = gifts without a matching rule.
//
// The oracle below is written from those statements. Disagreements are kept as `it.fails` with a comment.
import { describe, expect, it } from "vitest";
import seed from "../../seed/seed.json";
import { calculateOrder, giftUnitValue, ruleAcceptsChosenGifts } from "../engine";
import type {
  BuyXGetYResult,
  BuyXGetYRule,
  CalcGift,
  CalcResult,
  DiscountRule,
  ID,
  OrderGift,
  OrderLine,
  ProductGroup,
  Program,
  Rule,
  TierGiftRule,
} from "../../types";

// ───────────────────────── helpers ─────────────────────────

function mkGroup(id: ID, items: Array<[string, number, number]> = []): ProductGroup {
  return { id, name: `Nhóm ${id}`, items: items.map(([sku, r, w]) => ({ sku, name: `SP ${sku}`, retailPrice: r, wholesalePrice: w })) };
}

function mkProgram(groups: ProductGroup[], rules: Rule[]): Program {
  return {
    id: "p",
    name: "P",
    brand: "X",
    startDate: null,
    endDate: null,
    note: "",
    groups,
    rules,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function bx(p: Partial<BuyXGetYRule> = {}): BuyXGetYRule {
  return {
    id: "r-bx",
    type: "buy_x_get_y",
    name: "Mua X tặng Y",
    sourceGroupIds: ["g1"],
    buyQty: 1,
    getQty: 1,
    giftMode: "same",
    giftGroupId: null,
    giftText: "",
    ...p,
  };
}

function disc(p: Partial<DiscountRule> = {}): DiscountRule {
  return {
    id: "r-disc",
    type: "discount",
    name: "Giảm",
    targetGroupIds: ["g1"],
    discountPercent: 45,
    discountBasis: "retail",
    minQty: null,
    maxQty: null,
    requireGroupIds: [],
    requireMinQty: 0,
    ...p,
  };
}

function tier(p: Partial<TierGiftRule> = {}): TierGiftRule {
  return {
    id: "r-tier",
    type: "tier_gift",
    name: "Doanh số",
    sourceGroupIds: ["g1"],
    giftGroupId: "gG",
    giftPriceBasis: "wholesale",
    tiers: [{ id: "t1", min: 1_000_000, limitType: "amount", limitValue: 500_000, maxQty: null, allowedSkus: null }],
    ...p,
  };
}

function ln(groupId: ID, sku: string, qty: number, wholesale = 100_000, retail = 150_000): OrderLine {
  return { groupId, sku, name: `SP ${sku}`, retailPrice: retail, wholesalePrice: wholesale, qty };
}

function gf(ruleId: ID, groupId: ID, sku: string, qty: number, wholesale = 50_000, retail = 80_000): OrderGift {
  return { ruleId, groupId, sku, name: `Quà ${sku}`, retailPrice: retail, wholesalePrice: wholesale, qty };
}

function calc(program: Program | null, lines: OrderLine[], gifts: OrderGift[] = [], frozenRules?: Rule[]): CalcResult {
  return calculateOrder(program, { lines, gifts, frozenRules });
}

function bxOf(r: CalcResult, id = "r-bx"): BuyXGetYResult {
  const x = r.rules.find((rr) => rr.ruleId === id);
  if (!x || x.type !== "buy_x_get_y") throw new Error(`no bxgy result ${id}`);
  return x;
}

const giftsOf = (r: CalcResult, id = "r-bx") => r.gifts.filter((g) => g.ruleId === id);
const levelsOf = (r: CalcResult, id: ID | null) =>
  r.issues
    .filter((i) => i.ruleId === id)
    .map((i) => i.level)
    .sort();

// ───────────────────────── oracle ─────────────────────────

/** A count as the business sees it: whole, non-negative number of units. */
const units = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const norm = (s: string) => s.trim().replace(/\s+/g, "").toUpperCase();

interface OracleBx {
  sourceQty: number;
  entitledQty: number;
  chosenQty: number;
  remainingQty: number;
  ok: boolean;
  giftGroupId: ID | null;
  gifts: CalcGift[];
  issueLevels: string[];
}

/** Business oracle for one rule. "same" is counted per product code (mã hàng), pooled over the rule's source lines. */
function oracleBx(rule: BuyXGetYRule, lines: OrderLine[], orderGifts: OrderGift[]): OracleBx {
  const X = units(rule.buyQty);
  const Y = units(rule.getQty);
  const sources = new Set(rule.sourceGroupIds);
  const srcLines = lines.filter((l) => sources.has(l.groupId));
  const sourceQty = srcLines.reduce((s, l) => s + units(l.qty), 0);
  const configured = X >= 1 && Y >= 1 && sources.size > 0 && (rule.giftMode !== "group" || !!rule.giftGroupId);
  const issueLevels: string[] = configured ? [] : ["warning"];
  const out: OracleBx = {
    sourceQty,
    entitledQty: 0,
    chosenQty: 0,
    remainingQty: 0,
    ok: true,
    giftGroupId: rule.giftMode === "group" ? rule.giftGroupId : null,
    gifts: [],
    issueLevels,
  };

  if (rule.giftMode === "same") {
    if (!configured) return out;
    // per code: Σ qty of that code over source lines, first line gives name/price
    const bySku = new Map<string, { first: OrderLine; qty: number }>();
    for (const l of srcLines) {
      const k = norm(l.sku);
      const e = bySku.get(k);
      if (e) e.qty += units(l.qty);
      else bySku.set(k, { first: l, qty: units(l.qty) });
    }
    for (const { first, qty } of bySku.values()) {
      const free = Math.floor(qty / X) * Y;
      if (free <= 0) continue;
      const unitValue = money(first.wholesalePrice); // free unit valued at the wholesale (pre-discount) price
      out.entitledQty += free;
      out.gifts.push({ ruleId: rule.id, sku: first.sku, name: first.name, qty: free, unitValue, value: unitValue * free, auto: true });
    }
    return out;
  }

  const entitled = configured ? Math.floor(sourceQty / X) * Y : 0;
  out.entitledQty = entitled;

  if (rule.giftMode === "text") {
    if (entitled > 0) {
      out.gifts.push({
        ruleId: rule.id,
        sku: "",
        name: rule.giftText.trim() || "Quà tặng",
        qty: entitled,
        unitValue: rule.giftTextValue ?? 0, // the value written on the rule (0 when not set)
        value: (rule.giftTextValue ?? 0) * entitled,
        auto: true,
      });
    }
    return out;
  }

  // group: sale picks
  let wrong = false;
  for (const g of orderGifts) {
    if (g.ruleId !== rule.id) continue;
    const q = units(g.qty);
    if (q === 0) continue;
    out.chosenQty += q;
    if (rule.giftGroupId && g.groupId !== rule.giftGroupId) wrong = true;
    const uv = money(g.wholesalePrice);
    out.gifts.push({ ruleId: rule.id, sku: g.sku, name: g.name, qty: q, unitValue: uv, value: uv * q, auto: false });
  }
  out.remainingQty = entitled - out.chosenQty;
  if (out.chosenQty > entitled) {
    out.ok = false;
    issueLevels.push("error");
  } else if (out.chosenQty < entitled) {
    issueLevels.push("warning");
  }
  if (wrong) {
    out.ok = false;
    issueLevels.push("error");
  }
  issueLevels.sort();
  return out;
}

function oracleOrphans(rules: Rule[], gifts: OrderGift[]): number[] {
  const accepting = new Set(rules.filter((r) => r.type === "tier_gift" || (r.type === "buy_x_get_y" && r.giftMode === "group")).map((r) => r.id));
  const res: number[] = [];
  gifts.forEach((g, i) => {
    if (!accepting.has(g.ruleId) && units(g.qty) > 0) res.push(i);
  });
  return res;
}

function expectMatchesOracle(r: CalcResult, rule: BuyXGetYRule, lines: OrderLine[], gifts: OrderGift[], label = "") {
  const o = oracleBx(rule, lines, gifts);
  const res = bxOf(r, rule.id);
  expect(
    { sourceQty: res.sourceQty, entitledQty: res.entitledQty, chosenQty: res.chosenQty, remainingQty: res.remainingQty, ok: res.ok, giftGroupId: res.giftGroupId, giftMode: res.giftMode },
    label,
  ).toEqual({ sourceQty: o.sourceQty, entitledQty: o.entitledQty, chosenQty: o.chosenQty, remainingQty: o.remainingQty, ok: o.ok, giftGroupId: o.giftGroupId, giftMode: rule.giftMode });
  expect(giftsOf(r, rule.id), label).toEqual(o.gifts);
  expect(levelsOf(r, rule.id), label).toEqual(o.issueLevels);
}

// ───────────────────────── (a) hand-computed examples ─────────────────────────

const G = [mkGroup("g1"), mkGroup("g2"), mkGroup("g3"), mkGroup("gG", [["Q1", 80_000, 50_000], ["Q2", 120_000, 90_000]])];

describe("same mode — tặng chính sản phẩm đó, tính theo từng mã", () => {
  it.each([
    // buy, get, qty, free
    [1, 1, 0, 0],
    [1, 1, 1, 1],
    [1, 1, 7, 7],
    [2, 1, 1, 0],
    [2, 1, 2, 1],
    [2, 1, 3, 1],
    [2, 1, 9, 4],
    [3, 2, 8, 4],
    [3, 2, 9, 6],
    [1, 3, 4, 12],
    [12, 1, 11, 0],
    [12, 1, 24, 2],
    [1000, 5, 999, 0],
    [1000, 5, 2500, 10],
  ])("buy %i get %i, qty %i → %i free units of the same code", (buyQty, getQty, qty, free) => {
    const rule = bx({ buyQty, getQty });
    const lines = [ln("g1", "A", qty, 123_456, 200_000)];
    const r = calc(mkProgram(G, [rule]), lines);
    expect(bxOf(r).entitledQty).toBe(free);
    expect(r.giftQty).toBe(free);
    expect(r.giftValue).toBe(free * 123_456);
    // free units are extra, not deducted from paid quantity
    expect(r.lines[0].qty).toBe(qty);
    expect(r.totalAmount).toBe(qty * 123_456);
    expectMatchesOracle(r, rule, lines, []);
  });

  it("each code counted on its own (A=3, B=3 with buy 2 get 1 → 1 + 1 = 2, not floor(6/2)=3)", () => {
    const rule = bx({ buyQty: 2, getQty: 1, sourceGroupIds: ["g1", "g2"] });
    const lines = [ln("g1", "A", 3, 100_000), ln("g2", "B", 3, 200_000), ln("g3", "C", 10)];
    const r = calc(mkProgram(G, [rule]), lines);
    expect(bxOf(r)).toMatchObject({ sourceQty: 6, entitledQty: 2 });
    expect(r.gifts.map((g) => [g.sku, g.qty, g.unitValue, g.value, g.auto])).toEqual([
      ["A", 1, 100_000, 100_000, true],
      ["B", 1, 200_000, 200_000, true],
    ]);
    expect(r.giftValue).toBe(300_000);
    expect(r.issues).toEqual([]);
  });

  it("Ashaway seed program — Mua 1 tặng 1: AV1F×3 + AV200×2 → 3 AV1F + 2 AV200 free at wholesale", () => {
    const program = (seed.programs as unknown as Program[]).find((p) => p.id === "seed-bang-gia-sau-ck")!;
    const ash = program.groups.find((g) => g.id === "g-bg-ashaway")!;
    const av1f = ash.items.find((i) => i.sku === "AV1F")!;
    const av200 = ash.items.find((i) => i.sku === "AV200")!;
    const lines = [
      { groupId: ash.id, sku: av1f.sku, name: av1f.name, retailPrice: av1f.retailPrice, wholesalePrice: av1f.wholesalePrice, qty: 3 },
      { groupId: ash.id, sku: av200.sku, name: av200.name, retailPrice: av200.retailPrice, wholesalePrice: av200.wholesalePrice, qty: 2 },
    ];
    const r = calc(program, lines);
    expect(bxOf(r, "r-bg-ashaway")).toMatchObject({ sourceQty: 5, entitledQty: 5, ok: true });
    expect(r.gifts.map((g) => [g.sku, g.qty, g.value])).toEqual([
      ["AV1F", 3, 3 * 1_150_000],
      ["AV200", 2, 2 * 750_000],
    ]);
    expect(r.totalAmount).toBe(3 * 1_150_000 + 2 * 750_000);
    expect(r.giftQty).toBe(5);
    expect(r.giftValue).toBe(4_950_000);
  });

  it("discount on the same line does not change entitlement; free unit valued at wholesale, not at discounted price", () => {
    const rule = bx({ buyQty: 2, getQty: 1 });
    const lines = [ln("g1", "A", 4, 100_000, 200_000)];
    const r = calc(mkProgram(G, [disc({ discountPercent: 60, discountBasis: "retail" }), rule]), lines);
    expect(r.lines[0].unitPrice).toBe(80_000); // 200.000 × 40%
    expect(r.totalAmount).toBe(320_000);
    expect(giftsOf(r)).toEqual([{ ruleId: "r-bx", sku: "A", name: "SP A", qty: 2, unitValue: 100_000, value: 200_000, auto: true }]);
  });

  it("unconfigured (buy 0 / get 0 / no source) → warning, no free units", () => {
    for (const p of [{ buyQty: 0 }, { getQty: 0 }, { sourceGroupIds: [] }, { buyQty: -2 }, { getQty: NaN }]) {
      const rule = bx(p);
      const r = calc(mkProgram(G, [rule]), [ln("g1", "A", 5)]);
      expect(bxOf(r).entitledQty, JSON.stringify(p)).toBe(0);
      expect(r.gifts).toEqual([]);
      expect(levelsOf(r, "r-bx")).toEqual(["warning"]);
      expect(r.hasError).toBe(false);
    }
  });

  it("line with no wholesale price → free gift has value 0 (the line itself already warns)", () => {
    const rule = bx();
    const r = calc(mkProgram(G, [rule]), [ln("g1", "A", 2, 0, 100_000)]);
    expect(giftsOf(r)).toEqual([{ ruleId: "r-bx", sku: "A", name: "SP A", qty: 2, unitValue: 0, value: 0, auto: true }]);
    expect(r.issues.some((i) => i.level === "warning" && i.ruleId === null)).toBe(true);
  });

  // AMBIGUITY / likely bug: "tính theo từng mã" (per product code). The same code can legitimately sit in two source
  // groups (seed «Khuyến mại Hè»: P-AYPT417-5 is in DM01 and DM02) and so appear on two lines. The engine counts per
  // line: A×1 in g1 + A×1 in g2 with "mua 2 tặng 1" gives 0 instead of 1.
  it("[fixed] same code on two lines of different source groups is pooled per code", () => {
    const rule = bx({ buyQty: 2, getQty: 1, sourceGroupIds: ["g1", "g2"] });
    const r = calc(mkProgram(G, [rule]), [ln("g1", "A", 1), ln("g2", "A", 1)]);
    expect(bxOf(r).entitledQty).toBe(1);
  });

});

describe("text mode — món quà ghi bằng chữ", () => {
  it.each([
    [1, 1, 3, 3],
    [3, 1, 2, 0],
    [3, 1, 3, 1],
    [3, 1, 8, 2],
    [2, 5, 5, 10],
    [100, 1, 100, 1],
  ])("buy %i get %i, total qty %i over the source groups → %i", (buyQty, getQty, qty, n) => {
    const rule = bx({ giftMode: "text", giftText: " Cước N65 ", buyQty, getQty, sourceGroupIds: ["g1", "g2"] });
    // split the quantity over two different codes in two groups: text counts the TOTAL
    const a = Math.floor(qty / 2);
    const lines = [ln("g1", "A", a), ln("g2", "B", qty - a), ln("g3", "C", 50)];
    const r = calc(mkProgram(G, [rule]), lines);
    expect(bxOf(r)).toMatchObject({ sourceQty: qty, entitledQty: n, chosenQty: 0, remainingQty: 0, giftGroupId: null, ok: true });
    expect(giftsOf(r)).toEqual(n > 0 ? [{ ruleId: "r-bx", sku: "", name: "Cước N65", qty: n, unitValue: 0, value: 0, auto: true }] : []);
    expect(r.giftQty).toBe(n);
    expect(r.giftValue).toBe(0);
    expectMatchesOracle(r, rule, lines, []);
  });

  it("seed «Khuyến mại Hè» B1 + A + B2: 3 DM01 rackets (+1 DM03) → 3 «Cước cầu lông LiNing N65», 45% off DM01", () => {
    const program = (seed.programs as unknown as Program[]).find((p) => p.id === "seed-km-2026-he")!;
    const dm01 = program.groups.find((g) => g.id === "g-he-dm01")!;
    const dm03 = program.groups.find((g) => g.id === "g-he-dm03")!;
    const toLine = (groupId: ID, i: (typeof dm01.items)[number], qty: number): OrderLine => ({
      groupId,
      sku: i.sku,
      name: i.name,
      retailPrice: i.retailPrice,
      wholesalePrice: i.wholesalePrice,
      qty,
    });
    const lines = [toLine(dm01.id, dm01.items[0], 2), toLine(dm01.id, dm01.items[1], 1), toLine(dm03.id, dm03.items[0], 1)];
    const r = calc(program, lines);
    expect(bxOf(r, "r-he-b1")).toMatchObject({ giftMode: "text", sourceQty: 3, entitledQty: 3, ok: true });
    expect(giftsOf(r, "r-he-b1")).toEqual([
      { ruleId: "r-he-b1", sku: "", name: "Cước cầu lông LiNing N65", qty: 3, unitValue: 150_000, value: 450_000, auto: true },
    ]);
    // DM01 lines discounted 45% on retail: 2.356.364×0,55 = 1.296.000,2 → 1.296.000 ; 932.727×0,55 = 513.000 (rounded)
    expect(r.lines[0].unitPrice).toBe(Math.round(2_356_364 * 0.55));
    expect(r.lines[1].unitPrice).toBe(Math.round(932_727 * 0.55));
    expect(r.giftQty).toBe(3);
    expect(r.giftValue).toBe(450_000); // 3 × 150.000 (giftTextValue of r-he-b1)
  });

  it("empty text → «Quà tặng»; unconfigured → warning and nothing", () => {
    const r1 = calc(mkProgram(G, [bx({ giftMode: "text", giftText: "   " })]), [ln("g1", "A", 2)]);
    expect(giftsOf(r1)[0]).toMatchObject({ name: "Quà tặng", qty: 2 });
    const r2 = calc(mkProgram(G, [bx({ giftMode: "text", giftText: "Cước", getQty: 0 })]), [ln("g1", "A", 2)]);
    expect(r2.gifts).toEqual([]);
    expect(levelsOf(r2, "r-bx")).toEqual(["warning"]);
  });

  it("[decided] text gifts are worth giftTextValue each (0 when not set), and giftUnitValue agrees", () => {
    const rule = bx({ giftMode: "text", giftText: "Cước" });
    expect(giftUnitValue(rule, { retailPrice: 200, wholesalePrice: 100 })).toBe(0);
    expect(calc(mkProgram(G, [rule]), [ln("g1", "A", 1)]).gifts[0].unitValue).toBe(0);
    const valued = bx({ giftMode: "text", giftText: "Cước N65", giftTextValue: 150_000 });
    expect(giftUnitValue(valued, { retailPrice: 200, wholesalePrice: 100 })).toBe(150_000);
    const r = calc(mkProgram(G, [valued]), [ln("g1", "A", 3)]);
    expect(r.gifts[0]).toMatchObject({ qty: 3, unitValue: 150_000, value: 450_000 });
    expect(r.giftValue).toBe(450_000);
  });
});

describe("group mode — sale chọn quà trong danh mục quà, tính trên tổng số lượng", () => {
  const rule = bx({ giftMode: "group", giftGroupId: "gG", buyQty: 3, getQty: 2, sourceGroupIds: ["g1", "g2"] });
  const lines = [ln("g1", "A", 4), ln("g2", "B", 5), ln("g3", "C", 30)]; // 9 → floor(9/3)×2 = 6

  it("entitled 6 from A=4 + B=5 pooled; nothing chosen → warning «còn được chọn thêm 6»", () => {
    const r = calc(mkProgram(G, [rule]), lines);
    expect(bxOf(r)).toMatchObject({ sourceQty: 9, entitledQty: 6, chosenQty: 0, remainingQty: 6, giftGroupId: "gG", ok: true });
    expect(levelsOf(r, "r-bx")).toEqual(["warning"]);
    expect(r.issues.find((i) => i.ruleId === "r-bx")!.message).toContain("6");
    expect(r.gifts).toEqual([]);
  });

  it("choose 4 Q1 + 2 Q2 = 6 exactly → ok, no issue, value at gift wholesale snapshot", () => {
    const gifts = [gf("r-bx", "gG", "Q1", 4, 50_000, 80_000), gf("r-bx", "gG", "Q2", 2, 90_000, 120_000)];
    const r = calc(mkProgram(G, [rule]), lines, gifts);
    expect(bxOf(r)).toMatchObject({ chosenQty: 6, remainingQty: 0, ok: true });
    expect(r.issues).toEqual([]);
    expect(r.gifts.map((g) => [g.sku, g.qty, g.unitValue, g.value, g.auto])).toEqual([
      ["Q1", 4, 50_000, 200_000, false],
      ["Q2", 2, 90_000, 180_000, false],
    ]);
    expect(r.giftQty).toBe(6);
    expect(r.giftValue).toBe(380_000);
    expect(r.totalAmount).toBe(39 * 100_000); // gifts never charged
  });

  it("choose 7 > 6 → error, ok=false, remaining −1", () => {
    const gifts = [gf("r-bx", "gG", "Q1", 7)];
    const r = calc(mkProgram(G, [rule]), lines, gifts);
    expect(bxOf(r)).toMatchObject({ chosenQty: 7, remainingQty: -1, ok: false });
    expect(levelsOf(r, "r-bx")).toEqual(["error"]);
    expect(r.hasError).toBe(true);
  });

  it("choose a code outside the gift group → error even when quantity is fine", () => {
    const gifts = [gf("r-bx", "g3", "C", 1), gf("r-bx", "gG", "Q1", 5)];
    const r = calc(mkProgram(G, [rule]), lines, gifts);
    expect(bxOf(r)).toMatchObject({ chosenQty: 6, ok: false });
    expect(levelsOf(r, "r-bx")).toEqual(["error"]);
    expect(r.issues.find((i) => i.level === "error")!.message).toContain("C");
  });

  it("chosen gifts while not yet entitled (qty 2 < buy 3) → error", () => {
    const r = calc(mkProgram(G, [rule]), [ln("g1", "A", 2)], [gf("r-bx", "gG", "Q1", 1)]);
    expect(bxOf(r)).toMatchObject({ entitledQty: 0, chosenQty: 1, remainingQty: -1, ok: false });
    expect(r.hasError).toBe(true);
  });

  it("duplicate gift rows of the same code are summed; qty 0/negative/fraction handled as whole units", () => {
    const gifts = [gf("r-bx", "gG", "Q1", 2), gf("r-bx", "gG", "Q1", 1.9), gf("r-bx", "gG", "Q2", 0), gf("r-bx", "gG", "Q2", -3)];
    const r = calc(mkProgram(G, [rule]), lines, gifts);
    expect(bxOf(r)).toMatchObject({ chosenQty: 3, remainingQty: 3 });
    expect(r.orphanGiftIndexes).toEqual([]);
  });

  it("gift group may also be the source group: chosen gifts do not add to the bought quantity", () => {
    const self = bx({ giftMode: "group", giftGroupId: "g1", buyQty: 2, getQty: 1, sourceGroupIds: ["g1"] });
    const r = calc(mkProgram(G, [self]), [ln("g1", "A", 4)], [gf("r-bx", "g1", "A", 2, 100_000)]);
    expect(bxOf(r)).toMatchObject({ sourceQty: 4, entitledQty: 2, chosenQty: 2, ok: true });
    expect(r.issues).toEqual([]);
  });

  it("no gift group configured → warning, entitled 0, any chosen gift is an error", () => {
    const g0 = bx({ giftMode: "group", giftGroupId: null });
    const r = calc(mkProgram(G, [g0]), [ln("g1", "A", 5)], [gf("r-bx", "gG", "Q1", 1)]);
    expect(bxOf(r)).toMatchObject({ entitledQty: 0, chosenQty: 1, ok: false, giftGroupId: null });
    expect(levelsOf(r, "r-bx")).toEqual(["error", "warning"]);
  });

  it("gift value of a pick: wholesale of the snapshot, regardless of the catalog's current price", () => {
    const r = calc(mkProgram(G, [rule]), lines, [gf("r-bx", "gG", "Q1", 1, 33_333, 999_999)]);
    expect(r.gifts[0]).toMatchObject({ unitValue: 33_333, value: 33_333 });
    expect(giftUnitValue(rule, { retailPrice: 999_999, wholesalePrice: 33_333 })).toBe(33_333);
    expect(ruleAcceptsChosenGifts(rule)).toBe(true);
    expect(ruleAcceptsChosenGifts(bx({ giftMode: "same" }))).toBe(false);
    expect(ruleAcceptsChosenGifts(bx({ giftMode: "text" }))).toBe(false);
  });

  // AMBIGUITY: CalcResult.gifts is documented as "toàn bộ quà hợp lệ" (all VALID gifts), yet over-entitlement and
  // wrong-group picks are still listed and counted in giftQty / giftValue. (hasError blocks confirming, so impact is display.)
  it.fails("invalid picks (over entitlement) are excluded from calc.gifts / giftQty as the type doc says", () => {
    const r = calc(mkProgram(G, [rule]), lines, [gf("r-bx", "gG", "Q1", 10)]);
    expect(r.giftQty).toBeLessThanOrEqual(6);
  });
});

describe("orphans, frozen rules, interaction with other rules", () => {
  it("gifts whose rule was removed or switched to same/text mode are orphans → error", () => {
    const lines = [ln("g1", "A", 2)];
    const gifts = [gf("r-gone", "gG", "Q1", 1), gf("r-bx", "gG", "Q1", 1), gf("r-gone", "gG", "Q2", 0)];
    for (const mode of ["same", "text"] as const) {
      const r = calc(mkProgram(G, [bx({ giftMode: mode, giftText: "X" })]), lines, gifts);
      expect(r.orphanGiftIndexes, mode).toEqual([0, 1]);
      expect(r.hasError).toBe(true);
      expect(r.issues.filter((i) => i.ruleId === null && i.level === "error")).toHaveLength(1);
      expect(r.gifts.every((g) => g.auto)).toBe(true); // orphans never counted as gifts
    }
    const rg = calc(mkProgram(G, [bx({ giftMode: "group", giftGroupId: "gG" })]), lines, gifts);
    expect(rg.orphanGiftIndexes).toEqual([0]);
  });

  it("frozenRules override program rules (even an empty list)", () => {
    const program = mkProgram(G, [bx({ buyQty: 1, getQty: 1 })]);
    const frozen = [bx({ buyQty: 2, getQty: 1 })];
    expect(calc(program, [ln("g1", "A", 5)], [], frozen).giftQty).toBe(2);
    expect(calc(program, [ln("g1", "A", 5)], []).giftQty).toBe(5);
    const r = calc(program, [ln("g1", "A", 5)], [], []);
    expect(r.giftQty).toBe(0);
    expect(r.rules).toEqual([]);
  });

  it("frozen group rule still counts lines of a since-deleted source group, and its picks are not orphans", () => {
    const program = mkProgram([mkGroup("gG")], []);
    const frozen = [bx({ giftMode: "group", giftGroupId: "gG", buyQty: 2, getQty: 1, sourceGroupIds: ["g1"] })];
    const r = calc(program, [ln("g1", "A", 4)], [gf("r-bx", "gG", "Q1", 2)], frozen);
    expect(bxOf(r)).toMatchObject({ sourceQty: 4, entitledQty: 2, chosenQty: 2, ok: true });
    expect(r.orphanGiftIndexes).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("tier_gift picks and bxgy picks do not mix; free units do not add to tier revenue", () => {
    const g = bx({ id: "r-bx", giftMode: "group", giftGroupId: "gG", buyQty: 5, getQty: 1 });
    const s = bx({ id: "r-same", giftMode: "same", buyQty: 1, getQty: 1 });
    const t = tier();
    const lines = [ln("g1", "A", 10, 100_000)]; // revenue 1.000.000 → tier reached, budget 500.000
    const gifts = [gf("r-tier", "gG", "Q1", 3, 50_000), gf("r-bx", "gG", "Q2", 2, 90_000)];
    const r = calc(mkProgram(G, [t, g, s]), lines, gifts);
    const tr = r.rules.find((x) => x.type === "tier_gift")!;
    expect(tr).toMatchObject({ revenue: 1_000_000, used: 150_000, giftQty: 3 });
    expect(bxOf(r)).toMatchObject({ entitledQty: 2, chosenQty: 2, ok: true });
    expect(bxOf(r, "r-same").entitledQty).toBe(10);
    expect(r.giftQty).toBe(3 + 2 + 10);
    expect(r.giftValue).toBe(150_000 + 180_000 + 1_000_000);
    expect(r.issues).toEqual([]);
  });

  it("discount qty conditions (min/max) never change bxgy entitlement", () => {
    const rule = bx({ giftMode: "text", giftText: "Cước", buyQty: 1, getQty: 1 });
    for (const qty of [1, 3, 5, 9]) {
      const withDisc = calc(mkProgram(G, [disc({ minQty: 2, maxQty: 4 }), rule]), [ln("g1", "A", qty)]);
      const without = calc(mkProgram(G, [rule]), [ln("g1", "A", qty)]);
      expect(bxOf(withDisc).entitledQty).toBe(qty);
      expect(withDisc.gifts).toEqual(without.gifts);
    }
  });

  it("two bxgy rules on the same group stack independently", () => {
    const a = bx({ id: "r-a", buyQty: 2, getQty: 1 });
    const b = bx({ id: "r-b", giftMode: "text", giftText: "Bao vợt", buyQty: 3, getQty: 1 });
    const r = calc(mkProgram(G, [a, b]), [ln("g1", "A", 6)]);
    expect(bxOf(r, "r-a").entitledQty).toBe(3);
    expect(bxOf(r, "r-b").entitledQty).toBe(2);
    expect(r.giftQty).toBe(5);
  });

  it("a source group listed twice is not double-counted; lines with qty 0/negative/fraction count as whole units", () => {
    const rule = bx({ giftMode: "text", giftText: "X", buyQty: 2, getQty: 1, sourceGroupIds: ["g1", "g1"] });
    const r = calc(mkProgram(G, [rule]), [ln("g1", "A", 3.7), ln("g1", "B", -4), ln("g1", "C", 0)]);
    expect(bxOf(r)).toMatchObject({ sourceQty: 3, entitledQty: 1 });
  });
});

// ───────────────────────── (b) seeded randomized property tests ─────────────────────────

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

function makeGen(seedN: number) {
  const rnd = mulberry32(seedN);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const subset = <T,>(xs: readonly T[]) => xs.filter(() => rnd() < 0.5);
  return { rnd, int, pick, subset };
}

const SRC = ["g1", "g2", "g3", "g4"] as const;
const GIFT_GROUPS = ["gG", "gH"] as const;
const ALL_GROUPS = [...SRC, ...GIFT_GROUPS].map((id) => mkGroup(id));

function randomCase(seedN: number, allowDupSku: boolean) {
  const { rnd, int, pick, subset } = makeGen(seedN);
  const nRules = int(1, 3);
  const rules: Rule[] = [];
  for (let k = 0; k < nRules; k++) {
    const mode = pick(["same", "group", "text"] as const);
    rules.push(
      bx({
        id: `r${k}`,
        name: `R${k}`,
        giftMode: mode,
        buyQty: pick([0, 1, 1, 2, 3, 5, 10, 1000]),
        getQty: pick([0, 1, 1, 2, 3]),
        sourceGroupIds: rnd() < 0.08 ? [] : subset(SRC).length ? subset(SRC) : [pick(SRC)],
        giftGroupId: mode === "group" && rnd() < 0.9 ? pick(GIFT_GROUPS) : null,
        giftText: pick(["", "Cước N65", "  Bao vợt  "]),
      }),
    );
  }
  if (rnd() < 0.4) rules.splice(int(0, rules.length), 0, disc({ targetGroupIds: subset(SRC), discountPercent: pick([10, 45, 55]), minQty: pick([null, 2]), maxQty: pick([null, 6]) }));

  const lines: OrderLine[] = [];
  const nLines = int(0, 8);
  const used = new Set<string>();
  for (let i = 0; i < nLines; i++) {
    const groupId = pick(SRC);
    let sku = `S${int(0, allowDupSku ? 3 : 30)}`;
    if (!allowDupSku) {
      while (used.has(sku)) sku = `S${int(0, 1000)}`;
      used.add(sku);
    }
    const w = pick([0, 50_000, 123_457, 1_649_455]);
    // a code always has the same price, whatever group it sits in
    const price = allowDupSku ? 10_000 * (Number(sku.slice(1)) + 1) : w;
    lines.push(ln(groupId, sku, pick([0, 1, 2, 3, 4, 5, 7, 9, 12, 25, 1000, 2.5, -1]), price, price * 2));
  }

  const gifts: OrderGift[] = [];
  const nGifts = int(0, 4);
  for (let i = 0; i < nGifts; i++) {
    const ruleId = rnd() < 0.85 ? `r${int(0, nRules - 1)}` : "r-gone";
    const groupId = rnd() < 0.85 ? pick(GIFT_GROUPS) : pick(SRC);
    gifts.push(gf(ruleId, groupId, `Q${int(0, 5)}`, pick([0, 1, 1, 2, 3, 5, -1]), pick([0, 40_000, 90_000]), 100_000));
  }
  return { rules, lines, gifts };
}

describe("randomized: engine matches the business oracle", () => {
  const N = 4000;

  it(`${N} random orders with distinct codes: every bxgy rule, totals, orphans`, () => {
    const stats = { same: 0, text: 0, group: 0, over: 0, under: 0, wrong: 0, orphan: 0, unconf: 0, exact: 0 };
    for (let s = 1; s <= N; s++) {
      const { rules, lines, gifts } = randomCase(s, false);
      const program = mkProgram(ALL_GROUPS, rules);
      const r = calc(program, lines, gifts);
      let expQty = 0;
      let expVal = 0;
      for (const rule of rules) {
        if (rule.type !== "buy_x_get_y") continue;
        const o = oracleBx(rule, lines, gifts);
        expectMatchesOracle(r, rule, lines, gifts, `seed ${s} rule ${rule.id}`);
        if (o.entitledQty > 0) stats[rule.giftMode]++;
        if (o.issueLevels.includes("warning") && o.entitledQty === 0 && o.chosenQty === 0) stats.unconf++;
        if (rule.giftMode === "group" && o.chosenQty > o.entitledQty) stats.over++;
        if (rule.giftMode === "group" && o.chosenQty < o.entitledQty) stats.under++;
        if (rule.giftMode === "group" && o.chosenQty > 0 && o.chosenQty === o.entitledQty) stats.exact++;
        if (rule.giftMode === "group" && !o.ok && o.chosenQty <= o.entitledQty) stats.wrong++;
        expQty += o.gifts.reduce((a, g) => a + g.qty, 0);
        expVal += o.gifts.reduce((a, g) => a + g.value, 0);
      }
      expect(r.giftQty, `seed ${s}`).toBe(expQty);
      expect(r.giftValue, `seed ${s}`).toBe(expVal);
      const orph = oracleOrphans(rules, gifts);
      expect(r.orphanGiftIndexes, `seed ${s}`).toEqual(orph);
      if (orph.length) stats.orphan++;
      expect(levelsOf(r, null).filter((l) => l === "error").length, `seed ${s}`).toBe(orph.length > 0 ? 1 : 0);
      for (const g of r.gifts) expect(g.value).toBe(g.unitValue * g.qty);

      // metamorphic: bxgy rules never change what is paid
      const base = calc(mkProgram(ALL_GROUPS, rules.filter((x) => x.type !== "buy_x_get_y")), lines, []);
      expect(r.totalAmount, `seed ${s}`).toBe(base.totalAmount);
      expect(r.lines.map((l) => l.unitPrice)).toEqual(base.lines.map((l) => l.unitPrice));

      // metamorphic: discounts never change bxgy entitlement
      const noDisc = calc(mkProgram(ALL_GROUPS, rules.filter((x) => x.type !== "discount")), lines, gifts);
      for (const rule of rules) if (rule.type === "buy_x_get_y") expect(bxOf(noDisc, rule.id).entitledQty).toBe(bxOf(r, rule.id).entitledQty);

      // frozen copy of the rules gives the same result even if the program's rules are gone
      const frozen = calc(mkProgram(ALL_GROUPS, []), lines, gifts, rules);
      expect(frozen.gifts).toEqual(r.gifts);
      expect(frozen.rules).toEqual(r.rules);
    }
    // the generator really reaches every branch
    for (const [k, v] of Object.entries(stats)) expect(v, `${k} ${JSON.stringify(stats)}`).toBeGreaterThan(20);
  });

  it("monotonic: buying one more source unit never lowers entitlement (same/text/group)", () => {
    for (let s = 1; s <= 1500; s++) {
      const { rules, lines } = randomCase(10_000 + s, false);
      const program = mkProgram(ALL_GROUPS, rules);
      if (lines.length === 0) continue;
      const before = calc(program, lines);
      const bumped = lines.map((l, i) => (i === 0 ? { ...l, qty: Math.max(0, Math.floor(l.qty)) + 1 } : l));
      const after = calc(program, bumped);
      for (const rule of rules) {
        if (rule.type !== "buy_x_get_y") continue;
        expect(bxOf(after, rule.id).entitledQty, `seed ${s}`).toBeGreaterThanOrEqual(bxOf(before, rule.id).entitledQty);
      }
    }
  });

  it("group ≥ same for identical X/Y/sources (pooling never gives fewer gifts than per-code)", () => {
    for (let s = 1; s <= 1500; s++) {
      const { lines } = randomCase(20_000 + s, false);
      const { int, pick, subset } = makeGen(s);
      const X = int(1, 6);
      const Y = int(1, 3);
      const src = subset(SRC).length ? subset(SRC) : [pick(SRC)];
      const same = bx({ id: "a", buyQty: X, getQty: Y, sourceGroupIds: src });
      const grp = bx({ id: "b", buyQty: X, getQty: Y, sourceGroupIds: src, giftMode: "group", giftGroupId: "gG" });
      const txt = bx({ id: "c", buyQty: X, getQty: Y, sourceGroupIds: src, giftMode: "text", giftText: "T" });
      const r = calc(mkProgram(ALL_GROUPS, [same, grp, txt]), lines);
      expect(bxOf(r, "b").entitledQty).toBeGreaterThanOrEqual(bxOf(r, "a").entitledQty);
      expect(bxOf(r, "b").entitledQty).toBe(bxOf(r, "c").entitledQty);
    }
  });

  // Same-code-in-several-lines cases differ only in the "same" mode (per line vs per code). Count how many disagree.
  it("[fixed] random orders where a code repeats over several lines: every mode matches the per-code oracle", () => {
    let sameDiffs = 0;
    let firstDiff = "";
    for (let s = 1; s <= 2000; s++) {
      const { rules, lines, gifts } = randomCase(30_000 + s, true);
      const r = calc(mkProgram(ALL_GROUPS, rules), lines, gifts);
      for (const rule of rules) {
        if (rule.type !== "buy_x_get_y") continue;
        if (rule.giftMode !== "same") {
          expectMatchesOracle(r, rule, lines, gifts, `dup seed ${s}`);
          continue;
        }
        const o = oracleBx(rule, lines, gifts);
        if (o.entitledQty !== bxOf(r, rule.id).entitledQty) {
          sameDiffs++;
          if (!firstDiff) firstDiff = `seed ${30_000 + s}: oracle ${o.entitledQty} vs engine ${bxOf(r, rule.id).entitledQty}`;
        }
      }
    }
    expect(sameDiffs, firstDiff).toBe(0); // fixed: «same» now counts per code, like the oracle
  });
});
