// Ứng dụng chạy ở một trong hai chế độ, quyết định lúc build bằng hai biến môi trường:
//   • có VITE_SUPABASE_URL + VITE_SUPABASE_KEY → dùng máy chủ Supabase: đăng nhập, dữ liệu dùng chung, quyền theo tài khoản;
//   • để trống                                  → không cần máy chủ: dữ liệu nằm trong trình duyệt của từng máy.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY ?? "").trim();

export const cloudEnabled = SUPABASE_URL !== "" && SUPABASE_KEY !== "";
