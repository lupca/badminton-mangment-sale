// Tests for the pure exports of the store: normalizeDB (reads untrusted data) and seedDB.
// The React provider itself is not rendered here.
import { describe, expect, it } from "vitest";
import seed from "../seed/seed.json";
import demo from "../seed/demo.json";
import type { BuyXGetYRule, DB, DiscountRule, Program, TierGiftRule } from "../types";
import { calculateOrder } from "./engine";
import { normalizeSku } from "./format";
import { ruleGroupIds, validateRule } from "./programOps";
import { freshDB, keepDeviceSettings, mergeDeviceSettings, normalizeDB, seedDB } from "./store";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

/** What the store does on every page load: JSON text → normalizeDB. */
const reload = (db: DB): DB => normalizeDB(JSON.parse(JSON.stringify(db)));

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ───────────────────────── Garbage ─────────────────────────

describe("normalizeDB — input that is not a database", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a string", "abc"],
    ["true", true],
    ["an empty array", []],
    ["an array of programs", [{ id: "p1", name: "KM", groups: [], rules: [] }]],
    ["an empty object", {}],
    ["an unrelated object", { foo: 1, bar: [1, 2, 3] }],
    ["programs is a string", { programs: "x" }],
    ["programs is an object, orders a number", { programs: {}, orders: 5 }],
    ["programs is null", { programs: null, orders: null }],
  ])("%s → throws an error with a Vietnamese message", (_label, input) => {
    expect(() => normalizeDB(input)).toThrow(Error);
    expect(() => normalizeDB(input)).toThrow(/File không đúng định dạng dữ liệu của hệ thống/);
  });

  it("accepts a file that has at least one of the two lists", () => {
    const empty: DB = {
      version: 1,
      programs: [],
      orders: [],
      settings: { role: "manager", salesperson: "", salespersonPhone: "", lowStockThreshold: 5 },
      stock: { bySku: {}, updatedAt: null },
    };
    expect(normalizeDB({ programs: [] })).toEqual(empty);
    expect(normalizeDB({ orders: [] })).toEqual(empty);
    expect(normalizeDB({ programs: [], orders: "not a list" })).toEqual(empty);
  });

  it("always writes version 1 and a settings object, whatever the file says", () => {
    expect(normalizeDB({ version: 99, programs: [], settings: null })).toMatchObject({ version: 1, settings: { salesperson: "" } });
    const defaults = { role: "manager", salesperson: "", salespersonPhone: "", lowStockThreshold: 5 };
    expect(normalizeDB({ programs: [], settings: "x" }).settings).toEqual(defaults);
    expect(normalizeDB({ programs: [], settings: { salesperson: 123 } }).settings).toEqual(defaults);
    expect(normalizeDB({ programs: [], settings: { salesperson: "Tùng", extra: true } }).settings).toEqual({ ...defaults, salesperson: "Tùng" });
  });

  it("drops list entries that are not objects instead of inventing empty records", () => {
    const db = normalizeDB({
      programs: [null, 5, "x", [], { id: "p1", name: "KM", groups: [null, "x", { id: "g1", name: "Nhóm", items: [null, 7, "x", {}] }], rules: [null, "x", 3, {}] }],
      orders: [null, 0, "y", { id: "o1", lines: [null, "x", {}], gifts: [null, 1, {}] }],
    });
    expect(db.programs.map((p) => p.id)).toEqual(["p1"]);
    expect(db.programs[0].groups.map((g) => g.id)).toEqual(["g1"]);
    expect(db.programs[0].groups[0].items).toEqual([]);
    expect(db.programs[0].rules).toEqual([]);
    expect(db.orders.map((o) => o.id)).toEqual(["o1"]);
    expect(db.orders[0].lines).toEqual([]);
    expect(db.orders[0].gifts).toEqual([]);
  });

  it("drops gift-tier entries that are not objects (a phantom tier would start at 0 đ and be reached by every order)", () => {
    const db = normalizeDB({
      programs: [
        {
          id: "p1",
          rules: [
            {
              id: "r1",
              type: "tier_gift",
              tiers: [null, 5, "x", [], { id: "t1", min: 10_000_000, limitType: "amount", limitValue: 500_000 }],
            },
          ],
        },
      ],
    });
    const rule = db.programs[0].rules[0] as TierGiftRule;
    expect(rule.tiers).toEqual([{ id: "t1", min: 10_000_000, limitType: "amount", limitValue: 500_000, maxQty: null, allowedSkus: null }]);
  });

  it("does not crash on deeply wrong field types", () => {
    const db = normalizeDB({
      programs: [{ id: 5, name: null, brand: {}, groups: "x", rules: 7, startDate: 20261105, endDate: [], note: 1 }],
      orders: [{ id: {}, code: 9, programId: null, lines: "x", gifts: {}, status: 1, frozenRules: "x" }],
      settings: [],
    });
    expect(db.programs).toHaveLength(1);
    expect(db.programs[0]).toMatchObject({ name: "Chương trình chưa đặt tên", brand: "", groups: [], rules: [], startDate: null, endDate: null, note: "" });
    expect(db.programs[0].id).toMatch(/^p/);
    expect(db.orders).toHaveLength(1);
    expect(db.orders[0]).toMatchObject({ code: "", programId: "", lines: [], gifts: [], status: "draft" });
    expect(db.orders[0]).not.toHaveProperty("frozenRules");
  });

  it("does not modify the object it was given", () => {
    const raw = deepFreeze(JSON.parse(JSON.stringify(seed)));
    expect(() => normalizeDB(raw)).not.toThrow();
  });
});

