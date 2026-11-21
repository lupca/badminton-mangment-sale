// Tests for the product catalogue behind the «Sản phẩm» screen (one row per SKU) and for paging.
import { describe, expect, it } from "vitest";
import type { Program, Stock } from "../types";
import {
  NO_BRAND,
  NO_FILTER,
  OTHER_CATEGORY,
  brandOf,
  buildCatalog,
  catalogFacets,
  categoryOf,
  filterCatalog,
  hasStockAttention,
  sortCatalog,
  splitBrands,
  summarizeCatalog,
  type CatalogProduct,
} from "./catalog";
import { pageButtons, pageSizeOf, paginate } from "./paging";
import { seedDB } from "./store";

const TODAY = "2026-11-21";
const NO_STOCK: Stock = { bySku: {}, updatedAt: null };

type ItemSpec = [sku: string, name: string, retailPrice: number, extra?: { unit?: string; note?: string; wholesalePrice?: number }];

function program(
  id: string,
  groups: Array<[groupId: string, groupName: string, items: ItemSpec[]]>,
  options: { brand?: string; startDate?: string | null; endDate?: string | null; updatedAt?: string; name?: string } = {},
): Program {
  return {
    id,
    name: options.name ?? `Chương trình ${id}`,
    brand: options.brand ?? "Li-Ning",
    startDate: options.startDate ?? null,
    endDate: options.endDate ?? null,
    note: "",
    groups: groups.map(([groupId, groupName, items]) => ({
      id: groupId,
      name: groupName,
      items: items.map(([sku, name, retailPrice, extra]) => ({
        sku,
        name,
        retailPrice,
        wholesalePrice: extra?.wholesalePrice ?? Math.round(retailPrice * 0.7),
        ...(extra?.unit ? { unit: extra.unit } : {}),
        ...(extra?.note ? { note: extra.note } : {}),
      })),
    })),
    rules: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: options.updatedAt ?? "2026-11-20T00:00:00.000Z",
  };
}

const skus = (products: CatalogProduct[]) => products.map((product) => product.sku);
const bySku = (products: CatalogProduct[], sku: string) => {
  const found = products.find((product) => product.sku === sku);
  if (!found) throw new Error(`no product ${sku}`);
  return found;
};

