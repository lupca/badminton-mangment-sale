// Kiểm tra phần tồn kho của màn hình tính đơn bằng dữ liệu mẫu thật và engine thật.
import { describe, expect, it } from "vitest";
import { calculateOrder } from "../../lib/engine";
import { formatDateTime } from "../../lib/format";
import seed from "../../seed/seed.json";
import type { DB, Order, OrderGift, OrderLine, Program, Stock } from "../../types";
import {
  orderStockView,
  stockSourceNote,
  stockWarningSummary,
  stockWarningText,
  stockWarnings,
  type StockWarning,
} from "./stockView";

const db = seed as unknown as DB;

function program(id: string): Program {
  const found = db.programs.find((p) => p.id === id);
  if (!found) throw new Error(`Không có chương trình mẫu ${id}`);
  return found;
}

function line(p: Program, groupId: string, sku: string, qty: number): OrderLine {
  const item = p.groups.find((g) => g.id === groupId)?.items.find((i) => i.sku === sku);
  if (!item) throw new Error(`Không có mã ${sku} trong ${groupId}`);
  return { groupId, sku, name: item.name, retailPrice: item.retailPrice, wholesalePrice: item.wholesalePrice, qty };
}

function gift(p: Program, ruleId: string, groupId: string, sku: string, qty: number): OrderGift {
  return { ...line(p, groupId, sku, qty), ruleId };
}

function calcOf(p: Program, fields: Partial<Order>) {
  return calculateOrder(p, { lines: [], gifts: [], ...fields });
}

const stockOf = (bySku: Record<string, number>, updatedAt: string | null = "2026-11-20T14:05:00.000Z"): Stock => ({
  bySku,
  updatedAt,
});

const km11 = program("seed-km-2026-11");
const bangGia = program("seed-bang-gia-sau-ck");
const he = program("seed-km-2026-he");

// Đơn mẫu: 30 + 2 + 2 + 99 khung vợt và 3 + 1 quà sale chọn.
const km11Calc = calcOf(km11, {
  lines: [
    line(km11, "g-km11-apply", "P-AYPR285-3", 30),
    line(km11, "g-km11-apply", "P-AYPR287-3", 2),
    line(km11, "g-km11-apply", "P-AYPR291-5", 2),
    line(km11, "g-km11-apply", "P-AYPU077-4", 99),
  ],
  gifts: [
    gift(km11, "r-km11-tier", "g-km11-gift", "P-AYPT467-4", 3),
    gift(km11, "r-km11-tier", "g-km11-gift", "P-AYPT471-4", 1),
  ],
});
// 285-3 còn 24 (đặt 30), 287-3 hết, 291-5 còn 3 (đặt 2 — đủ), U077-4 chưa có số liệu, quà 467-4 còn 2 (chọn 3), quà 471-4 âm kho.
const km11Stock = stockOf({ "P-AYPR285-3": 24, "P-AYPR287-3": 0, "P-AYPR291-5": 3, "P-AYPT467-4": 2, "P-AYPT471-4": -1 });

