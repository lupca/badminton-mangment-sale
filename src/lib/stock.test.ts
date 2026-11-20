// Tests for the stock helpers and the product list behind the «Sản phẩm» screen.
import { describe, expect, it } from "vitest";
import type { CalcGift, CalcLine, Program, Stock } from "../types";
import {
  applyStock,
  listProducts,
  newerStock,
  orderStockIssues,
  productNames,
  stockAlerts,
  stockLevel,
  stockOf,
  stockQty,
  summarizeProducts,
  unlistedStockCount,
  type ProductFilter,
} from "./stock";
import { seedDB } from "./store";

const NO_STOCK: Stock = { bySku: {}, updatedAt: null };
const ALL: ProductFilter = { programId: "", search: "", stock: "all", lowThreshold: 5 };

function program(
  id: string,
  groups: Array<[string, Array<[string, string, number]>]>,
  dates: { startDate?: string | null; endDate?: string | null } = {},
): Program {
  return {
    id,
    name: `Chương trình ${id}`,
    brand: "Li-Ning",
    startDate: dates.startDate ?? null,
    endDate: dates.endDate ?? null,
    note: "",
    groups: groups.map(([groupId, items]) => ({
      id: groupId,
      name: `Danh mục ${groupId}`,
      items: items.map(([sku, name, retailPrice]) => ({ sku, name, retailPrice, wholesalePrice: Math.round(retailPrice * 0.7) })),
    })),
    rules: [],
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
  };
}

const P1 = program("p1", [
  ["g1", [["A-1", "Khung vợt Aeronaut 6000", 2_000_000], ["A-2", "Khung vợt Axforce 90", 5_000_000], ["A-3", "Khung vợt Tubo 50D", 1_500_000]]],
  ["g2", [["Q-1", "Vợt quà tặng Lightning 2000", 1_200_000]]],
]);
const P2 = program("p2", [["g3", [["A-1", "Khung vợt Aeronaut 6000", 2_100_000], ["B-1", "Cước cầu lông N65", 150_000]]]]);
const STOCK: Stock = { bySku: { "A-1": 24, "A-2": 0, "Q-1": -1, "Z-9": 5 }, updatedAt: "2026-11-20T14:05:00.000Z" };

const skusOf = (list: ReturnType<typeof listProducts>) =>
  list.map(({ program: p, groups }) => [p.id, groups.map(({ group, rows }) => [group.id, rows.map((row) => row.item.sku)])]);

describe("stockQty", () => {
  it("keeps finite numbers including zero and negatives, rounded to 3 decimals", () => {
    expect(stockQty(24)).toBe(24);
    expect(stockQty(0)).toBe(0);
    expect(stockQty(-2)).toBe(-2);
    expect(stockQty(0.1 + 0.2)).toBe(0.3);
    expect(stockQty(2.50049)).toBe(2.5);
    expect(Object.is(stockQty(-0.0001), 0)).toBe(true);
  });

  it("rejects everything that is not a finite number", () => {
    for (const value of ["12", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, [], true]) {
      expect(stockQty(value)).toBeNull();
    }
  });
});

describe("stockOf", () => {
  it("looks the SKU up after normalising it; a SKU without data gives null, not 0", () => {
    expect(stockOf(STOCK, "A-1")).toBe(24);
    expect(stockOf(STOCK, " a-1 ")).toBe(24);
    expect(stockOf(STOCK, "A-2")).toBe(0);
    expect(stockOf(STOCK, "A-3")).toBeNull();
    expect(stockOf(NO_STOCK, "A-1")).toBeNull();
  });

  it("is not fooled by names that exist on every object", () => {
    for (const sku of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(stockOf(STOCK, sku)).toBeNull();
    }
  });
});

describe("applyStock", () => {
  const at = "2026-11-21T08:00:00.000Z";

  it("merge: updates the SKUs in the file, keeps the others, stamps the time", () => {
    expect(applyStock(STOCK, { "a-1": 30, "A-3": 7 }, at)).toEqual({
      bySku: { "A-1": 30, "A-2": 0, "Q-1": -1, "Z-9": 5, "A-3": 7 },
      updatedAt: at,
    });
  });

  it("replace (no base): only the SKUs in the file remain", () => {
    expect(applyStock(null, { "A-1": 30 }, at)).toEqual({ bySku: { "A-1": 30 }, updatedAt: at });
  });

  it("ignores blank SKUs and values that are not numbers; does not change its input", () => {
    const before = JSON.stringify(STOCK);
    const entries = { "": 5, "A-1": Number.NaN, "A-2": 3 } as Record<string, number>;
    expect(applyStock(STOCK, entries, at).bySku).toEqual({ "A-1": 24, "A-2": 3, "Q-1": -1, "Z-9": 5 });
    expect(JSON.stringify(STOCK)).toBe(before);
  });
});

