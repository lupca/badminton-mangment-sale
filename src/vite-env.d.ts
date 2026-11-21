/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Địa chỉ project Supabase, vd https://abcd.supabase.co. Để trống = chạy không cần máy chủ (dữ liệu nằm trong trình duyệt). */
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable key của project (sb_publishable_…; project cũ: anon key). Đây là khóa công khai, được phép nằm trong trình duyệt. */
  readonly VITE_SUPABASE_KEY?: string;
}
