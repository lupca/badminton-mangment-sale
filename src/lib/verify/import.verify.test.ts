// Kiểm thử độc lập: từ chữ trong ô Excel / văn bản dán ra con số (giá VND, tồn kho, số lượng đặt) và cách hiển thị số.
// Giá trị mong đợi tính tay hoặc tính chính xác bằng phân số (BigInt), không lấy lại từ code của ứng dụng.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  convertRows,
  convertStockRows,
  detectLayout,
  detectPriceUnit,
  parseNumber,
  readWorkbook,
  rowsFromText,
  type Cell,
  type ColumnMapping,
  type ConvertOptions,
} from "../excel";
import { formatNumber, formatQty, formatVND, normalizeSku, parseDecimal, parseInteger } from "../format";
import { parseQty, parseSkuQty } from "../paste";
import { stockQty } from "../stock";

// ───────────────────────── Công cụ ─────────────────────────

/** PRNG có hạt giống (mulberry32) để lần chạy nào cũng ra cùng bộ dữ liệu. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  return { next, int, pick };
}

/** Số hữu tỉ n/d (d > 0). */
type Q = { n: bigint; d: bigint };
const q = (n: bigint | number, d: bigint | number = 1n): Q => ({ n: BigInt(n), d: BigInt(d) });
const mul = (a: Q, b: Q): Q => ({ n: a.n * b.n, d: a.d * b.d });
/** Phần lẻ đúng bằng 0,5 (ca làm tròn nhạy với sai số số thực). */
const isHalf = (x: Q) => (2n * x.n) % (2n * x.d) === x.d;
/** "2022.545" → 2022545/1000 */
function qFromDecimal(text: string): Q {
  const [int, frac = ""] = text.split(".");
  return { n: BigInt(int + frac), d: 10n ** BigInt(frac.length) };
}
/** Làm tròn nửa lên (x ≥ 0), giống làm tròn thông thường / hàm ROUND của Excel với số dương. */
function roundHalfUp(x: Q): number {
  return Number((2n * x.n + x.d) / (2n * x.d));
}