// ───────────────────────── Defaults ─────────────────────────

describe("normalizeDB — partial objects get defaults", () => {
  it("an empty program", () => {
    const [program] = normalizeDB({ programs: [{}] }).programs;
    expect(program).toMatchObject({
      name: "Chương trình chưa đặt tên",
      brand: "",
      startDate: null,
      endDate: null,
      note: "",
      groups: [],
      rules: [],
    });
    expect(program.id).toMatch(/^p[0-9a-z]+$/);
    expect(program.createdAt).toMatch(ISO);
    expect(program.updatedAt).toMatch(ISO);
  });

  it("keeps what a program does have", () => {
    const [program] = normalizeDB({
      programs: [
        {
          id: "p-1",
          name: "KM tháng 12",
          brand: "Yonex",
          startDate: "2026-12-01",
          endDate: "2026-12-31",
          note: "Ghi chú",
          createdAt: "2026-11-20T01:02:03.000Z",
          updatedAt: "2026-11-21T01:02:03.000Z",
        },
      ],
    }).programs;
    expect(program).toEqual({
      id: "p-1",
      name: "KM tháng 12",
      brand: "Yonex",
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      note: "Ghi chú",
      groups: [],
      rules: [],
      createdAt: "2026-11-20T01:02:03.000Z",
      updatedAt: "2026-11-21T01:02:03.000Z",
    });
  });

  it("only keeps dates written as YYYY-MM-DD", () => {
    const dates = (startDate: unknown, endDate: unknown) => {
      const [p] = normalizeDB({ programs: [{ startDate, endDate }] }).programs;
      return [p.startDate, p.endDate];
    };
    expect(dates("2026-11-05", "2026-11-30")).toEqual(["2026-11-05", "2026-11-30"]);
    expect(dates("05/11/2026", "30-11-2026")).toEqual([null, null]);
    expect(dates("2026-11-05T00:00:00.000Z", "")).toEqual([null, null]);
    expect(dates(null, undefined)).toEqual([null, null]);
  });

  it("a group: generated id, default name, items cleaned", () => {
    const [program] = normalizeDB({
      programs: [
        {
          groups: [
            {},
            {
              id: "g-1",
              name: "Danh mục áp dụng",
              items: [
                { sku: " p-aypr285-3 ", name: "Khung vợt", retailPrice: "2022545", wholesalePrice: 1415781.5, unit: "cây", note: "ghi chú" },
                { sku: "AV1F" },
                { sku: "", name: "không có mã" },
                { name: "cũng không có mã" },
                { sku: "N-1", name: 5, retailPrice: -1, wholesalePrice: "abc", unit: "", note: 7 },
              ],
            },
          ],
        },
      ],
    }).programs;
    expect(program.groups[0]).toMatchObject({ name: "Danh mục", items: [] });
    expect(program.groups[0].id).toMatch(/^g[0-9a-z]+$/);
    expect(program.groups[1]).toEqual({
      id: "g-1",
      name: "Danh mục áp dụng",
      items: [
        { sku: "P-AYPR285-3", name: "Khung vợt", retailPrice: 2_022_545, wholesalePrice: 1_415_782, unit: "cây", note: "ghi chú" },
        { sku: "AV1F", name: "", retailPrice: 0, wholesalePrice: 0 },
        { sku: "N-1", name: "", retailPrice: 0, wholesalePrice: 0 },
      ],
    });
  });

  it("a tier_gift rule and its tiers", () => {
    const [program] = normalizeDB({
      programs: [
        {
          rules: [
            { type: "tier_gift" },
            {
              id: "r-1",
              type: "tier_gift",
              name: "Tặng theo doanh số",
              sourceGroupIds: ["g-1", 5, null, "g-2"],
              giftGroupId: "g-gift",
              giftPriceBasis: "retail",
              tiers: [
                {},
                { id: "t-1", min: "10000000", limitType: "percent", limitValue: "12.5", maxQty: "3", allowedSkus: [" p-aypt399-4 ", "", null, "AV1F"] },
                { id: "t-2", min: -5, limitType: "weird", limitValue: -100, maxQty: "", allowedSkus: "P-AYPT399-4" },
                { id: "t-3", min: 20_000_000, limitValue: 3_190_000, maxQty: null, allowedSkus: null },
              ],
            },
          ],
        },
      ],
    }).programs;
    const [bare, full] = program.rules as TierGiftRule[];
    expect(bare).toMatchObject({ type: "tier_gift", name: "Quy tắc", sourceGroupIds: [], giftGroupId: null, giftPriceBasis: "wholesale", tiers: [] });
    expect(bare.id).toMatch(/^r[0-9a-z]+$/);
    expect(full).toMatchObject({ id: "r-1", name: "Tặng theo doanh số", sourceGroupIds: ["g-1", "g-2"], giftGroupId: "g-gift", giftPriceBasis: "retail" });
    expect(full.tiers[0]).toMatchObject({ min: 0, limitType: "amount", limitValue: 0, maxQty: null, allowedSkus: null });
    expect(full.tiers[0].id).toMatch(/^t[0-9a-z]+$/);
    expect(full.tiers.slice(1)).toEqual([
      { id: "t-1", min: 10_000_000, limitType: "percent", limitValue: 12.5, maxQty: 3, allowedSkus: ["P-AYPT399-4", "AV1F"] },
      { id: "t-2", min: 0, limitType: "amount", limitValue: 0, maxQty: null, allowedSkus: null },
      { id: "t-3", min: 20_000_000, limitType: "amount", limitValue: 3_190_000, maxQty: null, allowedSkus: null },
    ]);
  });

  it("a discount rule", () => {
    const [program] = normalizeDB({
      programs: [
        {
          rules: [
            { type: "discount" },
            {
              id: "r-2",
              type: "discount",
              name: "Giảm 45%",
              targetGroupIds: ["g-1"],
              discountPercent: "45",
              discountBasis: "retail",
              minQty: 2,
              maxQty: "4",
              requireGroupIds: ["g-3"],
              requireMinQty: 1,
            },
          ],
        },
      ],
    }).programs;
    const [bare, full] = program.rules as DiscountRule[];
    expect(bare).toMatchObject({
      type: "discount",
      name: "Quy tắc",
      targetGroupIds: [],
      discountPercent: 0,
      discountBasis: "wholesale",
      minQty: null,
      maxQty: null,
      requireGroupIds: [],
    });
    expect(full).toEqual({
      id: "r-2",
      type: "discount",
      name: "Giảm 45%",
      targetGroupIds: ["g-1"],
      discountPercent: 45,
      discountBasis: "retail",
      minQty: 2,
      maxQty: 4,
      requireGroupIds: ["g-3"],
      requireMinQty: 1,
    });
  });

  it("a discount rule that names companion groups but no quantity still requires one companion item", () => {
    // Dropping the requirement silently would hand out the discount to orders that should not get it.
    const [program] = normalizeDB({
      programs: [{ rules: [{ type: "discount", targetGroupIds: ["g-1"], discountPercent: 45, requireGroupIds: ["g-3"] }] }],
    }).programs;
    expect((program.rules[0] as DiscountRule).requireMinQty).toBe(1);
    // An explicit 0 is kept: the rule editor shows it as “no companion requirement”.
    const [explicit] = normalizeDB({
      programs: [{ rules: [{ type: "discount", targetGroupIds: ["g-1"], discountPercent: 45, requireGroupIds: ["g-3"], requireMinQty: 0 }] }],
    }).programs;
    expect((explicit.rules[0] as DiscountRule).requireMinQty).toBe(0);
  });

  it("a buy_x_get_y rule", () => {
    const [program] = normalizeDB({
      programs: [
        {
          rules: [
            { type: "buy_x_get_y" },
            { id: "r-3", type: "buy_x_get_y", name: "Mua 2 tặng 1", sourceGroupIds: ["g-1"], buyQty: "2", getQty: 1.9, giftMode: "group", giftGroupId: "g-gift", giftText: "" },
            { id: "r-4", type: "buy_x_get_y", giftMode: "text", giftText: "Cước N65" },
            { id: "r-5", type: "buy_x_get_y", giftMode: "anything else" },
          ],
        },
      ],
    }).programs;
    const [bare, group, text, weird] = program.rules as BuyXGetYRule[];
    expect(bare).toMatchObject({ type: "buy_x_get_y", name: "Quy tắc", sourceGroupIds: [], buyQty: 1, getQty: 1, giftMode: "same", giftGroupId: null, giftText: "" });
    expect(group).toEqual({ id: "r-3", type: "buy_x_get_y", name: "Mua 2 tặng 1", sourceGroupIds: ["g-1"], buyQty: 2, getQty: 1, giftMode: "group", giftGroupId: "g-gift", giftText: "" });
    expect(text).toMatchObject({ giftMode: "text", giftText: "Cước N65" });
    expect(weird.giftMode).toBe("same");
  });

  it("rules of an unknown type are dropped", () => {
    const [program] = normalizeDB({
      programs: [{ rules: [{ type: "combo", name: "?" }, { name: "không có kiểu" }, { type: "discount", id: "r-ok" }] }],
    }).programs;
    expect(program.rules.map((r) => r.id)).toEqual(["r-ok"]);
  });

  it("an empty order", () => {
    const [order] = normalizeDB({ orders: [{}] }).orders;
    expect(order).toMatchObject({
      code: "",
      programId: "",
      customerName: "",
      customerPhone: "",
      salesperson: "",
      note: "",
      status: "draft",
      lines: [],
      gifts: [],
    });
    expect(order.id).toMatch(/^o[0-9a-z]+$/);
    expect(order.createdAt).toMatch(ISO);
    expect(order).not.toHaveProperty("frozenRules");
  });

  it("an order: lines and gifts cleaned, status restricted, frozen rules normalised", () => {
    const [order] = normalizeDB({
      orders: [
        {
          id: "o-1",
          code: "DH261120-001",
          programId: "p-1",
          customerName: "Đại lý Minh Anh",
          customerPhone: "0901234567",
          salesperson: "Tùng",
          note: "giao gấp",
          status: "confirmed",
          lines: [
            { groupId: "g-1", sku: " p-aypr285-3 ", name: "Khung vợt", retailPrice: 2_022_545, wholesalePrice: 1_415_782, qty: "15" },
            { groupId: "g-1", sku: "AV1F", qty: 2.9 },
            { groupId: "g-1", sku: "AV1X", qty: -4 },
            { groupId: "g-1", sku: "", qty: 3 },
            { sku: "N-1" },
          ],
          gifts: [
            { ruleId: "r-1", groupId: "g-gift", sku: "p-aypt399-4", name: "Quà", retailPrice: 1_200_000, wholesalePrice: 840_000, qty: 1 },
            { sku: "Q-2" },
            { ruleId: "r-1", groupId: "g-gift", sku: "", qty: 1 },
          ],
          frozenRules: [{ type: "discount", id: "r-9", discountPercent: 45 }, { type: "unknown" }],
          createdAt: "2026-11-20T01:02:03.000Z",
          updatedAt: "2026-11-20T04:05:06.000Z",
        },
        { id: "o-2", status: "paid" },
      ],
    }).orders;
    expect(order).toMatchObject({
      id: "o-1",
      code: "DH261120-001",
      programId: "p-1",
      customerName: "Đại lý Minh Anh",
      customerPhone: "0901234567",
      salesperson: "Tùng",
      note: "giao gấp",
      status: "confirmed",
      createdAt: "2026-11-20T01:02:03.000Z",
      updatedAt: "2026-11-20T04:05:06.000Z",
    });
    expect(order.lines).toEqual([
      { groupId: "g-1", sku: "P-AYPR285-3", name: "Khung vợt", retailPrice: 2_022_545, wholesalePrice: 1_415_782, qty: 15 },
      { groupId: "g-1", sku: "AV1F", name: "", retailPrice: 0, wholesalePrice: 0, qty: 2 },
      { groupId: "g-1", sku: "AV1X", name: "", retailPrice: 0, wholesalePrice: 0, qty: 0 },
      { groupId: "", sku: "N-1", name: "", retailPrice: 0, wholesalePrice: 0, qty: 0 },
    ]);
    expect(order.gifts).toEqual([
      { ruleId: "r-1", groupId: "g-gift", sku: "P-AYPT399-4", name: "Quà", retailPrice: 1_200_000, wholesalePrice: 840_000, qty: 1 },
      { ruleId: "", groupId: "", sku: "Q-2", name: "", retailPrice: 0, wholesalePrice: 0, qty: 0 },
    ]);
    expect(order.frozenRules).toHaveLength(1);
    expect(order.frozenRules![0]).toMatchObject({ id: "r-9", type: "discount", discountPercent: 45 });
  });

  it("status is draft unless it is exactly “confirmed”", () => {
    const statuses = normalizeDB({ orders: [{ status: "confirmed" }, { status: "paid" }, { status: "CONFIRMED" }, {}] }).orders.map((o) => o.status);
    expect(statuses).toEqual(["confirmed", "draft", "draft", "draft"]);
  });

  it("an empty frozenRules list is kept: a confirmed order with no rule must not pick up the program's rules later", () => {
    const [frozen, notFrozen] = normalizeDB({ orders: [{ frozenRules: [] }, { frozenRules: null }] }).orders;
    expect(frozen.frozenRules).toEqual([]);
    expect(notFrozen).not.toHaveProperty("frozenRules");
  });
});

