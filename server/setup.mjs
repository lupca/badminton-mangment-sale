// Cài đặt / nâng cấp database cho ứng dụng:  npm run db:setup
//
// Đọc DATABASE_URL (và DATABASE_CA nếu có) từ biến môi trường hoặc file .env.local / .env, rồi chạy server/schema.sql.
// Chạy lại nhiều lần cũng không sao: file SQL chỉ tạo những gì còn thiếu và thay các hàm bằng bản mới; dữ liệu giữ nguyên.
//
//   npm run db:setup            cài đặt / nâng cấp
//   npm run db:setup -- --check chỉ kiểm tra: kết nối được không, lược đồ đã đúng phiên bản chưa (không ghi gì)
//
// `npm run build` gọi bước kiểm tra này trước khi build (thêm --if-configured: không có DATABASE_URL thì bỏ qua, vì khi đó
// ứng dụng được build ở chế độ không máy chủ). Database chưa sẵn sàng thì build dừng — bản đang chạy trên mạng giữ nguyên,
// không bao giờ có chuyện trang web đòi máy chủ mà máy chủ chưa dùng được.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SCHEMA_VERSION } from "./app.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Nạp các dòng KHÓA=giá trị của một file .env vào process.env (không ghi đè biến đã có). */
function loadEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/s, "$2");
    process.env[match[1]] ??= value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const checkOnly = process.argv.includes("--check");
const url = (process.env.DATABASE_URL ?? "").trim();
if (process.argv.includes("--if-configured") && (url === "" || process.env.KM_SERVER === "off")) {
  console.log("Không có DATABASE_URL (hoặc KM_SERVER=off): build ở chế độ không máy chủ — dữ liệu nằm trong trình duyệt của từng máy.");
  process.exit(0);
}
if (!url) {
  console.error(
    [
      "Thiếu DATABASE_URL.",
      "Tạo file .env.local ở thư mục gốc của dự án với một dòng:",
      "  DATABASE_URL=postgres://<user>:<mật khẩu>@<máy chủ>:<cổng>/<database>",
      "rồi chạy lại lệnh này.",
    ].join("\n"),
  );
  process.exit(2);
}

// Cùng cách chọn TLS với lớp API (server/app.js).
let connectionString = url;
let sslmode = "";
try {
  const parsed = new URL(url);
  sslmode = parsed.searchParams.get("sslmode") ?? "";
  parsed.searchParams.delete("sslmode");
  connectionString = parsed.toString();
} catch {
  // để nguyên
}
const ca = process.env.DATABASE_CA;
const ssl = sslmode === "disable" ? false : ca ? { ca, rejectUnauthorized: true, checkServerIdentity: () => undefined } : { rejectUnauthorized: false };

/** Nơi đang nối tới, không kèm mật khẩu. */
function target() {
  try {
    const parsed = new URL(url);
    return `${parsed.username}@${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    return "(chuỗi kết nối không phải dạng URL)";
  }
}

const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 10_000, application_name: "km-setup" });
// Các dòng «đã có rồi, bỏ qua» của Postgres khi chạy lại: không cần hiện.
client.on("notice", () => {});

async function installedVersion() {
  try {
    const { rows } = await client.query("select value from km.meta where key = 'schema_version'");
    return rows[0]?.value ?? null;
  } catch (error) {
    if (["3F000", "42P01"].includes(error?.code)) return null;
    throw error;
  }
}

try {
  await client.connect();
  const { rows } = await client.query("select current_database() as db, current_user as usr, current_setting('server_version') as version");
  console.log(`Đã kết nối ${target()} — PostgreSQL ${rows[0].version}.`);
  const before = await installedVersion();

  if (checkOnly) {
    if (before === SCHEMA_VERSION) {
      console.log(`Lược đồ đã cài, phiên bản ${before} — đúng với mã nguồn.`);
    } else {
      console.error(
        before
          ? `Lược đồ trong database là phiên bản ${before}, mã nguồn cần phiên bản ${SCHEMA_VERSION}. Hãy chạy: npm run db:setup`
          : "Database chưa được cài đặt cho ứng dụng. Hãy chạy: npm run db:setup",
      );
      process.exitCode = 1;
    }
  } else {
    const sql = readFileSync(join(root, "server", "schema.sql"), "utf8");
    // Cả file trong một giao dịch: lỗi giữa chừng thì database giữ nguyên như trước khi chạy.
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
    const after = await installedVersion();
    const { rows: counts } = await client.query(
      "select (select count(*) from km.accounts)::int as accounts, (select count(*) from km.programs)::int as programs, (select count(*) from km.orders)::int as orders",
    );
    console.log(
      before === null ? `Đã cài lược đồ phiên bản ${after}.` : `Đã cập nhật lược đồ: phiên bản ${before} → ${after}.`,
    );
    console.log(`Hiện có: ${counts[0].accounts} tài khoản, ${counts[0].programs} chương trình, ${counts[0].orders} đơn hàng.`);
    if (counts[0].accounts === 0) {
      console.log("Chưa có tài khoản nào: người đăng ký ĐẦU TIÊN trên trang web sẽ là Quản lý.");
    }
  }
} catch (error) {
  console.error(`Không làm được với ${target()}: ${error?.message ?? error}`);
  if (error?.position) console.error(`(vị trí ${error.position} trong server/schema.sql)`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
