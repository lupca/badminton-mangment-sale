// Đồ dùng chung cho các bài kiểm thử lớp máy chủ (server/schema.sql + server/app.js).
//
// AN TOÀN: các bài kiểm thử XÓA SẠCH dữ liệu trong database chúng chạy trên đó. Vì vậy có hai lớp chặn:
//   1. chỉ nhận địa chỉ database ở ngay trên máy này (localhost / 127.0.0.1 / ::1) — xem assertLocalUrl;
//   2. trước mỗi lần xóa, database phải mang «dấu database thử» (một dòng trong km.meta do server/tests/run.mjs ghi vào
//      lúc nó tự dựng database, hoặc lúc database được giao cho nó còn trống) — xem resetDatabase.
//      Lớp này chặn cả trường hợp một database thật được «kéo» về localhost qua đường hầm (ssh -L, kubectl port-forward).
// Không bao giờ dùng DATABASE_URL của ứng dụng: bài kiểm thử chỉ đọc KM_TEST_DATABASE_URL.
import { createHash } from "node:crypto";
import pg from "pg";

// Ngay khi file này được nạp: bỏ DATABASE_URL / DATABASE_CA của môi trường (có thể là database thật của ứng dụng).
// Từ đây lớp API trong tiến trình này chỉ nối được vào database mà useTestDatabase() đã kiểm tra.
delete process.env.DATABASE_URL;
delete process.env.DATABASE_CA;
let ready = false;
/** Địa chỉ database thử đã được kiểm tra (đặt bởi useTestDatabase). */
let testUrl = "";

function requireReady() {
  if (!ready) throw new Error("Chưa gọi useTestDatabase(): bài kiểm thử phải kiểm tra địa chỉ database thử trước khi làm bất cứ việc gì.");
}

/** Khóa của dòng trong km.meta đánh dấu «đây là database thử, được phép xóa sạch». */
export const TEST_MARK_KEY = "test_database";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Dừng ngay (mã thoát 2) nếu `url` không trỏ vào một database trên chính máy này.
 * @param {string | undefined} url
 * @param {string} name tên biến môi trường, để báo lỗi
 * @returns {string} chính `url` nếu hợp lệ
 */
export function assertLocalUrl(url, name) {
  const refuse = (/** @type {string} */ why) => {
    console.error(
      [
        `TỪ CHỐI CHẠY: ${name} ${why}`,
        "Các bài kiểm thử xóa sạch dữ liệu của database chúng chạy trên đó, nên chỉ được trỏ vào một database thử",
        "ngay trên máy này (localhost / 127.0.0.1). Cách dễ nhất: chạy `npm run test:db` và để nó tự dựng database bằng Docker.",
      ].join("\n"),
    );
    process.exit(2);
  };
  if (!url || url.trim() === "") refuse("đang trống.");
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(/** @type {string} */ (url));
  } catch {
    return refuse("không phải một địa chỉ dạng postgres://user:mật-khẩu@máy:cổng/database.");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) refuse("không phải địa chỉ postgres://…");
  // Tham số «host» / «hostaddr» trong chuỗi kết nối ghi đè máy chủ ghi ở phần địa chỉ: không nhận.
  if (parsed.searchParams.has("host") || parsed.searchParams.has("hostaddr")) refuse("có tham số host / hostaddr.");
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    refuse(`trỏ tới máy «${parsed.hostname}», không phải máy này.`);
  }
  return /** @type {string} */ (url);
}

/**
 * Gọi ở đầu mỗi file kiểm thử: kiểm tra địa chỉ database thử, rồi cho lớp API (server/app.js) dùng đúng database đó.
 * @returns {{ url: string, adminUrl: string }}
 */
export function useTestDatabase() {
  const given = process.env.KM_TEST_DATABASE_URL;
  if (!given) {
    console.error("Thiếu KM_TEST_DATABASE_URL. Chạy cả bộ bằng `npm run test:db` (tự dựng database thử bằng Docker).");
    process.exit(2);
  }
  const url = assertLocalUrl(given, "KM_TEST_DATABASE_URL");
  const adminUrl = process.env.KM_TEST_ADMIN_URL ? assertLocalUrl(process.env.KM_TEST_ADMIN_URL, "KM_TEST_ADMIN_URL") : url;
  // Lớp API đọc DATABASE_URL: ghi đè bằng database thử, để không gì trong tiến trình này chạm được database khác.
  process.env.DATABASE_URL = url;
  delete process.env.DATABASE_CA;
  // Giữ bể kết nối giữa các lệnh gọi (mặc định lớp API đóng hết kết nối sau mỗi yêu cầu lẻ) cho bộ kiểm thử chạy nhanh.
  process.env.KM_KEEP_POOL = "1";
  testUrl = url;
  ready = true;
  return { url, adminUrl };
}

