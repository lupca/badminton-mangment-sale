// @ts-check
// Lớp API của «Quản lý khuyến mãi»: đứng giữa trình duyệt và database PostgreSQL (trình duyệt không nối thẳng database được).
//
// Lớp này chỉ làm ba việc: đọc yêu cầu, băm / so mật khẩu, rồi chuyển yêu cầu thành MỘT lệnh gọi hàm trong database.
// Ai được làm gì là do các hàm trong database quyết định (server/schema.sql, hàm km.call) — ở đây không có phép kiểm tra quyền nào.
//
// Chạy ở đâu: trên Vercel qua api/index.js (một Vercel Function tại /api); ở máy mình qua `npm run dev` (vite.config.ts gắn
// lớp này vào /api khi có DATABASE_URL).
//
// ── Giao thức ──────────────────────────────────────────────────────────────────────────────────────────────
//   GET  /api    → { ok, database: "ok" | "not_configured" | "not_installed" | "outdated" | "unreachable", … }
//   POST /api    Content-Type: application/json, thân: { "op": "<tên lệnh>", "args": { … } }
//                Authorization: Bearer <khóa phiên>   (mọi lệnh trừ auth.signUp và auth.signIn)
//     thành công → 200 { "result": … }
//     thất bại   → mã HTTP 4xx / 5xx kèm { "error": { "code": "<mã>", "message": "<lời báo tiếng Việt>" } }
//
//   Mã lỗi: bad_request (400, 405) · invalid_credentials (400) · unauthorized (401: chưa đăng nhập / phiên hết hạn)
//           forbidden (403) · not_found (404) · conflict (409) · too_large (413) · rejected (422) · rate_limited (429)
//           server (500) · unavailable (503: database không kết nối được) · not_configured / not_installed (503)
//
// ── Các lệnh ───────────────────────────────────────────────────────────────────────────────────────────────
//   auth.signUp   { email, password, fullName, phone }  → { token, profile }     (tài khoản đầu tiên là quản lý)
//   auth.signIn   { email, password }                   → { token, profile }
//   auth.signOut  {}                                    → true
//   me            {}                                    → profile
//   me.update     { fullName?, phone? }                 → profile
//   me.password   { newPassword }                       → true                    (các phiên khác của mình bị đăng xuất)
//   accounts.list {}                                    → profile[]               (quản lý)
//   accounts.setRole     { id, role: "sale" | "manager" | "locked" } → profile    (quản lý, không phải chính mình)
//   accounts.setPassword { id, newPassword }            → true                    (quản lý; người kia bị đăng xuất)
//   sync.poll     {}                                    → { me: profile,
//                                                           fingerprints: { programs, orders, app_state } | null,
//                                                           accounts: { pending: number, stamp: string } | null }
//   sync.heads    { table }                             → [{ id, rev }]
//   sync.load     { table, ids?: string[], after?: string, limit?: number } → { rows: [{ id, rev, data }], next: string | null }
//   sync.insert   { table: "programs" | "orders", id, data } → { id, rev, code? }
//   sync.update   { table, id, rev, data }              → { id, rev } | null      (null: rev đã khác, hoặc không thấy dòng đó)
//   sync.remove   { table: "programs" | "orders", id }  → boolean
//
//   profile = { id, email, fullName, phone, role: "pending" | "sale" | "manager" | "locked", createdAt }
//   table   = "programs" | "orders" | "app_state"
//
// ── Biến môi trường (đặt ở nơi chạy lớp API, KHÔNG đưa vào mã nguồn) ───────────────────────────────────────
//   DATABASE_URL   postgres://user:password@host:port/database   — bắt buộc
//   DATABASE_CA    (không bắt buộc) chứng chỉ CA dạng PEM của máy chủ database; có thì kết nối được kiểm tra bằng chứng chỉ này.
//                  Không có: kết nối vẫn được mã hóa (TLS) nhưng không kiểm tra chứng chỉ. Thêm «?sslmode=disable» vào
//                  DATABASE_URL để tắt hẳn TLS (chỉ nên dùng với database chạy ngay trên máy mình).
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import pg from "pg";

/** Phiên bản lược đồ mà mã này cần (server/schema.sql ghi vào km.meta). */
export const SCHEMA_VERSION = "3";

