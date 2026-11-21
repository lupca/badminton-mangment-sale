// Đọc bảng giá hoặc bảng tồn kho từ file Excel / CSV hoặc văn bản dán: nhận diện dòng tiêu đề, các cột và đơn vị giá,
// rồi chuyển thành danh sách sản phẩm / số lượng tồn. Các hàm đều thuần (không đụng tới giao diện) để kiểm thử được.
import type { CellObject, WorkSheet } from "xlsx";
import type { ProductItem } from "../types";
import { normalizeSku, roundMoney, searchKey } from "./format";
import { parseTable } from "./paste";

/** Giá trị thô của một ô: chữ, số, hoặc null nếu ô trống. */
export type Cell = string | number | null;

export interface SheetData {
  name: string;
  /** Các ô theo đúng vị trí trong sheet: rows[0][0] là ô A1. */
  rows: Cell[][];
}

export type ColumnRole = "sku" | "name" | "retail" | "wholesale" | "unit" | "note" | "stock";
/** Vai trò → vị trí cột (0 = cột A); null = không có cột này. */
export type ColumnMapping = Record<ColumnRole, number | null>;
/** Đơn vị của các số giá trong file: nghìn đồng (1420 = 1.420.000 đ) hay đồng. */
export type PriceUnit = "thousand" | "dong";

/** File đang đọc để làm gì: nhập sản phẩm vào danh mục (bảng giá) hay cập nhật tồn kho. */
export type LayoutPurpose = "products" | "stock";

export interface SheetLayout {
  /** Vị trí dòng tiêu đề trong `rows`; null = không có dòng tiêu đề, dữ liệu bắt đầu từ dòng đầu. */
  headerRow: number | null;
  mapping: ColumnMapping;
  priceUnit: PriceUnit;
}

export interface ConvertOptions extends SheetLayout {
  /** Quy đổi giá lẻ từ giá gồm VAT 10% sang VAT 8% (÷ 1,1 × 1,08). Không áp dụng cho cột giá sỉ. */
  vatFrom10To8: boolean;
  /** Dòng không có giá sỉ: giá sỉ = giá lẻ × (100 − CK)%. null = lấy bằng giá lẻ. */
  wholesaleDiscountPercent: number | null;
}

export type SkipReason = "no_sku" | "no_price" | "no_stock" | "duplicate" | "total";

export interface SkippedRow {
  /** Số thứ tự dòng trong sheet, tính từ 1 như Excel. */
  row: number;
  reason: SkipReason;
  /** Nội dung dòng (rút gọn) để người dùng nhận ra. */
  text: string;
}

export interface ConvertResult {
  /** Sản phẩm đọc được: mã đã chuẩn hóa và không trùng nhau, giá là số nguyên đồng. */
  items: ProductItem[];
  /** Các dòng có dữ liệu nhưng không nhập (gồm cả dòng trùng mã). */
  skipped: SkippedRow[];
  /** Số dòng bị bỏ vì trùng mã với một dòng phía trên. */
  duplicateCount: number;
  /** Tồn kho của các sản phẩm đọc được (mã hàng → số lượng), chỉ gồm những dòng có số ở cột tồn kho. */
  stock: Record<string, number>;
}

export interface StockRow {
  sku: string;
  /** Tên hàng ghi trong file (rỗng nếu file không có cột tên). */
  name: string;
  qty: number;
}

export interface StockConvertResult {
  /** Mỗi mã hàng một dòng, theo thứ tự xuất hiện trong file; mã nằm ở nhiều dòng thì số lượng được cộng dồn. */
  rows: StockRow[];
  /** Các dòng có dữ liệu nhưng không đọc được tồn kho. */
  skipped: SkippedRow[];
  /** Các mã xuất hiện ở từ hai dòng trở lên (vd mỗi kho một dòng) — đã cộng dồn. */
  mergedSkus: string[];
}

export interface ColumnOption {
  index: number;
  /** Vd "A — Mã Hàng"; cột không có tiêu đề thì lấy giá trị đầu tiên làm mẫu. */
  label: string;
}

// ───────────────────────── Đọc file / văn bản dán ─────────────────────────

// Chặn trên để một file có ô lạc ở tận dòng 1.000.000 không làm treo trình duyệt.
const MAX_ROWS = 20000;
const MAX_COLUMNS = 100;

function cellValue(cell: CellObject | undefined): Cell {
  if (cell?.t === "n" && typeof cell.v === "number") return cell.v;
  if (cell?.t === "s" && typeof cell.v === "string" && cell.v.trim() !== "") return cell.v;
  return null;
}