// ───────────────────────── Vào thẳng database ─────────────────────────

/** Cấu hình kết nối cho thư viện pg từ một địa chỉ (cùng cách hiểu «sslmode=disable» với server/app.js). */
export function pgConfig(url) {
  const parsed = new URL(url);
  const disable = parsed.searchParams.get("sslmode") === "disable";
  parsed.searchParams.delete("sslmode");
  return { connectionString: parsed.toString(), ssl: disable ? false : { rejectUnauthorized: false } };
}

/** @type {pg.Client | null} */
let shared = null;
/** @type {pg.Client[]} */
const extraClients = [];

/** Một phiên database riêng (để giữ giao dịch mở, chen hai giao dịch vào nhau…). Tự đóng khi gọi closeDatabase(). */
export async function openSession(url = testUrl) {
  requireReady();
  const client = new pg.Client({ ...pgConfig(assertLocalUrl(url, "địa chỉ database thử")), application_name: "km-test" });
  client.on("notice", () => {});
  client.on("error", () => {});
  await client.connect();
  extraClients.push(client);
  return client;
}

/**
 * Chạy một câu lệnh thẳng vào database thử (không qua lớp API, không có «người gọi»).
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<any[]>} các dòng kết quả
 */
export async function sql(text, params = []) {
  requireReady();
  if (!shared) {
    // Luôn là database thử đã kiểm tra — kể cả khi một phép thử tạm trỏ DATABASE_URL của lớp API đi nơi khác.
    shared = new pg.Client({ ...pgConfig(testUrl), application_name: "km-test" });
    shared.on("notice", () => {});
    shared.on("error", () => {});
    await shared.connect();
  }
  const result = await shared.query(text, params);
  return result.rows;
}

export async function closeDatabase() {
  for (const client of [...extraClients.splice(0), shared]) {
    if (client) await client.end().catch(() => {});
  }
  shared = null;
}

