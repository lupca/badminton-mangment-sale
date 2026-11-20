import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  columnOptions,
  convertRows,
  convertStockRows,
  defaultSheetIndex,
  detectLayout,
  parseNumber,
  readWorkbook,
  rowsFromText,
  type Cell,
  type ConvertOptions,
} from "./excel";

// ───────────────────────── Dữ liệu mẫu, dựng theo 3 kiểu file khách gửi ─────────────────────────

/** Kiểu 1: cột "Mã Hàng" lẫn mã vạch, mã thật nằm ở cột "Tên Hàng"; giá theo nghìn đồng, không có giá sỉ. */
const BARCODE_SHEET: Cell[][] = [
  ["Mã Hàng", "Tên SP", "ĐVT", "Giá lẻ\nVAT 10%", "Tên Hàng"],
  ["6902258696667", "Khung vợt cầu lông Axforce Warrior - 4U", "Chiếc", 1420, "P-AYPW039-4V"],
  ["6905154065223", "Khung vợt cầu lông Axforce 90 Tiger Max - 4U Red", "Chiếc", 5200, "P-AYPT243-4V"],
  ["P-AYPJ008-4", "Khung vợt cầu lông 80TF", "Cái", 1620, "P-AYPJ008-4"],
  ["P-AYPM394-4", "Khung vợt cầu lông\u00a03D  Calibar200 ", "Cái", 1450, " p-aypm394-4 "],
  ["P-AYPR285-3", "Khung vợt cầu lông Aeronaut 6000 Speed", "Cái", 2060, "P-AYPR285-3"],
  ["P-AYPJ008-4", "Khung vợt cầu lông 80TF (dòng trùng)", "Cái", 9999, "P-AYPJ008-4"],
];

/** Kiểu 2: bảng Li-Ning, giữa chừng có dòng tên nhóm "ASHAWAY" + dòng tiêu đề thứ hai, cột D của nhóm đó là chữ "ASW". */
const PROMO_SHEET: Cell[][] = [
  ["Row Labels", "Tên Hàng", "GiaLe", "Giá sau Vat", "Giá Sỉ", "Ghi Chú", null],
  ["P-AYPR285-3", "Khung vợt cầu lông Aeronaut 6000 Speed", 2060, 2022.5454545454545, 1415.7818181818182, null, null],
  ["P-AYPJ008-4A", "Khung vợt cầu lông 80TF", 1650, 1619.9999999999998, 1133.9999999999998, null, null],
  ["P-AYPT235-4V", "Khung vợt cầu lông Axforce 100 - 4U Black Golden", 5900, 5792.727272727272, 4054.90909090909, null, "1 Kèm 3 tối đa kèm 5"],
  ["P-AYPJ008-4", "Khung vợt cầu lông 80TF", 1650, 1619.9999999999998, 971.9999999999998, "MỤC 2", null],
  [null, null, null, null, null, null, null],
  ["ASHAWAY", null, null, null, null, null, null],
  ["Mã Hàng", "Tên Hàng", "Giá Lẻ", null, null, "Ghi Chú", null],
  ["AV1F", "Khung vợt cầu lông Flexred", 1150, "ASW", 1150, "Mua 1 Tặng 1", null],
  ["AVPTX", "Khung vợt cầu lông Phantom X-Shadow", 1800, "ASW", 1800, "Mua 1 Tặng 1", null],
];

/** Kiểu 3: bảng bắt đầu ở ô B3, có thêm hai cột số lượng và thành tiền không tiêu đề. */
const OFFSET_TABLE: Cell[][] = [
  ["Mã Hàng", "Tên Hàng", "Giá Lẻ", "Giá sỉ", null, null],
  ["P-AYPT235-4V", "Khung vợt cầu lông Axforce 100 - 4U Black Golden", 5900, 4054.90909090909, null, null],
  ["P-AYPU011-4V", "Khung vợt cầu lông AXFORCE 40 - 4U Black", 2250, 1546.3636363636363, 15, 23195.454545454544],
  ["P-AYPT369-4V", "Khung vợt cầu lông Halbertec 8000 - 4U", 4700, 3230.1818181818176, 20, 64603.63636363635],
];

interface TestSheet {
  name: string;
  rows: unknown[][];
  origin?: string;
  hidden?: boolean;
}