function sheetRows(sheet: WorkSheet): Cell[][] {
  const rows: Cell[][] = [];
  let width = 0;
  (sheet["!data"] ?? []).forEach((cells, r) => {
    if (r >= MAX_ROWS) return;
    cells?.forEach((cell, c) => {
      const value = cellValue(cell);
      if (value == null || c >= MAX_COLUMNS) return;
      (rows[r] ??= [])[c] = value;
      width = Math.max(width, c + 1);
    });
  });
  return Array.from(rows, (row) => Array.from({ length: width }, (_, c) => row?.[c] ?? null));
}

/** File .xlsx (zip) và .xls (OLE) nhận ra qua 4 byte đầu; còn lại coi là văn bản (CSV, bảng HTML lưu đuôi .xls). */
function isBinaryWorkbook(bytes: Uint8Array): boolean {
  const startsWith = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  return startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0xd0, 0xcf, 0x11, 0xe0);
}

const UNREADABLE =
  "Không đọc được file này. Hãy mở file bằng Excel, lưu lại dạng .xlsx rồi thử lại, " +
  "hoặc copy vùng dữ liệu trong Excel và dán vào ô dán dữ liệu.";
const READER_NOT_LOADED =
  "Không tải được bộ đọc file Excel. Hãy kiểm tra kết nối mạng rồi thử lại, " +
  "hoặc copy vùng dữ liệu trong Excel và dán vào ô dán dữ liệu.";
const PASSWORD_PROTECTED = "File đang đặt mật khẩu. Hãy bỏ mật khẩu trong Excel rồi chọn lại file.";

/** File văn bản: ưu tiên UTF-8; không hợp lệ thì coi là bảng mã Windows tiếng Việt (Excel lưu "CSV (Comma delimited)"). */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1258").decode(bytes);
  }
}

/**
 * Đọc file .xlsx / .xls / .csv thành các sheet có dữ liệu (bỏ sheet trống và sheet ẩn).
 * Ô công thức lấy giá trị đã tính sẵn trong file. Ném Error (thông báo tiếng Việt) nếu không đọc được.
 */
export async function readWorkbook(source: Blob | ArrayBuffer): Promise<SheetData[]> {
  const bytes = new Uint8Array(source instanceof ArrayBuffer ? source : await source.arrayBuffer());
  const XLSX = await import("xlsx").catch(() => {
    throw new Error(READER_NOT_LOADED);
  });
  const options = { dense: true, cellFormula: false, cellHTML: false, cellText: false } as const;
  let workbook;
  try {
    workbook = isBinaryWorkbook(bytes)
      ? XLSX.read(bytes, { ...options, type: "array" })
      : // raw: giữ nguyên chữ trong ô ("1.420") để tự đọc số theo kiểu Việt Nam thay vì kiểu Mỹ.
        XLSX.read(decodeText(bytes).trimStart(), { ...options, type: "string", raw: true });
  } catch (error) {
    throw new Error(/password/i.test(String(error)) ? PASSWORD_PROTECTED : UNREADABLE);
  }
  const sheets = workbook.SheetNames.map((name, i) => ({
    name,
    rows: sheetRows(workbook.Sheets[name]),
    hidden: Boolean(workbook.Workbook?.Sheets?.[i]?.Hidden),
  })).filter((sheet) => sheet.rows.length > 0);
  if (sheets.length === 0) throw new Error("File không có dữ liệu.");
  const visible = sheets.filter((sheet) => !sheet.hidden);
  return (visible.length > 0 ? visible : sheets).map(({ name, rows }) => ({ name, rows }));
}

/**
 * Excel bọc ô có xuống dòng trong ngoặc kép (vd tiêu đề "Giá lẻ⏎VAT 10%") khi copy.
 * Gộp ô đó về một dòng để parseTable không cắt đôi dòng tiêu đề.
 */
function joinQuotedLines(text: string): string {
  return text.replace(/(^|[\t\n])"((?:[^"]|"")*)"(?=[\t\r\n]|$)/g, (match, lead: string, body: string) =>
    body.includes("\n") ? lead + body.replace(/""/g, '"').replace(/\s*\n\s*/g, " ") : match,
  );
}