/** 1234567 → "1.234.567" với dấu ngăn tùy chọn. */
function group(int: string, sep: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

const NBSP = " ";

const HEADER = ["Mã hàng", "Tên hàng", "Giá lẻ", "Giá sỉ"];
const MAP4: ColumnMapping = { sku: 0, name: 1, retail: 2, wholesale: 3, unit: null, note: null, stock: null };

function opts(over: Partial<ConvertOptions> = {}): ConvertOptions {
  return {
    headerRow: 0,
    mapping: MAP4,
    priceUnit: "dong",
    vatFrom10To8: false,
    wholesaleDiscountPercent: null,
    ...over,
  };
}

// ───────────────────────── 1. parseNumber: mọi cách Excel Việt Nam hiển thị một số nguyên ─────────────────────────

describe("parseNumber — số nguyên viết theo nhiều kiểu (ngẫu nhiên, 5000 ca)", () => {
  it("mọi kiểu hiển thị của cùng một số nguyên đều đọc ra đúng số đó", () => {
    const r = prng(1);
    const failures: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const digits = r.int(1, 10);
      const n = digits === 1 ? r.int(1, 9) : r.int(10 ** (digits - 1), 10 ** digits - 1);
      const s = String(n);
      const forms = [
        s,
        group(s, "."),
        group(s, ","),
        group(s, " "),
        group(s, NBSP),
        `${group(s, ".")} đ`,
        `${group(s, ".")}đ`,
        `${group(s, ".")} ₫`,
        `${group(s, ",")} VND`,
        `${group(s, ".")} VNĐ`,
        `${group(s, ".")},00`,
        `${group(s, ",")}.00`,
        `  ${group(s, ".")}  `,
      ];
      for (const f of forms) {
        const got = parseNumber(f);
        if (got !== n) failures.push(`${JSON.stringify(f)} → ${got} (mong đợi ${n})`);
      }
      if (parseNumber(n) !== n) failures.push(`ô số ${n}`);
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it("số thập phân không mơ hồ (phần nguyên ≥ 1000 hoặc số chữ số lẻ ≠ 3) đọc đúng ở cả kiểu Việt lẫn kiểu Mỹ", () => {
    const r = prng(2);
    const failures: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const int = String(r.int(0, 99_999));
      const fracLen = r.int(1, 6);
      const frac = String(r.int(0, 10 ** fracLen - 1)).padStart(fracLen, "0");
      const exact = Number(`${int}.${frac}`);
      const forms: string[] = [];
      // Dạng có ngăn nghìn + phần lẻ: không bao giờ mơ hồ. (Đúng 3 số lẻ: xem ca lỗi riêng bên dưới.)
      if (int.length > 3 && fracLen !== 3) forms.push(`${group(int, ".")},${frac}`, `${group(int, ",")}.${frac}`);
      // Dạng không ngăn nghìn: chỉ mơ hồ khi phần nguyên ≤ 3 chữ số và phần lẻ đúng 3 chữ số.
      if (!(int.length <= 3 && fracLen === 3)) forms.push(`${int},${frac}`, `${int}.${frac}`);
      for (const f of forms) {
        const got = parseNumber(f);
        if (got == null || Math.abs(got - exact) > 1e-9) failures.push(`${f} → ${got} (mong đợi ${exact})`);
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  // LỖI: "2.022,545" (ngăn nghìn bằng chấm + đúng 3 số lẻ sau phẩy, đúng kiểu Excel VN định dạng #,##0.000) bị đọc là
  // 2022545 vì biểu thức «ngăn nghìn» /^\d{1,3}([.,]\d{3})+$/ chấp nhận trộn chấm và phẩy. Kể cả khi cột đã biết dấu
  // thập phân là phẩy. Tương tự "2,022.545" kiểu Mỹ. Với 2 hoặc 4 số lẻ thì đọc đúng ("2.022,54" → 2022,54).
  it("[đã sửa] «2.022,545» = 2022,545 (không phải 2.022.545)", () => {
    expect(parseNumber("2.022,545")).toBeCloseTo(2022.545, 9);
  });
  it("[đã sửa] «2.022,545» trong cột đã biết dấu thập phân là phẩy = 2022,545", () => {
    expect(parseNumber("2.022,545", ",")).toBeCloseTo(2022.545, 9);
  });
  it("[đã sửa] «2,022.545» kiểu Mỹ = 2022,545", () => {
    expect(parseNumber("2,022.545")).toBeCloseTo(2022.545, 9);
  });

  it("mơ hồ «785,455» / «1.500»: không có ngữ cảnh → hàng nghìn; cột đã lộ dấu thập phân → số lẻ", () => {
    expect(parseNumber("1.500")).toBe(1500);
    expect(parseNumber("1,500")).toBe(1500);
    expect(parseNumber("785,455")).toBe(785455);
    expect(parseNumber("785,455", ",")).toBeCloseTo(785.455, 9);
    expect(parseNumber("1.500", ",")).toBe(1500); // dấu chấm vẫn là ngăn nghìn khi cột dùng phẩy thập phân
    expect(parseNumber("1.500", ".")).toBe(1.5);
    expect(parseNumber("1,500", ".")).toBe(1500);
  });

  it.each([["-"], ["x"], [""], ["   "], ["Liên hệ"], ["1.00.000"], ["1,5,0"], ["--5"], ["1e3"], ["đ 1.500"], ["12 cái"]])(
    "không phải số: %j → null",
    (text) => {
      expect(parseNumber(text)).toBeNull();
    },
  );

  it("số âm dạng chữ không phải giá; ô số NaN/Infinity → null", () => {
    expect(parseNumber("-1.500")).toBeNull();
    expect(parseNumber(Number.NaN)).toBeNull();
    expect(parseNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseNumber(-5)).toBe(-5);
  });
});

// ───────────────────────── 2. convertRows: quy đổi giá ra VND (ngẫu nhiên, đối chiếu phân số chính xác) ─────────────────────────

type Style = "number" | "vn" | "vnGrouped" | "us";

/** Hiển thị một số thập phân (chuỗi "int.frac") theo một kiểu ô. */
function renderPrice(dec: string, style: Style): Cell {
  const [int, frac] = dec.split(".");
  switch (style) {
    case "number":
      return Number(dec);
    case "vn":
      return frac ? `${int},${frac}` : int;
    case "vnGrouped":
      return frac ? `${group(int, ".")},${frac}` : group(int, ".");
    case "us":
      return frac ? `${group(int, ",")}.${frac}` : group(int, ",");
  }
}

interface Case {
  rows: Cell[][];
  options: ConvertOptions;
  expected: Array<{ sku: string; retail: number; wholesale: number; retailHalf: boolean; wholesaleHalf: boolean }>;
}

/**
 * Sinh một bảng giá ngẫu nhiên. Mỗi cột một kiểu hiển thị (như khi dán từ Excel); mỗi cột có ít nhất một ô lộ rõ
 * dấu thập phân (phần nguyên ≥ 1000 có phần lẻ) để tránh trường hợp mơ hồ đã kiểm riêng ở trên.
 */
function genCase(r: ReturnType<typeof prng>, unit: "thousand" | "dong", integersOnly: boolean, includeMixed3: boolean): Case {
  const vat = r.next() < 0.5;
  const discount = r.next() < 0.3 ? null : r.int(0, 99);
  const retailStyle = r.pick<Style>(["number", "vn", "vnGrouped", "us"]);
  const wholesaleStyle = r.pick<Style>(["number", "vn", "vnGrouped", "us"]);
  const count = r.int(1, 12);
  const rows: Cell[][] = [HEADER];
  const expected: Case["expected"] = [];
  const mult = unit === "thousand" ? 1000n : 1n;
  const genDec = (style: Style): string => {
    if (unit === "dong") {
      const int = String(r.int(1000, 50_000_000));
      return integersOnly ? int : `${int}.${String(r.int(0, 99)).padStart(2, "0")}`;
    }
    const int = String(r.int(1000, 15_000));
    if (integersOnly) return int;
    let fracLen = r.int(1, 6);
    // Ca «2.022,545» (ngăn nghìn + đúng 3 số lẻ) là lỗi đã kiểm riêng; ở đây tránh để thấy các lệch khác.
    if (fracLen === 3 && !includeMixed3 && (style === "vnGrouped" || style === "us")) fracLen = 2;
    return `${int}.${String(r.int(1, 10 ** fracLen - 1)).padStart(fracLen, "0")}`;
  };
  for (let i = 0; i < count; i++) {
    const sku = `P-T${String(i).padStart(3, "0")}`;
    const retailDec = genDec(retailStyle);
    const hasWholesale = r.next() < 0.5;
    const wholesaleDec = hasWholesale ? genDec(wholesaleStyle) : null;
    rows.push([sku, `Hàng ${i}`, renderPrice(retailDec, retailStyle), wholesaleDec ? renderPrice(wholesaleDec, wholesaleStyle) : null]);
    let retailQ = mul(qFromDecimal(retailDec), q(mult));
    if (vat) retailQ = mul(retailQ, q(108, 110));
    const wholesale = wholesaleDec
      ? roundHalfUp(mul(qFromDecimal(wholesaleDec), q(mult)))
      : roundHalfUp(mul(retailQ, q(100 - (discount ?? 0), 100)));
    const wholesaleQ = wholesaleDec ? mul(qFromDecimal(wholesaleDec), q(mult)) : mul(retailQ, q(100 - (discount ?? 0), 100));
    expected.push({ sku, retail: roundHalfUp(retailQ), wholesale, retailHalf: isHalf(retailQ), wholesaleHalf: isHalf(wholesaleQ) });
  }
  return {
    rows,
    options: opts({ priceUnit: unit, vatFrom10To8: vat, wholesaleDiscountPercent: discount }),
    expected,
  };
}

/** Trả về các ca lệch; `half` = các ca chỉ lệch 1 đồng đúng ở giá trị ,5 (làm tròn xuống thay vì lên). */
function runCases(seed: number, n: number, unit: "thousand" | "dong", integersOnly: boolean, includeMixed3 = false) {
  const r = prng(seed);
  const failures: string[] = [];
  const half: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = genCase(r, unit, integersOnly, includeMixed3);
    const got = convertRows(c.rows, c.options);
    c.expected.forEach((e, k) => {
      const item = got.items.find((x) => x.sku === e.sku);
      const row = c.rows[k + 1];
      if (!item) failures.push(`${e.sku} thiếu: ${JSON.stringify(row)}`);
      else if (item.retailPrice !== e.retail || item.wholesalePrice !== e.wholesale) {
        const onlyHalf =
          (item.retailPrice === e.retail || (e.retailHalf && item.retailPrice === e.retail - 1)) &&
          (item.wholesalePrice === e.wholesale || (e.wholesaleHalf && item.wholesalePrice === e.wholesale - 1));
        (onlyHalf ? half : failures).push(
          `${JSON.stringify(row.slice(2))} vat=${c.options.vatFrom10To8} ck=${c.options.wholesaleDiscountPercent} unit=${unit}: ` +
            `got ${item.retailPrice}/${item.wholesalePrice}, expected ${e.retail}/${e.wholesale}`,
        );
      }
    });
  }
  return { failures, half };
}

describe("convertRows — giá ra VND (ngẫu nhiên, đối chiếu phân số chính xác)", () => {
  // Mỗi bộ 2000 bảng × 1..12 dòng. Chỉ chấp nhận lệch ở ca giá đúng ,5 đồng (lỗi làm tròn số thực, kiểm riêng bên dưới).
  it("nghìn đồng, có số lẻ, mọi kiểu ô, VAT bật/tắt, chiết khấu sỉ", () => {
    const { failures, half } = runCases(10, 2000, "thousand", false);
    expect(failures.slice(0, 10)).toEqual([]);
    expect(half.length).toBeLessThan(30); // ~10 ca trên ~13.000 giá, đều đúng ở ,5 đồng
  });

  it("đồng, có 2 số lẻ, mọi kiểu ô", () => {
    const { failures, half } = runCases(11, 2000, "dong", false);
    expect(failures.slice(0, 10)).toEqual([]);
    expect(half.length).toBeLessThan(20);
  });

  it("nghìn đồng, giá nguyên", () => {
    const { failures, half } = runCases(12, 2000, "thousand", true);
    expect(failures).toEqual([]);
    expect(half).toEqual([]);
  });

  it("đồng, giá nguyên: khớp cả ở các ca ra đúng ,5 đồng", () => {
    const { failures, half } = runCases(13, 2000, "dong", true);
    expect(failures).toEqual([]);
  });

  it("[đã sửa] cột nghìn đồng định dạng #,##0.000 (ngăn nghìn + 3 số lẻ): mọi giá phải đúng", () => {
    expect(runCases(14, 300, "thousand", false, true).failures.slice(0, 5)).toEqual([]);
  });

  // LỖI: dán từ Excel VN cột giá nghìn đồng định dạng #,##0.000. Đơn vị tự nhận là nghìn (đúng), nhưng giá ≥ 1000 nghìn
  // bị nhân 1000 lần nữa: 2.022,545 → 2.022.545.000 đ, trong khi 785,455 → 785.455 đ (đúng).
  it("[đã sửa] dán «2.022,545 / 785,455 / 471,273» (nghìn đồng) → 2.022.545 / 785.455 / 471.273 đ", () => {
    const rows = rowsFromText(
      "Mã hàng\tTên hàng\tGiá lẻ\tGiá sỉ\nP-AYPR285-3\tAeronaut 6000\t2.022,545\t1.415,782\nP-AYPH044-3\tA880T\t785,455\t549,818\nP-AYPT315-2\tAxforce 9\t471,273\t329,891",
    );
    const layout = detectLayout(rows);
    const res = convertRows(rows, { ...layout, vatFrom10To8: false, wholesaleDiscountPercent: null });
    expect(res.items.map((i) => [i.sku, i.retailPrice, i.wholesalePrice])).toEqual([
      ["P-AYPR285-3", 2_022_545, 1_415_782],
      ["P-AYPH044-3", 785_455, 549_818],
      ["P-AYPT315-2", 471_273, 329_891],
    ]);
  });

  // LỖI NHỎ (1 đồng): giá sỉ = giá lẻ × (100 − CK)/100 tính bằng số thực; 329.090 × 0,35 = 115.181,5 nhưng máy ra
  // 115.181,49999… → làm tròn xuống 115.181 (Excel ROUND ra 115.182). Tương tự VAT: 12.882.938,75 ÷ 1,1 × 1,08 = 12.648.703,5.
  it("[đã sửa] 329.090 đ, CK 65% → giá sỉ 115.182 đ", () => {
    const res = convertRows([HEADER, ["A-1", "x", 329_090, null]], opts({ wholesaleDiscountPercent: 65 }));
    expect(res.items[0].wholesalePrice).toBe(115_182);
  });
  it("[đã sửa] 12.882.938,75 đ, VAT 10→8 → 12.648.704 đ", () => {
    const res = convertRows([HEADER, ["A-1", "x", "12882938,75", null]], opts({ vatFrom10To8: true }));
    expect(res.items[0].retailPrice).toBe(12_648_704);
  });

  // Tính tay
  it("ví dụ tính tay: 2060 nghìn, VAT 10→8, CK 30%", () => {
    // 2060 / 1,1 × 1,08 = 2022,5454… nghìn → 2.022.545 đ; giá sỉ = 2022,5454… × 0,7 = 1415,7818… → 1.415.782 đ
    const res = convertRows([HEADER, ["P-AYPR285-3", "Aeronaut 6000", 2060, null]], opts({ priceUnit: "thousand", vatFrom10To8: true, wholesaleDiscountPercent: 30 }));
    expect(res.items[0]).toMatchObject({ retailPrice: 2_022_545, wholesalePrice: 1_415_782 });
  });

  it("ví dụ tính tay: giá sỉ có sẵn trong file không bị quy đổi VAT và không bị trừ chiết khấu", () => {
    const res = convertRows([HEADER, ["A-1", "x", "2.060", "1.415,78"]], opts({ priceUnit: "thousand", vatFrom10To8: true, wholesaleDiscountPercent: 30 }));
    expect(res.items[0]).toMatchObject({ retailPrice: 2_022_545, wholesalePrice: 1_415_780 });
  });

  it("chỉ có giá sỉ: giá lẻ = giá sỉ, không áp VAT", () => {
    const res = convertRows([HEADER, ["A-1", "x", null, 1000]], opts({ priceUnit: "thousand", vatFrom10To8: true, wholesaleDiscountPercent: 30 }));
    expect(res.items[0]).toMatchObject({ retailPrice: 1_000_000, wholesalePrice: 1_000_000 });
  });

  it("chiết khấu 0% → giá sỉ = giá lẻ; CK null → giá sỉ = giá lẻ; CK ngoài khoảng bị kẹp về 0..100", () => {
    const rows = [HEADER, ["A-1", "x", 1000, null]];
    expect(convertRows(rows, opts({ wholesaleDiscountPercent: 0 })).items[0].wholesalePrice).toBe(1000);
    expect(convertRows(rows, opts({ wholesaleDiscountPercent: null })).items[0].wholesalePrice).toBe(1000);
    expect(convertRows(rows, opts({ wholesaleDiscountPercent: -10 })).items[0].wholesalePrice).toBe(1000);
    expect(convertRows(rows, opts({ wholesaleDiscountPercent: 150 })).items[0].wholesalePrice).toBe(0);
    expect(convertRows(rows, opts({ wholesaleDiscountPercent: 12.5 })).items[0].wholesalePrice).toBe(875);
  });

  it("giá 0, âm, «-», «x», «Liên hệ» không phải giá: dòng bị bỏ với lý do no_price", () => {
    const rows: Cell[][] = [HEADER, ["A-1", "x", 0, null], ["A-2", "x", -5, null], ["A-3", "x", "-", "x"], ["A-4", "x", "Liên hệ", ""], ["A-5", "x", "-1.500", null]];
    const res = convertRows(rows, opts());
    expect(res.items).toEqual([]);
    expect(res.skipped.map((s) => [s.row, s.reason])).toEqual([
      [2, "no_price"],
      [3, "no_price"],
      [4, "no_price"],
      [5, "no_price"],
      [6, "no_price"],
    ]);
  });
});

// ───────────────────────── 3. Đơn vị giá: nghìn đồng hay đồng ─────────────────────────

describe("detectPriceUnit — ngưỡng", () => {
  const unitOf = (prices: Cell[]) =>
    detectPriceUnit([["Mã", "Giá"], ...prices.map((p, i): Cell[] => [`A-${i}`, p])], 0, { ...MAP4, retail: 1, wholesale: null });

  it("giá điển hình 99.999 → nghìn; 100.000 → đồng", () => {
    expect(unitOf([99_999])).toBe("thousand");
    expect(unitOf([100_000])).toBe("dong");
  });
  it("giá tròn nghìn: điển hình 10.000 → đồng; 9.000 → nghìn", () => {
    expect(unitOf([10_000, 25_000, 65_000])).toBe("dong");
    expect(unitOf([9_000, 9_000, 5_000])).toBe("thousand");
  });
  it("giá thật của khách (nghìn đồng, có số lẻ) → nghìn", () => {
    expect(unitOf([800, 2022.5454545454545, 1415.78, 5900])).toBe("thousand");
  });
  it("chữ «2.022,545» và «1.420» → nghìn", () => {
    expect(unitOf(["2.022,545", "1.420", "800"])).toBe("thousand");
  });
  it("trung vị: số dòng chẵn lấy phần tử giữa phía trên", () => {
    expect(unitOf([1000, 200_000])).toBe("dong");
  });

  // NGHI VẤN: bảng phụ kiện ghi bằng đồng có một giá không tròn nghìn (12.500 đ) → cả file bị hiểu là nghìn đồng,
  // mọi giá nhân 1000 (45.000 đ thành 45.000.000 đ). Người dùng phải tự sửa ô đơn vị.
  it.fails("[nghi vấn] bảng phụ kiện bằng đồng có giá 12.500 đ vẫn nên là đồng", () => {
    expect(unitOf([12_500, 45_000, 65_000, 25_000])).toBe("dong");
  });
  // NGHI VẤN: phụ kiện rẻ (cuốn cán 5.000–9.000 đ) → giá điển hình < 10.000 → coi là nghìn đồng.
  it("[giới hạn đã biết] bảng phụ kiện toàn giá < 10.000 đ bị coi là nghìn đồng", () => {
    expect(unitOf([5_000, 8_000, 9_000])).toBe("thousand");
  });
});

// ───────────────────────── 4. Mã hàng: chuẩn hóa, trùng mã, dòng bị bỏ ─────────────────────────

describe("normalizeSku", () => {
  it.each([
    [" p-aypr285-3 ", "P-AYPR285-3"],
    [`P-AYPR285-3${NBSP}`, "P-AYPR285-3"],
    ["P - AYPR 285-3", "P-AYPR285-3"],
    ["\tav1f\n", "AV1F"],
    [6902258696667, "6902258696667"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeSku(input)).toBe(expected);
  });

  // NGHI VẤN: ký tự vô hình (zero-width space, BOM) hay đi kèm khi copy mã từ web/Zalo — không bị bỏ nên mã không khớp.
  it.fails("[nghi vấn] bỏ ký tự vô hình U+200B / U+FEFF", () => {
    expect(normalizeSku("​P-AYPR285-3")).toBe("P-AYPR285-3");
    expect(normalizeSku("﻿P-AYPR285-3")).toBe("P-AYPR285-3");
  });
  // NGHI VẤN: dấu ' đầu ô (Excel ép kiểu chữ) xuất hiện trong CSV/văn bản → mã thành "'P-AYPR285-3".
  it.fails("[nghi vấn] bỏ dấu nháy ' đầu mã", () => {
    expect(normalizeSku("'P-AYPR285-3")).toBe("P-AYPR285-3");
  });
});

describe("convertRows — trùng mã và dòng bị bỏ", () => {
  it("mã trùng sau chuẩn hóa (hoa/thường, dấu cách, NBSP): giữ dòng đầu, đếm trùng, báo đúng số dòng Excel", () => {
    const rows: Cell[][] = [
      ["Bảng giá tháng 11", null, null, null],
      HEADER,
      ["P-AYPR285-3", "Đầu", 2060, 1400],
      [" p-aypr285-3", "Trùng 1", 9999, 9999],
      [`P-AYPR285-3${NBSP}`, "Trùng 2", 8888, null],
      [null, "Không mã", 100, 100],
      ["A-2", "Không giá", null, null],
      ["Tổng cộng", null, 99999, null],
      ["TỔNG:", null, 1, null],
      ["Grand Total", null, 1, null],
      [null, null, null, null],
      ["A-2", "Có giá ở dòng dưới", 500, null],
    ];
    const res = convertRows(rows, opts({ headerRow: 1 }));
    expect(res.items.map((i) => [i.sku, i.name, i.retailPrice, i.wholesalePrice])).toEqual([
      ["P-AYPR285-3", "Đầu", 2060, 1400],
      ["A-2", "Có giá ở dòng dưới", 500, 500],
    ]);
    expect(res.duplicateCount).toBe(2);
    expect(res.skipped.map((s) => [s.row, s.reason])).toEqual([
      [4, "duplicate"],
      [5, "duplicate"],
      [6, "no_sku"],
      [7, "no_price"],
      [8, "total"],
      [9, "total"],
      [10, "total"],
    ]);
  });

  it("tồn kho trong bảng giá: dòng trùng mã bị bỏ cả tồn kho (không cộng dồn), khác với file tồn kho", () => {
    const rows: Cell[][] = [
      ["Mã hàng", "Giá lẻ", "Tồn kho"],
      ["A-1", 100, 5],
      ["A-1", 100, 7],
    ];
    const res = convertRows(rows, { ...detectLayout(rows), vatFrom10To8: false, wholesaleDiscountPercent: null });
    expect(res.stock).toEqual({ "A-1": 5 });
  });
});

// ───────────────────────── 5. File tồn kho: số lượng, cộng dồn ─────────────────────────

const STOCK_MAP: ColumnMapping = { sku: 0, name: 1, retail: null, wholesale: null, unit: null, note: null, stock: 2 };

describe("convertStockRows — số lượng", () => {
  it.each<[Cell, number | null]>([
    [5, 5],
    [0, 0],
    [-3, -3],
    [-0, 0],
    [2.5, 2.5],
    [1.23456, 1.235],
    ["5", 5],
    ["-5", -5],
    ["- 5", -5],
    ["−5", -5],
    ["–5", -5],
    ["(5)", -5],
    ["( 12 )", -12],
    ["1.250", 1250],
    ["1,250", 1250],
    ["2,5", 2.5],
    ["1.250,5", 1250.5],
    ["-1.250", -1250],
    ["0", 0],
    ["x", null],
    ["Hết", null],
    ["12 cái", null],
    ["", null],
    [null, null],
  ])("ô %j → %j", (cell, expected) => {
    const res = convertStockRows([["Mã hàng", "Tên", "Tồn kho"], ["A-1", "t", cell]], { headerRow: 0, mapping: STOCK_MAP });
    if (expected == null) {
      expect(res.rows).toEqual([]);
      expect(res.skipped.map((s) => s.reason)).toEqual(["no_stock"]);
    } else {
      expect(res.rows).toEqual([{ sku: "A-1", name: "t", qty: expected }]);
    }
  });

  // NGHI VẤN: định dạng Accounting của Excel hiển thị số 0 thành «-». Dán từ Excel thì ô tồn kho = 0 thành «-»
  // → dòng bị bỏ (no_stock) → ở chế độ «cập nhật theo mã» số tồn cũ (vd 12) vẫn giữ nguyên dù kho đã hết.
  it("[đã sửa] «-» (số 0 kiểu kế toán) nên là 0", () => {
    const res = convertStockRows([["Mã hàng", "Tên", "Tồn kho"], ["A-1", "t", "-"]], { headerRow: 0, mapping: STOCK_MAP });
    expect(res.rows).toEqual([{ sku: "A-1", name: "t", qty: 0 }]);
  });

  it("cộng dồn ngẫu nhiên: 2000 file, mã lặp nhiều dòng với biến thể hoa/thường/dấu cách, số âm và số lẻ", () => {
    const r = prng(42);
    const failures: string[] = [];
    for (let t = 0; t < 2000; t++) {
      const skus = Array.from({ length: r.int(1, 6) }, (_, i) => `SKU-${i}${r.pick(["A", "B", ""])}`);
      const rows: Cell[][] = [["Mã hàng", "Tên", "Tồn kho"]];
      const expected = new Map<string, bigint>(); // phần nghìn
      const order: string[] = [];
      const counts = new Map<string, number>();
      for (let k = 0; k < r.int(1, 15); k++) {
        const sku = r.pick(skus);
        const milli = BigInt(r.int(-50_000, 2_000_000)) * (r.next() < 0.7 ? 1000n : 1n);
        const abs = milli < 0n ? -milli : milli;
        const int = String(abs / 1000n);
        const frac = String(abs % 1000n).padStart(3, "0").replace(/0+$/, "");
        const neg = milli < 0n;
        // Kiểu ô: số thật, chữ kiểu Việt (ngăn nghìn chỉ khi không có phần lẻ — tránh ca mơ hồ), kiểu kế toán (n).
        const style = r.pick(["number", "vn", "paren"]);
        let cell: Cell;
        if (style === "number" || (frac && frac.length === 3 && int.length <= 3)) cell = Number(milli) / 1000;
        else {
          const body = frac ? `${int},${frac}` : group(int, ".");
          cell = neg ? (style === "paren" ? `(${body})` : `-${body}`) : body;
        }
        const variant = r.pick([sku, sku.toLowerCase(), ` ${sku} `, sku.replace("-", " - ")]);
        rows.push([variant, "t", cell]);
        if (!expected.has(sku)) order.push(sku);
        expected.set(sku, (expected.get(sku) ?? 0n) + milli);
        counts.set(sku, (counts.get(sku) ?? 0) + 1);
      }
      // Cột có ô "2,5" cho biết dấu thập phân là phẩy → "1.250" vẫn là 1250. Không có ô kiểu Mỹ nên không mơ hồ.
      const res = convertStockRows(rows, { headerRow: 0, mapping: STOCK_MAP });
      const got = res.rows.map((x) => [x.sku, x.qty]);
      const want = order.map((s) => [s, Number(expected.get(s)!) / 1000]);
      // Thứ tự của mergedSkus không được hứa hẹn → so như tập hợp.
      const merged = order.filter((s) => counts.get(s)! > 1).sort();
      if (JSON.stringify(got) !== JSON.stringify(want) || JSON.stringify([...res.mergedSkus].sort()) !== JSON.stringify(merged))
        failures.push(`${JSON.stringify(rows.slice(1))}\n got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("dán hai cột mã + số lượng (không tiêu đề) qua rowsFromText → nhận cột số là tồn kho", () => {
    const rows = rowsFromText("P-AYPR285-3\t12\nAV1F\t1.250\np-aypr285-3\t-2\nTổng cộng\t1.260");
    const layout = detectLayout(rows, "stock");
    expect(layout.mapping.sku).toBe(0);
    expect(layout.mapping.stock).toBe(1);
    const res = convertStockRows(rows, layout);
    expect(res.rows).toEqual([
      { sku: "P-AYPR285-3", name: "", qty: 10 },
      { sku: "AV1F", name: "", qty: 1250 },
    ]);
    expect(res.mergedSkus).toEqual(["P-AYPR285-3"]);
    expect(res.skipped.map((s) => [s.row, s.reason])).toEqual([[4, "total"]]);
  });

  it("stockQty: làm tròn 3 số lẻ, -0 → 0, không phải số → null", () => {
    expect(stockQty(1.0005)).toBe(1.001);
    expect(stockQty(-0.0001)).toBe(0);
    expect(Object.is(stockQty(-0.0001), 0)).toBe(true);
    expect(stockQty("5")).toBeNull();
    expect(stockQty(Number.NaN)).toBeNull();
  });
});

// ───────────────────────── 6. Dán «mã + số lượng» khi tạo đơn ─────────────────────────

describe("parseSkuQty — dán danh sách đặt hàng", () => {
  it("tab, dấu phẩy, nhiều dấu cách, chấm phẩy, nhãn tiếng Việt", () => {
    const text = [
      "P-AYPR285-3\t2",
      "AV1F, 3",
      "P-AYPT307-4    4",
      "AVQ1;5",
      "P-AYPM444-3 Khung vợt Aeronaut 4000C SL 6",
      "AVXT1200 7 cái",
      "Mã hàng\tSố lượng",
      "Tổng cộng\t27",
    ].join("\n");
    const res = parseSkuQty(text);
    expect(res.rows).toEqual([
      { sku: "P-AYPR285-3", qty: 2 },
      { sku: "AV1F", qty: 3 },
      { sku: "P-AYPT307-4", qty: 4 },
      { sku: "AVQ1", qty: 5 },
      { sku: "P-AYPM444-3", qty: 6 },
      { sku: "AVXT1200", qty: 7 },
    ]);
    expect(res.skipped).toEqual(["Mã hàng\tSố lượng", "Tổng cộng\t27"]);
  });

  it("parseQty ngẫu nhiên: số nguyên 1..10^7 viết thường, ngăn nghìn chấm/phẩy, có ,0/.00", () => {
    const r = prng(7);
    for (let i = 0; i < 3000; i++) {
      const n = r.int(1, 10_000_000);
      const s = String(n);
      for (const f of [s, group(s, "."), group(s, ","), `${s}.0`, `${s},00`]) expect(parseQty(f), f).toBe(n);
    }
  });

  // NGHI VẤN (khả năng cao là lỗi): dán một dòng bảng giá ghi theo nghìn đồng (như file khách gửi) mà không có cột
  // số lượng → ứng dụng lấy giá lẻ 800 làm số lượng đặt. Ứng dụng chỉ loại được giá ≥ 100.000 (giá ghi bằng đồng).
  it.fails("[lỗi] dòng bảng giá nghìn đồng, không có số lượng → phải bị bỏ, không lấy giá 800 làm số lượng", () => {
    const row = "P-AYPH044-3\tKhung vợt cầu lông A880T\t800\t785,4545455\t549,8181818";
    expect(parseSkuQty(row)).toEqual({ rows: [], skipped: [row] });
  });
  it("[lỗi, minh họa] cùng dòng đó hiện ra số lượng 800", () => {
    expect(parseSkuQty("P-AYPH044-3\tKhung vợt cầu lông A880T\t800\t785,4545455\t549,8181818").rows).toEqual([
      { sku: "P-AYPH044-3", qty: 800 },
    ]);
  });

  // NGHI VẤN: gõ tay mã + tên hàng mà không ghi số lượng: tài liệu nói «chỉ có mã hàng → số lượng 1»; có tên thì
  // số cuối trong tên (6000) bị lấy làm số lượng.
  it("[nghi vấn, minh họa] «P-AYPR285-3 Aeronaut 6000» → số lượng 6000", () => {
    expect(parseSkuQty("P-AYPR285-3 Aeronaut 6000").rows).toEqual([{ sku: "P-AYPR285-3", qty: 6000 }]);
  });

  // NGHI VẤN: kiểu gõ «x2», «: 2» rất hay gặp trong tin nhắn Zalo.
  it.fails("[nghi vấn] «P-AYPR285-3 x2» → 2", () => {
    expect(parseSkuQty("P-AYPR285-3 x2").rows).toEqual([{ sku: "P-AYPR285-3", qty: 2 }]);
  });
  it.fails("[nghi vấn] «P-AYPR285-3: 2» → mã P-AYPR285-3 (không dính dấu hai chấm)", () => {
    expect(parseSkuQty("P-AYPR285-3: 2").rows).toEqual([{ sku: "P-AYPR285-3", qty: 2 }]);
  });
});

// ───────────────────────── 7. Hiển thị và ô nhập số ─────────────────────────

describe("formatVND / formatQty / formatNumber", () => {
  it.each<[number, string]>([
    [0, "0 đ"],
    [1, "1 đ"],
    [999, "999 đ"],
    [1000, "1.000 đ"],
    [1_415_782, "1.415.782 đ"],
    [1_415_781.5, "1.415.782 đ"],
    [-1_500_000, "-1.500.000 đ"],
    [9_007_199_254_740_991, "9.007.199.254.740.991 đ"],
    [Number.NaN, "0 đ"],
    [Number.POSITIVE_INFINITY, "0 đ"],
  ])("formatVND(%s) = %j", (n, expected) => {
    expect(formatVND(n)).toBe(expected);
  });

  // NGHI VẤN: số âm rất nhỏ (vd -0,4 đ do trừ số thực) làm tròn ra -0 và hiện «-0 đ».
  it.fails("[nghi vấn] formatVND(-0.4) không nên hiện «-0 đ»", () => {
    expect(formatVND(-0.4)).toBe("0 đ");
  });

  it.each<[number, string]>([
    [0, "0"],
    [1250, "1.250"],
    [2.5, "2,5"],
    [-3, "-3"],
    [1.2345, "1,235"],
    [1e9, "1.000.000.000"],
    [Number.NaN, "0"],
  ])("formatQty(%s) = %j", (n, expected) => {
    expect(formatQty(n)).toBe(expected);
  });

  it.fails("[nghi vấn] formatQty(-0.0001) không nên hiện «-0»", () => {
    expect(formatQty(-0.0001)).toBe("0");
  });

  it("round-trip: formatNumber → parseInteger trả lại đúng số nguyên (ngẫu nhiên 5000 số, cả số âm)", () => {
    const r = prng(99);
    for (let i = 0; i < 5000; i++) {
      const n = r.int(-2_000_000_000, 2_000_000_000);
      expect(parseInteger(formatNumber(n))).toBe(n);
      expect(parseInteger(formatVND(n))).toBe(n);
    }
  });
});

describe("parseInteger / parseDecimal (ô nhập tiền, số lượng, %)", () => {
  it.each<[string, number]>([
    ["1.200.000", 1_200_000],
    ["1,200,000 đ", 1_200_000],
    ["1 200 000", 1_200_000],
    ["", 0],
    ["abc", 0],
    ["-5", -5],
  ])("parseInteger(%j) = %d", (text, n) => {
    expect(parseInteger(text)).toBe(n);
  });

  // NGHI VẤN: dán giá có phần lẻ từ Excel («1.200.000,00» hoặc «1,200,000.00») vào ô tiền → mọi chữ số bị nối lại,
  // thành 120.000.000 (gấp 100 lần).
  it("[đã sửa] parseInteger(«1.200.000,00») = 1.200.000", () => {
    expect(parseInteger("1.200.000,00")).toBe(1_200_000);
  });

  it.each<[string, number]>([
    ["12,5", 12.5],
    ["12.5", 12.5],
    [" 30 ", 30],
    ["", 0],
    ["abc", 0],
    ["1.200,5", 0],
  ])("parseDecimal(%j) = %d", (text, n) => {
    expect(parseDecimal(text)).toBe(n);
  });
});

// ───────────────────────── 8. File thật của khách (chỉ đọc, nếu có trên máy) ─────────────────────────

const UPLOADS = "/home/tung/.claude/uploads/cfbb4fe6-edd3-44a6-aa19-8a383924ed84";
const PROMO = `${UPLOADS}/da32d7d6-V_T_SAU_CK.xlsx`;
const BARCODE = `${UPLOADS}/c98ddb99-V_t.xlsx`;

async function importFile(path: string, sheet = 0, vat = false) {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(path)).buffer as ArrayBuffer);
  const rows = sheets[sheet].rows;
  const layout = detectLayout(rows);
  return { layout, res: convertRows(rows, { ...layout, vatFrom10To8: vat, wholesaleDiscountPercent: layout.mapping.wholesale == null ? 30 : null }) };
}

describe.skipIf(!existsSync(PROMO) || !existsSync(BARCODE))("file thật của khách", () => {
  it("V_T_SAU_CK Sheet1: lấy «Giá sau Vat», nghìn đồng → 2060 nghìn thành 2.022.545 đ, giá sỉ 1.415.782 đ", async () => {
    const { layout, res } = await importFile(PROMO);
    expect(layout.priceUnit).toBe("thousand");
    const item = res.items.find((i) => i.sku === "P-AYPR285-3")!;
    expect(item).toMatchObject({ retailPrice: 2_022_545, wholesalePrice: 1_415_782 });
    // Nhóm Ashaway: «Giá sau Vat» là chữ «ASW» → giá lẻ lấy theo giá sỉ (bằng GiaLe 1800 trong file này).
    expect(res.items.find((i) => i.sku === "AVPTX")).toMatchObject({ retailPrice: 1_800_000, wholesalePrice: 1_800_000 });
    for (const i of res.items) {
      expect(Number.isInteger(i.retailPrice) && Number.isInteger(i.wholesalePrice)).toBe(true);
      expect(i.retailPrice).toBeGreaterThanOrEqual(100_000);
    }
  });

  it("V_t: mã hàng ở cột «Tên Hàng», giá lẻ VAT 10% → 8%: 1420 nghìn → 1.394.182 đ, sỉ CK 30% → 975.927 đ", async () => {
    const { layout, res } = await importFile(BARCODE, 0, true);
    expect(layout.mapping.sku).toBe(4);
    expect(layout.priceUnit).toBe("thousand");
    // 1420 / 1,1 × 1,08 = 1394,1818… → 1.394.182; × 0,7 = 975,927… → 975.927
    expect(res.items.find((i) => i.sku === "P-AYPW039-4V")).toMatchObject({ retailPrice: 1_394_182, wholesalePrice: 975_927 });
    // 12300 nghìn (combo) → 12.076.364 đ
    expect(res.items.find((i) => i.sku === "P-AYPU115-88C")?.retailPrice).toBe(12_076_364);
  });

  it("V_T_SAU_CK Sheet3 (bảng ở B3, cột số lượng/thành tiền không tiêu đề): không lấy nhầm thành giá", async () => {
    const { layout, res } = await importFile(PROMO, 1);
    expect(layout.mapping).toMatchObject({ sku: 1, retail: 3, wholesale: 4 });
    expect(res.items.find((i) => i.sku === "P-AYPU011-4V")).toMatchObject({ retailPrice: 2_250_000, wholesalePrice: 1_546_364 });
  });
});