// ───────────────────────── Stability ─────────────────────────

describe("normalizeDB — reading back what the app itself saved", () => {
  it("is idempotent", () => {
    const messy = {
      programs: [
        {
          id: "p-1",
          groups: [{ id: "g-1", items: [{ sku: " a-1 ", retailPrice: "150000", wholesalePrice: 100000.4 }] }],
          rules: [
            { id: "r-1", type: "tier_gift", sourceGroupIds: ["g-1"], tiers: [{ id: "t-1", min: "10000000", limitValue: "5", limitType: "percent", allowedSkus: [" a-1 "] }] },
            { id: "r-2", type: "discount", discountPercent: "12.5", minQty: "2" },
            { id: "r-3", type: "buy_x_get_y", buyQty: "2" },
          ],
          createdAt: "2026-11-20T00:00:00.000Z",
          updatedAt: "2026-11-20T00:00:00.000Z",
        },
      ],
      orders: [
        {
          id: "o-1",
          lines: [{ sku: "a-1", qty: "3" }],
          gifts: [{ sku: "a-1", ruleId: "r-1", qty: 1 }],
          frozenRules: [{ id: "r-3", type: "buy_x_get_y" }],
          createdAt: "2026-11-20T00:00:00.000Z",
          updatedAt: "2026-11-20T00:00:00.000Z",
        },
      ],
      settings: { salesperson: "Tùng" },
    };
    const once = normalizeDB(messy);
    expect(normalizeDB(once)).toEqual(once);
    expect(reload(once)).toEqual(once);
  });

  it("the seed survives a save / reload unchanged", () => {
    const db = seedDB();
    expect(reload(db)).toEqual(db);
    expect(JSON.stringify(reload(db))).toBe(JSON.stringify(db));
  });

  it("a rule saved with “buy 0” or “get 0” stays invalid after a reload — it must not turn into buy 1 get 1", () => {
    // The rep clears the quantity field in the rule editor (0), the engine and validateRule flag the rule,
    // then the page is reloaded.
    const db = seedDB();
    const program = db.programs.find((p) => p.id === "seed-bang-gia-sau-ck")!;
    const rule = program.rules[0] as BuyXGetYRule;
    rule.buyQty = 0;
    rule.getQty = 0;
    expect(validateRule(rule, program.groups)).not.toEqual([]);

    const reloaded = reload(db).programs.find((p) => p.id === "seed-bang-gia-sau-ck")!;
    const after = reloaded.rules[0] as BuyXGetYRule;
    expect(after.buyQty).toBe(0);
    expect(after.getQty).toBe(0);
    expect(validateRule(after, reloaded.groups)).not.toEqual([]);

    // 3 × AV1F must not earn free rackets from a rule that is not set up.
    const av1f = reloaded.groups.find((g) => g.id === "g-bg-ashaway")!.items.find((i) => i.sku === "AV1F")!;
    const calc = calculateOrder(reloaded, { lines: [{ groupId: "g-bg-ashaway", ...av1f, qty: 3 }], gifts: [] });
    expect(calc.gifts).toEqual([]);
    expect(calc.issues.some((i) => i.level === "warning")).toBe(true);
  });

  it("other values the rule editor can produce survive a reload unchanged", () => {
    const db = seedDB();
    const he = db.programs.find((p) => p.id === "seed-km-2026-he")!;
    const a = he.rules[0] as DiscountRule;
    a.discountPercent = 12.5;
    a.minQty = null;
    a.maxQty = 7;
    a.requireMinQty = 0;
    const b2 = he.rules[2] as TierGiftRule;
    b2.tiers[0].limitValue = 12.5;
    b2.tiers[0].maxQty = 3;
    b2.tiers[0].allowedSkus = ["P-AYPT417-5"];
    b2.giftGroupId = null;
    he.startDate = null;
    he.name = "";
    expect(reload(db)).toEqual(db);
  });
});