describe("stockWarnings", () => {
  it("báo mã đặt vượt tồn và mã đã hết hàng, kèm số lượng là quà tặng", () => {
    const name = expect.any(String);
    expect(stockWarnings(km11Calc, km11Stock)).toEqual([
      { sku: "P-AYPR285-3", name: "Khung vợt cầu lông Aeronaut 6000 Speed", ordered: 30, stock: 24, level: "over", giftQty: 0 },
      { sku: "P-AYPR287-3", name, ordered: 2, stock: 0, level: "out", giftQty: 0 },
      { sku: "P-AYPT467-4", name, ordered: 3, stock: 2, level: "over", giftQty: 3 },
      { sku: "P-AYPT471-4", name, ordered: 1, stock: -1, level: "out", giftQty: 1 },
    ]);
  });

  it("không báo gì khi kho đủ hàng hoặc mã chưa có số liệu tồn kho", () => {
    expect(stockWarnings(km11Calc, stockOf({ "P-AYPR285-3": 30, "P-AYPR287-3": 2, "P-AYPT467-4": 3, "P-AYPT471-4": 1 }))).toEqual([]);
    expect(stockWarnings(km11Calc, stockOf({ "KHONG-CO-TRONG-DON": 0 }))).toEqual([]);
  });

  it("cộng hàng mua với quà tự tặng của cùng một mã (mua 1 tặng 1)", () => {
    // Mua 10 khung AV1F → được tặng 10 khung AV1F: kho phải xuất 20.
    const calc = calcOf(bangGia, { lines: [line(bangGia, "g-bg-ashaway", "AV1F", 10)] });
    expect(calc.gifts).toMatchObject([{ sku: "AV1F", qty: 10, auto: true }]);
    expect(stockWarnings(calc, stockOf({ AV1F: 20 }))).toEqual([]);
    expect(stockWarnings(calc, stockOf({ AV1F: 15 }))).toMatchObject([
      { sku: "AV1F", ordered: 20, stock: 15, level: "over", giftQty: 10 },
    ]);
  });

  it("cộng cùng một mã nằm ở hai danh mục với quà sale chọn", () => {
    // P-AYPT417-5 có ở cả Danh mục 01 và 02; quà của ưu đãi B2 cũng chọn từ Danh mục 01.
    const calc = calcOf(he, {
      lines: [line(he, "g-he-dm01", "P-AYPT417-5", 2), line(he, "g-he-dm02", "P-AYPT417-5", 6)],
      gifts: [gift(he, "r-he-b2", "g-he-dm01", "P-AYPT417-5", 1)],
    });
    expect(stockWarnings(calc, stockOf({ "P-AYPT417-5": 9 }))).toEqual([]);
    expect(stockWarnings(calc, stockOf({ "P-AYPT417-5": 8 }))).toMatchObject([
      { sku: "P-AYPT417-5", ordered: 9, stock: 8, level: "over", giftQty: 1 },
    ]);
  });

  it("cộng quà của cùng một mã đến từ nhiều quy tắc", () => {
    // Một mã vừa là quà tự tặng (2) vừa là quà sale chọn ở quy tắc khác (3): phần quà là 5 trong 6 cái phải xuất.
    const calc = {
      lines: calcOf(km11, { lines: [line(km11, "g-km11-apply", "P-AYPR285-3", 1)] }).lines,
      gifts: [
        { ruleId: "r-1", sku: "P-AYPR285-3", name: "Khung vợt", qty: 2, unitValue: 0, value: 0, auto: true },
        { ruleId: "r-2", sku: "p-aypr285-3", name: "Khung vợt", qty: 3, unitValue: 0, value: 0, auto: false },
        { ruleId: "r-3", sku: "", name: "Cước N65", qty: 9, unitValue: 0, value: 0, auto: true }, // quà ghi bằng chữ: không có mã
      ],
    };
    expect(stockWarnings(calc, stockOf({ "P-AYPR285-3": 5 }))).toMatchObject([
      { sku: "P-AYPR285-3", ordered: 6, stock: 5, level: "over", giftQty: 5 },
    ]);
  });
});

describe("stockWarningText", () => {
  const warning = (fields: Partial<StockWarning>): StockWarning => ({
    sku: "P-AYPR285-3",
    name: "Khung vợt",
    ordered: 30,
    stock: 24,
    level: "over",
    giftQty: 0,
    ...fields,
  });

  it("ghi mã hàng, số đặt và số còn trong kho", () => {
    expect(stockWarnings(km11Calc, km11Stock).map(stockWarningText)).toEqual([
      "Vượt tồn kho: P-AYPR285-3 đặt 30, kho còn 24",
      "P-AYPR287-3: kho đã hết hàng",
      "Vượt tồn kho: P-AYPT467-4 đặt 3, kho còn 2 (quà tặng)",
      "P-AYPT471-4: kho đã hết hàng (quà tặng)",
    ]);
  });

  it("tách phần mua và phần quà khi số đặt gồm cả hai", () => {
    expect(stockWarningText(warning({ sku: "AV1F", ordered: 20, stock: 15, giftQty: 10 }))).toBe(
      "Vượt tồn kho: AV1F đặt 20, kho còn 15 (gồm 10 mua + 10 quà tặng)",
    );
    expect(stockWarningText(warning({ sku: "P-AYPT417-5", ordered: 9, stock: 8, giftQty: 1 }))).toBe(
      "Vượt tồn kho: P-AYPT417-5 đặt 9, kho còn 8 (gồm 8 mua + 1 quà tặng)",
    );
    // Hết hàng thì mua hay tặng cũng không có để giao: không cần tách.
    expect(stockWarningText(warning({ ordered: 3, stock: 0, level: "out", giftQty: 1 }))).toBe("P-AYPR285-3: kho đã hết hàng");
  });

  it("viết số theo kiểu Việt Nam, giữ phần lẻ của số tồn", () => {
    expect(stockWarningText(warning({ ordered: 2000, stock: 1250.5 }))).toBe(
      "Vượt tồn kho: P-AYPR285-3 đặt 2.000, kho còn 1.250,5",
    );
  });
});