/** Thân yêu cầu lớn nhất được nhận (Vercel tự chặn ở 4,5 MB; đây là mức của riêng lớp này, áp dụng ở mọi nơi chạy). */
export const MAX_BODY_BYTES = 4_400_000;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 200;
/** Tham số băm mật khẩu (scrypt). Được ghi kèm trong từng mã băm, nên nâng lên sau này không làm hỏng mật khẩu cũ. */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };

/** Lỗi trả về cho trình duyệt. */
export class ApiFail extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ───────────────────────── Database ─────────────────────────

/** @type {pg.Pool | null} */
let pool = null;
/** @type {string | null} */
let poolKey = null;
/** Số yêu cầu đang được xử lý trong tiến trình này. */
let inFlight = 0;

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const ca = process.env.DATABASE_CA ?? "";
  const key = `${url}\n${ca}`;
  if (pool && poolKey === key) return pool;
  // Tự quyết định TLS (không để thư viện suy ra từ «sslmode»): database tự dựng thường dùng chứng chỉ tự ký.
  let connectionString = url;
  let sslmode = "";
  try {
    const parsed = new URL(url);
    sslmode = parsed.searchParams.get("sslmode") ?? "";
    parsed.searchParams.delete("sslmode");
    connectionString = parsed.toString();
  } catch {
    // Chuỗi kết nối không phải dạng URL: để nguyên cho thư viện xử lý.
  }
  /** @type {pg.PoolConfig["ssl"]} */
  const ssl =
    sslmode === "disable"
      ? false
      : ca
        ? // Kiểm tra chuỗi chứng chỉ theo CA đã cho; không so tên máy (chứng chỉ của database trong cụm thường chỉ ghi tên nội bộ).
          { ca, rejectUnauthorized: true, checkServerIdentity: () => undefined }
        : { rejectUnauthorized: false };
  const created = new pg.Pool({
    connectionString,
    ssl,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    application_name: "km-api",
  });
  // Kết nối đang rảnh bị database ngắt: thư viện tự bỏ nó khỏi bể; không để lỗi này làm sập tiến trình.
  created.on("error", (error) => console.error("[km-api] kết nối rảnh bị ngắt:", error.message));
  pool = created;
  poolKey = key;
  return created;
}

/** Đóng mọi kết nối tới database. */
export async function closePool() {
  const current = pool;
  pool = null;
  poolKey = null;
  if (!current) return;
  try {
    await current.end();
  } catch (error) {
    console.error("[km-api] đóng kết nối không được:", error instanceof Error ? error.message : error);
  }
}

const KM_CODES = /** @type {Record<string, string>} */ ({
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "rejected",
  429: "rate_limited",
});

const UNAVAILABLE = "Máy chủ dữ liệu đang bận hoặc không kết nối được. Hãy thử lại sau ít phút.";

/**
 * Đổi một lỗi của database thành lỗi trả về cho trình duyệt.
 * @param {unknown} error
 * @returns {ApiFail}
 */
function fromDbError(error) {
  if (error instanceof ApiFail) return error;
  const e = /** @type {{ code?: unknown, message?: unknown }} */ (error ?? {});
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  // Lỗi do các hàm trong server/schema.sql chủ động báo: SQLSTATE «KMxxx», lời báo đã là tiếng Việt.
  const km = /^KM(\d{3})$/.exec(code);
  if (km) return new ApiFail(Number(km[1]), KM_CODES[km[1]] ?? "rejected", message);
  if (code === "23505") return new ApiFail(409, "conflict", "Bản ghi này đã có trên máy chủ.");
  // Dữ liệu sai dạng (vd chuỗi chứa ký tự \u0000 mà jsonb không nhận) hoặc vi phạm ràng buộc.
  if (/^(22|23)[0-9A-Z]{3}$/.test(code)) return new ApiFail(422, "rejected", "Dữ liệu gửi lên không hợp lệ.");
  // Chưa có schema / hàm / bảng: database chưa chạy server/schema.sql.
  if (code === "3F000" || code === "42883" || code === "42P01") {
    return new ApiFail(503, "not_installed", "Database chưa được cài đặt cho ứng dụng (chưa chạy npm run db:setup).");
  }
  // Mất kết nối, quá tải, đang tắt, hết thời gian chờ (nhóm 08, 53, 57), sai mật khẩu database (28), hoặc lỗi mạng của
  // Node (không có SQLSTATE). Mã lỗi mạng của Node có cái dài đúng 5 chữ như một SQLSTATE («EPIPE»): nhận riêng theo
  // dạng «E» + chữ cái — không SQLSTATE nào của PostgreSQL có dạng đó.
  if (/^(08|28|53|57)[0-9A-Z]{3}$/.test(code) || /^E[A-Z]+$/.test(code) || !/^[0-9A-Z]{5}$/.test(code)) {
    console.error("[km-api] database không dùng được:", code, message);
    return new ApiFail(503, "unavailable", UNAVAILABLE);
  }
  console.error("[km-api] lỗi database chưa lường:", code, message);
  return new ApiFail(500, "server", "Có lỗi trên máy chủ. Hãy thử lại.");
}