// ───────────────────────── Settings: role, sale profile, low-stock threshold ─────────────────────────

describe("normalizeDB — settings", () => {
  const settingsOf = (settings: unknown) => normalizeDB({ programs: [], settings }).settings;

  it("data saved before roles existed belongs to a manager: nobody loses the screens they were using", () => {
    expect(settingsOf({ salesperson: "Tùng" })).toEqual({ role: "manager", salesperson: "Tùng", salespersonPhone: "", lowStockThreshold: 5 });
    const old = JSON.parse(JSON.stringify(seedDB()));
    old.settings = { salesperson: "" };
    expect(normalizeDB(old).settings.role).toBe("manager");
  });

  it("keeps the sale role and the sale's phone; anything else as a role means manager", () => {
    expect(settingsOf({ role: "sale", salesperson: "Lan", salespersonPhone: "0903 111 222" })).toMatchObject({
      role: "sale",
      salesperson: "Lan",
      salespersonPhone: "0903 111 222",
    });
    for (const role of ["admin", "SALE", 1, null, {}]) expect(settingsOf({ role }).role).toBe("manager");
    expect(settingsOf({ salespersonPhone: 903111222 }).salespersonPhone).toBe("");
  });

  it("low-stock threshold: missing → 5, a saved 0 stays 0 (warning off), text numbers are read, garbage → 0", () => {
    expect(settingsOf({}).lowStockThreshold).toBe(5);
    expect(settingsOf({ lowStockThreshold: null }).lowStockThreshold).toBe(5);
    expect(settingsOf({ lowStockThreshold: 0 }).lowStockThreshold).toBe(0);
    expect(settingsOf({ lowStockThreshold: 12 }).lowStockThreshold).toBe(12);
    expect(settingsOf({ lowStockThreshold: "7" }).lowStockThreshold).toBe(7);
    expect(settingsOf({ lowStockThreshold: 2.9 }).lowStockThreshold).toBe(2);
    expect(settingsOf({ lowStockThreshold: -3 }).lowStockThreshold).toBe(0);
    expect(settingsOf({ lowStockThreshold: "nhiều" }).lowStockThreshold).toBe(0);
  });

  it("settings survive a save / reload unchanged", () => {
    const db = seedDB();
    db.settings = { role: "sale", salesperson: "Lan", salespersonPhone: "0903111222", lowStockThreshold: 0 };
    expect(reload(db).settings).toEqual(db.settings);
  });
});