/** Văn bản dán (copy từ Excel: các ô cách nhau bằng tab) → bảng ô cùng dạng với sheet đọc từ file. */
export function rowsFromText(text: string): Cell[][] {
  return parseTable(joinQuotedLines(text)).map((row) => row.map((value) => (value === "" ? null : value)));
}

// ───────────────────────── Đọc giá trị ô ─────────────────────────

function isBlank(value: Cell | undefined): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

/**
 * Chữ trong ô: mọi khoảng trắng (kể cả khoảng trắng không ngắt và xuống dòng) gộp thành một dấu cách,
 * dấu tiếng Việt đưa về dạng dựng sẵn (file CSV bảng mã Windows và một số bộ gõ dùng dấu tổ hợp).
 */
function cellText(value: Cell | undefined): string {
  return value == null ? "" : String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type DecimalSeparator = "," | "." | null;

/** Chữ số trong ô sau khi bỏ dấu cách, khoảng trắng không ngắt và ký hiệu tiền ("1 420 000 đ" → "1420000"). */
function numberText(value: string): string {
  return value.replace(/\s/g, "").replace(/(vnđ|vnd|đ|₫)$/i, "");
}

/**
 * Đọc số trong ô. Số từ file giữ nguyên. Chữ (dữ liệu dán, CSV) đọc theo cách Excel hiển thị:
 * "2.023", "1.415.782", "1,415,782" → dấu ngăn hàng nghìn; "2022,55", "2022.55", "1.415,78" → số thập phân.
 * `decimal`: dấu thập phân đã biết của cột, khi đó "785,455" là 785 phẩy 455. Không phải số → null.
 */
export function parseNumber(value: Cell | undefined, decimal: DecimalSeparator = null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = numberText(value);
  if (decimal && text.includes(decimal) && /^\d+[.,]\d+$/.test(text)) return Number(text.replace(",", "."));
  // Dấu ngăn hàng nghìn phải là một loại: "2.022,545" là 2022 phẩy 545 (nghìn đồng), không phải 2.022.545.
  if (/^\d{1,3}(\.\d{3})+$/.test(text) || /^\d{1,3}(,\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ""));
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(text)) return Number(text.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(,\d{3})+\.\d+$/.test(text)) return Number(text.replace(/,/g, ""));
  if (/^\d+([.,]\d+)?$/.test(text)) return Number(text.replace(",", "."));
  return null;
}

/** Giá hợp lệ (số > 0) hoặc null. */
function toPrice(value: Cell | undefined, decimal: DecimalSeparator = null): number | null {
  const n = parseNumber(value, decimal);
  return n != null && n > 0 ? n : null;
}

/**
 * Dấu thập phân mà cột chắc chắn đang dùng: "," khi có ô "2022,55" hay "1.415,78"; null nếu không ô nào cho thấy.
 * Excel hiển thị số lẻ theo bề rộng cột, nên khi dán một cột có thể vừa có "2022,55" vừa có "785,455":
 * nhờ ô thứ nhất mà ô thứ hai được hiểu là 785 phẩy 455 chứ không phải 785 nghìn 455.
 */
function decimalSeparator(values: Array<Cell | undefined>): DecimalSeparator {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = numberText(value);
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(text)) return ",";
    if (/^\d{1,3}(,\d{3})+\.\d+$/.test(text)) return ".";
    const single = /^\d+([.,])\d+$/.exec(text);
    if (single && !/^\d{1,3}[.,]\d{3}$/.test(text)) return single[1] as DecimalSeparator;
  }
  return null;
}

/** Giá của từng dòng trong một cột (null = ô không có giá hợp lệ), đọc số theo quy ước chung của cả cột. */
function columnPrices(rows: Cell[][], column: number | null): Array<number | null> {
  const values = rows.map((row) => (column == null ? null : row[column]));
  const decimal = decimalSeparator(values);
  return values.map((value) => toPrice(value, decimal));
}

/**
 * Số lượng tồn trong ô. Khác với giá: nhận cả 0 và số âm (kho bị âm), kể cả kiểu «-5» và «(5)» của sổ sách.
 * Ô trống hoặc ô chữ («Hết», «12 cái») → null. Làm tròn 3 chữ số lẻ.
 */
function toQuantity(value: Cell | undefined, decimal: DecimalSeparator = null): number | null {
  let n: number | null;
  if (typeof value === "string") {
    const text = value.trim();
    // Kiểu số «Accounting» của Excel ghi số 0 thành «-».
    if (/^[-−–]$/.test(text)) return 0;
    const negative = /^[-−–]/.test(text) || /^\(.+\)$/.test(text);
    n = parseNumber(negative ? text.replace(/^[-−–]\s*|^\(\s*|\s*\)$/g, "") : text, decimal);
    if (n != null && negative) n = -n;
  } else {
    n = parseNumber(value, decimal);
  }
  return n == null ? null : Math.round(n * 1000) / 1000 || 0;
}