describe("stockWarningSummary", () => {
  const warnings = stockWarnings(km11Calc, km11Stock);

  it("không có cảnh báo thì không có dòng nào", () => {
    expect(stockWarningSummary([])).toBeNull();
  });

  it("một mã thì nói rõ mã đó, bỏ phần chú thích quà tặng cho ngắn", () => {
    expect(stockWarningSummary(warnings.slice(0, 1))).toBe("Vượt tồn kho: P-AYPR285-3 đặt 30, kho còn 24");
    expect(stockWarningSummary(warnings.slice(1, 2))).toBe("P-AYPR287-3: kho đã hết hàng");
    expect(stockWarningSummary(warnings.slice(2, 3))).toBe("Vượt tồn kho: P-AYPT467-4 đặt 3, kho còn 2");
  });

  it("nhiều mã thì chỉ đếm và chỉ sang phần kết quả", () => {
    expect(stockWarningSummary(warnings)).toBe("Tồn kho không đủ cho 4 mã — xem kết quả");
  });
});

describe("orderStockView", () => {
  it("chưa có số liệu tồn kho thì không hiện gì về tồn kho", () => {
    expect(orderStockView(stockOf({}, null), 5, "draft", km11Calc)).toBeNull();
  });

  it("đơn đã chốt không so với tồn kho hôm nay", () => {
    expect(orderStockView(km11Stock, 5, "confirmed", km11Calc)).toBeNull();
  });

  it("đơn nháp: giữ nguyên tồn kho và ngưỡng, kèm cảnh báo và các mã cần tô đỏ", () => {
    const view = orderStockView(km11Stock, 7, "draft", km11Calc);
    expect(view?.stock).toBe(km11Stock); // cùng danh tính: các dòng React.memo không vẽ lại
    expect(view?.lowThreshold).toBe(7);
    expect(view?.warnings).toEqual(stockWarnings(km11Calc, km11Stock));
    expect([...(view?.overSkus ?? [])]).toEqual(["P-AYPR285-3", "P-AYPR287-3", "P-AYPT467-4", "P-AYPT471-4"]);
  });

  it("đơn nháp đủ hàng: vẫn hiện tồn kho, không có cảnh báo", () => {
    const view = orderStockView(km11Stock, 5, "draft", calcOf(km11, { lines: [line(km11, "g-km11-apply", "P-AYPR285-3", 24)] }));
    expect(view?.warnings).toEqual([]);
    expect(view?.overSkus.size).toBe(0);
  });
});

describe("stockSourceNote", () => {
  it("ghi thời điểm cập nhật file kho và nói rõ vẫn chốt được đơn", () => {
    const at = "2026-11-20T14:05:00.000Z";
    expect(stockSourceNote({ updatedAt: at })).toBe(
      `Tồn kho là số trong file kho cập nhật lúc ${formatDateTime(at)}, có thể đã thay đổi — vẫn chốt đơn được.`,
    );
    expect(formatDateTime(at)).toMatch(/^\d{2}\/11\/2026 \d{2}:05$/);
  });

  it("không rõ thời điểm cập nhật thì bỏ phần giờ", () => {
    expect(stockSourceNote({ updatedAt: null })).toBe(
      "Tồn kho là số trong file kho đã nhập, có thể đã thay đổi — vẫn chốt đơn được.",
    );
  });
});