describe("categoryOf", () => {
  it("reads the product type from the words the name starts with", () => {
    expect(categoryOf("Khung vợt cầu lông Aeronaut 6000 Speed")).toBe("Vợt cầu lông");
    expect(categoryOf("Vợt cầu lông Aeronaut 4000C")).toBe("Vợt cầu lông");
    expect(categoryOf("Vợt tennis Radical")).toBe("Vợt tennis");
    expect(categoryOf("Giày cầu lông Yonex 65Z3")).toBe("Giày");
    expect(categoryOf("Áo cầu lông nam AAYT013")).toBe("Quần áo");
    expect(categoryOf("Bộ quần áo thi đấu")).toBe("Quần áo");
    expect(categoryOf("Quả cầu lông Thành Công 77")).toBe("Quả cầu");
    expect(categoryOf("Ống cầu Hải Yến S70")).toBe("Quả cầu");
    expect(categoryOf("Cước N65")).toBe("Cước");
    expect(categoryOf("Quấn cán GP1000")).toBe("Quấn cán");
    expect(categoryOf("Băng chặn mồ hôi")).toBe("Phụ kiện");
  });

  it("the earliest keyword decides, so «túi vợt» is a bag and «cước vợt» is string", () => {
    expect(categoryOf("Túi vợt cầu lông 3 ngăn")).toBe("Túi, balo");
    expect(categoryOf("Bao vợt đơn")).toBe("Túi, balo");
    expect(categoryOf("Cước vợt cầu lông No.1")).toBe("Cước");
    expect(categoryOf("Quấn cán vợt")).toBe("Quấn cán");
    expect(categoryOf("Vợt cầu lông tặng kèm túi")).toBe("Vợt cầu lông");
  });

  it("knows racket series written without the word «vợt»", () => {
    expect(categoryOf("Bladex 800 power")).toBe("Vợt cầu lông");
    expect(categoryOf("Winstom 72 Black")).toBe("Vợt cầu lông");
    expect(categoryOf("Calibar 300B")).toBe("Vợt cầu lông");
    expect(categoryOf("Turbo Charging 75")).toBe("Vợt cầu lông");
  });

  it("accepts names typed without accents, except where dropping the accent makes two words the same", () => {
    expect(categoryOf("KHUNG VOT CAU LONG AXFORCE 80")).toBe("Vợt cầu lông");
    expect(categoryOf("Giay cau long")).toBe("Giày");
    expect(categoryOf("Tui vot")).toBe("Túi, balo");
    expect(categoryOf("Quan can vot")).toBe("Quấn cán");
    // «quan» alone could be «quần» or «quấn», «ao» could be a pond: not guessed.
    expect(categoryOf("Quan the thao")).toBe(OTHER_CATEGORY);
    expect(categoryOf("Ao the thao")).toBe(OTHER_CATEGORY);
    expect(categoryOf("Quần thể thao")).toBe("Quần áo");
  });

  it("matches whole words only, and gives «Khác» when nothing is recognised", () => {
    expect(categoryOf("Votex 100")).toBe(OTHER_CATEGORY);
    expect(categoryOf("Gripper X")).toBe(OTHER_CATEGORY);
    expect(categoryOf("")).toBe(OTHER_CATEGORY);
    expect(categoryOf("12345")).toBe(OTHER_CATEGORY);
  });

  it("also reads list names such as «Danh mục 01 (vợt trung cấp)»", () => {
    expect(categoryOf("Danh mục 01 (vợt trung cấp)")).toBe("Vợt cầu lông");
    expect(categoryOf("Danh mục hàng tặng")).toBe(OTHER_CATEGORY);
  });
});

describe("splitBrands / brandOf", () => {
  it("splits a program's brand text into names, dropping repeats", () => {
    expect(splitBrands("Li-Ning, Ashaway")).toEqual(["Li-Ning", "Ashaway"]);
    expect(splitBrands("Yonex / Victor và  Kawasaki")).toEqual(["Yonex", "Victor", "Kawasaki"]);
    expect(splitBrands("Li-Ning; LI-NING ,li ning")).toEqual(["Li-Ning"]);
    expect(splitBrands("  ")).toEqual([]);
  });

  it("one brand on the program: that brand", () => {
    expect(brandOf("Li-Ning", "Danh mục hàng tặng", "Khung vợt A")).toBe("Li-Ning");
    expect(brandOf("", "Ashaway", "Khung vợt A")).toBe("");
  });

  it("several brands: the one named by the list, else by the product name, else unknown", () => {
    expect(brandOf("Li-Ning, Ashaway", "Li-Ning — Hàng thường", "Khung vợt A880T")).toBe("Li-Ning");
    expect(brandOf("Li-Ning, Ashaway", "ASHAWAY", "Khung vợt Flexred")).toBe("Ashaway");
    expect(brandOf("Li-Ning, Ashaway", "Hàng tặng", "Cước Ashaway ZyMax 66")).toBe("Ashaway");
    expect(brandOf("Li-Ning, Ashaway", "Hàng tặng", "Cước ZyMax 66")).toBe("");
    // Tên danh mục nhắc cả hai hãng thì không đoán.
    expect(brandOf("Li-Ning, Ashaway", "Li-Ning và Ashaway", "Cước ZyMax 66")).toBe("");
  });
});