/** Số lượng tồn của từng dòng trong một cột (null = ô không có số), đọc số theo quy ước chung của cả cột. */
function columnQuantities(rows: Cell[][], column: number | null): Array<number | null> {
  const values = rows.map((row) => (column == null ? null : row[column]));
  const decimal = decimalSeparator(values);
  return values.map((value) => toQuantity(value, decimal));
}

// ───────────────────────── Nhận diện dòng tiêu đề và các cột ─────────────────────────

const NO_MAPPING: ColumnMapping = {
  sku: null,
  name: null,
  retail: null,
  wholesale: null,
  unit: null,
  note: null,
  stock: null,
};

interface LabelRule {
  role: ColumnRole;
  /** Nhiều cột cùng vai trò thì cột có hạng cao hơn được chọn. */
  rank: number;
  pattern: RegExp;
}

// Nhãn cột thường gặp, so trên chữ đã bỏ dấu và viết thường. Nhãn cụ thể đứng trước nhãn chung:
// "Đơn giá bán buôn" phải ra giá sỉ trước khi kịp khớp với "Đơn giá".
const LABEL_RULES: LabelRule[] = [
  { role: "wholesale", rank: 1, pattern: /\bgia (si|buon|ban buon|ban si|dai ly|sau ck|sau chiet khau)\b/ },
  // "Giá sau VAT" là giá các bảng khuyến mãi dùng nên được ưu tiên hơn "Giá lẻ".
  { role: "retail", rank: 3, pattern: /\bsau vat\b/ },
  { role: "retail", rank: 2, pattern: /\b(gia le|giale|gia ban le|gia niem yet)\b/ },
  { role: "retail", rank: 1, pattern: /^(gia|don gia|gia ban|price)$/ },
  { role: "sku", rank: 2, pattern: /^ma hang su dung\b/ },
  { role: "sku", rank: 1, pattern: /^(ma|sku|code|row labels)$|^ma (hang|sp|san pham|hh|vat tu|vt|sku)\b|^(item|product) code$/ },
  { role: "name", rank: 1, pattern: /^(ten|name|san pham|hang hoa)$|^ten (hang|sp|san pham|hh|vat tu)\b|^(item|product) name$/ },
  { role: "unit", rank: 1, pattern: /^(dvt|dv|unit|don vi( tinh)?)$/ },
  { role: "note", rank: 1, pattern: /^(ghi chu|chu thich|notes?)\b/ },
  // Tồn kho: nhãn nói rõ đây là số đang tồn («Tồn kho», «SL tồn», «Tồn cuối kỳ»…). Các cột định mức và đầu kỳ
  // («Tồn nhỏ nhất», «Tồn lớn nhất», «Tồn đầu kỳ», «Giá trị tồn») không khớp.
  {
    role: "stock",
    rank: 2,
    pattern: /^((sl|so luong|tong|tong sl|tong so luong) )?ton( kho)?( (hien tai|thuc te|cuoi|cuoi ky|kha dung|co the ban))?$/,
  },
  {
    role: "stock",
    rank: 1,
    pattern: /^(co the ban|kha dung|sl kha dung|stock|in stock|on hand|(qty|quantity) on hand|stock (qty|quantity)|inventory|available)$/,
  },
];

/** Nhãn cột số lượng không nói rõ là tồn kho: chỉ dùng khi người dùng đang nhập một file tồn kho. */
const LOOSE_STOCK_LABEL = /^(so luong|sl|sl thuc te|so luong thuc te|qty|quantity|cuoi ky)$/;

/** Chữ của ô tiêu đề đưa về dạng để so khớp: bỏ dấu, viết thường, bỏ phần trong ngoặc và các ký hiệu. */
function labelKey(value: Cell | undefined): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  return searchKey(value)
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

function matchLabel(value: Cell | undefined): LabelRule | null {
  const key = labelKey(value);
  return key == null ? null : (LABEL_RULES.find((rule) => rule.pattern.test(key)) ?? null);
}

