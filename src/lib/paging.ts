// Phân trang cho các danh sách dài (sản phẩm, đơn hàng). Các hàm đều thuần.

/** Các lựa chọn «số dòng mỗi trang». */
export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface Page<T> {
  /** Các dòng của trang đang xem. */
  items: T[];
  /** Trang đang xem (từ 1), đã ép vào khoảng hợp lệ. */
  page: number;
  /** Tổng số trang (ít nhất là 1, kể cả khi danh sách rỗng). */
  pages: number;
  size: number;
  total: number;
  /** Thứ tự (từ 1) của dòng đầu và dòng cuối trên trang; cả hai là 0 khi danh sách rỗng. */
  from: number;
  to: number;
}

/** Số dòng mỗi trang hợp lệ gần nhất với giá trị đọc được (vd từ địa chỉ trang). */
export function pageSizeOf(value: unknown, fallback: number = DEFAULT_PAGE_SIZE): number {
  const n = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : fallback;
}

/** Cắt `list` lấy trang `page` (từ 1). Trang ngoài khoảng thì lấy trang gần nhất còn có dòng. */
export function paginate<T>(list: readonly T[], page: number, size: number): Page<T> {
  const perPage = Number.isFinite(size) && size >= 1 ? Math.floor(size) : DEFAULT_PAGE_SIZE;
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const wanted = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(1, wanted), pages);
  const start = (current - 1) * perPage;
  const items = list.slice(start, start + perPage);
  return { items, page: current, pages, size: perPage, total, from: total === 0 ? 0 : start + 1, to: start + items.length };
}

/**
 * Các nút số trang cần hiện: trang đầu, trang cuối, trang đang xem và `around` trang hai bên; chỗ bỏ bớt là "gap".
 * Vd pageButtons(6, 20) → [1, "gap", 5, 6, 7, "gap", 20]. Chỗ chỉ thiếu đúng một trang thì hiện luôn trang đó.
 */
export function pageButtons(page: number, pages: number, around = 1): Array<number | "gap"> {
  const out: Array<number | "gap"> = [];
  let last = 0;
  for (let n = 1; n <= pages; n++) {
    const near = n === 1 || n === pages || Math.abs(n - page) <= around;
    // Trang nằm giữa hai trang đang hiện mà chỉ có một mình: hiện nó thay cho dấu «…».
    const lone = !near && n - last === 1 && (n + 1 === pages || Math.abs(n + 1 - page) <= around);
    if (!near && !lone) continue;
    if (n - last > 1) out.push("gap");
    out.push(n);
    last = n;
  }
  return out;
}
