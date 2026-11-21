import type { Program, ProgramStatus } from "../types";

const numberFormat = new Intl.NumberFormat("vi-VN");

/** 1415782 → "1.415.782" */
export function formatNumber(n: number): string {
  return numberFormat.format(Math.round(Number.isFinite(n) ? n : 0));
}

/**
 * Bỏ sai số của phép tính số thực (vd 12.648.703,4999999 thay vì 12.648.703,5) để làm tròn đúng ở ranh giới nửa đồng.
 * Giữ 15 chữ số có nghĩa — thừa cho mọi số tiền VND.
 */
export function cleanFloat(n: number): number {
  return Number.isFinite(n) ? Number(n.toPrecision(15)) : n;
}

/** Làm tròn về đồng (nửa đồng làm tròn lên), không bị sai số số thực kéo xuống. */
export function roundMoney(n: number): number {
  return Math.round(cleanFloat(n)) || 0;
}

/** 1415782 → "1.415.782 đ" */
export function formatVND(n: number): string {
  return `${formatNumber(n)} đ`;
}

const quantityFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });

/** Số lượng tồn kho: 1250 → "1.250", 2.5 → "2,5", -3 → "-3". */
export function formatQty(n: number): string {
  return quantityFormat.format(Number.isFinite(n) ? n : 0);
}

/** 45 → "45%", 12.5 → "12,5%" (dấu phẩy thập phân kiểu Việt Nam). */
export function formatPercent(n: number): string {
  return `${String(n).replace(".", ",")}%`;
}

/** Đọc số nguyên từ chuỗi người dùng gõ: "1.200.000", "1,200,000 đ", "1200000", "1.200.000,00" → 1200000. Rỗng → 0. */
export function parseInteger(text: string): number {
  const negative = /^\s*-/.test(text);
  // Số tiền dán từ Excel kèm phần lẻ: "1.200.000,00" / "1,200,000.00" → bỏ phần lẻ (VND không có số lẻ).
  const money = /^\s*-?\s*(\d{1,3}(?:([.,])\d{3})+)([.,])\d{1,2}\s*(đ|vnđ|vnd|₫)?\s*$/i.exec(text);
  if (money && money[2] !== money[3]) text = money[1];
  const digits = text.replace(/\D/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return negative ? -n : n;
}

/** Đọc số thập phân kiểu "12,5" hoặc "12.5" (dùng cho ô %). Không hợp lệ → 0. */
export function parseDecimal(text: string): number {
  const n = Number(text.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Ngày hôm nay theo giờ máy, dạng "YYYY-MM-DD". */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "2026-11-05" hoặc chuỗi ISO đầy đủ → "05/11/2026". Rỗng → "". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Chuỗi ISO → "20/11/2026 21:05". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${formatDate(value)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "05/11/2026 – 30/11/2026", "Từ 05/11/2026", "Đến 30/11/2026" hoặc "Không thời hạn". */
export function formatPeriod(start: string | null, end: string | null): string {
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start) return `Từ ${formatDate(start)}`;
  if (end) return `Đến ${formatDate(end)}`;
  return "Không thời hạn";
}

export function programStatus(p: Pick<Program, "startDate" | "endDate">, today: string = todayISO()): ProgramStatus {
  if (!p.startDate && !p.endDate) return "open";
  if (p.startDate && today < p.startDate) return "upcoming";
  if (p.endDate && today > p.endDate) return "ended";
  return "running";
}

export const PROGRAM_STATUS_LABEL: Record<ProgramStatus, string> = {
  upcoming: "Sắp diễn ra",
  running: "Đang chạy",
  ended: "Đã kết thúc",
  open: "Không thời hạn",
};

/** Id ngắn, không cần secure context (crypto.randomUUID không chạy trên http qua IP LAN). */
export function newId(prefix = ""): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

/** Chuẩn hóa mã hàng: bỏ khoảng trắng thừa, viết hoa. */
export function normalizeSku(value: unknown): string {
  return String(value ?? "")
    .replace(/ /g, " ")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** Khóa tìm kiếm: bỏ dấu tiếng Việt, viết thường. */
export function searchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Mọi từ trong `query` đều xuất hiện trong `haystack` (không phân biệt dấu, hoa thường). */
export function matchesSearch(haystack: string, query: string): boolean {
  const q = searchKey(query).trim();
  if (!q) return true;
  const h = searchKey(haystack);
  return q.split(/\s+/).every((word) => h.includes(word));
}

/** Chép chữ vào clipboard; có phương án dự phòng khi trang không chạy trên https/localhost. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // thử cách dự phòng bên dưới
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