/** Mã hàng: liền một khối, có cả chữ lẫn số (P-AYPR285-3, AV8000SQ). */
const CODE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9][A-Za-z0-9._/+-]*$/;
/** Mã vạch: toàn chữ số, dài 12–13 ký tự. */
const BARCODE = /^\d{12,13}$/;
/** Đơn vị tính thường gặp (đã bỏ dấu): cái, chiếc, bộ, đôi, hộp, cuộn, quả, ống, túi, cây, sợi, thùng, gói… */
const UNITS = new Set("cai chiec bo doi hop cuon qua ong tui cay soi thung goi pcs set".split(" "));

type CellKind = "code" | "barcode" | "price" | "unit" | "text" | "other";

function cellKind(value: Cell): CellKind {
  const text = cellText(value);
  if (BARCODE.test(text)) return "barcode";
  if (toPrice(value) != null) return "price";
  if (typeof value === "number") return "other";
  if (CODE.test(text)) return "code";
  if (UNITS.has(searchKey(text))) return "unit";
  return text.length >= 6 && text.includes(" ") ? "text" : "other";
}

type ColumnStats = Record<CellKind, number> & { filled: number; textLength: number };

function columnStats(data: Cell[][], width: number): ColumnStats[] {
  const stats = Array.from(
    { length: width },
    (): ColumnStats => ({ code: 0, barcode: 0, price: 0, unit: 0, text: 0, other: 0, filled: 0, textLength: 0 }),
  );
  for (const row of data) {
    row.forEach((value, c) => {
      if (isBlank(value)) return;
      const kind = cellKind(value);
      stats[c].filled++;
      stats[c][kind]++;
      if (kind === "text") stats[c].textLength += cellText(value).length;
    });
  }
  return stats;
}

