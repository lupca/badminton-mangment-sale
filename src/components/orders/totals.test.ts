// Kiểm tra phần cộng dồn đơn hàng bằng dữ liệu mẫu thật và engine thật.
import { describe, expect, it } from "vitest";
import { calculateOrder } from "../../lib/engine";
import seed from "../../seed/seed.json";
import type { DB, Order, OrderGift, OrderLine, Program } from "../../types";
import { salesKey, salesNames, sumOrders, summarizeOrders, type OrderCalc } from "./totals";

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

function entry(p: Program, fields: Partial<Order>): OrderCalc {
  const order: Order = {
    id: "o",
    code: "DH",
    programId: p.id,
    customerName: "",
    customerPhone: "",
    salesperson: "",
    salespersonPhone: "",
    note: "",
    status: "draft",
    lines: [],
    gifts: [],
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    ...fields,
  };
  return { order, calc: calculateOrder(p, order) };
}

const km11 = program("seed-km-2026-11");
const he = program("seed-km-2026-he");

// Giá sỉ trong dữ liệu mẫu: P-AYPR285-3 = 1.415.782, P-AYPR287-3 = 1.415.782, P-AYPT065-4 = 2.130.545.
// Giá lẻ quà: P-AYPM394-4 = 1.450.000, P-AYPT563-4 = 1.380.000.
const entries: OrderCalc[] = [
  entry(km11, {
    customerName: "Shop Minh Anh",
    status: "confirmed",
    lines: [line(km11, "g-km11-apply", "P-AYPR285-3", 15)],
    gifts: [
      gift(km11, "r-km11-tier", "g-km11-gift", "P-AYPM394-4", 1),
      gift(km11, "r-km11-tier", "g-km11-gift", "P-AYPT563-4", 1),
    ],
  }),
  // Quà 4.350.000 đ vượt hạn mức 3.190.000 đ của mức 20 triệu → đơn có lỗi nhưng vẫn được cộng.
  entry(km11, {
    customerName: "  shop  minh anh ",
    lines: [line(km11, "g-km11-apply", "P-AYPR287-3", 20), line(km11, "g-km11-apply", "P-AYPR291-5", 0)],
    gifts: [gift(km11, "r-km11-tier", "g-km11-gift", "P-AYPM394-4", 3)],
  }),
  entry(km11, {
    lines: [line(km11, "g-km11-apply", "P-AYPT065-4", 4), line(km11, "g-km11-apply", "P-AYPR285-3", 6)],
  }),
];

describe("sumOrders", () => {
  it("cộng số lượng, tiền hàng, quà và đếm đơn lỗi", () => {
    expect(sumOrders(entries)).toEqual({
      orderCount: 3,
      errorCount: 1,
      totalQty: 45,
      totalAmount: 21_236_730 + 28_315_640 + 17_016_872,
      giftQty: 5,
      giftValue: 2_830_000 + 4_350_000,
    });
  });

  it("không có đơn nào thì mọi tổng bằng 0", () => {
    const zero = { orderCount: 0, errorCount: 0, totalQty: 0, totalAmount: 0, giftQty: 0, giftValue: 0 };
    expect(sumOrders([])).toEqual(zero);
  });
});