describe("keepDeviceSettings / freshDB", () => {
  it("replacing the data keeps this device's role and sale profile, and takes the rest from the new data", () => {
    const device = { role: "sale", salesperson: "Lan", salespersonPhone: "0903111222", lowStockThreshold: 5 } as const;
    const incoming = { role: "manager", salesperson: "Tùng", salespersonPhone: "0988", lowStockThreshold: 12 } as const;
    expect(keepDeviceSettings(device, incoming)).toEqual({ role: "sale", salesperson: "Lan", salespersonPhone: "0903111222", lowStockThreshold: 12 });
  });

  it("a device with no sale name does not pick up the name of whoever sent the file", () => {
    const device = { role: "manager", salesperson: "", salespersonPhone: "", lowStockThreshold: 5 } as const;
    const incoming = { role: "sale", salesperson: "Tùng", salespersonPhone: "0988", lowStockThreshold: 3 } as const;
    expect(keepDeviceSettings(device, incoming)).toEqual({ role: "manager", salesperson: "", salespersonPhone: "", lowStockThreshold: 3 });
  });

  it("a browser that opens the app for the first time starts as a sale, with the sample data", () => {
    const db = freshDB();
    expect(db.settings).toEqual({ role: "sale", salesperson: "", salespersonPhone: "", lowStockThreshold: 5 });
    expect(db.programs).toHaveLength(3);
    expect(seedDB().settings.role).toBe("manager");
  });
});