function sheetWidth(rows: Cell[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

/** Các dòng dữ liệu (nằm dưới dòng tiêu đề), đã bỏ dòng trống. */
function dataRows(rows: Cell[][], headerRow: number | null): Cell[][] {
  return rows.slice(headerRow == null ? 0 : headerRow + 1).filter((row) => !row.every(isBlank));
}

const HEADER_SCAN_ROWS = 30;

/**
 * Dòng tiêu đề là dòng đầu tiên (trong 30 dòng đầu) có từ 2 nhãn cột quen thuộc trở lên.
 * Gặp dòng dữ liệu (có mã hàng và giá) trước khi thấy tiêu đề thì coi như bảng không có tiêu đề —
 * để một dòng tiêu đề lặp lại giữa bảng không làm mất các dòng phía trên nó.
 */
function findHeaderRow(rows: Cell[][]): number | null {
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const roles = new Set(rows[r].map((value) => matchLabel(value)?.role).filter(Boolean));
    if (roles.size >= 2) return r;
    const kinds = rows[r].map(cellKind);
    if (kinds.includes("code") && kinds.includes("price")) return null;
  }
  return null;
}

/** Phần tử có điểm cao nhất; bằng điểm thì lấy phần tử đứng trước. */
function best<T>(items: T[], score: (item: T) => number): T | undefined {
  let top: T | undefined;
  let topScore = -Infinity;
  for (const item of items) {
    const value = score(item);
    if (value > topScore) {
      top = item;
      topScore = value;
    }
  }
  return top;
}

/** Tỷ lệ số dòng có (giá cột `a` ÷ giá cột `b`) nằm trong khoảng [min, max], tính trên các dòng có đủ hai giá. */
function ratioShare(data: Cell[][], a: number, b: number, min: number, max: number): number {
  const divisors = columnPrices(data, b);
  let both = 0;
  let within = 0;
  columnPrices(data, a).forEach((x, i) => {
    const y = divisors[i];
    if (x == null || y == null) return;
    both++;
    if (x / y >= min && x / y <= max) within++;
  });
  return both > 0 ? within / both : 0;
}

/** Cột số thứ tự (1, 2, 3…): hầu hết các dòng bằng dòng trên cộng 1. */
function isRunningNumber(data: Cell[][], column: number): boolean {
  let steps = 0;
  for (let i = 1; i < data.length; i++) {
    if (parseNumber(data[i][column]) === (parseNumber(data[i - 1][column]) ?? NaN) + 1) steps++;
  }
  return data.length >= 2 && steps >= (data.length - 1) * 0.8;
}

/**
 * Giá điển hình (trung vị) của cột giá dưới 100.000 thì file đang ghi theo nghìn đồng (1420 = 1.420.000 đ).
 * Ngoại lệ: bảng giá phụ kiện ghi bằng đồng (25.000, 65.000…) — nhận ra nhờ giá điển hình từ 10.000 trở lên
 * và mọi giá đều tròn nghìn; hàng ghi theo nghìn đồng mà giá điển hình trên 10 triệu thì gần như không có.
 */
export function detectPriceUnit(rows: Cell[][], headerRow: number | null, mapping: ColumnMapping): PriceUnit {
  const column = mapping.retail ?? mapping.wholesale;
  if (column == null) return "thousand";
  const prices = columnPrices(dataRows(rows, headerRow), column)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  if (prices.length === 0) return "thousand";
  const typical = prices[Math.floor(prices.length / 2)];
  const roundThousands = typical >= 10_000 && prices.every((n) => n % 1000 === 0);
  return typical >= 100_000 || roundThousands ? "dong" : "thousand";
}

const VAT_8_OVER_10 = 1.08 / 1.1;
/** Số dòng đầu (có giá) dùng để nhận diện cột — đủ đại diện mà file rất dài vẫn nhanh. */
const SAMPLE_ROWS = 500;

/** Cột toàn số (kể cả 0 và số âm) mà không phải số thứ tự: ứng viên cho cột số lượng tồn. */
function isQuantityColumn(data: Cell[][], column: number): boolean {
  const filled = data.map((row) => row[column]).filter((value) => !isBlank(value));
  const numbers = filled.filter((value) => toQuantity(value) != null);
  return filled.length > 0 && numbers.length >= filled.length * 0.8 && !isRunningNumber(data, column);
}

/**
 * Tìm dòng tiêu đề, gán cột cho từng vai trò (theo nhãn trước, theo nội dung cột sau) và đoán đơn vị giá.
 * `purpose` = "stock" khi đang đọc một file tồn kho: cột «Số lượng» cũng được nhận là tồn kho, và không đoán cột giá.
 */
export function detectLayout(rows: Cell[][], purpose: LayoutPurpose = "products"): SheetLayout {
  const headerRow = findHeaderRow(rows);
  const labels = headerRow == null ? [] : rows[headerRow].map(matchLabel);
  // Chỉ thống kê trên các dòng có giá: dòng tên nhóm hay dòng tiêu đề lặp lại không làm lệch tỷ lệ.
  const data = dataRows(rows, headerRow)
    .filter((row) => row.some((value) => cellKind(value) === "price"))
    .slice(0, SAMPLE_ROWS);
  const stats = columnStats(data, sheetWidth(rows));
  const columns = stats.map((_, c) => c);
  const share = (c: number, kind: CellKind) => (stats[c].filled > 0 ? stats[c][kind] / stats[c].filled : 0);
  /** Cột có dữ liệu ở ít nhất một nửa số dòng có giá. */
  const common = (c: number) => stats[c].filled > 0 && stats[c].filled >= data.length / 2;
  /** Các cột mang nhãn của vai trò này, hạng cao trước, cùng hạng thì từ trái sang. */
  const labelled = (role: ColumnRole) =>
    columns.filter((c) => labels[c]?.role === role).sort((a, b) => labels[b]!.rank - labels[a]!.rank);

  const mapping: ColumnMapping = { ...NO_MAPPING };
  const free = (c: number) => !Object.values(mapping).includes(c);

  // Mã hàng: cột mang nhãn "mã hàng" — trừ khi cột đó lẫn mã vạch (6902258696667) trong khi
  // có cột khác chứa mã thật (P-AYPW039-4V), dù cột kia mang nhãn gì.
  const skuLabelled = labelled("sku");
  mapping.sku =
    skuLabelled.find((c) => common(c) && stats[c].barcode === 0) ??
    best(
      columns.filter((c) => common(c) && stats[c].barcode === 0 && share(c, "code") >= 0.6),
      (c) => share(c, "code"),
    ) ??
    skuLabelled[0] ??
    columns.find((c) => common(c) && share(c, "barcode") >= 0.6) ??
    null;

  // Tên hàng: cột mang nhãn "tên…" có nhiều chữ nhất; không có nhãn thì lấy cột chữ dài nhất.
  mapping.name =
    best(labelled("name").filter(free), (c) => share(c, "text")) ??
    best(
      columns.filter((c) => free(c) && common(c) && share(c, "text") >= 0.5),
      (c) => stats[c].textLength / stats[c].filled,
    ) ??
    null;

  mapping.unit = labelled("unit").find(free) ?? columns.find((c) => free(c) && share(c, "unit") >= 0.6) ?? null;
  mapping.note = labelled("note").find(free) ?? null;
  mapping.retail = labelled("retail").find(free) ?? null;
  mapping.wholesale = labelled("wholesale").find(free) ?? null;
  mapping.stock = labelled("stock").find(free) ?? null;

  if (purpose === "stock") {
    if (mapping.stock == null && headerRow != null) {
      // File tồn kho không ghi chữ «tồn»: nhận cột «Số lượng» / «SL».
      const header = rows[headerRow];
      mapping.stock = columns.find((c) => free(c) && LOOSE_STOCK_LABEL.test(labelKey(header[c]) ?? "")) ?? null;
    } else if (mapping.stock == null) {
      // Bảng không có dòng tiêu đề (vd dán hai cột mã hàng + số lượng): chỉ có đúng một cột số thì đó là tồn kho.
      const numeric = columns.filter(
        (c) => free(c) && common(c) && stats[c].barcode === 0 && isQuantityColumn(data, c),
      );
      if (numeric.length === 1) mapping.stock = numeric[0];
    }
  } else if (mapping.retail == null && mapping.wholesale == null) {
    // Không có nhãn giá nào: đoán theo nội dung. Giá lẻ là cột số đầu tiên (không tính cột số thứ tự) — nhưng nếu
    // có cột bằng đúng (cột đó ÷ 1,1 × 1,08) thì đấy là "giá sau VAT" và được ưu tiên. Giá sỉ là cột số kế tiếp
    // không cao hơn giá lẻ (cột số lượng, thành tiền lệch quá xa nên bị loại).
    const priceColumns = columns.filter(
      (c) => free(c) && common(c) && share(c, "price") >= 0.5 && !isRunningNumber(data, c),
    );
    const first = priceColumns[0];
    if (first != null) {
      const afterVat = priceColumns.find(
        (c) => ratioShare(data, c, first, VAT_8_OVER_10 - 0.002, VAT_8_OVER_10 + 0.002) >= 0.8,
      );
      const retail = afterVat ?? first;
      mapping.retail = retail;
      mapping.wholesale = priceColumns.find((c) => c !== retail && ratioShare(data, c, retail, 0.2, 1) >= 0.8) ?? null;
    }
  }

  return { headerRow, mapping, priceUnit: detectPriceUnit(rows, headerRow, mapping) };
}

/** Sheet nên chọn sẵn: sheet đầu tiên nhận ra được cột mã hàng và cột giá (file tồn kho: cột mã hàng và cột tồn kho). */
export function defaultSheetIndex(sheets: SheetData[], purpose: LayoutPurpose = "products"): number {
  const index = sheets.findIndex((sheet) => {
    const { mapping } = detectLayout(sheet.rows, purpose);
    return mapping.sku != null && (purpose === "stock" ? mapping.stock : (mapping.retail ?? mapping.wholesale)) != null;
  });
  return Math.max(index, 0);
}

function columnLetter(index: number): string {
  let letters = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) letters = String.fromCharCode(65 + (n % 26)) + letters;
  return letters;
}