describe("summarizeOrders", () => {
  const summary = summarizeOrders(entries);

  it("gộp hàng bán theo mã, nhiều số lượng nhất đứng trước, bỏ dòng số lượng 0", () => {
    expect(summary.items.map((i) => [i.sku, i.qty, i.value])).toEqual([
      ["P-AYPR285-3", 21, 21 * 1_415_782],
      ["P-AYPR287-3", 20, 20 * 1_415_782],
      ["P-AYPT065-4", 4, 4 * 2_130_545],
    ]);
    expect(summary.items[0].name).toBe("Khung vợt cầu lông Aeronaut 6000 Speed");
  });

  it("gộp quà theo mã, tính theo giá trị quà của quy tắc", () => {
    expect(summary.gifts.map((g) => [g.sku, g.qty, g.value])).toEqual([
      ["P-AYPM394-4", 4, 4 * 1_450_000],
      ["P-AYPT563-4", 1, 1_380_000],
    ]);
  });

  it("gộp theo đại lý không phân biệt hoa thường / khoảng trắng thừa; đơn chưa ghi tên gom vào tên rỗng", () => {
    expect(summary.dealers).toEqual([
      { name: "Shop Minh Anh", orderCount: 2, totalAmount: 21_236_730 + 28_315_640, giftValue: 2_830_000 + 4_350_000 },
      { name: "", orderCount: 1, totalAmount: 17_016_872, giftValue: 0 },
    ]);
  });

  it("tổng của các bảng khớp với tổng chung", () => {
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    expect(sum(summary.items.map((i) => i.qty))).toBe(summary.totalQty);
    expect(sum(summary.items.map((i) => i.value))).toBe(summary.totalAmount);
    expect(sum(summary.gifts.map((g) => g.qty))).toBe(summary.giftQty);
    expect(sum(summary.gifts.map((g) => g.value))).toBe(summary.giftValue);
    expect(sum(summary.dealers.map((d) => d.totalAmount))).toBe(summary.totalAmount);
    expect(sum(summary.dealers.map((d) => d.orderCount))).toBe(summary.orderCount);
  });

  it("quà ghi bằng chữ (không có mã) được gộp theo tên", () => {
    // Hè 2026: mỗi vợt Danh mục 01 tặng 1 «Cước cầu lông LiNing N65»; mua 3 kèm 1 vợt Danh mục 03 thì giảm 45% giá lẻ.
    const order = {
      lines: [line(he, "g-he-dm01", "P-AYPT417-5", 3), line(he, "g-he-dm03", "P-AYPM444-3", 1)],
    };
    const result = summarizeOrders([entry(he, order), entry(he, { lines: [line(he, "g-he-dm01", "P-AYPU109-4", 1)] })]);
    expect(result.gifts).toEqual([{ sku: "", name: "Cước cầu lông LiNing N65", qty: 4, value: 0 }]);
    // 2.356.364 × 55% = 1.296.000 (làm tròn) — hàng bán cộng theo tiền sau giảm.
    expect(result.items.find((i) => i.sku === "P-AYPT417-5")).toMatchObject({ qty: 3, value: 3 * 1_296_000 });
  });
});

describe("salesKey", () => {
  it("cùng một khóa dù gõ khác chữ hoa/thường, có dấu hay không dấu, thừa khoảng trắng", () => {
    expect(salesKey("Nguyễn Văn An")).toBe("nguyen van an");
    expect(salesKey("  NGUYỄN   VĂN AN ")).toBe("nguyen van an");
    expect(salesKey("nguyen van an")).toBe("nguyen van an");
    // Cùng một chữ nhưng máy gõ ra dạng dấu rời (NFD).
    expect(salesKey("Nguyễn Văn An".normalize("NFD"))).toBe("nguyen van an");
    expect(salesKey("Đỗ Thị Đào")).toBe("do thi dao");
  });

  it("tên khác nhau thì khóa khác nhau; để trống hoặc chỉ có khoảng trắng thì khóa rỗng", () => {
    expect(salesKey("Nguyễn Văn Anh")).not.toBe(salesKey("Nguyễn Văn An"));
    expect(salesKey("")).toBe("");
    expect(salesKey("   ")).toBe("");
  });
});

describe("salesNames", () => {
  const order = (salesperson: string, createdAt = "2026-11-10T00:00:00.000Z"): Order =>
    entry(km11, { salesperson, createdAt }).order;

  it("mỗi sale một tên: cách viết gặp nhiều nhất, đã bỏ khoảng trắng thừa", () => {
    const names = salesNames([
      order("nguyen van an"),
      order("Nguyễn Văn An"),
      order("  Nguyễn  Văn An "),
      order("Trần Thị Bình"),
    ]);
    expect([...names]).toEqual([
      ["nguyen van an", "Nguyễn Văn An"],
      ["tran thi binh", "Trần Thị Bình"],
    ]);
    // Khóa của bảng tên chính là `salesKey` — danh sách đơn dựa vào điều này để lọc theo sale.
    for (const [key, name] of names) expect(salesKey(name)).toBe(key);
  });

  it("hai cách viết gặp bằng nhau thì lấy cách viết ở đơn tạo gần đây hơn, không phụ thuộc thứ tự các đơn", () => {
    const older = order("NGUYEN VAN AN", "2026-11-10T08:00:00.000Z");
    const newer = order("Nguyễn Văn An", "2026-11-12T08:00:00.000Z");
    expect(salesNames([older, newer]).get("nguyen van an")).toBe("Nguyễn Văn An");
    expect(salesNames([newer, older]).get("nguyen van an")).toBe("Nguyễn Văn An");
  });

  it("các đơn chưa ghi tên sale nằm ở khóa rỗng; không có đơn nào thì không có sale nào", () => {
    expect([...salesNames([order(""), order("   "), order("An")])]).toEqual([
      ["", ""],
      ["an", "An"],
    ]);
    expect(salesNames([]).size).toBe(0);
  });
});