/** Database đang nối có mang «dấu database thử» không. */
export async function isMarkedTestDatabase() {
  try {
    const rows = await sql("select 1 from km.meta where key = $1", [TEST_MARK_KEY]);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Xóa sạch dữ liệu của ứng dụng trong database thử, đưa nó về trạng thái «vừa cài xong, chưa có tài khoản nào». */
export async function resetDatabase() {
  if (!(await isMarkedTestDatabase())) {
    console.error(
      [
        "TỪ CHỐI XÓA DỮ LIỆU: database này không mang dấu «database thử» (km.meta không có dòng test_database).",
        "Chỉ server/tests/run.mjs mới đặt dấu đó, và chỉ lên database nó tự dựng hoặc database còn trống.",
      ].join("\n"),
    );
    process.exit(2);
  }
  await sql(
    "truncate km.sessions, km.auth_events, km.orders, km.programs, km.app_state, km.order_counters, km.accounts restart identity",
  );
  await sql(
    `insert into km.app_state (key, data) values
       ('stock', '{"bySku": {}, "updatedAt": null}'::jsonb),
       ('settings', '{"lowStockThreshold": 5}'::jsonb)`,
  );
}

/**
 * «Ảnh chụp» toàn bộ dữ liệu của ứng dụng dưới dạng một chuỗi băm: hai lần chụp bằng nhau nghĩa là không có gì đổi
 * (chương trình, đơn hàng kể cả chủ đơn / ngày tạo, tồn kho, thiết lập, tài khoản kể cả mật khẩu, bộ đếm mã đơn, phiên đăng nhập).
 */
export async function stateDigest() {
  const [row] = await sql(`
    select md5(concat_ws('|',
      (select coalesce(string_agg(id || ':' || rev || ':' || md5(data::text), ',' order by id), '') from km.programs),
      (select coalesce(string_agg(id || ':' || rev || ':' || coalesce(owner_id::text, '-') || ':' || created_at::text || ':' || md5(data::text), ',' order by id), '') from km.orders),
      (select coalesce(string_agg(key || ':' || rev || ':' || md5(data::text), ',' order by key), '') from km.app_state),
      (select coalesce(string_agg(id::text || ':' || email || ':' || role || ':' || full_name || ':' || phone || ':' || md5(password_hash), ',' order by id), '') from km.accounts),
      (select coalesce(string_agg(day::text || ':' || last, ',' order by day), '') from km.order_counters),
      (select coalesce(string_agg(encode(token_hash, 'hex') || ':' || account_id::text, ',' order by token_hash), '') from km.sessions)
    )) as digest`);
  return row.digest;
}

// ───────────────────────── Gọi lớp API ─────────────────────────

const { handle, closePool } = await import("../app.js");

/**
 * Gọi lớp API ngay trong tiến trình (hàm handle của server/app.js — đúng hàm mà Vercel và máy chủ ở máy mình gọi).
 * @param {string} op
 * @param {Record<string, unknown>} [args]
 * @param {{ token?: string | null, ip?: string, method?: string, raw?: string, contentType?: string, authorization?: string }} [options]
 *   raw: thân yêu cầu gửi nguyên văn (thay cho { op, args }); authorization: gửi nguyên văn (thay cho «Bearer <token>»)
 */
export async function api(op, args = {}, options = {}) {
  requireReady();
  const { token = null, ip = "198.51.100.1", method = "POST", raw, contentType = "application/json", authorization } = options;
  const response = await handle({
    method,
    contentType,
    authorization: authorization ?? (token ? `Bearer ${token}` : ""),
    body: raw ?? JSON.stringify({ op, args }),
    ip,
  });
  const body = /** @type {any} */ (response.body ?? {});
  return {
    status: response.status,
    body,
    /** Kết quả của lệnh (undefined nếu lệnh thất bại). */
    result: body.result,
    /** Mã lỗi của lớp API, null nếu lệnh thành công. */
    code: body.error?.code ?? null,
    message: body.error?.message ?? null,
  };
}

export async function closeApi() {
  await closePool();
}

/** Lệnh thành công (200, không có lỗi). */
export const ok = (r) => r.status === 200 && r.code === null && "result" in r.body;
/** Lệnh bị từ chối đúng với mã HTTP và mã lỗi mong đợi. */
export const refused = (r, status, code) => r.status === status && r.code === code && typeof r.message === "string" && r.message.length > 0;
export const show = (r) => ({ status: r.status, body: r.body });

// ───────────────────────── Tài khoản thử ─────────────────────────

let accountCounter = 0;
let ipCounter = 0;

/** Một địa chỉ mạng giả chưa dùng lần nào (để giới hạn «đăng ký / đăng nhập theo địa chỉ mạng» không ảnh hưởng nhau). */
export function freshIp() {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/**
 * Đăng ký một tài khoản qua lớp API. Tài khoản đầu tiên sau resetDatabase() là quản lý, các tài khoản sau ở trạng thái chờ duyệt.
 * @param {string} label
 * @param {{ email?: string, password?: string, fullName?: string, phone?: string, ip?: string }} [overrides]
 */
export async function signUp(label, overrides = {}) {
  accountCounter += 1;
  const email = overrides.email ?? `${label}.${accountCounter}@example.com`;
  const password = overrides.password ?? `mat-khau-${label}-${accountCounter}`;
  const r = await api(
    "auth.signUp",
    { email, password, fullName: overrides.fullName ?? `Người ${label}`, phone: overrides.phone ?? "0900000000" },
    { ip: overrides.ip ?? freshIp() },
  );
  if (!ok(r)) throw new Error(`Không tạo được tài khoản thử ${email}: ${JSON.stringify(r.body)}`);
  const profile = r.result.profile;
  return { id: profile.id, email: profile.email, password, token: r.result.token, role: profile.role, label };
}

/** Quản lý `manager` đổi vai trò của `account` (qua lớp API). */
export async function setRole(manager, account, role) {
  const r = await api("accounts.setRole", { id: account.id, role }, { token: manager.token });
  if (!ok(r)) throw new Error(`Không đổi được vai trò của ${account.email} thành ${role}: ${JSON.stringify(r.body)}`);
  account.role = role;
  return account;
}

/** Đăng nhập, trả về khóa phiên mới (ném lỗi nếu không đăng nhập được). */
export async function signIn(account, password = account.password, ip = freshIp()) {
  const r = await api("auth.signIn", { email: account.email, password }, { ip });
  if (!ok(r)) throw new Error(`Không đăng nhập được ${account.email}: ${JSON.stringify(r.body)}`);
  return r.result.token;
}

/**
 * Dựng một nhóm tài khoản trên hệ thống đang trống: một quản lý (tài khoản đầu tiên), rồi các tài khoản còn lại
 * được quản lý đó duyệt / khóa qua lớp API.
 * @param {{ managers?: number, sales?: number, pending?: number, locked?: number }} [shape]
 */
export async function team(shape = {}) {
  const { managers = 1, sales = 2, pending = 0, locked = 0 } = shape;
  const boss = await signUp("quanly");
  const make = (label, count) => Promise.all(Array.from({ length: count }, () => signUp(label)));
  const [moreManagers, saleAccounts, pendingAccounts, lockedAccounts] = await Promise.all([
    make("quanly", Math.max(0, managers - 1)),
    make("sale", sales),
    make("cho", pending),
    make("khoa", locked),
  ]);
  for (const account of moreManagers) await setRole(boss, account, "manager");
  for (const account of saleAccounts) await setRole(boss, account, "sale");
  for (const account of lockedAccounts) await setRole(boss, account, "locked");
  return { boss, managers: [boss, ...moreManagers], sales: saleAccounts, pending: pendingAccounts, locked: lockedAccounts };
}

// ───────────────────────── Tài liệu thử ─────────────────────────

export const programDoc = (id, extra = {}) => ({ id, name: `Chương trình ${id}`, ...extra });
export const orderDoc = (id, programId, extra = {}) => ({ id, programId, status: "draft", code: "", ...extra });

/** Ngày hôm nay theo giờ Việt Nam, dạng yymmdd — phần ngày trong mã đơn DHyymmdd-NNN. */
export function vietnamDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "2-digit", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), /** @type {Record<string, string>} */ ({}));
  return `${parts.year}${parts.month}${parts.day}`;
}