/** Các cột có dữ liệu của sheet, kèm nhãn để người dùng chọn. */
export function columnOptions(rows: Cell[][], headerRow: number | null): ColumnOption[] {
  const data = dataRows(rows, headerRow);
  const width = sheetWidth(rows);
  const options: ColumnOption[] = [];
  for (let c = 0; c < width; c++) {
    const sample = data.find((row) => !isBlank(row[c]))?.[c];
    const title =
      (headerRow == null ? "" : cellText(rows[headerRow][c])) ||
      (typeof sample === "number" ? String(Math.round(sample * 100) / 100) : cellText(sample));
    if (title) options.push({ index: c, label: `${columnLetter(c)} — ${shorten(title, 30)}` });
  }
  return options;
}

// ───────────────────────── Chuyển các dòng thành sản phẩm ─────────────────────────

const TOTAL_ROW = /^(grand total|total|tong cong|tong|cong)[:.]?$/;

/** Nội dung một dòng, rút gọn, để người dùng nhận ra dòng bị bỏ qua. */
function describeRow(row: Cell[]): string {
  return shorten(
    row
      .filter((value) => !isBlank(value))
      .map(cellText)
      .join(" | "),
    80,
  );
}

/**
 * Chuyển các dòng dưới dòng tiêu đề thành sản phẩm. Dòng hợp lệ phải có mã hàng và ít nhất một giá là số > 0,
 * nhờ vậy dòng trống, dòng tên nhóm ("ASHAWAY") và dòng tiêu đề lặp lại tự bị bỏ qua. Mã trùng: giữ dòng đầu tiên.
 */