// p1 đang chạy, cập nhật gần nhất; p2 không thời hạn, cập nhật trước đó; p3 đã kết thúc nhưng vừa được sửa.
const P1 = program(
  "p1",
  [
    ["g1", "Danh mục áp dụng", [["A-1", "Khung vợt cầu lông Aeronaut 6000", 2_000_000], ["A-2", "Khung vợt cầu lông Axforce 90", 5_000_000, { unit: "cây" }]]],
    ["g2", "Danh mục hàng tặng", [["A-1", "Khung vợt cầu lông Aeronaut 6000", 2_000_000], ["Q-1", "Bladex 800 Power", 900_000]]],
  ],
  { startDate: "2026-11-05", endDate: "2026-11-30", updatedAt: "2026-11-20T10:00:00.000Z" },
);
const P2 = program(
  "p2",
  [
    ["g3", "Li-Ning — Hàng thường", [[" a-1 ", "Khung vợt Aeronaut 6000 (tên cũ)", 2_100_000, { note: "Kèm bao" }], ["G-1", "Giày cầu lông Saga", 1_000_000]]],
    ["g4", "Ashaway", [["AV1", "Khung vợt cầu lông Flexred", 1_150_000], ["S-1", "Cước ZyMax 66", 150_000]]],
  ],
  { brand: "Li-Ning, Ashaway", updatedAt: "2026-11-10T10:00:00.000Z" },
);
const P3 = program("p3", [["g5", "Danh mục 02 (vợt cao cấp)", [["A-1", "Vợt Aeronaut 6000 đời cũ", 1_800_000], ["OLD-1", "Halbertec 2000", 3_200_000], ["X-1", "Hàng không rõ", 0]]]], {
  startDate: "2026-05-20",
  endDate: "2026-06-10",
  updatedAt: "2026-11-21T08:00:00.000Z",
});
const PROGRAMS = [P3, P2, P1];
const STOCK: Stock = { bySku: { "A-1": 24, "A-2": 0, "Q-1": 3, "OLD-1": 0, "S-1": -2, "Z-9": 5 }, updatedAt: "2026-11-20T14:05:00.000Z" };
const catalog = (stock: Stock = STOCK, threshold = 5) => buildCatalog(PROGRAMS, stock, threshold, TODAY);