/**
 * Chạy một câu lệnh trả về đúng một giá trị (cột «r»).
 * @param {string} text
 * @param {unknown[]} params
 * @returns {Promise<any>}
 */
async function one(text, params) {
  const db = getPool();
  if (!db) throw new ApiFail(503, "not_configured", "Máy chủ chưa được cấu hình database (thiếu DATABASE_URL).");
  try {
    const result = await db.query(text, params);
    return result.rows[0]?.r ?? null;
  } catch (error) {
    throw fromDbError(error);
  }
}

// ───────────────────────── Mật khẩu và khóa phiên ─────────────────────────

/** @param {string} token */
const tokenHash = (token) => createHash("sha256").update(token).digest();

const newToken = () => randomBytes(32).toString("base64url");

/**
 * @param {string} password
 * @param {Buffer} salt
 * @param {{ N: number, r: number, p: number, keylen: number }} options
 * @returns {Promise<Buffer>}
 */
function derive(password, salt, options) {
  return new Promise((resolve, reject) => {
    // Gõ tiếng Việt trên máy khác nhau cho ra các dãy mã Unicode khác nhau của cùng một chữ: chuẩn hóa trước khi băm.
    scrypt(
      password.normalize("NFC"),
      salt,
      options.keylen,
      { N: options.N, r: options.r, p: options.p, maxmem: 256 * options.N * options.r * options.p + 1_048_576 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** @param {string} password */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * @param {string} password
 * @param {string} stored
 */
export async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  const sane = [N, r, p].every(Number.isInteger) && N >= 1024 && N <= 1_048_576 && r >= 1 && r <= 32 && p >= 1 && p <= 8;
  if (!sane || expected.length < 16 || expected.length > 128) return false;
  try {
    const key = await derive(password, salt, { N, r, p, keylen: expected.length });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Mã băm để so khi email không tồn tại, cho thời gian trả lời giống lúc email có thật. */
let dummyHash = /** @type {Promise<string> | null} */ (null);

// ───────────────────────── Đọc tham số ─────────────────────────

/**
 * @param {unknown} value
 * @param {string} problem
 * @param {number} max
 */
function text(value, problem, max) {
  if (typeof value !== "string" || value.length > max) throw new ApiFail(400, "bad_request", problem);
  return value;
}

/** @param {unknown} value */
function password(value) {
  if (typeof value !== "string" || value.length < PASSWORD_MIN) {
    throw new ApiFail(422, "rejected", `Mật khẩu phải có ít nhất ${PASSWORD_MIN} ký tự.`);
  }
  if (value.length > PASSWORD_MAX) throw new ApiFail(422, "rejected", `Mật khẩu dài tối đa ${PASSWORD_MAX} ký tự.`);
  return value;
}

/**
 * @typedef {{ token: string | null, ip: string }} Caller
 */

/**
 * Lệnh của người đã đăng nhập: database tự tìm tài khoản theo khóa phiên rồi kiểm tra quyền.
 * @param {Caller} caller
 * @param {string} op
 * @param {Record<string, unknown>} args
 */
function call(caller, op, args) {
  if (!caller.token) throw new ApiFail(401, "unauthorized", "Bạn chưa đăng nhập.");
  return one("select km.call($1::bytea, $2::text, $3::jsonb) as r", [tokenHash(caller.token), op, JSON.stringify(args)]);
}

// ───────────────────────── Các lệnh ─────────────────────────

/**
 * @param {string} op
 * @param {Record<string, unknown>} args
 * @param {Caller} caller
 * @returns {Promise<unknown>}
 */
async function run(op, args, caller) {
  switch (op) {
    case "auth.signUp": {
      const email = text(args.email, "Thiếu email.", 320);
      const fullName = text(args.fullName ?? "", "Họ tên không hợp lệ.", 500);
      const phone = text(args.phone ?? "", "Số điện thoại không hợp lệ.", 200);
      const plain = password(args.password);
      // Các lý do từ chối rẻ (email sai dạng, quá giới hạn, email đã có) được kiểm tra trước khi băm mật khẩu: băm tốn
      // nhiều sức máy, không để người lạ bắt máy chủ băm mãi cho các yêu cầu chắc chắn bị từ chối.
      if ((await one("select km.sign_up_check($1, $2) as r", [email, caller.ip])) === "exists") {
        throw new ApiFail(409, "conflict", "Email này đã được đăng ký. Hãy đăng nhập; nếu quên mật khẩu, nhờ người quản lý đặt lại.");
      }
      const hash = await hashPassword(plain);
      const token = newToken();
      const profile = await one("select km.sign_up($1, $2, $3, $4, $5::bytea, $6) as r", [
        email,
        hash,
        fullName,
        phone,
        tokenHash(token),
        caller.ip,
      ]);
      return { token, profile };
    }

    case "auth.signIn": {
      const email = text(args.email, "Thiếu email.", 320);
      if (typeof args.password !== "string" || args.password === "") throw new ApiFail(400, "bad_request", "Thiếu mật khẩu.");
      // Mật khẩu dài hơn mức cho phép thì không thể đúng: trả lời như sai mật khẩu, không tốn công băm.
      if (args.password.length > PASSWORD_MAX) throw new ApiFail(400, "invalid_credentials", "Email hoặc mật khẩu không đúng.");
      const given = args.password;
      const found = await one("select km.sign_in_begin($1, $2) as r", [email, caller.ip]);
      dummyHash ??= hashPassword(randomBytes(12).toString("hex"));
      const ok = found ? await verifyPassword(given, String(found.hash)) : (await verifyPassword(given, await dummyHash), false);
      const token = newToken();
      const profile = await one("select km.sign_in_finish($1::uuid, $2, $3, $4, $5::bytea) as r", [
        found?.id ?? null,
        ok,
        email,
        caller.ip,
        tokenHash(token),
      ]);
      if (!ok || !profile) throw new ApiFail(400, "invalid_credentials", "Email hoặc mật khẩu không đúng.");
      return { token, profile };
    }

    case "auth.signOut":
      if (caller.token) await one("select km.sign_out($1::bytea) as r", [tokenHash(caller.token)]);
      return true;

    // Hai lệnh có mật khẩu mới: băm ở đây, database chỉ nhận mã băm.
    // Phiên (và với accounts.setPassword: vai trò quản lý) được kiểm tra trước khi băm, để người không có quyền không bắt
    // được máy chủ băm mật khẩu. Database vẫn kiểm tra lại khi ghi.
    case "me.password": {
      const plain = password(args.newPassword);
      await call(caller, "me", {});
      return call(caller, op, { passwordHash: await hashPassword(plain) });
    }

    case "accounts.setPassword": {
      const plain = password(args.newPassword);
      const me = /** @type {{ role?: string } | null} */ (await call(caller, "me", {}));
      if (me?.role !== "manager") throw new ApiFail(403, "forbidden", "Chỉ người quản lý mới đặt lại được mật khẩu.");
      return call(caller, op, { id: args.id, passwordHash: await hashPassword(plain) });
    }

    default:
      return call(caller, op, args);
  }
}

/** Tình trạng của lớp API và database (không có gì bí mật: ai cũng hỏi được). */
export async function health() {
  /** @type {Record<string, unknown>} */
  const report = { ok: true, service: "km-api", expects: SCHEMA_VERSION, region: process.env.VERCEL_REGION ?? null };
  if (!process.env.DATABASE_URL) return { ...report, database: "not_configured" };
  try {
    const found = await one("select km.health() as r", []);
    const schema = found?.schema ?? null;
    return { ...report, database: schema === SCHEMA_VERSION ? "ok" : schema ? "outdated" : "not_installed", schema };
  } catch (error) {
    const code = error instanceof ApiFail ? error.code : "";
    return { ...report, database: code === "not_installed" ? "not_installed" : "unreachable" };
  }
}

// ───────────────────────── HTTP ─────────────────────────

/**
 * @typedef {{ method: string, contentType: string, authorization: string, body: string, ip: string }} ApiRequest
 * @typedef {{ status: number, body: unknown }} ApiResponse
 */

/**
 * @param {ApiRequest} request
 * @returns {Promise<ApiResponse>}
 */
async function respond(request) {
  try {
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD") return { status: 200, body: await health() };
    if (method !== "POST") throw new ApiFail(405, "bad_request", "Chỉ nhận GET và POST.");
    if (!/^application\/json\b/i.test(request.contentType)) {
      throw new ApiFail(400, "bad_request", "Yêu cầu phải có Content-Type: application/json.");
    }
    if (Buffer.byteLength(request.body, "utf8") > MAX_BODY_BYTES) {
      throw new ApiFail(413, "too_large", "Dữ liệu gửi lên quá lớn (tối đa khoảng 4 MB mỗi bản ghi).");
    }
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      throw new ApiFail(400, "bad_request", "Yêu cầu không phải JSON hợp lệ.");
    }
    const input = /** @type {{ op?: unknown, args?: unknown }} */ (parsed && typeof parsed === "object" ? parsed : {});
    const op = text(input.op, "Thiếu tên lệnh.", 64);
    const args = input.args ?? {};
    if (typeof args !== "object" || Array.isArray(args)) throw new ApiFail(400, "bad_request", "Tham số của lệnh không hợp lệ.");
    const bearer = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(request.authorization.trim());
    const result = await run(op, /** @type {Record<string, unknown>} */ (args), { token: bearer ? bearer[1] : null, ip: request.ip });
    return { status: 200, body: { result: result ?? null } };
  } catch (error) {
    const fail = error instanceof ApiFail ? error : null;
    if (!fail) console.error("[km-api] lỗi chưa lường:", error);
    return {
      status: fail?.status ?? 500,
      body: { error: { code: fail?.code ?? "server", message: fail?.message ?? "Có lỗi trên máy chủ. Hãy thử lại." } },
    };
  }
}

/**
 * Xử lý một yêu cầu. Không phụ thuộc nền tảng: Vercel, máy chủ chạy ở máy mình và các bài kiểm thử đều gọi hàm này.
 * @param {ApiRequest} request
 * @returns {Promise<ApiResponse>}
 */
export async function handle(request) {
  inFlight += 1;
  try {
    return await respond(request);
  } finally {
    inFlight -= 1;
    // Không còn yêu cầu nào đang chạy thì đóng hết kết nối database TRƯỚC khi trả lời. Trên nền serverless, tiến trình bị
    // «đóng băng» ngay sau câu trả lời cuối cùng: kết nối để ngỏ lúc đó sẽ nằm treo bên phía database và đã hỏng khi tiến
    // trình chạy lại. Các yêu cầu đến dồn (một máy đang lưu nhiều bản ghi) vẫn dùng chung kết nối vì chúng gối lên nhau.
    if (inFlight === 0 && process.env.KM_KEEP_POOL !== "1") await closePool();
  }
}

export const RESPONSE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

/**
 * Cửa vào theo chuẩn Web (Request → Response), dùng trên Vercel.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleFetch(request) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const declared = Number(request.headers.get("content-length") ?? "0");
  const tooLarge = Number.isFinite(declared) && declared > MAX_BODY_BYTES;
  const { status, body } = await handle({
    method: request.method,
    contentType: request.headers.get("content-type") ?? "",
    authorization: request.headers.get("authorization") ?? "",
    // Thân quá lớn thì không đọc vào bộ nhớ: gửi một chuỗi giữ chỗ đủ dài để `handle` trả lời 413.
    body: request.method !== "POST" ? "" : tooLarge ? " ".repeat(MAX_BODY_BYTES + 1) : await request.text(),
    ip: (request.headers.get("x-real-ip") ?? forwarded.split(",")[0]).trim(),
  });
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}