function toXlsx(sheets: TestSheet[]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(worksheet, sheet.rows, { origin: sheet.origin ?? "A1" });
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  workbook.Workbook = { Sheets: sheets.map((sheet) => ({ Hidden: sheet.hidden ? 1 : 0 })) };
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** Nhận diện rồi chuyển đổi như hộp thoại nhập làm, cho phép ghi đè vài tùy chọn. */
function importRows(rows: Cell[][], overrides: Partial<ConvertOptions> = {}) {
  return convertRows(rows, { ...detectLayout(rows), vatFrom10To8: false, wholesaleDiscountPercent: null, ...overrides });
}

// ───────────────────────── Đọc số ─────────────────────────

describe("parseNumber", () => {
  it("giữ nguyên số đọc từ file", () => {
    expect(parseNumber(1415.7818)).toBe(1415.7818);
    expect(parseNumber(0)).toBe(0);
  });

  it("coi các nhóm 3 chữ số là dấu ngăn hàng nghìn", () => {
    expect(parseNumber("2.023")).toBe(2023);
    expect(parseNumber("1.415.782")).toBe(1415782);
    expect(parseNumber("1,415,782")).toBe(1415782);
  });

  it("đọc một dấu thập phân, dù là phẩy hay chấm", () => {
    expect(parseNumber("2022,55")).toBe(2022.55);
    expect(parseNumber("2022.55")).toBe(2022.55);
    expect(parseNumber("1.415,78")).toBe(1415.78);
    expect(parseNumber("1,415.78")).toBe(1415.78);
    expect(parseNumber("480")).toBe(480);
  });

  it("bỏ chữ đ, dấu cách và khoảng trắng không ngắt", () => {
    expect(parseNumber(" 1.420.000 đ ")).toBe(1420000);
    expect(parseNumber("1\u00a0420\u00a0000đ")).toBe(1420000);
    expect(parseNumber("2.060 VNĐ")).toBe(2060);
  });

  it("biết dấu thập phân của cột thì «785,455» là số lẻ, còn dấu kia vẫn là dấu ngăn hàng nghìn", () => {
    expect(parseNumber("785,455")).toBe(785455);
    expect(parseNumber("785,455", ",")).toBe(785.455);
    expect(parseNumber("785.455", ".")).toBe(785.455);
    expect(parseNumber("2.023", ",")).toBe(2023);
    expect(parseNumber("1.415,78", ",")).toBe(1415.78);
  });

  it("trả null khi không phải số", () => {
    for (const value of ["ASW", "", "  ", "Giá Lẻ", "P-AYPR285-3", "12abc", "-5", null, undefined]) {
      expect(parseNumber(value)).toBeNull();
    }
  });
});

// ───────────────────────── Nhãn cột ─────────────────────────

describe("nhận diện cột theo tiêu đề", () => {
  const product: Cell[] = ["AV1F", "Khung vợt cầu lông Flexred", 1150, 805, "Cái", "Mua 1 tặng 1"];

  it.each([
    [["Mã hàng", "Tên hàng", "Giá lẻ", "Giá sỉ", "ĐVT", "Ghi chú"]],
    [["Mã hàng sử dụng", "Tên SP", "GiaLe", "Giá buôn", "Đơn vị", "Ghi chú"]],
    [["Mã SP", "Tên sản phẩm", "Đơn giá bán lẻ", "Đơn giá bán buôn", "Đơn vị tính", "GHI CHÚ"]],
    [["Mã", "TÊN HÀNG", "Giá bán lẻ", "GIÁ SỈ", "đvt", "ghi chú"]],
    [["SKU", "Tên hàng", "Giá sau VAT", "Giá đại lý", "ĐVT", "Ghi chú"]],
    [["Row Labels", "TEN HANG", "GIA LE\n(VAT 10%)", "GIA SI", "DVT", "GHI CHU"]],
  ])("%j", (header) => {
    expect(detectLayout([header, product])).toEqual({
      headerRow: 0,
      mapping: { sku: 0, name: 1, retail: 2, wholesale: 3, unit: 4, note: 5, stock: null },
      priceUnit: "thousand",
    });
  });

  it("có cả «Mã hàng» và «Mã hàng sử dụng» thì lấy «Mã hàng sử dụng»", () => {
    const rows: Cell[][] = [
      ["Mã hàng", "Mã hàng sử dụng", "Tên hàng", "Đơn giá bán lẻ"],
      ["LN-0001", "P-AYPR285-3", "Khung vợt cầu lông Aeronaut 6000 Speed", 2060],
    ];
    expect(detectLayout(rows).mapping).toMatchObject({ sku: 1, name: 2, retail: 3 });
  });

  it("cột mã vạch, số thứ tự, số lượng có tiêu đề riêng thì không bị gán vai trò nào", () => {
    const rows: Cell[][] = [
      ["STT", "Mã vạch", "Mã hàng", "Tên hàng", "Số lượng", "Đơn giá", "Thành tiền"],
      [1, "6902258696667", "P-AYPW039-4V", "Khung vợt cầu lông Axforce Warrior - 4U", 5, 1420, 7100],
      [2, "6905154065223", "P-AYPT243-4V", "Khung vợt cầu lông Axforce 90 Tiger Max - 4U Red", 2, 5200, 10400],
    ];
    expect(detectLayout(rows).mapping).toEqual({ sku: 2, name: 3, retail: 5, wholesale: null, unit: null, note: null, stock: null });
  });
});

// ───────────────────────── Kiểu 1: mã vạch lẫn trong cột mã hàng ─────────────────────────

describe("bảng có cột mã hàng lẫn mã vạch", () => {
  it("chọn cột chứa mã thật làm mã hàng dù cột đó mang nhãn «Tên Hàng»", () => {
    expect(detectLayout(BARCODE_SHEET)).toEqual({
      headerRow: 0,
      mapping: { sku: 4, name: 1, retail: 3, wholesale: null, unit: 2, note: null, stock: null },
      priceUnit: "thousand",
    });
  });

  it("vẫn dùng cột mang nhãn mã hàng khi không có cột nào chứa mã thật", () => {
    const rows = BARCODE_SHEET.map((row) => row.slice(0, 4));
    expect(detectLayout(rows).mapping).toMatchObject({ sku: 0, name: 1, retail: 3 });
  });

  it("đổi nghìn đồng ra đồng, chuẩn hóa mã và tên, giữ dòng đầu của mã trùng", () => {
    const result = importRows(BARCODE_SHEET);
    expect(result.items).toEqual([
      { sku: "P-AYPW039-4V", name: "Khung vợt cầu lông Axforce Warrior - 4U", retailPrice: 1420000, wholesalePrice: 1420000, unit: "Chiếc" },
      { sku: "P-AYPT243-4V", name: "Khung vợt cầu lông Axforce 90 Tiger Max - 4U Red", retailPrice: 5200000, wholesalePrice: 5200000, unit: "Chiếc" },
      { sku: "P-AYPJ008-4", name: "Khung vợt cầu lông 80TF", retailPrice: 1620000, wholesalePrice: 1620000, unit: "Cái" },
      { sku: "P-AYPM394-4", name: "Khung vợt cầu lông 3D Calibar200", retailPrice: 1450000, wholesalePrice: 1450000, unit: "Cái" },
      { sku: "P-AYPR285-3", name: "Khung vợt cầu lông Aeronaut 6000 Speed", retailPrice: 2060000, wholesalePrice: 2060000, unit: "Cái" },
    ]);
    expect(result.duplicateCount).toBe(1);
    expect(result.skipped).toEqual([
      { row: 7, reason: "duplicate", text: "P-AYPJ008-4 | Khung vợt cầu lông 80TF (dòng trùng) | Cái | 9999 | P-AYPJ008-4" },
    ]);
  });

  it("quy đổi VAT 10% → 8% và tính giá sỉ theo chiết khấu, làm tròn ở bước cuối", () => {
    const { items } = importRows(BARCODE_SHEET, { vatFrom10To8: true, wholesaleDiscountPercent: 30 });
    // 2060 ÷ 1,1 × 1,08 = 2022,5454… nghìn; × 70% = 1415,7818… nghìn — đúng các số trong bảng tính của khách.
    expect(items.find((item) => item.sku === "P-AYPR285-3")).toMatchObject({ retailPrice: 2022545, wholesalePrice: 1415782 });
    expect(items.find((item) => item.sku === "P-AYPJ008-4")).toMatchObject({ retailPrice: 1590545, wholesalePrice: 1113382 });
  });
});

// ───────────────────────── Kiểu 2: nhóm thứ hai giữa bảng ─────────────────────────

describe("bảng có dòng tên nhóm và dòng tiêu đề lặp lại giữa chừng", () => {
  it("lấy «Giá sau Vat» làm giá lẻ khi có cả «GiaLe»", () => {
    expect(detectLayout(PROMO_SHEET)).toEqual({
      headerRow: 0,
      mapping: { sku: 0, name: 1, retail: 3, wholesale: 4, unit: null, note: 5, stock: null },
      priceUnit: "thousand",
    });
  });

  it("bỏ dòng trống, dòng tên nhóm, dòng tiêu đề lặp; dòng thiếu giá lẻ lấy giá sỉ", () => {
    const result = importRows(PROMO_SHEET);
    expect(result.items).toEqual([
      { sku: "P-AYPR285-3", name: "Khung vợt cầu lông Aeronaut 6000 Speed", retailPrice: 2022545, wholesalePrice: 1415782 },
      { sku: "P-AYPJ008-4A", name: "Khung vợt cầu lông 80TF", retailPrice: 1620000, wholesalePrice: 1134000 },
      { sku: "P-AYPT235-4V", name: "Khung vợt cầu lông Axforce 100 - 4U Black Golden", retailPrice: 5792727, wholesalePrice: 4054909 },
      { sku: "P-AYPJ008-4", name: "Khung vợt cầu lông 80TF", retailPrice: 1620000, wholesalePrice: 972000, note: "MỤC 2" },
      { sku: "AV1F", name: "Khung vợt cầu lông Flexred", retailPrice: 1150000, wholesalePrice: 1150000, note: "Mua 1 Tặng 1" },
      { sku: "AVPTX", name: "Khung vợt cầu lông Phantom X-Shadow", retailPrice: 1800000, wholesalePrice: 1800000, note: "Mua 1 Tặng 1" },
    ]);
    expect(result.skipped.map(({ row, reason }) => ({ row, reason }))).toEqual([
      { row: 7, reason: "no_price" },
      { row: 8, reason: "no_price" },
    ]);
    expect(result.duplicateCount).toBe(0);
  });

  it("chỉ quy đổi VAT cho cột giá lẻ, không đụng tới cột giá sỉ", () => {
    const { items } = importRows(PROMO_SHEET, { mapping: { ...detectLayout(PROMO_SHEET).mapping, retail: 2 }, vatFrom10To8: true });
    expect(items[0]).toMatchObject({ retailPrice: 2022545, wholesalePrice: 1415782 });
    // Dòng Ashaway: cột giá lẻ 1150 được quy đổi, cột giá sỉ 1150 giữ nguyên.
    expect(items[4]).toMatchObject({ sku: "AV1F", retailPrice: 1129091, wholesalePrice: 1150000 });
  });

  it("ghi nhãn cột theo tiêu đề, cột không tiêu đề thì lấy giá trị mẫu", () => {
    expect(columnOptions(PROMO_SHEET, 0)).toEqual([
      { index: 0, label: "A — Row Labels" },
      { index: 1, label: "B — Tên Hàng" },
      { index: 2, label: "C — GiaLe" },
      { index: 3, label: "D — Giá sau Vat" },
      { index: 4, label: "E — Giá Sỉ" },
      { index: 5, label: "F — Ghi Chú" },
      { index: 6, label: "G — 1 Kèm 3 tối đa kèm 5" },
    ]);
  });
});

// ───────────────────────── Kiểu 3: bảng không bắt đầu ở A1 ─────────────────────────

describe("bảng bắt đầu ở ô B3", () => {
  it("đọc file .xlsx giữ đúng vị trí ô và tìm ra dòng tiêu đề", async () => {
    const sheets = await readWorkbook(toXlsx([{ name: "Sheet3", rows: OFFSET_TABLE, origin: "B3" }]));
    expect(sheets).toHaveLength(1);
    const { rows } = sheets[0];
    expect(rows[2].slice(0, 5)).toEqual([null, "Mã Hàng", "Tên Hàng", "Giá Lẻ", "Giá sỉ"]);
    expect(detectLayout(rows)).toEqual({
      headerRow: 2,
      mapping: { sku: 1, name: 2, retail: 3, wholesale: 4, unit: null, note: null, stock: null },
      priceUnit: "thousand",
    });
    expect(columnOptions(rows, 2).map((column) => column.label)).toEqual([
      "B — Mã Hàng",
      "C — Tên Hàng",
      "D — Giá Lẻ",
      "E — Giá sỉ",
      "F — 15",
      "G — 23195.45",
    ]);
    const result = importRows(rows);
    expect(result.items.map((item) => [item.sku, item.retailPrice, item.wholesalePrice])).toEqual([
      ["P-AYPT235-4V", 5900000, 4054909],
      ["P-AYPU011-4V", 2250000, 1546364],
      ["P-AYPT369-4V", 4700000, 3230182],
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("không tính các dòng tên bảng phía trên tiêu đề là dòng bị bỏ qua", () => {
    const rows: Cell[][] = [["BẢNG GIÁ ĐẠI LÝ THÁNG 11", null, null], [], ["Mã hàng", "Tên hàng", "Giá bán lẻ"], ["AV1F", "Khung vợt Flexred", 1150]];
    expect(detectLayout(rows).headerRow).toBe(2);
    expect(importRows(rows)).toMatchObject({ items: [{ sku: "AV1F", retailPrice: 1150000 }], skipped: [] });
  });
});

// ───────────────────────── Đơn vị giá, giá sỉ, dòng tổng ─────────────────────────

describe("đơn vị giá và giá sỉ", () => {
  const header: Cell[] = ["Mã hàng", "Tên hàng", "Đơn giá bán lẻ", "Đơn giá bán buôn"];

  it("giá điển hình từ 100.000 trở lên thì file đang ghi theo đồng", () => {
    const rows: Cell[][] = [header, ["AV1F", "Khung vợt Flexred", 1150000, 805000], ["AV80", "Khung vợt Nano80", 800000, 560000]];
    expect(detectLayout(rows)).toMatchObject({ mapping: { retail: 2, wholesale: 3 }, priceUnit: "dong" });
    expect(importRows(rows).items[0]).toMatchObject({ retailPrice: 1150000, wholesalePrice: 805000 });
  });

  it("một dòng giá rất lớn không làm đổi đơn vị của cả file", () => {
    const rows: Cell[][] = [header, ["AV1F", "Khung vợt Flexred", 1150, 805], ["AV80", "Khung vợt Nano80", 800, 560], ["CB-01", "Combo 100 cây vợt", 250000, 175000]];
    expect(detectLayout(rows).priceUnit).toBe("thousand");
  });

  it("bảng giá phụ kiện ghi bằng đồng (giá từ 10.000, đều tròn nghìn) không bị nhân 1000", () => {
    const rows: Cell[][] = [header, ["GP-01", "Quấn cán vợt GP-01", 25000, 18000], ["N65", "Cước cầu lông N65", 65000, 45000]];
    expect(detectLayout(rows).priceUnit).toBe("dong");
    // Vợt cao cấp ghi theo nghìn đồng (12.300 = 12.300.000 đ) thì không tròn nghìn như vậy.
    const rackets: Cell[][] = [header, ["P-AYPU115-88C", "Combo Halbertec 9000 Olympic", 12300, 8610], ["CB-02", "Combo 02", 15000, 10500]];
    expect(detectLayout(rackets).priceUnit).toBe("thousand");
  });

  it("người dùng ép đơn vị thì theo người dùng", () => {
    const rows: Cell[][] = [header, ["AV1F", "Khung vợt Flexred", 1150, 805]];
    expect(importRows(rows, { priceUnit: "dong" }).items[0]).toMatchObject({ retailPrice: 1150, wholesalePrice: 805 });
  });

  it("dòng thiếu giá sỉ: tính theo chiết khấu nếu có, không thì bằng giá lẻ", () => {
    const rows: Cell[][] = [header, ["AV1F", "Khung vợt Flexred", 1150, 900], ["AV80", "Khung vợt Nano80", 800, null]];
    expect(importRows(rows).items.map((item) => item.wholesalePrice)).toEqual([900000, 800000]);
    expect(importRows(rows, { wholesaleDiscountPercent: 30 }).items.map((item) => item.wholesalePrice)).toEqual([900000, 560000]);
    expect(importRows(rows, { wholesaleDiscountPercent: 12.5 }).items[1].wholesalePrice).toBe(700000);
  });

  it("bỏ dòng không có mã, dòng không có giá và dòng tổng cộng", () => {
    const rows: Cell[][] = [
      header,
      ["AV1F", "Khung vợt Flexred", 1150, 805],
      [null, "Dòng không có mã", 500, 400],
      ["AV80", "Khung vợt Nano80", "liên hệ", 0],
      ["Grand Total", null, 1650, 1205],
      ["Tổng cộng:", null, 1650, 1205],
    ];
    const result = importRows(rows);
    expect(result.items.map((item) => item.sku)).toEqual(["AV1F"]);
    expect(result.skipped.map((row) => row.reason)).toEqual(["no_sku", "no_price", "total", "total"]);
  });

  it("không có cột mã hàng thì không đọc dòng nào", () => {
    const rows: Cell[][] = [["Khung vợt Flexred", 1150], ["Khung vợt Nano80", 800]];
    expect(detectLayout(rows).mapping.sku).toBeNull();
    expect(importRows(rows)).toEqual({ items: [], skipped: [], duplicateCount: 0, stock: {} });
  });
});

// ───────────────────────── Văn bản dán ─────────────────────────

describe("dữ liệu dán từ Excel", () => {
  it("đọc số đã định dạng kiểu «2.023» và gộp ô tiêu đề có xuống dòng", () => {
    const rows = rowsFromText(
      [
        'Mã Hàng\tTên SP\tĐVT\t"Giá lẻ\nVAT 10%"\tTên Hàng',
        "6902258696667\tKhung vợt cầu lông Axforce Warrior - 4U\tChiếc\t1.420\tP-AYPW039-4V",
        "P-AYPR285-3\tKhung vợt cầu lông Aeronaut 6000 Speed\tCái\t2.060\tP-AYPR285-3",
        "P-AYPT315-2\tKhung vợt cầu lông Axforce 9 Black Orange\tCái\t480\tP-AYPT315-2",
        "",
      ].join("\r\n"),
    );
    expect(rows[0]).toEqual(["Mã Hàng", "Tên SP", "ĐVT", "Giá lẻ VAT 10%", "Tên Hàng"]);
    expect(rows).toHaveLength(4);
    expect(detectLayout(rows)).toMatchObject({ headerRow: 0, mapping: { sku: 4, name: 1, retail: 3, unit: 2 }, priceUnit: "thousand" });
    expect(importRows(rows).items.map((item) => [item.sku, item.retailPrice])).toEqual([
      ["P-AYPW039-4V", 1420000],
      ["P-AYPR285-3", 2060000],
      ["P-AYPT315-2", 480000],
    ]);
  });

  it("không có dòng tiêu đề: đoán cột theo nội dung, ưu tiên cột giá sau VAT", () => {
    const rows = rowsFromText(
      [
        "P-AYPR285-3\tKhung vợt cầu lông Aeronaut 6000 Speed\t2.060\t2.023\t1.416\t",
        "P-AYPT235-4V\tKhung vợt cầu lông Axforce 100 - 4U Black Golden\t5.900\t5.793\t4.055\t1 Kèm 3 tối đa kèm 5",
        "P-AYPT315-2\tKhung vợt cầu lông Axforce 9 Black Orange\t480\t471\t330\t",
      ].join("\n"),
    );
    expect(detectLayout(rows)).toEqual({
      headerRow: null,
      mapping: { sku: 0, name: 1, retail: 3, wholesale: 4, unit: null, note: null, stock: null },
      priceUnit: "thousand",
    });
    expect(importRows(rows).items[0]).toEqual({
      sku: "P-AYPR285-3",
      name: "Khung vợt cầu lông Aeronaut 6000 Speed",
      retailPrice: 2023000,
      wholesalePrice: 1416000,
    });
    expect(columnOptions(rows, null).map((column) => column.label)).toEqual([
      "A — P-AYPR285-3",
      "B — Khung vợt cầu lông Aeronaut 6…",
      "C — 2.060",
      "D — 2.023",
      "E — 1.416",
      "F — 1 Kèm 3 tối đa kèm 5",
    ]);
  });

  it("cột số lẻ bị Excel cắt theo bề rộng cột: «785,455» đọc cùng kiểu với «2022,55»", () => {
    const rows = rowsFromText(
      [
        "P-AYPR285-3\tKhung vợt cầu lông Aeronaut 6000 Speed\t2060\t2022,55\t1415,78",
        "P-AYPH044-3\tKhung vợt cầu lông A880T\t800\t785,455\t549,818",
        "P-AYPT315-2\tKhung vợt cầu lông Axforce 9 Black Orange\t480\t471,273\t329,891",
      ].join("\n"),
    );
    expect(detectLayout(rows)).toMatchObject({ mapping: { retail: 3, wholesale: 4 }, priceUnit: "thousand" });
    expect(importRows(rows).items.map((item) => [item.sku, item.retailPrice, item.wholesalePrice])).toEqual([
      ["P-AYPR285-3", 2022550, 1415780],
      ["P-AYPH044-3", 785455, 549818],
      ["P-AYPT315-2", 471273, 329891],
    ]);
  });

  it("không có tiêu đề, có cột số lượng và thành tiền: không nhầm thành giá sỉ", () => {
    const rows: Cell[][] = OFFSET_TABLE.slice(1).map((row) => [row[0], row[1], row[2], row[3], row[4] ?? 10, row[5] ?? 40549]);
    expect(detectLayout(rows).mapping).toEqual({ sku: 0, name: 1, retail: 2, wholesale: 3, unit: null, note: null, stock: null });
  });

  it("không có tiêu đề, có cột số thứ tự: không nhầm số thứ tự thành giá", () => {
    const rows = rowsFromText(
      [
        "1\tAV1F\tKhung vợt cầu lông Flexred\tCái\t1150\t805",
        "2\tAV80\tKhung vợt cầu lông Nano80\tCái\t800\t560",
        "3\tAV200\tKhung vợt cầu lông Dynamic 200\tCái\t750\t525",
      ].join("\n"),
    );
    expect(detectLayout(rows).mapping).toEqual({ sku: 1, name: 2, retail: 4, wholesale: 5, unit: 3, note: null, stock: null });
  });

  it("dòng tiêu đề nằm giữa vùng dán không làm mất các dòng phía trên", () => {
    const rows = rowsFromText(
      [
        "P-AYPU109-5\tKhung vợt cầu lông Axforce 10 - 5U Blue\t950\t932,7273\t559,6364\tMỤC 2",
        "ASHAWAY",
        "Mã Hàng\tTên Hàng\tGiá Lẻ\t\t\tGhi Chú",
        "AV1F\tKhung vợt cầu lông Flexred\t1150\tASW\t1150\tMua 1 Tặng 1",
      ].join("\n"),
    );
    const result = importRows(rows);
    expect(detectLayout(rows).headerRow).toBeNull();
    expect(result.items.map((item) => [item.sku, item.retailPrice, item.wholesalePrice])).toEqual([
      ["P-AYPU109-5", 932727, 559636],
      ["AV1F", 1150000, 1150000],
    ]);
    expect(result.skipped.map((row) => row.row)).toEqual([2, 3]);
  });

  it("tách được dòng không có tab (cách nhau từ 2 dấu cách)", () => {
    const rows = rowsFromText("AV1F  Khung vợt cầu lông Flexred  1.150.000 đ\nAV80  Khung vợt cầu lông Nano80  800.000 đ");
    expect(detectLayout(rows).priceUnit).toBe("dong");
    expect(importRows(rows).items).toEqual([
      { sku: "AV1F", name: "Khung vợt cầu lông Flexred", retailPrice: 1150000, wholesalePrice: 1150000 },
      { sku: "AV80", name: "Khung vợt cầu lông Nano80", retailPrice: 800000, wholesalePrice: 800000 },
    ]);
  });
});

// ───────────────────────── Đọc file ─────────────────────────

describe("readWorkbook", () => {
  it("lấy giá trị đã tính sẵn của ô công thức", async () => {
    const rows = [
      ["Mã hàng", "Tên hàng", "Giá lẻ", "Giá sỉ"],
      ["P-AYPR285-3", "Khung vợt cầu lông Aeronaut 6000 Speed", 2022.5454545454545, { t: "n", v: 1415.7818181818182, f: "C2*0.7" }],
    ];
    const [sheet] = await readWorkbook(toXlsx([{ name: "Sheet1", rows }]));
    expect(sheet.rows[1][3]).toBe(1415.7818181818182);
    expect(importRows(sheet.rows).items[0]).toMatchObject({ retailPrice: 2022545, wholesalePrice: 1415782 });
  });

  it("bỏ sheet trống và sheet ẩn, nhận cả File lẫn ArrayBuffer", async () => {
    const buffer = toXlsx([
      { name: "Sheet1", rows: PROMO_SHEET },
      { name: "Sheet2", rows: [] },
      { name: "An", rows: BARCODE_SHEET, hidden: true },
      { name: "Sheet3", rows: OFFSET_TABLE, origin: "B3" },
    ]);
    const sheets = await readWorkbook(new File([buffer], "bang-gia.xlsx"));
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Sheet1", "Sheet3"]);
    expect(sheets[0].rows).toEqual(PROMO_SHEET);
    expect(importRows(sheets[0].rows).items).toHaveLength(6);
  });

  it("chọn sẵn sheet đầu tiên có bảng giá", () => {
    const cover = { name: "Bìa", rows: [["BẢNG GIÁ ĐẠI LÝ"], ["Áp dụng từ 05/11/2026"]] as Cell[][] };
    expect(defaultSheetIndex([cover, { name: "Giá", rows: PROMO_SHEET }])).toBe(1);
    expect(defaultSheetIndex([cover])).toBe(0);
  });

  it("đọc file .csv ngăn bằng dấu chấm phẩy, giữ số kiểu Việt Nam", async () => {
    const csv = 'Mã hàng;Tên hàng;Giá lẻ;Giá sỉ\r\nP-AYPR285-3;"Khung vợt; bản Speed";2.023;1415,78\r\nAV1F;Khung vợt cầu lông Flexred;1.150;805\r\n';
    const [sheet] = await readWorkbook(toBytes(csv));
    expect(sheet.rows[1]).toEqual(["P-AYPR285-3", "Khung vợt; bản Speed", "2.023", "1415,78"]);
    expect(importRows(sheet.rows).items.map((item) => [item.sku, item.retailPrice, item.wholesalePrice])).toEqual([
      ["P-AYPR285-3", 2023000, 1415780],
      ["AV1F", 1150000, 805000],
    ]);
  });

  it("đọc file .xls (Excel 97-2003)", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(PROMO_SHEET), "Sheet1");
    const [sheet] = await readWorkbook(XLSX.write(workbook, { type: "array", bookType: "biff8" }));
    expect(sheet.rows).toEqual(PROMO_SHEET);
  });

  it("đọc bảng HTML lưu đuôi .xls, giá có dấu chấm ngăn hàng nghìn", async () => {
    const html =
      "<html><body><table><tr><th>Mã hàng</th><th>Tên hàng</th><th>Giá lẻ</th></tr>" +
      "<tr><td>P-AYPR285-3</td><td>Khung vợt cầu lông Aeronaut 6000 Speed</td><td>2.022.545</td></tr></table></body></html>";
    const [sheet] = await readWorkbook(toBytes(html));
    expect(importRows(sheet.rows).items).toEqual([
      { sku: "P-AYPR285-3", name: "Khung vợt cầu lông Aeronaut 6000 Speed", retailPrice: 2022545, wholesalePrice: 2022545 },
    ]);
  });

  it("đọc file .csv bảng mã Windows tiếng Việt và đưa dấu về dạng dựng sẵn", async () => {
    const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));
    // "Mã hàng;Tên hàng;Giá lẻ" / "AV1F;Khung vợt Flexred;1150" theo bảng mã windows-1258 (dấu ngã, hỏi, nặng là ký tự tổ hợp).
    const bytes = new Uint8Array([
      ...ascii("Ma"), 0xde, ...ascii(" h"), 0xe0, ...ascii("ng;T"), 0xea, ...ascii("n h"), 0xe0, ...ascii("ng;Gi"), 0xe1, ...ascii(" le"), 0xd2, 0x0a,
      ...ascii("AV1F;Khung v"), 0xf5, 0xf2, ...ascii("t Flexred;1150"), 0x0a,
    ]);
    const [sheet] = await readWorkbook(bytes.buffer);
    expect(detectLayout(sheet.rows).mapping).toMatchObject({ sku: 0, name: 1, retail: 2 });
    expect(columnOptions(sheet.rows, 0).map((column) => column.label)).toEqual(["A — Mã hàng", "B — Tên hàng", "C — Giá lẻ"]);
    expect(importRows(sheet.rows).items).toEqual([
      { sku: "AV1F", name: "Khung vợt Flexred", retailPrice: 1150000, wholesalePrice: 1150000 },
    ]);
  });

  it("báo lỗi tiếng Việt khi file hỏng hoặc không có dữ liệu", async () => {
    await expect(readWorkbook(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8]).buffer)).rejects.toThrow("Không đọc được file này");
    await expect(readWorkbook(toXlsx([{ name: "Sheet1", rows: [] }]))).rejects.toThrow("File không có dữ liệu");
  });
});

