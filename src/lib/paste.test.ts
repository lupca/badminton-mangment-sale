// Tests for reading text pasted from Excel / Zalo / plain text.
import { describe, expect, it } from "vitest";
import seed from "../seed/seed.json";
import type { DB } from "../types";
import { parseQty, parseSkuQty, parseTable } from "./paste";

const db = seed as unknown as DB;
const NBSP = " ";

// ───────────────────────── parseTable ─────────────────────────

describe("parseTable", () => {
  it("reads rows pasted from Excel: tab-separated cells, Windows line endings", () => {
    const text = "Mã hàng\tTên hàng\tGiá lẻ\tGiá sỉ\r\nP-AYPR285-3\tKhung vợt cầu lông Aeronaut 6000 Speed\t2.022.545\t1.415.782\r\n";
    expect(parseTable(text)).toEqual([
      ["Mã hàng", "Tên hàng", "Giá lẻ", "Giá sỉ"],
      ["P-AYPR285-3", "Khung vợt cầu lông Aeronaut 6000 Speed", "2.022.545", "1.415.782"],
    ]);
  });

  it("keeps empty cells so the columns stay aligned", () => {
    expect(parseTable("A\t\tC\n\tB\t\nX\tY\tZ")).toEqual([
      ["A", "", "C"],
      ["", "B", ""],
      ["X", "Y", "Z"],
    ]);
  });

  it("trims cells and turns non-breaking spaces into ordinary ones", () => {
    expect(parseTable(`  P-AYPR285-3 \t ${NBSP}Khung${NBSP}vợt${NBSP} \t 15 `)).toEqual([["P-AYPR285-3", "Khung vợt", "15"]]);
  });

  it("drops blank lines, including lines made only of spaces or tabs", () => {
    expect(parseTable("\n\nA\tB\n   \n\t\t\n\r\nC\tD\n\n")).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("accepts \\r\\n, \\n and lone \\r line endings", () => {
    expect(parseTable("A\t1\r\nB\t2\nC\t3\rD\t4")).toEqual([
      ["A", "1"],
      ["B", "2"],
      ["C", "3"],
      ["D", "4"],
    ]);
  });

  it("without tabs, cells are separated by “;” or by two or more spaces; single spaces stay inside a cell", () => {
    expect(parseTable("P-AYPR285-3;Khung vợt Aeronaut 6000;2022545;1415782")).toEqual([
      ["P-AYPR285-3", "Khung vợt Aeronaut 6000", "2022545", "1415782"],
    ]);
    expect(parseTable("P-AYPR285-3   Khung vợt Aeronaut 6000    2022545")).toEqual([["P-AYPR285-3", "Khung vợt Aeronaut 6000", "2022545"]]);
    expect(parseTable("một ô duy nhất")).toEqual([["một ô duy nhất"]]);
  });

  it("a tab-separated row is not split any further on “;” or double spaces", () => {
    expect(parseTable("A-1\tVợt; loại  tốt\t15")).toEqual([["A-1", "Vợt; loại  tốt", "15"]]);
  });

  it("each line decides on its own whether it is tab-separated", () => {
    expect(parseTable("A-1\t15\nB-2;20")).toEqual([
      ["A-1", "15"],
      ["B-2", "20"],
    ]);
  });

  it("empty text gives no rows", () => {
    expect(parseTable("")).toEqual([]);
    expect(parseTable("  \n \t ")).toEqual([]);
  });
});

// ───────────────────────── parseQty ─────────────────────────

describe("parseQty", () => {
  it.each([
    ["15", 15],
    [" 15 ", 15],
    ["007", 7],
    ["0", 0],
    ["15.0", 15],
    ["15,00", 15],
    ["1.000", 1000],
    ["1,000", 1000],
    ["10.000", 10_000],
    ["12.345.678", 12_345_678],
    ["12,345,678", 12_345_678],
  ])("%j → %d", (text, expected) => {
    expect(parseQty(text)).toBe(expected);
  });

  it.each(["", " ", "abc", "1.5", "2,50", "-3", "+3", "1e3", "15 cái", "x15", "1.00.000", "1 000", "15.", ".5", "１５"])(
    "%j is not a quantity",
    (text) => {
      expect(parseQty(text)).toBeNaN();
    },
  );
});

// ───────────────────────── parseSkuQty ─────────────────────────

describe("parseSkuQty", () => {
  it("reads two Excel columns: SKU and quantity", () => {
    const text = "P-AYPR285-3\t15\r\nP-AYPT307-4\t2\r\nAV1F\t3\r\n";
    expect(parseSkuQty(text)).toEqual({
      rows: [
        { sku: "P-AYPR285-3", qty: 15 },
        { sku: "P-AYPT307-4", qty: 2 },
        { sku: "AV1F", qty: 3 },
      ],
      skipped: [],
    });
  });

  it.each([
    "P-AYPR285-3 15",
    "P-AYPR285-3    15",
    "  P-AYPR285-3 15  ",
    "P-AYPR285-3;15",
    "P-AYPR285-3; 15",
    "P-AYPR285-3,15",
    "P-AYPR285-3, 15",
    "p-aypr285-3 15",
    `P-AYPR285-3${NBSP}15`,
    "P-AYPR285-3\t15",
    `${NBSP}P-AYPR285-3${NBSP}\t${NBSP}15${NBSP}`,
    "P-AYPR285-3\t\t15",
    "P-AYPR285-3 x 15",
    "P-AYPR285-3 15 cây",
  ])("typed line %j → P-AYPR285-3 × 15", (text) => {
    expect(parseSkuQty(text)).toEqual({ rows: [{ sku: "P-AYPR285-3", qty: 15 }], skipped: [] });
  });

  it("a line with only a SKU counts as quantity 1", () => {
    expect(parseSkuQty("P-AYPR285-3\nAV1F\n  p-aypt307-4  ")).toEqual({
      rows: [
        { sku: "P-AYPR285-3", qty: 1 },
        { sku: "AV1F", qty: 1 },
        { sku: "P-AYPT307-4", qty: 1 },
      ],
      skipped: [],
    });
  });

  it("skips header lines and reports them as they were pasted", () => {
    const text = ["Mã hàng\tSố lượng", "P-AYPR285-3\t15", "Mã hàng  SL", "SKU;Qty", "STT\tMã\tTên\tSL", "AV1F\t3"].join("\n");
    expect(parseSkuQty(text)).toEqual({
      rows: [
        { sku: "P-AYPR285-3", qty: 15 },
        { sku: "AV1F", qty: 3 },
      ],
      skipped: ["Mã hàng\tSố lượng", "Mã hàng  SL", "SKU;Qty", "STT\tMã\tTên\tSL"],
    });
  });

  it("skips a totals line", () => {
    expect(parseSkuQty("P-AYPR285-3\t15\nTổng cộng\t15\nTổng 15")).toEqual({
      rows: [{ sku: "P-AYPR285-3", qty: 15 }],
      skipped: ["Tổng cộng\t15", "Tổng 15"],
    });
  });

  it("reads thousand-formatted quantities, in an Excel cell or typed, with “.” or “,”", () => {
    expect(parseSkuQty("A-1\t1.000\nB-2\t1,000\nC-3\t12.500\nD-4 2.000\nE-5 2,000\nF-6;3,000\nG-7, 1,500").rows).toEqual([
      { sku: "A-1", qty: 1000 },
      { sku: "B-2", qty: 1000 },
      { sku: "C-3", qty: 12_500 },
      { sku: "D-4", qty: 2000 },
      { sku: "E-5", qty: 2000 },
      { sku: "F-6", qty: 3000 },
      { sku: "G-7", qty: 1500 },
    ]);
  });

  it("a comma between SKU and quantity is still a separator", () => {
    expect(parseSkuQty("AV200,500\nAV80,5\nP-AYPR285-3,120").rows).toEqual([
      { sku: "AV200", qty: 500 },
      { sku: "AV80", qty: 5 },
      { sku: "P-AYPR285-3", qty: 120 },
    ]);
  });

  it("the first cell is always the SKU, also when it is all digits (a barcode) followed by a comma", () => {
    expect(parseSkuQty("123,500\n8936012345678,5\n8936012345678 1,000").rows).toEqual([
      { sku: "123", qty: 500 },
      { sku: "8936012345678", qty: 1005 },
    ]);
  });

  it("a typed line that also carries the product name: the quantity is the last whole number, not one inside the name", () => {
    expect(parseSkuQty("P-AYPR285-3 Aeronaut 6000 Speed 15\nAV1F Flexred 3 cây\nP-AYPT307-4 Axforce Cannon 4U x 2").rows).toEqual([
      { sku: "P-AYPR285-3", qty: 15 },
      { sku: "AV1F", qty: 3 },
      { sku: "P-AYPT307-4", qty: 2 },
    ]);
  });

  it("accepts \\r\\n, \\n and lone \\r line endings", () => {
    expect(parseSkuQty("A-1\t1\r\nB-2\t2\nC-3\t3\rD-4 4\rE-5").rows).toEqual([
      { sku: "A-1", qty: 1 },
      { sku: "B-2", qty: 2 },
      { sku: "C-3", qty: 3 },
      { sku: "D-4", qty: 4 },
      { sku: "E-5", qty: 1 },
    ]);
  });

  it("reads whole-number quantities written with decimals (15.0, 15,00)", () => {
    expect(parseSkuQty("A-1\t15.0\nB-2\t15,00").rows).toEqual([
      { sku: "A-1", qty: 15 },
      { sku: "B-2", qty: 15 },
    ]);
  });

  it("adds up a SKU that appears several times, whatever its case, and keeps the order of first appearance", () => {
    const result = parseSkuQty("P-AYPR285-3\t5\nAV1F\t1\np-aypr285-3\t7\nP-AYPR285-3 3\nAV1F");
    expect(result).toEqual({
      rows: [
        { sku: "P-AYPR285-3", qty: 15 },
        { sku: "AV1F", qty: 2 },
      ],
      skipped: [],
    });
  });

  it("normalises SKUs: upper case, no spaces", () => {
    expect(parseSkuQty(" p-aypr285-3 \t2\nav1f\t1").rows).toEqual([
      { sku: "P-AYPR285-3", qty: 2 },
      { sku: "AV1F", qty: 1 },
    ]);
  });

  it("Excel rows with more columns: the quantity is the last whole-number cell", () => {
    const text = [
      "P-AYPR285-3\tKhung vợt cầu lông Aeronaut 6000 Speed\t15",
      "P-AYPT307-4\tKhung vợt cầu lông Axforce Cannon - 4U Black\t2\t687.273\t1.374.546",
      "AV1F\tKhung vợt cầu lông Flexred\tcây\t3\tgiao gấp",
    ].join("\n");
    expect(parseSkuQty(text)).toEqual({
      rows: [
        { sku: "P-AYPR285-3", qty: 15 },
        { sku: "P-AYPT307-4", qty: 2 },
        { sku: "AV1F", qty: 3 },
      ],
      skipped: [],
    });
  });

  it("a catalogue row without any quantity (SKU, name, prices) is skipped, not given a price as quantity", () => {
    const row = "P-AYPR285-3\tKhung vợt cầu lông Aeronaut 6000 Speed\t2.022.545\t1.415.782";
    expect(parseSkuQty(row)).toEqual({ rows: [], skipped: [row] });
  });

  it.each(["P-AYPR285-3\tabc", "P-AYPR285-3\t0", "P-AYPR285-3\t-3", "P-AYPR285-3\t1.5", "P-AYPR285-3 2,5", "P-AYPR285-3\tx15"])(
    "an unreadable or non-positive quantity skips the line: %j",
    (text) => {
      expect(parseSkuQty(text)).toEqual({ rows: [], skipped: [text] });
    },
  );

  it("ignores blank lines without reporting them", () => {
    expect(parseSkuQty("\n\nP-AYPR285-3\t15\n   \n\t\t\nAV1F\t3\n\n")).toEqual({
      rows: [
        { sku: "P-AYPR285-3", qty: 15 },
        { sku: "AV1F", qty: 3 },
      ],
      skipped: [],
    });
    expect(parseSkuQty("")).toEqual({ rows: [], skipped: [] });
  });

  it("a mix of good and bad lines keeps the good ones and reports the bad ones in order", () => {
    const result = parseSkuQty("Đơn hàng đại lý Minh Anh\nP-AYPR285-3 15\nAV1F abc\nAV1X 2\ncảm ơn");
    expect(result.rows).toEqual([
      { sku: "P-AYPR285-3", qty: 15 },
      { sku: "AV1X", qty: 2 },
    ]);
    expect(result.skipped).toEqual(["Đơn hàng đại lý Minh Anh", "AV1F abc", "cảm ơn"]);
  });

  // ── Real catalogue data ──

  it("every SKU of the seed catalogue can be pasted with a quantity (Excel row and typed line)", () => {
    const skus = [...new Set(db.programs.flatMap((p) => p.groups.flatMap((g) => g.items.map((i) => i.sku))))];
    expect(skus.length).toBeGreaterThan(100);
    for (const sku of skus) {
      expect(parseSkuQty(`${sku}\t3`), `${sku} (tab)`).toEqual({ rows: [{ sku, qty: 3 }], skipped: [] });
      expect(parseSkuQty(`${sku} 3`), `${sku} (space)`).toEqual({ rows: [{ sku, qty: 3 }], skipped: [] });
    }
  });

  it("a SKU made only of letters (Ashaway AVPTX) is accepted when a quantity comes with it", () => {
    expect(parseSkuQty("AVPTX\t5\nAVPTX 2\navptx;1\nAVPTX\tKhung vợt cầu lông Phantom X-Shadow\t4")).toEqual({
      rows: [{ sku: "AVPTX", qty: 12 }],
      skipped: [],
    });
  });

  // ── Order forms copied from Excel ──

  it("an Excel row whose quantity cell is empty is not ordered: it must not become quantity 1", () => {
    // Two columns copied from an order form that lists every product; only two rows have a quantity.
    const text = "P-AYPR285-3\t15\r\nP-AYPR287-3\t\r\nP-AYPR291-5\t\r\nAV1F\t3\r\n";
    const result = parseSkuQty(text);
    expect(result.rows).toEqual([
      { sku: "P-AYPR285-3", qty: 15 },
      { sku: "AV1F", qty: 3 },
    ]);
    expect(result.skipped).toEqual(["P-AYPR287-3", "P-AYPR291-5"]);
  });

  it("an Excel row with a name but an empty quantity cell is skipped as well", () => {
    const result = parseSkuQty("P-AYPR285-3\tKhung vợt cầu lông Aeronaut 6000 Speed\t\nAV1F\tKhung vợt cầu lông Flexred\t3");
    expect(result.rows).toEqual([{ sku: "AV1F", qty: 3 }]);
    expect(result.skipped).toHaveLength(1);
  });
});