describe("mergeDeviceSettings — adding a file to the data already on the device", () => {
  const managerFile = { role: "manager", salesperson: "Sếp", salespersonPhone: "0900", lowStockThreshold: 12 } as const;

  it("a sale's device follows the manager's low-stock threshold and keeps its own role and sale profile", () => {
    const device = { role: "sale", salesperson: "Lan", salespersonPhone: "0903", lowStockThreshold: 5 } as const;
    expect(mergeDeviceSettings(device, managerFile)).toEqual({
      role: "sale",
      salesperson: "Lan",
      salespersonPhone: "0903",
      lowStockThreshold: 12,
    });
  });

  it("a sale's device also follows a threshold of 0 (the manager switched the «sắp hết» warning off)", () => {
    const device = { role: "sale", salesperson: "", salespersonPhone: "", lowStockThreshold: 5 } as const;
    expect(mergeDeviceSettings(device, { ...managerFile, lowStockThreshold: 0 }).lowStockThreshold).toBe(0);
  });

  it("a manager's device keeps everything: a file sent back by a sale must not undo the manager's threshold", () => {
    const device = { role: "manager", salesperson: "", salespersonPhone: "", lowStockThreshold: 12 } as const;
    const saleFile = { role: "sale", salesperson: "Lan", salespersonPhone: "0903", lowStockThreshold: 5 } as const;
    expect(mergeDeviceSettings(device, saleFile)).toBe(device);
  });
});

describe("normalizeDB — the salesperson on an order", () => {
  it("keeps the name and the phone; an order saved before the phone existed gets an empty one", () => {
    const [withPhone, old] = normalizeDB({
      orders: [
        { id: "o-1", salesperson: "Lan", salespersonPhone: "0903 111 222" },
        { id: "o-2", salesperson: "Tùng" },
      ],
    }).orders;
    expect(withPhone).toMatchObject({ salesperson: "Lan", salespersonPhone: "0903 111 222" });
    expect(old).toMatchObject({ salesperson: "Tùng", salespersonPhone: "" });
  });
});

// ───────────────────────── Stock ─────────────────────────