describe("buildCatalog", () => {
  it("lists each SKU once, however many lists it sits in", () => {
    const products = catalog();
    expect(skus(products).sort()).toEqual(["A-1", "A-2", "AV1", "G-1", "OLD-1", "Q-1", "S-1", "X-1"]);
    expect(bySku(products, "A-1").sources.map((source) => `${source.programId}/${source.groupId}`)).toEqual(["p1/g1", "p1/g2", "p2/g3", "p3/g5"]);
  });

  it("takes name and price from the most trustworthy place: a program that has not ended, updated last", () => {
    const a1 = bySku(catalog(), "A-1");
    expect(a1.name).toBe("Khung vợt cầu lông Aeronaut 6000");
    expect(a1.retailPrice).toBe(2_000_000);
    // p3 was edited last but has ended, so it comes after the others.
    expect([a1.retailMin, a1.retailMax]).toEqual([1_800_000, 2_100_000]);
    expect(a1.sources[2]).toMatchObject({ programName: "Chương trình p2", groupName: "Li-Ning — Hàng thường", note: "Kèm bao", retailPrice: 2_100_000, wholesalePrice: 1_470_000, programStatus: "open" });
    expect(a1.sources[3].programStatus).toBe("ended");
  });

  it("falls back to other places for a missing name or price", () => {
    const blank = program("b1", [["g", "Danh mục", [["A-1", "  ", 0]]]], { startDate: "2026-11-01", endDate: "2026-12-01", updatedAt: "2026-11-21T12:00:00.000Z" });
    const a1 = bySku(buildCatalog([blank, P1], NO_STOCK, 5, TODAY), "A-1");
    expect(a1.sources[0].programId).toBe("b1");
    expect([a1.name, a1.retailPrice, a1.retailMin, a1.retailMax]).toEqual(["Khung vợt cầu lông Aeronaut 6000", 2_000_000, 2_000_000, 2_000_000]);
    expect(bySku(catalog(), "X-1")).toMatchObject({ retailPrice: 0, retailMin: 0, retailMax: 0 });
  });

  it("works out the brand from the program, or from the list when the program names several", () => {
    const products = catalog();
    expect(bySku(products, "A-1").brand).toBe("Li-Ning");
    expect(bySku(products, "G-1").brand).toBe("Li-Ning");
    expect(bySku(products, "AV1").brand).toBe("Ashaway");
    expect(bySku(products, "S-1").brand).toBe("Ashaway");
  });

  it("spells one brand one way even when programs write it differently", () => {
    const shouting = program("s1", [["g", "Danh mục", [["N-1", "Khung vợt N1", 1]]]], { brand: "LI-NING", updatedAt: "2026-11-01T00:00:00.000Z" });
    const products = buildCatalog([shouting, P1], NO_STOCK, 5, TODAY);
    expect(new Set(products.map((product) => product.brand))).toEqual(new Set(["Li-Ning"]));
  });

  it("works out the product type from the name, then from the list name", () => {
    const products = catalog();
    expect(bySku(products, "A-1").category).toBe("Vợt cầu lông");
    expect(bySku(products, "Q-1").category).toBe("Vợt cầu lông");
    expect(bySku(products, "G-1").category).toBe("Giày");
    expect(bySku(products, "S-1").category).toBe("Cước");
    // «Hàng không rõ» says nothing, but it sits in «Danh mục 02 (vợt cao cấp)».
    expect(bySku(products, "X-1").category).toBe("Vợt cầu lông");
    const lone = program("l1", [["g", "Danh mục hàng tặng", [["M-1", "Món quà bí mật", 10]]]]);
    expect(bySku(buildCatalog([lone], NO_STOCK, 5, TODAY), "M-1").category).toBe(OTHER_CATEGORY);
  });

  it("attaches stock and its level; a SKU without data is unknown, not zero", () => {
    const products = catalog();
    expect(bySku(products, "A-1")).toMatchObject({ stock: 24, level: "in" });
    expect(bySku(products, "Q-1")).toMatchObject({ stock: 3, level: "low" });
    expect(bySku(products, "A-2")).toMatchObject({ stock: 0, level: "out" });
    expect(bySku(products, "S-1")).toMatchObject({ stock: -2, level: "out" });
    expect(bySku(products, "G-1")).toMatchObject({ stock: null, level: "unknown" });
    expect(bySku(catalog(STOCK, 0), "Q-1").level).toBe("in");
  });

  it("flags for attention only what is still being sold: out or low, in a program that has not ended", () => {
    const products = catalog();
    expect(bySku(products, "A-2")).toMatchObject({ selling: true, attention: true });
    expect(bySku(products, "Q-1")).toMatchObject({ selling: true, attention: true });
    expect(bySku(products, "A-1")).toMatchObject({ selling: true, attention: false });
    // OLD-1 is out of stock but only in the ended program.
    expect(bySku(products, "OLD-1")).toMatchObject({ selling: false, level: "out", attention: false });
  });

  it("keeps the unit, ignores blank SKUs and repeats inside one list, and does not change its input", () => {
    const messy = program("m1", [["g", "Danh mục", [["", "Không mã", 5], ["D-1", "Vợt D1", 100], ["d-1", "Vợt D1 lặp", 200]]]]);
    const before = JSON.stringify([messy, P1]);
    const products = buildCatalog([messy, P1], NO_STOCK, 5, TODAY);
    expect(bySku(products, "D-1")).toMatchObject({ name: "Vợt D1", retailPrice: 100, retailMax: 100 });
    expect(bySku(products, "D-1").sources).toHaveLength(1);
    expect(bySku(products, "A-2").unit).toBe("cây");
    expect(skus(products)).not.toContain("");
    expect(JSON.stringify([messy, P1])).toBe(before);
    expect(buildCatalog([], NO_STOCK, 5, TODAY)).toEqual([]);
  });
});

