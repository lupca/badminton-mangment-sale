// Ứng dụng chạy ở một trong hai chế độ, quyết định lúc build (xem vite.config.ts):
//   • build khi có biến môi trường DATABASE_URL → dùng máy chủ: đăng nhập, dữ liệu dùng chung nằm trong database PostgreSQL,
//     quyền theo tài khoản. Trình duyệt nói chuyện với lớp API ở /api (api/index.js), không bao giờ nối thẳng database;
//   • không có                                 → không cần máy chủ: dữ liệu nằm trong trình duyệt của từng máy.
// Trình duyệt chỉ biết CÓ máy chủ hay không; địa chỉ và mật khẩu database không bao giờ nằm trong mã gửi xuống trình duyệt.
export const cloudEnabled: boolean = typeof __KM_SERVER__ !== "undefined" && __KM_SERVER__ === true;

/** Địa chỉ của lớp API, cùng nơi với trang web. */
export const API_URL = "/api";