// ───────────────────────── Tồn kho ─────────────────────────

describe("cột tồn kho trong bảng giá", () => {
  const product: Cell[] = ["AV1F", "Khung vợt cầu lông Flexred", 1150, 12];

  it.each([
    "Tồn kho",
    "TỒN",
    "SL tồn",
    "Số lượng tồn",
    "Số lượng tồn kho",
    "Tổng tồn",
    "Tồn cuối kỳ",
    "Tồn kho hiện tại",
    "Tồn thực tế",
    "Tồn kho (chiếc)",
    "Có thể bán",
    "Stock",
    "Qty on hand",
  ])("nhận nhãn «%s» là tồn kho", (label) => {
    const layout = detectLayout([["Mã hàng", "Tên hàng", "Giá lẻ", label], product]);
    expect(layout.mapping).toMatchObject({ sku: 0, name: 1, retail: 2, stock: 3 });
  });

  it.each(["Tồn đầu kỳ", "Tồn nhỏ nhất", "Tồn lớn nhất", "Định mức tồn", "Giá trị tồn", "Số lượng", "SL", "KH đặt"])(
    "không coi «%s» là tồn kho",
    (label) => {
      expect(detectLayout([["Mã hàng", "Tên hàng", "Giá lẻ", label], product]).mapping.stock).toBeNull();
    },
  );

  it("có cả «Tồn kho» và «Có thể bán» thì lấy «Tồn kho»", () => {
    const rows: Cell[][] = [["Mã hàng", "Tên hàng", "Giá lẻ", "Có thể bán", "Tồn kho"], [...product, 15]];
    expect(detectLayout(rows).mapping.stock).toBe(4);
  });

  it("cột tồn kho không bị đoán thành cột giá khi file không có nhãn giá", () => {
    const rows: Cell[][] = [
      ["Mã hàng", "Tên hàng", "Tồn kho", "VAT 10%"],
      ["AV1F", "Khung vợt cầu lông Flexred", 12, 1150],
      ["AV80", "Khung vợt cầu lông Nano80", 3, 800],
    ];
    expect(detectLayout(rows).mapping).toMatchObject({ sku: 0, name: 1, stock: 2, retail: 3, wholesale: null });
  });

  it("trả tồn kho theo mã hàng: nhận 0 và số âm, ô trống thì không có số liệu, dòng trùng mã bị bỏ cả tồn kho", () => {
    const rows: Cell[][] = [
      ["Mã hàng", "Tên hàng", "Giá lẻ", "Tồn kho"],
      [" av1f ", "Khung vợt cầu lông Flexred", 1150, 12],
      ["AV80", "Khung vợt cầu lông Nano80", 800, 0],
      ["AVPTX", "Khung vợt cầu lông Phantom X-Shadow", 1800, -2],
      ["AV90", "Khung vợt cầu lông Nano90", 900, null],
      ["AV95", "Khung vợt cầu lông Nano95", 950, "Hết"],
      ["AV1F", "Khung vợt cầu lông Flexred (dòng trùng)", 1150, 99],
    ];
    const result = importRows(rows);
    expect(result.items.map((item) => item.sku)).toEqual(["AV1F", "AV80", "AVPTX", "AV90", "AV95"]);
    expect(result.stock).toEqual({ AV1F: 12, AV80: 0, AVPTX: -2 });
    expect(result.duplicateCount).toBe(1);
  });

  it("file không có cột tồn kho thì không có số liệu tồn kho nào", () => {
    expect(importRows(PROMO_SHEET).stock).toEqual({});
    expect(detectLayout(PROMO_SHEET).mapping.stock).toBeNull();
  });
});