describe("newerStock", () => {
  const older: Stock = { bySku: { "A-1": 1 }, updatedAt: "2026-11-19T10:00:00.000Z" };
  const newer: Stock = { bySku: { "A-1": 9 }, updatedAt: "2026-11-20T10:00:00.000Z" };

  it("takes the whole snapshot that was updated last, whichever side it is on", () => {
    expect(newerStock(older, newer)).toBe(newer);
    expect(newerStock(newer, older)).toBe(newer);
  });

  it("an empty side never wins", () => {
    expect(newerStock(older, NO_STOCK)).toBe(older);
    expect(newerStock(NO_STOCK, older)).toBe(older);
    expect(newerStock(older, { bySku: {}, updatedAt: "2027-01-01T00:00:00.000Z" })).toBe(older);
  });

  it("keeps the current data when the times are equal or the incoming one has no time", () => {
    expect(newerStock(older, { ...older, bySku: { "A-1": 2 } })).toBe(older);
    expect(newerStock(older, { bySku: { "A-1": 2 }, updatedAt: null })).toBe(older);
  });
});

describe("listProducts", () => {
  it("lists every product by program and category, in the order they were entered, with its stock", () => {
    const list = listProducts([P1, P2], STOCK, ALL);
    expect(skusOf(list)).toEqual([
      ["p1", [["g1", ["A-1", "A-2", "A-3"]], ["g2", ["Q-1"]]]],
      ["p2", [["g3", ["A-1", "B-1"]]]],
    ]);
    expect(list[0].groups[0].rows.map((row) => row.stock)).toEqual([24, 0, null]);
    expect(list[0].groups[1].rows[0].stock).toBe(-1);
    // The same SKU has one stock figure, whichever program it is listed under; the price is the category's own.
    expect(list[1].groups[0].rows[0]).toMatchObject({ stock: 24, item: { retailPrice: 2_100_000 } });
  });

  it("filters by program", () => {
    expect(skusOf(listProducts([P1, P2], STOCK, { ...ALL, programId: "p2" }))).toEqual([["p2", [["g3", ["A-1", "B-1"]]]]]);
    expect(listProducts([P1, P2], STOCK, { ...ALL, programId: "missing" })).toEqual([]);
  });

  it("searches SKU and name without accents or case, and drops categories and programs left empty", () => {
    expect(skusOf(listProducts([P1, P2], STOCK, { ...ALL, search: "aeronaut" }))).toEqual([
      ["p1", [["g1", ["A-1"]]]],
      ["p2", [["g3", ["A-1"]]]],
    ]);
    expect(skusOf(listProducts([P1, P2], STOCK, { ...ALL, search: "cuoc n65" }))).toEqual([["p2", [["g3", ["B-1"]]]]]);
    expect(skusOf(listProducts([P1, P2], STOCK, { ...ALL, search: "q-1" }))).toEqual([["p1", [["g2", ["Q-1"]]]]]);
    expect(listProducts([P1, P2], STOCK, { ...ALL, search: "không có mã này" })).toEqual([]);
  });

  it("filters by stock: in stock (> 0), out of stock (0 or negative), no data", () => {
    const only = (stock: ProductFilter["stock"]) =>
      listProducts([P1, P2], STOCK, { ...ALL, stock }).flatMap(({ groups }) => groups.flatMap(({ rows }) => rows.map((row) => row.item.sku)));
    expect(only("in")).toEqual(["A-1", "A-1"]);
    expect(only("out")).toEqual(["A-2", "Q-1"]);
    expect(only("unknown")).toEqual(["A-3", "B-1"]);
  });

  it("with no stock data every product is listed as unknown", () => {
    const list = listProducts([P1], NO_STOCK, ALL);
    expect(list[0].groups.flatMap(({ rows }) => rows.map((row) => row.stock))).toEqual([null, null, null, null]);
    expect(listProducts([P1], NO_STOCK, { ...ALL, stock: "in" })).toEqual([]);
  });

  it("handles no programs and programs without products", () => {
    expect(listProducts([], STOCK, ALL)).toEqual([]);
    expect(listProducts([program("empty", [["g", []]])], STOCK, ALL)).toEqual([]);
  });
});