describe("filterCatalog", () => {
  const products = catalog();
  const filtered = (patch: Partial<typeof NO_FILTER>) => skus(filterCatalog(products, { ...NO_FILTER, ...patch })).sort();

  it("no filter keeps everything", () => {
    expect(filterCatalog(products, NO_FILTER)).toHaveLength(products.length);
  });

  it("searches SKU, name and brand; every word must match; accents and case do not matter", () => {
    expect(filtered({ search: "aeronaut" })).toEqual(["A-1"]);
    expect(filtered({ search: "VOT   axforce" })).toEqual(["A-2"]);
    expect(filtered({ search: "av1" })).toEqual(["AV1"]);
    expect(filtered({ search: "ashaway" })).toEqual(["AV1", "S-1"]);
    expect(filtered({ search: "giay saga" })).toEqual(["G-1"]);
    expect(filtered({ search: "không có" })).toEqual([]);
  });

  it("filters by brand (however it is spelt), unknown brand, and product type", () => {
    expect(filtered({ brand: "Ashaway" })).toEqual(["AV1", "S-1"]);
    expect(filtered({ brand: "li ning" })).toEqual(["A-1", "A-2", "G-1", "OLD-1", "Q-1", "X-1"]);
    expect(filtered({ brand: NO_BRAND })).toEqual([]);
    expect(filtered({ category: "Giày" })).toEqual(["G-1"]);
    expect(filtered({ category: "Cước", brand: "Li-Ning" })).toEqual([]);
    const unbranded = buildCatalog([program("u1", [["g", "Danh mục", [["U-1", "Vợt U1", 10]]]], { brand: "" }), P1], NO_STOCK, 5, TODAY);
    expect(skus(filterCatalog(unbranded, { ...NO_FILTER, brand: NO_BRAND }))).toEqual(["U-1"]);
  });

  it("filters by stock: in stock includes the low ones; attention is what the alert counts", () => {
    expect(filtered({ stock: "in" })).toEqual(["A-1", "Q-1"]);
    expect(filtered({ stock: "low" })).toEqual(["Q-1"]);
    expect(filtered({ stock: "out" })).toEqual(["A-2", "OLD-1", "S-1"]);
    expect(filtered({ stock: "unknown" })).toEqual(["AV1", "G-1", "X-1"]);
    expect(filtered({ stock: "attention" })).toEqual(["A-2", "Q-1", "S-1"]);
  });

  it("filters by retail price range: the lower bound counts, the upper does not, and a missing price is in no range", () => {
    expect(filtered({ price: "lt1" })).toEqual(["Q-1", "S-1"]);
    expect(filtered({ price: "1-2" })).toEqual(["AV1", "G-1"]);
    expect(filtered({ price: "2-3" })).toEqual(["A-1"]);
    expect(filtered({ price: "3-5" })).toEqual(["OLD-1"]);
    expect(filtered({ price: "gt5" })).toEqual(["A-2"]);
    expect(filtered({ price: "nonsense" })).toHaveLength(products.length);
  });

  it("combines the filters", () => {
    expect(filtered({ brand: "Li-Ning", category: "Vợt cầu lông", stock: "out", search: "axforce" })).toEqual(["A-2"]);
  });
});

describe("catalogFacets", () => {
  it("lists brands by name and product types in their fixed order, each with its count", () => {
    const facets = catalogFacets(catalog());
    expect(facets.brands).toEqual([
      { value: "Ashaway", label: "Ashaway", count: 2 },
      { value: "Li-Ning", label: "Li-Ning", count: 6 },
    ]);
    expect(facets.categories.map((option) => [option.value, option.count])).toEqual([
      ["Vợt cầu lông", 6],
      ["Giày", 1],
      ["Cước", 1],
    ]);
  });

  it("puts products without a brand last, under their own choice", () => {
    const unbranded = buildCatalog([program("u1", [["g", "Danh mục", [["U-1", "Thứ gì đó", 10]]]], { brand: "" }), P1], NO_STOCK, 5, TODAY);
    const facets = catalogFacets(unbranded);
    expect(facets.brands.at(-1)).toEqual({ value: NO_BRAND, label: "Chưa rõ hãng", count: 1 });
    expect(facets.categories.at(-1)).toEqual({ value: OTHER_CATEGORY, label: OTHER_CATEGORY, count: 1 });
  });
});

