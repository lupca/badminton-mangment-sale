// Tests for the stock helpers and the product list behind the «Sản phẩm» screen.
import { describe, expect, it } from "vitest";
import type { Program, Stock } from "../types";
import {
  applyStock,
  listProducts,
  newerStock,
  productNames,
  stockOf,
  stockQty,
  summarizeProducts,
  unlistedStockCount,
  type ProductFilter,
} from "./stock";
import { seedDB } from "./store";

const NO_STOCK: Stock = { bySku: {}, updatedAt: null };
const ALL: ProductFilter = { programId: "", search: "", stock: "all" };

function program(id: string, groups: Array<[string, Array<[string, string, number]>]>): Program {
  return {
    id,
    name: `Chương trình ${id}`,
    brand: "Li-Ning",
    startDate: null,
    endDate: null,
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
    expect(summarizeProducts(list)).toEqual({ skus: 5, inStock: 1, outOfStock: 2, unknown: 2 });
  });

  it("follows the filter", () => {
    expect(summarizeProducts(listProducts([P1, P2], STOCK, { ...ALL, programId: "p2" }))).toEqual({
      skus: 2,
      inStock: 1,
      outOfStock: 0,
      unknown: 1,
    });
    expect(summarizeProducts([])).toEqual({ skus: 0, inStock: 0, outOfStock: 0, unknown: 0 });
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
    expect(summarizeProducts(list)).toEqual({ skus: 166, inStock: 0, outOfStock: 0, unknown: 166 });
  });
});