describe("summarizeProducts", () => {
  it("counts each SKU once even when it sits in several categories", () => {
    const list = listProducts([P1, P2], STOCK, ALL);
    // 6 rows, 5 different SKUs: A-1 (in), A-2 and Q-1 (out), A-3 and B-1 (no data).
    expect(summarizeProducts(list)).toEqual({ skus: 5, inStock: 1, low: 0, outOfStock: 2, unknown: 2 });
  });

  it("follows the filter", () => {
    expect(summarizeProducts(listProducts([P1, P2], STOCK, { ...ALL, programId: "p2" }))).toEqual({
      skus: 2,
      inStock: 1,
      low: 0,
      outOfStock: 0,
      unknown: 1,
    });
    expect(summarizeProducts([])).toEqual({ skus: 0, inStock: 0, low: 0, outOfStock: 0, unknown: 0 });
  });
});

describe("stockLevel", () => {
  it("unknown without data, out at zero or below, low from 1 up to the threshold, in above it", () => {
    expect(stockLevel(null, 5)).toBe("unknown");
    expect(stockLevel(0, 5)).toBe("out");
    expect(stockLevel(-2, 5)).toBe("out");
    expect(stockLevel(1, 5)).toBe("low");
    expect(stockLevel(5, 5)).toBe("low");
    expect(stockLevel(0.5, 5)).toBe("low");
    expect(stockLevel(6, 5)).toBe("in");
  });

  it("a threshold of 0 turns the low-stock warning off", () => {
    expect(stockLevel(1, 0)).toBe("in");
    expect(stockLevel(0, 0)).toBe("out");
  });
});

describe("low stock in the product list", () => {
  // A-1 plenty, A-2 out, A-3 low (3), Q-1 low (exactly at the threshold), B-1 no data.
  const LOW: Stock = { bySku: { "A-1": 24, "A-2": 0, "A-3": 3, "Q-1": 5 }, updatedAt: "2026-11-20T14:05:00.000Z" };
  const only = (stock: ProductFilter["stock"], lowThreshold = 5) =>
    listProducts([P1, P2], LOW, { ...ALL, stock, lowThreshold }).flatMap(({ groups }) =>
      groups.flatMap(({ rows }) => rows.map((row) => row.item.sku)),
    );

  it("each row carries its level", () => {
    const rows = listProducts([P1], LOW, ALL).flatMap(({ groups }) => groups.flatMap(({ rows: r }) => r));
    expect(rows.map((row) => [row.item.sku, row.level])).toEqual([
      ["A-1", "in"],
      ["A-2", "out"],
      ["A-3", "low"],
      ["Q-1", "low"],
    ]);
  });

  it("filters: low, attention (low + out), and in stock still includes the low ones", () => {
    expect(only("low")).toEqual(["A-3", "Q-1"]);
    expect(only("attention")).toEqual(["A-2", "A-3", "Q-1"]);
    expect(only("in")).toEqual(["A-1", "A-3", "Q-1", "A-1"]);
    expect(only("out")).toEqual(["A-2"]);
  });

  it("follows the threshold", () => {
    expect(only("low", 3)).toEqual(["A-3"]);
    expect(only("low", 0)).toEqual([]);
    expect(only("low", 100)).toEqual(["A-1", "A-3", "Q-1", "A-1"]);
  });

  it("the summary counts the low SKUs inside the in-stock ones", () => {
    expect(summarizeProducts(listProducts([P1, P2], LOW, ALL))).toEqual({ skus: 5, inStock: 3, low: 2, outOfStock: 1, unknown: 1 });
  });
});

describe("stockAlerts", () => {
  const TODAY = "2026-11-20";
  const LOW: Stock = { bySku: { "A-1": 2, "A-2": 0, "A-3": 30, "Q-1": -1, "B-1": 5, "Z-9": 1 }, updatedAt: null };

  it("lists each low or out-of-stock SKU once, emptiest first, with where it is first listed", () => {
    expect(stockAlerts([P1, P2], LOW, 5, TODAY)).toEqual([
      { sku: "Q-1", name: "Vợt quà tặng Lightning 2000", stock: -1, level: "out", programId: "p1", programName: "Chương trình p1", groupName: "Danh mục g2" },
      { sku: "A-2", name: "Khung vợt Axforce 90", stock: 0, level: "out", programId: "p1", programName: "Chương trình p1", groupName: "Danh mục g1" },
      { sku: "A-1", name: "Khung vợt Aeronaut 6000", stock: 2, level: "low", programId: "p1", programName: "Chương trình p1", groupName: "Danh mục g1" },
      { sku: "B-1", name: "Cước cầu lông N65", stock: 5, level: "low", programId: "p2", programName: "Chương trình p2", groupName: "Danh mục g3" },
    ]);
  });

  it("leaves out products of programs that have ended, SKUs without data and SKUs in no category", () => {
    const ended = program("old", [["g9", [["A-2", "Khung vợt Axforce 90", 1], ["E-1", "Chỉ có ở chương trình cũ", 1]]]], { endDate: "2026-11-19" });
    const upcoming = program("next", [["g8", [["U-1", "Hàng sắp bán", 1]]]], { startDate: "2026-12-01" });
    const stock: Stock = { bySku: { "A-2": 0, "E-1": 0, "U-1": 1, "Z-9": 0 }, updatedAt: null };
    expect(stockAlerts([ended, upcoming], stock, 5, TODAY).map((a) => a.sku)).toEqual(["U-1"]);
    // The same SKU is still reported when a program that is not over lists it too.
    expect(stockAlerts([ended, P1], stock, 5, TODAY).map((a) => [a.sku, a.programId])).toEqual([["A-2", "p1"]]);
  });

  it("with the threshold at 0 only out-of-stock SKUs are reported; with no stock data nothing is", () => {
    expect(stockAlerts([P1, P2], LOW, 0, TODAY).map((a) => a.sku)).toEqual(["Q-1", "A-2"]);
    expect(stockAlerts([P1, P2], NO_STOCK, 5, TODAY)).toEqual([]);
  });
});

