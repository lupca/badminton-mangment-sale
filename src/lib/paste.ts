// Đọc dữ liệu dán từ Excel / Zalo / văn bản.
import { normalizeSku } from "./format";

/** Tách văn bản dán thành bảng. Dán từ Excel thì các ô cách nhau bằng tab; nếu không có tab thì tách theo ; hoặc 2+ khoảng trắng. */
export function parseTable(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.split(/;|\s{2,}/);
      return cells.map((cell) => cell.replace(/ /g, " ").trim());
    });
}

/** "15", "15.0", "1.000", "1,000" → số nguyên dương; không hợp lệ → NaN. */
export function parseQty(cell: string): number {
  const text = cell.trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ""));
  if (/^\d+[.,]0+$/.test(text)) return Number(text.split(/[.,]/)[0]);
  return NaN;
}

export interface SkuQtyParseResult {
  rows: Array<{ sku: string; qty: number }>;
  /** Các dòng không đọc được (giữ nguyên văn để báo cho người dùng). */
  skipped: string[];
}

/** Con số viết có dấu phẩy — ngăn nghìn "1,000" hoặc thập phân "2,5": là một ô, không phải hai ô cách nhau bằng dấu phẩy. */
const COMMA_NUMBER = /^(\d{1,3}(,\d{3})+|\d+,\d{1,2})$/;

/**
 * Tách một dòng gõ tay (không có tab) thành các ô, cách nhau bằng khoảng trắng, ";" hoặc ",".
 * Ô đầu tiên luôn là mã hàng; từ ô thứ hai trở đi, dấu phẩy nằm trong một con số thì thuộc về con số đó
 * ("P-AYPR285-3 1,000" là 1.000 chứ không phải 1).
 */
function splitTypedLine(line: string): string[] {
  const cells: string[] = [];
  for (const token of line.trim().split(/[;\s]+/)) {
    let rest = token;
    while (rest !== "") {
      const comma = cells.length > 0 && COMMA_NUMBER.test(rest) ? -1 : rest.indexOf(",");
      if (comma < 0) {
        cells.push(rest);
        break;
      }
      if (comma > 0) cells.push(rest.slice(0, comma));
      rest = rest.slice(comma + 1);
    }
  }
  return cells;
}

/**
 * Đọc danh sách "Mã hàng + Số lượng" dán vào để tạo đơn nhanh.
 * Mỗi dòng: ô đầu là mã hàng; số lượng là ô thứ hai (nếu dòng có đúng 2 ô) hoặc ô số nguyên dương cuối cùng.
 * Dòng gõ tay chỉ có mã hàng → số lượng 1; dòng copy nhiều cột từ Excel mà ô số lượng để trống → bỏ qua (không đặt mã đó).
 * Mã trùng nhau được cộng dồn.
 */
export function parseSkuQty(text: string): SkuQtyParseResult {
  const rows = new Map<string, number>();
  const skipped: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const fromExcel = raw.includes("\t");
    const cells = (fromExcel ? raw.split("\t") : splitTypedLine(raw))
      .map((c) => c.replace(/ /g, " ").trim())
      .filter((c) => c !== "");
    if (cells.length === 0) continue;
    const sku = normalizeSku(cells[0]);
    // Mã hàng phải có chữ số hoặc dấu gạch, hoặc chỉ gồm chữ cái không dấu (vd AVPTX) — để loại dòng tiêu đề
    // kiểu "Mã hàng  SL", "Tổng cộng 15".
    if (!sku || !(/[\d-]/.test(sku) || /^[A-Z]+$/.test(sku))) {
      skipped.push(raw.trim());
      continue;
    }
    // Dòng nhiều cột copy từ Excel mà chỉ còn lại mã hàng: ô số lượng đang để trống, tức là không đặt mã này —
    // không được tự hiểu là 1.
    let qty = fromExcel ? NaN : 1;
    if (cells.length === 2) {
      qty = parseQty(cells[1]);
    } else if (cells.length > 2) {
      qty = NaN;
      for (let i = cells.length - 1; i >= 1; i--) {
        const n = parseQty(cells[i]);
        if (Number.isFinite(n) && n > 0 && n < 100000) {
          qty = n;
          break;
        }
      }
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      skipped.push(raw.trim());
      continue;
    }
    rows.set(sku, (rows.get(sku) ?? 0) + qty);
  }
  return { rows: [...rows].map(([sku, qty]) => ({ sku, qty })), skipped };
}