describe("normalizeDB — stock", () => {
  it("data saved before stock existed loads with an empty stock", () => {
    const old = JSON.parse(JSON.stringify(seedDB()));
    delete old.stock;
    const db = normalizeDB(old);
    expect(db.stock).toEqual({ bySku: {}, updatedAt: null });
    expect(db.programs).toHaveLength(3);
  });

  it("keeps (SKU, number) pairs, normalises the SKU, allows zero and negative, rounds to 3 decimals", () => {
    const db = normalizeDB({
      programs: [],
      stock: {
        updatedAt: "2026-11-20T14:05:00.000Z",
        bySku: { " p-aypr285-3 ": 24, AV1F: 0, AVPTX: -2, AV80: 2.50049, "": 5 },
      },
    });
    expect(db.stock).toEqual({
      updatedAt: "2026-11-20T14:05:00.000Z",
      bySku: { "P-AYPR285-3": 24, AV1F: 0, AVPTX: -2, AV80: 2.5 },
    });
  });

  it.each([
    ["a number", 5],
    ["a string", "24 chiếc"],
    ["an array", [["AV1F", 3]]],
    ["null", null],
  ])("a stock that is %s becomes an empty stock", (_label, stock) => {
    expect(normalizeDB({ programs: [], stock }).stock).toEqual({ bySku: {}, updatedAt: null });
  });

  it("drops values that are not finite numbers and a date it cannot read", () => {
    const db = normalizeDB({
      programs: [],
      stock: { updatedAt: "hôm qua", bySku: { A1: "12", A2: null, A3: Number.NaN, A4: Number.POSITIVE_INFINITY, A5: {}, A6: 7 } },
    });
    expect(db.stock).toEqual({ bySku: { A6: 7 }, updatedAt: null });
  });

  it("survives a save / reload unchanged", () => {
    const db = seedDB();
    db.stock = { bySku: { "P-AYPR285-3": 24, AV1F: 0, AVPTX: -2, AV80: 0.5 }, updatedAt: "2026-11-20T14:05:00.000Z" };
    expect(reload(db)).toEqual(db);
    expect(JSON.stringify(reload(db))).toBe(JSON.stringify(db));
  });
});

// ───────────────────────── Seed ─────────────────────────

