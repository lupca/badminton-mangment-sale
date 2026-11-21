// Kết nối tới Supabase — tạo một lần, dùng chung cho đăng nhập và dữ liệu.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, cloudEnabled } from "./config";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!cloudEnabled) throw new Error("Chưa cấu hình máy chủ (VITE_SUPABASE_URL / VITE_SUPABASE_KEY).");
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Ứng dụng điều hướng bằng hash (#/orders/…) và không dùng liên kết đăng nhập qua email,
      // nên không để thư viện đọc phần # của địa chỉ.
      detectSessionInUrl: false,
    },
  });
  return client;
}
