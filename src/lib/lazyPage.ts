// Tải từng màn hình khi cần, và tự xử lý trường hợp trang vừa được cập nhật lên bản mới.
//
// Mỗi lần đưa bản mới lên, tên các file của từng màn hình đổi theo (vd OrdersPage-BXsBNu_B.js → OrdersPage-Ck2….js) và
// file cũ không còn trên máy chủ. Một tab đã mở từ trước vẫn giữ danh sách tên cũ, nên khi bấm sang màn hình khác thì
// trình duyệt báo «Failed to fetch dynamically imported module». Cách chữa: tải lại trang một lần để lấy bản mới.
import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "km.reloadedForUpdate";
/** Trong khoảng này đã tự tải lại một lần mà vẫn lỗi thì thôi, để không tải lại mãi (vd đang mất mạng). */
const RELOAD_GAP_MS = 60_000;

/** Lỗi do không tải được một phần của ứng dụng (thường vì trang vừa được cập nhật). */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk \S+ failed/i.test(
    message,
  );
}

/** Tải lại trang để lấy bản mới, nhiều nhất một lần mỗi phút. Trả về false nếu vừa tải lại rồi. */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Không ghi được sessionStorage (chế độ riêng tư…): vẫn tải lại, lần sau sẽ hiện lỗi nếu còn hỏng.
  }
  window.location.reload();
  return true;
}

/** Như React.lazy, thêm: không tải được vì trang vừa cập nhật thì tự tải lại trang một lần. */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (error) {
      // Đang tải lại trang: chờ luôn, đừng hiện lỗi trong chốc lát trước khi trang mới hiện ra.
      if (isChunkLoadError(error) && reloadForUpdate()) return new Promise<never>(() => {});
      throw error;
    }
  });
}

/** Vite báo không tải trước được file phụ (CSS, phần dùng chung) của một màn hình: cũng tải lại trang một lần. */
export function watchPreloadErrors(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForUpdate()) event.preventDefault();
  });
}