describe("sortCatalog", () => {
  const products = catalog();

  it("sorts by name and by SKU the way people read them (numbers by value)", () => {
    const numbered = buildCatalog([program("n1", [["g", "Danh mục", [["V-10", "Vợt 10", 1], ["V-9", "Vợt 9", 1], ["V-80", "Vợt 80", 1]]]])], NO_STOCK, 5, TODAY);
    expect(skus(sortCatalog(numbered, "name"))).toEqual(["V-9", "V-10", "V-80"]);
    expect(skus(sortCatalog(numbered, "sku", "desc"))).toEqual(["V-80", "V-10", "V-9"]);
  });

  it("sorts by price both ways, with products that have no price always last", () => {
    expect(skus(sortCatalog(products, "price"))).toEqual(["S-1", "Q-1", "G-1", "AV1", "A-1", "OLD-1", "A-2", "X-1"]);
    expect(skus(sortCatalog(products, "price", "desc"))).toEqual(["A-2", "OLD-1", "A-1", "AV1", "G-1", "Q-1", "S-1", "X-1"]);
  });

  it("sorts by stock both ways, with SKUs that have no stock data always last", () => {
    // A-2 and OLD-1 both have 0: equal values keep the order by name («Halbertec…» before «Khung vợt…») either way.
    expect(skus(sortCatalog(products, "stock")).slice(0, 5)).toEqual(["S-1", "OLD-1", "A-2", "Q-1", "A-1"]);
    expect(skus(sortCatalog(products, "stock", "desc")).slice(0, 5)).toEqual(["A-1", "Q-1", "OLD-1", "A-2", "S-1"]);
    expect(skus(sortCatalog(products, "stock")).slice(5).sort()).toEqual(["AV1", "G-1", "X-1"]);
    expect(skus(sortCatalog(products, "stock", "desc")).slice(5).sort()).toEqual(["AV1", "G-1", "X-1"]);
  });

  it("sorts by brand and by type, and leaves its input alone", () => {
    const before = skus(products);
    expect(sortCatalog(products, "brand").map((product) => product.brand).slice(0, 3)).toEqual(["Ashaway", "Ashaway", "Li-Ning"]);
    expect(sortCatalog(products, "category", "desc")[0].category).toBe("Vợt cầu lông");
    expect(skus(products)).toEqual(before);
  });
});

describe("summarizeCatalog / hasStockAttention", () => {
  it("counts the levels; low SKUs are also in stock; attention is split in out and low", () => {
    expect(summarizeCatalog(catalog())).toEqual({ total: 8, inStock: 2, low: 1, out: 3, unknown: 3, attentionOut: 2, attentionLow: 1 });
    expect(summarizeCatalog(catalog(NO_STOCK))).toEqual({ total: 8, inStock: 0, low: 0, out: 0, unknown: 8, attentionOut: 0, attentionLow: 0 });
    expect(summarizeCatalog([])).toMatchObject({ total: 0, inStock: 0 });
  });

  it("the nav dot agrees with the list: on exactly when some product needs attention", () => {
    const check = (programs: Program[], stock: Stock, threshold: number) => {
      const expected = buildCatalog(programs, stock, threshold, TODAY).some((product) => product.attention);
      expect(hasStockAttention(programs, stock, threshold, TODAY)).toBe(expected);
      return expected;
    };
    expect(check(PROGRAMS, STOCK, 5)).toBe(true);
    expect(check(PROGRAMS, NO_STOCK, 5)).toBe(false);
    expect(check(PROGRAMS, { bySku: { "A-1": 24, "Q-1": 3 }, updatedAt: null }, 5)).toBe(true);
    expect(check(PROGRAMS, { bySku: { "A-1": 24, "Q-1": 3 }, updatedAt: null }, 0)).toBe(false);
    // Out of stock, but only in the program that has ended.
    expect(check(PROGRAMS, { bySku: { "OLD-1": 0 }, updatedAt: null }, 5)).toBe(false);
    expect(check([], STOCK, 5)).toBe(false);
  });
});