describe("orderStockIssues", () => {
  const stock: Stock = { bySku: { "A-1": 10, "A-2": 0, "A-3": 3, "Q-1": 2 }, updatedAt: null };
  const line = (sku: string, qty: number): CalcLine => ({
    index: 0, groupId: "g1", sku, name: `Tên ${sku}`, qty, retailPrice: 1, wholesalePrice: 1, unitPrice: 1, amount: qty, discountRuleId: null, discountPercent: null,
  });
  const gift = (sku: string, qty: number): CalcGift => ({ ruleId: "r", sku, name: `Tên ${sku}`, qty, unitValue: 1, value: qty, auto: false });

  it("reports SKUs ordered beyond the stock and SKUs that are out of stock", () => {
    const issues = orderStockIssues({ lines: [line("A-1", 12), line("A-2", 1), line("A-3", 3)], gifts: [] }, stock);
    expect(issues).toEqual([
      { sku: "A-1", name: "Tên A-1", ordered: 12, stock: 10, level: "over" },
      { sku: "A-2", name: "Tên A-2", ordered: 1, stock: 0, level: "out" },
    ]);
  });

  it("adds purchases and gifts of the same SKU together", () => {
    // 2 bought + 1 as a gift = 3 needed, only 2 in stock.
    expect(orderStockIssues({ lines: [line("Q-1", 2)], gifts: [gift("Q-1", 1)] }, stock)).toEqual([
      { sku: "Q-1", name: "Tên Q-1", ordered: 3, stock: 2, level: "over" },
    ]);
    expect(orderStockIssues({ lines: [line("A-1", 5)], gifts: [gift("A-1", 5)] }, stock)).toEqual([]);
  });

  it("ignores SKUs without stock data, gifts described in words and rows with no quantity", () => {
    const calc = { lines: [line("NO-DATA", 99), line("A-2", 0)], gifts: [gift("", 5)] };
    expect(orderStockIssues(calc, stock)).toEqual([]);
    expect(orderStockIssues(calc, NO_STOCK)).toEqual([]);
  });
});

describe("productNames / unlistedStockCount", () => {
  it("maps each listed SKU to the name where it first appears", () => {
    const renamed = program("p3", [["g4", [["A-1", "Tên khác", 1]]]]);
    const names = productNames([P1, P2, renamed]);
    expect([...names.keys()]).toEqual(["A-1", "A-2", "A-3", "Q-1", "B-1"]);
    expect(names.get("A-1")).toBe("Khung vợt Aeronaut 6000");
  });

  it("counts the SKUs that have stock data but sit in no category", () => {
    expect(unlistedStockCount([P1, P2], STOCK)).toBe(1); // Z-9
    expect(unlistedStockCount([], STOCK)).toBe(4);
    expect(unlistedStockCount([P1, P2], NO_STOCK)).toBe(0);
  });
});

describe("the seed data", () => {
  it("lists 351 rows for 166 different SKUs, none with stock data yet", () => {
    const db = seedDB();
    const list = listProducts(db.programs, db.stock, ALL);
    expect(list.map(({ program: p }) => p.id)).toEqual(["seed-km-2026-11", "seed-bang-gia-sau-ck", "seed-km-2026-he"]);
    expect(list.reduce((sum, { groups }) => sum + groups.reduce((n, { rows }) => n + rows.length, 0), 0)).toBe(351);
    expect(summarizeProducts(list)).toEqual({ skus: 166, inStock: 0, low: 0, outOfStock: 0, unknown: 166 });
  });
});