describe("summarizeOrders — theo sale", () => {
  const apply = (sku: string, qty: number) => line(km11, "g-km11-apply", sku, qty);
  const summary = summarizeOrders([
    entry(km11, { salesperson: "Nguyễn Văn An", lines: [apply("P-AYPR285-3", 2)] }),
    entry(km11, { salesperson: "Nguyễn Văn An", status: "confirmed", lines: [apply("P-AYPT065-4", 4)] }),
    entry(km11, { salesperson: " nguyen  van AN ", lines: [apply("P-AYPR287-3", 1)] }),
    entry(km11, {
      salesperson: "Trần Thị Bình",
      lines: [apply("P-AYPR285-3", 15)],
      gifts: [
        gift(km11, "r-km11-tier", "g-km11-gift", "P-AYPM394-4", 1),
        gift(km11, "r-km11-tier", "g-km11-gift", "P-AYPT563-4", 1),
      ],
    }),
    entry(km11, { salesperson: "  ", lines: [apply("P-AYPR285-3", 6)] }),
    entry(km11, { lines: [apply("P-AYPR287-3", 1)] }),
  ]);

  it("mỗi sale một dòng dù tên gõ khác nhau, thanh toán nhiều nhất đứng trước; đơn chưa ghi sale gom lại", () => {
    // Bình chỉ 1 đơn nhưng thanh toán nhiều nhất nên đứng đầu; An 3 đơn (2 cách viết); 2 đơn chưa ghi sale.
    expect(summary.sales).toEqual([
      { name: "Trần Thị Bình", orderCount: 1, totalQty: 15, totalAmount: 21_236_730, giftValue: 2_830_000 },
      {
        name: "Nguyễn Văn An",
        orderCount: 3,
        totalQty: 7,
        totalAmount: 2 * 1_415_782 + 4 * 2_130_545 + 1_415_782,
        giftValue: 0,
      },
      { name: "", orderCount: 2, totalQty: 7, totalAmount: 7 * 1_415_782, giftValue: 0 },
    ]);
  });

  it("tổng của bảng theo sale khớp với tổng chung", () => {
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    expect(sum(summary.sales.map((s) => s.orderCount))).toBe(summary.orderCount);
    expect(sum(summary.sales.map((s) => s.totalQty))).toBe(summary.totalQty);
    expect(sum(summary.sales.map((s) => s.totalAmount))).toBe(summary.totalAmount);
    expect(sum(summary.sales.map((s) => s.giftValue))).toBe(summary.giftValue);
  });

  it("không có đơn nào thì bảng theo sale rỗng", () => {
    expect(summarizeOrders([]).sales).toEqual([]);
  });

  it("nhận bảng tên của toàn bộ đơn hàng: sale hiện đúng cách viết đó dù nhóm đơn đang cộng viết khác", () => {
    const all = [
      entry(km11, { salesperson: "Nguyễn Văn An" }),
      entry(km11, { salesperson: "Nguyễn Văn An" }),
      entry(km11, { salesperson: "NGUYEN VAN AN", status: "confirmed", lines: [apply("P-AYPR285-3", 1)] }),
    ];
    const confirmed = all.filter((e) => e.order.status === "confirmed");
    const allNames = salesNames(all.map((e) => e.order));
    expect(summarizeOrders(confirmed).sales.map((s) => s.name)).toEqual(["NGUYEN VAN AN"]);
    expect(summarizeOrders(confirmed, allNames).sales.map((s) => s.name)).toEqual(["Nguyễn Văn An"]);
  });
});