describe("the seed data", () => {
  it("is 166 products, all rackets, of two brands", () => {
    const seed = seedDB();
    const products = buildCatalog(seed.programs, seed.stock, seed.settings.lowStockThreshold, TODAY);
    expect(products).toHaveLength(166);
    const facets = catalogFacets(products);
    expect(facets.brands.map((option) => [option.value, option.count])).toEqual([
      ["Ashaway", 23],
      ["Li-Ning", 143],
    ]);
    expect(facets.categories.map((option) => [option.value, option.count])).toEqual([
      ["Vợt cầu lông", 165],
      ["Vợt tennis", 1],
    ]);
    expect(products.every((product) => product.name && product.retailPrice > 0 && product.level !== "unknown")).toBe(true);
    expect(products.filter((product) => product.retailMin !== product.retailMax)).toHaveLength(10);
  });
});

describe("paginate", () => {
  const list = Array.from({ length: 53 }, (_, i) => i + 1);

  it("cuts the page out and says which rows it shows", () => {
    expect(paginate(list, 1, 25)).toMatchObject({ page: 1, pages: 3, total: 53, from: 1, to: 25, size: 25 });
    expect(paginate(list, 1, 25).items).toEqual(list.slice(0, 25));
    expect(paginate(list, 3, 25)).toMatchObject({ page: 3, from: 51, to: 53 });
    expect(paginate(list, 3, 25).items).toEqual([51, 52, 53]);
    expect(paginate(list, 1, 100)).toMatchObject({ pages: 1, from: 1, to: 53 });
  });

  it("clamps a page that is out of range (after a filter shortened the list)", () => {
    expect(paginate(list, 9, 25)).toMatchObject({ page: 3, from: 51, to: 53 });
    expect(paginate(list, 0, 25).page).toBe(1);
    expect(paginate(list, -4, 25).page).toBe(1);
    expect(paginate(list, Number.NaN, 25).page).toBe(1);
    expect(paginate(list, 2.9, 25).page).toBe(2);
  });

  it("an empty list is one empty page", () => {
    expect(paginate([], 1, 25)).toEqual({ items: [], page: 1, pages: 1, size: 25, total: 0, from: 0, to: 0 });
  });

  it("falls back to the default size when the size makes no sense", () => {
    expect(paginate(list, 1, 0).size).toBe(25);
    expect(paginate(list, 1, Number.NaN).size).toBe(25);
    expect(pageSizeOf("50")).toBe(50);
    expect(pageSizeOf("7")).toBe(25);
    expect(pageSizeOf(null)).toBe(25);
    expect(pageSizeOf("abc", 100)).toBe(100);
  });
});

describe("pageButtons", () => {
  it("shows every page when there are few", () => {
    expect(pageButtons(1, 1)).toEqual([1]);
    expect(pageButtons(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageButtons(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageButtons(1, 5)).toEqual([1, 2, "gap", 5]);
  });

  it("keeps the first, the last and the neighbours of the current page, with gaps between", () => {
    expect(pageButtons(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(pageButtons(6, 20)).toEqual([1, "gap", 5, 6, 7, "gap", 20]);
    expect(pageButtons(20, 20)).toEqual([1, "gap", 19, 20]);
  });

  it("never hides a single page behind a gap", () => {
    expect(pageButtons(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageButtons(17, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
    expect(pageButtons(3, 7)).toEqual([1, 2, 3, 4, "gap", 7]);
  });
});