/** So hai chuỗi theo thứ tự byte UTF-8 — viết lại đúng cách của trình duyệt (compareAsUtf8 trong src/lib/cloud/remote.ts). */
export function compareAsUtf8(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xd800 && y >= 0xd800) {
      x = x >= 0xe000 ? x - 0x800 : x + 0x2000;
      y = y >= 0xe000 ? y - 0x800 : y + 0x2000;
    }
    return x - y;
  }
  return a.length - b.length;
}

/** Dấu vân tay của một tập dòng, tính như trình duyệt tính (fingerprintOf trong src/lib/cloud/remote.ts). */
export function fingerprintOf(heads) {
  const text = [...heads]
    .sort((a, b) => compareAsUtf8(a.id, b.id))
    .map((head) => `${head.id}:${head.rev}`)
    .join(",");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ───────────────────────── Khung kiểm thử tí hon ─────────────────────────

let passed = 0;
let failed = 0;
/** @type {string[]} */
const failures = [];
let currentGroup = "";

const brief = (value, max = 1200) => {
  if (value === undefined) return "";
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = (text ?? "").replace(/\s*\n\s*/g, " ⏎ ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/** Ghi nhận một phép thử: in PASS / FAIL, trả về kết quả. `detail` chỉ in khi FAIL. */
export function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${currentGroup}: ${name}`);
    console.log(`FAIL  ${name}${detail === undefined ? "" : `\n        → ${brief(detail)}`}`);
  }
  return Boolean(condition);
}

export const note = (text) => console.log(`NOTE  ${text}`);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chờ tới khi `predicate()` đúng; trả về false nếu hết giờ. */
export async function until(predicate, timeoutMs = 5000, stepMs = 25) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(stepMs);
  }
}

/**
 * Mã đơn và bộ đếm dùng ngày theo giờ Việt Nam: không bắt đầu một nhóm phép thử sát nửa đêm (bộ đếm trong ngày sẽ bắt đầu
 * lại giữa chừng và các phép thử về mã đơn báo sai oan).
 */
async function avoidVietnamMidnight() {
  const vietnam = new Date(Date.now() + 7 * 3600_000);
  const secondsToMidnight = 86_400 - (vietnam.getUTCHours() * 3600 + vietnam.getUTCMinutes() * 60 + vietnam.getUTCSeconds());
  if (secondsToMidnight < 120) {
    note(`sắp sang ngày mới theo giờ Việt Nam: chờ ${secondsToMidnight + 2} giây để mã đơn không đổi ngày giữa chừng`);
    await sleep((secondsToMidnight + 2) * 1000);
  }
}

/**
 * Chạy một nhóm phép thử trên một hệ thống trống (xóa sạch dữ liệu trước khi chạy). Nhóm nào dừng giữa chừng vì lỗi thì
 * tính là một FAIL, các nhóm sau vẫn chạy.
 * @param {string} name
 * @param {() => Promise<void>} body
 * @param {{ reset?: boolean }} [options]
 */
export async function group(name, body, options = {}) {
  currentGroup = name;
  console.log(`\n── ${name}`);
  try {
    await avoidVietnamMidnight();
    if (options.reset !== false) await resetDatabase();
    await body();
  } catch (error) {
    failed += 1;
    failures.push(`${name}: nhóm dừng giữa chừng`);
    console.log(`FAIL  nhóm «${name}» dừng giữa chừng\n        → ${error?.stack ?? error}`);
  }
}

/** In tổng kết; trả về true nếu không có FAIL nào. */
export function summary(label) {
  console.log(`\n══ ${label}: PASS=${passed} FAIL=${failed}`);
  if (failed > 0) {
    console.log("Các mục FAIL:");
    for (const name of failures) console.log(`  • ${name}`);
  }
  return failed === 0;
}