describe("file tồn kho", () => {
  const stockRows = (rows: Cell[][]) => convertStockRows(rows, detectLayout(rows, "stock"));

  it("kiểu phần mềm bán hàng: lấy «Tồn kho», không lấy «Tồn nhỏ nhất» / «Tồn lớn nhất» / «KH đặt»", () => {
    const rows: Cell[][] = [
      ["Loại hàng", "Nhóm hàng(3 Cấp)", "Mã hàng", "Mã vạch", "Tên hàng", "Giá bán", "Giá vốn", "Tồn kho", "KH đặt", "Tồn nhỏ nhất", "Tồn lớn nhất", "ĐVT"],
      ["Hàng hóa", "Vợt", "P-AYPR285-3", "6902258696667", "Khung vợt cầu lông Aeronaut 6000 Speed", 2060000, 1400000, 24, 2, 5, 100, "Chiếc"],
      ["Hàng hóa", "Vợt", "P-AYPR287-3", "6905154065223", "Khung vợt cầu lông Aeronaut 6000 Power", 2060000, 1400000, 0, 0, 5, 100, "Chiếc"],
    ];
    expect(detectLayout(rows, "stock")).toMatchObject({ headerRow: 0, mapping: { sku: 2, name: 4, stock: 7 } });
    expect(stockRows(rows).rows).toEqual([
      { sku: "P-AYPR285-3", name: "Khung vợt cầu lông Aeronaut 6000 Speed", qty: 24 },
      { sku: "P-AYPR287-3", name: "Khung vợt cầu lông Aeronaut 6000 Power", qty: 0 },
    ]);
  });

  it("file chỉ có hai cột «Mã hàng» và «Tồn kho» vẫn nhận ra dòng tiêu đề", () => {
    const rows: Cell[][] = [["Mã hàng", "Tồn kho"], ["AV1F", 12], ["AV80", 3]];
    expect(detectLayout(rows, "stock")).toMatchObject({ headerRow: 0, mapping: { sku: 0, stock: 1 } });
    expect(stockRows(rows).rows.map((row) => [row.sku, row.qty])).toEqual([["AV1F", 12], ["AV80", 3]]);
  });

  it.each(["Số lượng", "SL", "Qty", "Cuối kỳ"])("không có chữ «tồn»: nhận cột «%s»", (label) => {
    const rows: Cell[][] = [["Mã hàng", "Tên hàng", "ĐVT", label], ["AV1F", "Khung vợt cầu lông Flexred", "Cái", 12]];
    expect(detectLayout(rows, "stock").mapping).toMatchObject({ sku: 0, name: 1, stock: 3 });
    // Khi nhập bảng giá thì cột này không được tự coi là tồn kho.
    expect(detectLayout(rows).mapping.stock).toBeNull();
  });

  it("có cả «Số lượng» và «Tồn kho» thì lấy «Tồn kho»", () => {
    const rows: Cell[][] = [["Mã hàng", "Số lượng", "Tồn kho"], ["AV1F", 5, 12]];
    expect(detectLayout(rows, "stock").mapping.stock).toBe(2);
  });

  it("dán hai cột mã hàng + số lượng không có tiêu đề: cột số duy nhất là tồn kho", () => {
    const rows = rowsFromText("P-AYPR285-3\t24\nP-AYPR287-3\t0\nAV1F\t1.250\n");
    expect(detectLayout(rows, "stock")).toMatchObject({ headerRow: null, mapping: { sku: 0, stock: 1 } });
    expect(stockRows(rows).rows.map((row) => [row.sku, row.qty])).toEqual([
      ["P-AYPR285-3", 24],
      ["P-AYPR287-3", 0],
      ["AV1F", 1250],
    ]);
  });

  it("không có tiêu đề mà có hai cột số: không đoán, để người dùng chọn cột", () => {
    const rows: Cell[][] = [
      ["P-AYPR285-3", "Khung vợt cầu lông Aeronaut 6000 Speed", 2060, 24],
      ["P-AYPR287-3", "Khung vợt cầu lông Aeronaut 6000 Power", 2060, 7],
    ];
    const layout = detectLayout(rows, "stock");
    expect(layout.mapping).toMatchObject({ sku: 0, name: 1, stock: null });
    expect(convertStockRows(rows, layout)).toEqual({ rows: [], skipped: [], mergedSkus: [] });
    // Người dùng chọn cột D:
    const chosen = convertStockRows(rows, { ...layout, mapping: { ...layout.mapping, stock: 3 } });
    expect(chosen.rows.map((row) => row.qty)).toEqual([24, 7]);
  });

  it("không có tiêu đề: cột số thứ tự và cột mã vạch không bị coi là tồn kho", () => {
    const rows: Cell[][] = [
      [1, "6902258696667", "P-AYPW039-4V", "Khung vợt cầu lông Axforce Warrior - 4U", 5],
      [2, "6905154065223", "P-AYPT243-4V", "Khung vợt cầu lông Axforce 90 Tiger Max - 4U Red", 2],
      [3, "6905154065650", "P-AYPT239-4V", "Khung vợt cầu lông Axforce 90 Loong Max - 4U Blue", 9],
    ];
    expect(detectLayout(rows, "stock").mapping).toMatchObject({ sku: 2, name: 3, stock: 4 });
  });

  it("mã nằm ở nhiều dòng thì cộng dồn; bỏ dòng tổng cộng, dòng thiếu mã và dòng ô tồn kho không phải số", () => {
    const rows: Cell[][] = [
      ["Kho", "Mã hàng", "Tên hàng", "Tồn kho"],
      ["Hà Nội", "AV1F", "Khung vợt cầu lông Flexred", 12],
      ["Hà Nội", "AV80", "Khung vợt cầu lông Nano80", 0.1],
      ["TP.HCM", "av1f", "Khung vợt cầu lông Flexred", 8],
      ["TP.HCM", "AV80", "Khung vợt cầu lông Nano80", 0.2],
      ["TP.HCM", "AVPTX", "Khung vợt cầu lông Phantom X-Shadow", "Hết"],
      ["TP.HCM", null, "Hàng chưa có mã", 4],
      [null, "Tổng cộng", null, 24],
      [null, null, null, null],
    ];
    const result = stockRows(rows);
    expect(result.rows).toEqual([
      { sku: "AV1F", name: "Khung vợt cầu lông Flexred", qty: 20 },
      { sku: "AV80", name: "Khung vợt cầu lông Nano80", qty: 0.3 },
    ]);
    expect(result.mergedSkus).toEqual(["AV1F", "AV80"]);
    expect(result.skipped.map((row) => [row.row, row.reason])).toEqual([
      [6, "no_stock"],
      [7, "no_sku"],
      [8, "total"],
    ]);
  });

  it("đọc số dán kiểu Việt Nam: «1.250» là 1250, «2,5» là 2,5; «-3», «(3)» và «−3» là số âm", () => {
    const rows = rowsFromText("Mã hàng\tTồn kho\nA1\t1.250\nA2\t2,5\nA3\t-3\nA4\t(3)\nA5\t−3\nA6\t0\nA7\t12 cái\n");
    const result = stockRows(rows);
    expect(result.rows.map((row) => [row.sku, row.qty])).toEqual([
      ["A1", 1250],
      ["A2", 2.5],
      ["A3", -3],
      ["A4", -3],
      ["A5", -3],
      ["A6", 0],
    ]);
    expect(result.skipped.map((row) => row.reason)).toEqual(["no_stock"]);
  });

  it("chọn sẵn sheet có cột mã hàng và cột tồn kho", () => {
    const sheets = [
      { name: "Bảng giá", rows: PROMO_SHEET },
      { name: "Tồn kho", rows: [["Mã hàng", "Tồn kho"], ["AV1F", 12]] as Cell[][] },
    ];
    expect(defaultSheetIndex(sheets, "stock")).toBe(1);
    expect(defaultSheetIndex(sheets)).toBe(0);
    expect(defaultSheetIndex([sheets[0]], "stock")).toBe(0);
  });

  it("đọc file .xlsx tồn kho từ đầu tới cuối", async () => {
    const sheets = await readWorkbook(
      toXlsx([{ name: "TonKho", rows: [["Mã hàng", "Tên hàng", "ĐVT", "Tồn cuối kỳ"], ["P-AYPR285-3", "Khung vợt Aeronaut 6000 Speed", "Chiếc", 24]] }]),
    );
    expect(stockRows(sheets[0].rows).rows).toEqual([{ sku: "P-AYPR285-3", name: "Khung vợt Aeronaut 6000 Speed", qty: 24 }]);
  });
});