describe("seedDB", () => {
  it("has the three programs, the demo orders and an empty default salesperson", () => {
    const db = seedDB();
    expect(db.version).toBe(1);
    expect(db.programs.map((p) => p.id)).toEqual(["seed-km-2026-11", "seed-bang-gia-sau-ck", "seed-km-2026-he"]);
    expect(db.orders).toHaveLength(17);
    expect(db.settings).toEqual({ role: "manager", salesperson: "", salespersonPhone: "", lowStockThreshold: 5 });
  });

  it("is exactly seed.json plus demo.json: normalisation loses nothing", () => {
    expect(seedDB()).toEqual({
      ...seed,
      orders: demo.orders,
      stock: demo.stock,
      settings: { role: "manager", salesperson: "", salespersonPhone: "", lowStockThreshold: 5 },
    });
  });

  it("demo orders: valid under their program, each with a dealer and a salesperson, unique codes", () => {
    const db = seedDB();
    const programs = new Map(db.programs.map((p) => [p.id, p]));
    for (const order of db.orders) {
      const calc = calculateOrder(programs.get(order.programId), order);
      expect(calc.hasError, order.code).toBe(false);
      expect(calc.totalAmount).toBeGreaterThan(0);
      expect(order.customerName && order.customerPhone && order.salesperson && order.salespersonPhone).toBeTruthy();
      expect(order.status === "draft" || order.frozenRules?.length).toBeTruthy();
    }
    expect(new Set(db.orders.map((o) => o.code)).size).toBe(db.orders.length);
    expect(new Set(db.orders.map((o) => o.salesperson)).size).toBe(4);
  });

  it("demo stock: every SKU of the programs has a number, some out and some low", () => {
    const db = seedDB();
    const skus = new Set(db.programs.flatMap((p) => p.groups.flatMap((g) => g.items.map((i) => i.sku.trim().toUpperCase()))));
    expect(Object.keys(db.stock.bySku).sort()).toEqual([...skus].sort());
    const values = Object.values(db.stock.bySku);
    expect(values.filter((v) => v === 0).length).toBeGreaterThan(0);
    expect(values.filter((v) => v > 0 && v <= 5).length).toBeGreaterThan(0);
  });

  it("returns a fresh copy every time", () => {
    const first = seedDB();
    first.programs[0].name = "đã sửa";
    first.programs[0].groups[0].items[0].wholesalePrice = 1;
    first.programs.pop();
    const second = seedDB();
    expect(second.programs).toHaveLength(3);
    expect(second.programs[0].name).toBe("KM tháng 11/2026 — Mua vợt tặng vợt theo doanh số");
    expect(second.programs[0].groups[0].items[0].wholesalePrice).toBe(1_415_782);
  });

  it("program basics: names, brands, valid dates", () => {
    const byId = Object.fromEntries(seedDB().programs.map((p) => [p.id, p])) as Record<string, Program>;
    expect(byId["seed-km-2026-11"]).toMatchObject({ brand: "Li-Ning", startDate: "2026-11-05", endDate: "2026-11-30" });
    expect(byId["seed-km-2026-he"]).toMatchObject({ brand: "Li-Ning", startDate: "2026-05-20", endDate: "2026-06-10" });
    expect(byId["seed-bang-gia-sau-ck"]).toMatchObject({ startDate: null, endDate: null });
    for (const program of Object.values(byId)) {
      expect(program.name.trim(), program.id).not.toBe("");
      expect(program.createdAt, program.id).toMatch(ISO);
      expect(program.updatedAt, program.id).toMatch(ISO);
      if (program.startDate && program.endDate) expect(program.startDate <= program.endDate, program.id).toBe(true);
    }
  });

  it("group sizes", () => {
    const sizes = seedDB().programs.map((p) => p.groups.map((g) => [g.id, g.items.length]));
    expect(sizes).toEqual([
      [
        ["g-km11-apply", 28],
        ["g-km11-gift", 10],
      ],
      [
        ["g-bg-thuong", 79],
        ["g-bg-kem", 20],
        ["g-bg-muc2", 39],
        ["g-bg-ashaway", 23],
      ],
      [
        ["g-he-dm01", 48],
        ["g-he-dm02", 83],
        ["g-he-dm03", 21],
      ],
    ]);
  });

  it("ids are unique: programs, groups within a program, rules and tiers within a program", () => {
    const db = seedDB();
    const unique = (ids: string[]) => new Set(ids).size === ids.length;
    expect(unique(db.programs.map((p) => p.id))).toBe(true);
    for (const program of db.programs) {
      expect(unique(program.groups.map((g) => g.id)), `${program.id} groups`).toBe(true);
      expect(unique(program.rules.map((r) => r.id)), `${program.id} rules`).toBe(true);
      const tierIds = program.rules.flatMap((r) => (r.type === "tier_gift" ? r.tiers.map((t) => t.id) : []));
      expect(unique(tierIds), `${program.id} tiers`).toBe(true);
    }
  });

  it("SKUs are unique within each group and already normalised", () => {
    for (const program of seedDB().programs) {
      for (const group of program.groups) {
        const skus = group.items.map((i) => i.sku);
        expect(new Set(skus).size, `${program.id}/${group.id}`).toBe(skus.length);
        for (const sku of skus) {
          expect(sku, `${program.id}/${group.id}`).not.toBe("");
          expect(normalizeSku(sku), `${program.id}/${group.id}/${sku}`).toBe(sku);
        }
      }
    }
  });

  it("every item has a name and whole, positive prices, with wholesale not above retail", () => {
    for (const program of seedDB().programs) {
      for (const group of program.groups) {
        for (const item of group.items) {
          const where = `${program.id}/${group.id}/${item.sku}`;
          expect(item.name.trim(), where).not.toBe("");
          expect(Number.isInteger(item.retailPrice) && item.retailPrice > 0, where).toBe(true);
          expect(Number.isInteger(item.wholesalePrice) && item.wholesalePrice > 0, where).toBe(true);
          expect(item.wholesalePrice, where).toBeLessThanOrEqual(item.retailPrice);
        }
      }
    }
  });

  it("every rule passes validateRule with no problems", () => {
    const db = seedDB();
    expect(db.programs.flatMap((p) => p.rules)).toHaveLength(5);
    for (const program of db.programs) {
      for (const rule of program.rules) {
        expect(validateRule(rule, program.groups), `${program.id}/${rule.id}`).toEqual([]);
      }
    }
  });

  it("every group a rule refers to exists in its program, and every allowed gift SKU exists in the gift group", () => {
    for (const program of seedDB().programs) {
      const groupIds = new Set(program.groups.map((g) => g.id));
      for (const rule of program.rules) {
        for (const id of ruleGroupIds(rule)) expect(groupIds.has(id), `${program.id}/${rule.id} → ${id}`).toBe(true);
        if (rule.type !== "tier_gift") continue;
        const giftSkus = new Set(program.groups.find((g) => g.id === rule.giftGroupId)!.items.map((i) => i.sku));
        for (const t of rule.tiers) {
          for (const sku of t.allowedSkus ?? []) expect(giftSkus.has(sku), `${rule.id}/${t.id} → ${sku}`).toBe(true);
        }
      }
    }
  });

  it("tiers are listed in ascending order with growing limits", () => {
    for (const program of seedDB().programs) {
      for (const rule of program.rules) {
        if (rule.type !== "tier_gift") continue;
        const mins = rule.tiers.map((t) => t.min);
        const limits = rule.tiers.map((t) => t.limitValue);
        expect([...mins].sort((a, b) => a - b), rule.id).toEqual(mins);
        expect([...limits].sort((a, b) => a - b), rule.id).toEqual(limits);
        expect(new Set(rule.tiers.map((t) => t.limitType)).size, rule.id).toBe(1);
      }
    }
  });

  it("an empty order raises no issue in any seed program", () => {
    for (const program of seedDB().programs) {
      const result = calculateOrder(program, { lines: [], gifts: [] });
      expect(result.issues, program.id).toEqual([]);
      expect(result.rules.map((r) => r.ruleId), program.id).toEqual(program.rules.map((r) => r.id));
    }
  });
});
