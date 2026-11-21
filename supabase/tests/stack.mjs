// Địa chỉ và khóa của Supabase dùng cho các kiểm thử trong thư mục này. Không ghi khóa nào vào mã nguồn:
//   • đặt biến môi trường SUPABASE_URL, SUPABASE_KEY (khóa công khai) và SUPABASE_SECRET_KEY (khóa bí mật — chỉ dùng để
//     dựng và dọn dữ liệu thử), hoặc
//   • để trống: lấy của bản Supabase đang chạy trên máy (đã `npx supabase start`) bằng lệnh `supabase status`.
import { spawnSync } from "node:child_process";

/** Hỏi Supabase CLI địa chỉ và khóa của bản đang chạy trên máy. Không hỏi được thì trả về {}. */
function localStack() {
  // SUPABASE_CLI: đường dẫn tới lệnh `supabase` nếu đã cài sẵn; không thì dùng npx (lần đầu sẽ tải CLI về).
  const cli = process.env.SUPABASE_CLI;
  const run = cli
    ? spawnSync(cli, ["status", "-o", "env"], { encoding: "utf8" })
    : spawnSync("npx", ["--yes", "supabase", "status", "-o", "env"], { encoding: "utf8" });
  if (run.status !== 0 || !run.stdout) return {};
  const read = (name) => run.stdout.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, "m"))?.[1];
  return {
    url: read("API_URL"),
    key: read("PUBLISHABLE_KEY") ?? read("ANON_KEY"),
    secret: read("SECRET_KEY") ?? read("SERVICE_ROLE_KEY"),
  };
}

/**
 * @returns {{ url: string, key: string, secret: string }} địa chỉ, khóa công khai và khóa bí mật của Supabase để kiểm thử.
 * Thiếu thì in hướng dẫn rồi thoát.
 */
export function stack() {
  const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY, secret: process.env.SUPABASE_SECRET_KEY };
  const local = env.url && env.key && env.secret ? {} : localStack();
  const url = (env.url || local.url || "").replace(/\/+$/, "");
  const key = env.key || local.key || "";
  const secret = env.secret || local.secret || "";
  if (!url || !key || !secret) {
    console.error(
      "Chưa biết Supabase nào để kiểm thử. Hãy chạy `npx supabase start` trong thư mục dự án (cần Docker),\n" +
        "hoặc đặt ba biến môi trường SUPABASE_URL, SUPABASE_KEY và SUPABASE_SECRET_KEY.",
    );
    process.exit(2);
  }
  return { url, key, secret };
}