export function convertRows(rows: Cell[][], options: ConvertOptions): ConvertResult {
  const { mapping } = options;
  const result: ConvertResult = { items: [], skipped: [], duplicateCount: 0, stock: {} };
  if (mapping.sku == null) return result;

  const multiplier = options.priceUnit === "thousand" ? 1000 : 1;
  const discount = options.wholesaleDiscountPercent;
  const wholesaleFactor = discount == null ? 1 : (100 - Math.min(Math.max(discount, 0), 100)) / 100;
  const at = (row: Cell[], column: number | null) => (column == null ? null : row[column]);
  const retailPrices = columnPrices(rows, mapping.retail);
  const wholesalePrices = columnPrices(rows, mapping.wholesale);
  const quantities = columnQuantities(rows, mapping.stock);
  const seen = new Set<string>();

  for (let r = options.headerRow == null ? 0 : options.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every(isBlank)) continue;
    const skip = (reason: SkipReason) => result.skipped.push({ row: r + 1, reason, text: describeRow(row) });

    const sku = normalizeSku(at(row, mapping.sku));
    const retailInFile = retailPrices[r];
    const wholesaleInFile = wholesalePrices[r];
    if (!sku) {
      skip("no_sku");
    } else if (TOTAL_ROW.test(searchKey(cellText(at(row, mapping.sku))))) {
      skip("total");
    } else if (retailInFile == null && wholesaleInFile == null) {
      skip("no_price");
    } else if (seen.has(sku)) {
      skip("duplicate");
      result.duplicateCount++;
    } else {
      seen.add(sku);
      // Tính bằng số lẻ theo đơn vị của file, chỉ làm tròn về đồng ở bước cuối (giống công thức trong Excel của khách).
      const retailConverted =
        retailInFile != null && options.vatFrom10To8 ? (retailInFile / 1.1) * 1.08 : retailInFile;
      const retail = retailConverted ?? wholesaleInFile!;
      const wholesale = wholesaleInFile ?? retail * wholesaleFactor;
      const item: ProductItem = {
        sku,
        name: cellText(at(row, mapping.name)),
        retailPrice: roundMoney(retail * multiplier),
        wholesalePrice: roundMoney(wholesale * multiplier),
      };
      const unit = cellText(at(row, mapping.unit));
      const note = cellText(at(row, mapping.note));
      if (unit) item.unit = unit;
      if (note) item.note = note;
      result.items.push(item);
      const quantity = quantities[r];
      if (quantity != null) result.stock[sku] = quantity;
    }
  }
  return result;
}

/**
 * Đọc bảng tồn kho: mỗi dòng hợp lệ cần mã hàng và một số ở cột tồn kho (không cần giá). Mã nằm ở nhiều dòng —
 * file kho hay ghi mỗi kho một dòng — thì cộng dồn số lượng.
 */
export function convertStockRows(rows: Cell[][], layout: Pick<SheetLayout, "headerRow" | "mapping">): StockConvertResult {
  const { mapping } = layout;
  const result: StockConvertResult = { rows: [], skipped: [], mergedSkus: [] };
  if (mapping.sku == null || mapping.stock == null) return result;

  const quantities = columnQuantities(rows, mapping.stock);
  const bySku = new Map<string, StockRow>();
  const merged = new Set<string>();

  for (let r = layout.headerRow == null ? 0 : layout.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every(isBlank)) continue;
    const skip = (reason: SkipReason) => result.skipped.push({ row: r + 1, reason, text: describeRow(row) });

    const sku = normalizeSku(row[mapping.sku]);
    const quantity = quantities[r];
    const existing = bySku.get(sku);
    if (!sku) {
      skip("no_sku");
    } else if (TOTAL_ROW.test(searchKey(cellText(row[mapping.sku])))) {
      skip("total");
    } else if (quantity == null) {
      skip("no_stock");
    } else if (existing) {
      existing.qty = Math.round((existing.qty + quantity) * 1000) / 1000 || 0;
      merged.add(sku);
    } else {
      const item: StockRow = { sku, name: mapping.name == null ? "" : cellText(row[mapping.name]), qty: quantity };
      bySku.set(sku, item);
      result.rows.push(item);
    }
  }
  result.mergedSkus = [...merged];
  return result;
}
