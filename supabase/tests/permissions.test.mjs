// Kiểm thử quyền truy cập của cơ sở dữ liệu (supabase/migrations/20261121000000_init.sql), đi đúng đường mà trình duyệt đi:
// khóa công khai + phiên đăng nhập của từng vai trò, gọi thẳng PostgREST / Auth / Realtime — và cố tình gọi sai cách
// (thêm cột lạ, upsert, PUT, RPC với tham số tự chế…) để chắc rằng máy chủ là nơi giữ quyền chứ không phải giao diện.
//
// Chạy từ thư mục gốc của dự án (cần Supabase đang chạy và đã nạp file SQL):   node supabase/tests/permissions.test.mjs
//
// Địa chỉ và khóa của Supabase lấy qua ./stack.mjs — không có khóa nào ghi trong file này:
//   • đặt SUPABASE_URL, SUPABASE_KEY (khóa công khai) và SUPABASE_SECRET_KEY (khóa bí mật — chỉ dùng để dựng và dọn dữ liệu thử), hoặc
//   • để trống: hỏi bản Supabase đang chạy trên máy bằng `supabase status` (đặt SUPABASE_CLI = đường dẫn tới lệnh supabase
//     nếu đã cài sẵn; không thì dùng npx).
// Biến môi trường khác:
//   SUPABASE_DB_CONTAINER   tên container Postgres, cho các phép thử phải vào thẳng cơ sở dữ liệu bằng psql
//                           (mặc định supabase_db_badminton-mangment-sale; SKIP_PSQL=1 để bỏ qua nhóm này)
//   SKIP_REALTIME=1         bỏ qua nhóm Realtime
//
// Script tự tạo tài khoản và dữ liệu riêng (email t-<mã>-…@example.com, id test-<mã>-…), không dựa vào dữ liệu có sẵn
// và tự dọn khi xong. Những gì chỉ thử được khi «bảng trống» hoặc «hai giao dịch chen nhau» thì chạy bằng psql trong
// giao dịch có ROLLBACK, nên không để lại gì và không đụng dữ liệu của người khác.
//
// An toàn khi chạy trên cơ sở dữ liệu đang có người dùng: mọi lệnh «thử phá» (sửa / xóa bằng tài khoản không có quyền)
// chỉ nhắm vào dòng do chính lần chạy này tạo ra. Riêng hai dòng dùng chung của app_state thì chỉ ghi lại đúng nội dung
// đang có. Nhờ vậy nếu một ngày nào đó máy chủ lỡ để lọt quyền, kiểm thử báo FAIL chứ không xóa dữ liệu thật.
//
// In ra từng dòng PASS / FAIL, cuối cùng là tổng kết; có FAIL thì thoát với mã khác 0.

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { stack } from "./stack.mjs";

// Địa chỉ, khóa công khai và khóa bí mật: từ biến môi trường hoặc từ bản Supabase đang chạy trên máy (xem stack.mjs).
const { url: URL_BASE, key: KEY, secret: SECRET } = stack();
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_badminton-mangment-sale";
/** Supabase đang thử có chạy trên chính máy này không (khi đó mới vào được cơ sở dữ liệu bằng psql trong container). */
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(URL_BASE);

const TAG = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PREFIX = `test-${TAG}-`;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// ───────────────────────── Khung kiểm thử tí hon ─────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

const brief = (value, max = 400) => {
  if (value === undefined) return "";
  const text = (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s*\n\s*/g, " ⏎ ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL  ${name}${detail === undefined ? "" : `\n        → ${brief(detail, 1200)}`}`);
  }
  return Boolean(condition);
}

function skip(name, reason) {
  skipped += 1;
  console.log(`SKIP  ${name} — ${reason}`);
}

const note = (text) => console.log(`NOTE  ${text}`);
const section = (title) => console.log(`\n── ${title}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chờ tới khi `predicate()` đúng; trả về false nếu hết giờ. */
async function until(predicate, timeoutMs, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(stepMs);
  }
}

// ───────────────────────── Gọi máy chủ ─────────────────────────

const AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const newClient = (key = KEY) => createClient(URL_BASE, key, { auth: AUTH_OPTIONS });
/** Khóa bí mật: bỏ qua RLS. Chỉ để dựng dữ liệu thử, xem kết quả thật trong bảng, và dọn dẹp. */
const adminDb = newClient(SECRET);

/**
 * Gọi PostgREST trực tiếp. `token` null = chưa đăng nhập (chỉ có khóa công khai).
 * Trả về { status, body, headers }; ghi (POST/PATCH/PUT/DELETE) mặc định xin trả về các dòng đã ghi.
 */
async function api(token, method, path, { body, rawBody, headers = {} } = {}) {
  const write = method !== "GET" && method !== "HEAD";
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      ...(write && !path.startsWith("rpc/") ? { Prefer: "return=representation" } : {}),
      ...headers,
    },
    body: payload,
  });
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

const rpc = (token, fn, args = {}) => api(token, "POST", `rpc/${fn}`, { body: args });

const ok = (r) => r.status >= 200 && r.status < 300;
/** Máy chủ từ chối vì thiếu quyền (lỗi 42501 của Postgres → 401 khi chưa đăng nhập, 403 khi đã đăng nhập). */
const denied = (r) => (r.status === 401 || r.status === 403) && r.body?.code === "42501";
/** Lệnh chạy được nhưng không đụng tới dòng nào (RLS lọc hết). */
const noRows = (r) => ok(r) && Array.isArray(r.body) && r.body.length === 0;
/** Không ghi / không đọc được gì, bằng cách này hay cách kia. */
const blocked = (r) => denied(r) || noRows(r);
const rows = (r) => (ok(r) && Array.isArray(r.body) ? r.body : []);
const show = (r) => ({ status: r.status, body: r.body });

/**
 * Nội dung hiện có của một dòng app_state, nguyên văn JSON như máy chủ đang giữ (đọc bằng khóa bí mật).
 * Các lệnh «thử ghi» vào hai dòng dùng chung này gửi lại đúng nội dung đó: nếu máy chủ lỡ cho ghi thì dữ liệu vẫn y nguyên.
 */
async function currentStateText(key) {
  const res = await fetch(`${URL_BASE}/rest/v1/app_state?key=eq.${key}&select=data::text`, { headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } });
  const body = await res.json();
  if (!res.ok || typeof body?.[0]?.data !== "string") throw new Error(`Không đọc được app_state.${key} bằng khóa bí mật: ${brief(body)}`);
  return body[0].data;
}

/** Ngày xa trong tương lai, dùng cho các lệnh thử ghi vào bảng bộ đếm: có lọt quyền cũng không đụng bộ đếm thật. */
const FAR_DAY = "2031-01-01";
let counterRowLeaked = false;
const counterInsert = async (token) => {
  const r = await api(token, "POST", "order_counters", { body: { day: FAR_DAY, last: 1 } });
  if (ok(r)) counterRowLeaked = true;
  return r;
};

/** Số dòng mà tài khoản này đếm được (đếm chính xác, sau khi RLS lọc). */
async function exactCount(token, path) {
  const r = await api(token, "HEAD", path, { headers: { Prefer: "count=exact" } });
  const total = (r.headers.get("content-range") ?? "").split("/")[1];
  return ok(r) && total !== undefined && total !== "*" ? Number(total) : null;
}

const allUsers = [];

/** Đăng ký một tài khoản thử. Tài khoản mới luôn ở trạng thái chờ duyệt. */
async function newUser(name, { password = "matkhau-thu-1", meta } = {}) {
  const email = `t-${TAG}-${name}@example.com`;
  const client = newClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: meta ?? { full_name: `Thử ${name}`, phone: "0900 000 000" } },
  });
  if (error) throw new Error(`Không đăng ký được tài khoản thử «${name}»: ${error.message}`);
  if (!data.session) {
    throw new Error("Đăng ký không trả về phiên đăng nhập: project đang bật xác nhận email. Kiểm thử này cần tắt «Confirm email».");
  }
  const user = { name, email, password, id: data.user.id, client, token: data.session.access_token, refreshToken: data.session.refresh_token };
  allUsers.push(user);
  return user;
}

async function signIn(email, password) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { client, ok: !error && Boolean(data.session), token: data.session?.access_token ?? null, message: error?.message ?? "" };
}

/** Dòng thật trong bảng (đọc bằng khóa bí mật). */
async function truth(table, column, value, columns = "*") {
  const { data, error } = await adminDb.from(table).select(columns).eq(column, value).maybeSingle();
  if (error) throw new Error(`Không đọc được ${table} bằng khóa bí mật: ${error.message}`);
  return data;
}

async function setRoleDirect(id, role) {
  const { error } = await adminDb.from("profiles").update({ role }).eq("id", id);
  if (error) throw new Error(`Không đặt được vai trò thử: ${error.message}`);
}

const sha256Hex = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
/** Chuỗi "id:rev,id:rev,…" xếp theo id theo thứ tự byte (UTF-8) — đúng cách hàm sync_fingerprint() trên máy chủ làm. */
const fingerprintOf = (heads) =>
  sha256Hex(
    [...heads]
      .sort((a, b) => Buffer.compare(Buffer.from(a.id, "utf8"), Buffer.from(b.id, "utf8")))
      .map((head) => `${head.id}:${head.rev}`)
      .join(","),
  );

// ───────────────────────── psql (cho những gì không thử được qua API) ─────────────────────────

const psqlArgs = ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"];

function psql(sql) {
  const r = spawnSync("docker", psqlArgs, { input: sql, encoding: "utf8", timeout: 60_000 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() || (r.error ? String(r.error.message) : "") };
}

function psqlAsync(sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", psqlArgs);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", (error) => resolve({ ok: false, out: out.trim(), err: String(error.message) }));
    child.on("close", (code) => resolve({ ok: code === 0, out: out.trim(), err: err.trim() }));
    child.stdin.end(sql);
  });
}

/** Đầu một phiên psql đóng vai một tài khoản đã đăng nhập (như PostgREST làm với mỗi yêu cầu). */
const actAs = (userId) =>
  `set local role authenticated;\nselect set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true) is null;\n`;

/** Chờ tới khi phiên kia đã giữ «khóa đánh dấu» (nghĩa là nó đã làm xong phần việc của mình và đang chưa commit). */
const waitForMarker = (marker) => `do $$
begin
  for i in 1..200 loop
    exit when exists (select 1 from pg_locks where locktype = 'advisory' and classid = 0 and objid = ${marker} and objsubid = 1 and granted);
    perform pg_sleep(0.05);
  end loop;
end $$;\n`;

// ───────────────────────── Dữ liệu thử ─────────────────────────

const oid = (n) => `${PREFIX}o-${n}`;
const pid = (n) => `${PREFIX}p-${n}`;
const orderDoc = (id, programId, extra = {}) => ({ id, code: "", programId, status: "draft", customerName: "Khách thử", lines: [], gifts: [], ...extra });

function vnDatePrefix(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "2-digit", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `DH${parts.year}${parts.month}${parts.day}-`;
}

const codeNumber = (code) => Number(String(code).split("-")[1]);
const formatSeq = (n) => (n < 1000 ? String(n).padStart(3, "0") : String(n));

/**
 * Số `high` có phải là số kế tiếp của `low` trong dãy mã của ngày `day` ("DHyymmdd-") không?
 * Cơ sở dữ liệu có thể đang được người khác dùng chung, nên chấp nhận các số ở giữa NẾU mỗi số đó đang có một đơn giữ:
 * đơn của người khác (không phải của lần chạy này), hoặc đơn nêu trong `mine`. Hụt số mà không ai giữ = sai.
 */
async function isNextInSequence(day, low, high, mine = []) {
  if (!Number.isInteger(low) || !Number.isInteger(high) || high <= low || high - low > 200) return false;
  if (high === low + 1) return true;
  const between = Array.from({ length: high - low - 1 }, (_, i) => day + formatSeq(low + 1 + i));
  const { data } = await adminDb.from("orders").select("id, code").in("code", between);
  const held = new Set((data ?? []).filter((o) => !o.id.startsWith(PREFIX) || mine.includes(o.id)).map((o) => o.code));
  return between.every((code) => held.has(code));
}

const realtimeChannels = [];

// ═════════════════════════ Kiểm thử ═════════════════════════

async function main() {
  console.log(`Máy chủ: ${URL_BASE}   mã lần chạy: ${TAG}`);

  // ───────────────────────── Tài khoản ─────────────────────────
  section("Đăng ký và duyệt tài khoản");

  // Cơ sở dữ liệu vừa dựng xong (chưa có tài khoản nào) thì tài khoản đầu tiên của lần chạy này đúng ra phải thành quản lý.
  const before = await adminDb.from("profiles").select("id", { count: "exact", head: true });
  const emptyServer = before.count === 0;

  const M = await newUser("m");
  const M2 = await newUser("m2");
  const S1 = await newUser("s1");
  const S2 = await newUser("s2");
  const S3 = await newUser("s3");
  // Tự khai «role: manager» trong thông tin đăng ký — máy chủ không được tin.
  const P = await newUser("p", { meta: { full_name: `   Thử p ${"x".repeat(200)}   `, phone: `  ${"9".repeat(60)}  `, role: "manager", app_role: "manager" } });
  const L = await newUser("l");

  const pProfile = await truth("profiles", "id", P.id);
  check("tài khoản mới đăng ký ở trạng thái chờ duyệt, dù tự khai role trong thông tin đăng ký", pProfile?.role === "pending", pProfile);
  check(
    "hồ sơ được tạo ngay khi đăng ký: email đúng, họ tên gọn khoảng trắng và tối đa 120 ký tự, điện thoại tối đa 40",
    pProfile?.email === P.email && pProfile.full_name.length === 120 && pProfile.full_name.startsWith("Thử p x") && pProfile.phone === "9".repeat(40),
    pProfile,
  );
  const fresh = await adminDb.from("profiles").select("id, role").in("id", [M.id, M2.id, S1.id, S2.id, S3.id, L.id]);
  check(
    emptyServer
      ? "máy chủ chưa có tài khoản nào: tài khoản đầu tiên thành quản lý, mọi tài khoản sau đều là pending"
      : "mọi tài khoản đăng ký sau tài khoản đầu tiên đều là pending",
    (fresh.data ?? []).length === 6 && fresh.data.every((p) => p.role === (emptyServer && p.id === M.id ? "manager" : "pending")),
    fresh.data,
  );

  // Trong cơ sở dữ liệu dùng chung đã có tài khoản khác, nên «tài khoản đầu tiên là quản lý» được thử riêng bằng psql (cuối file).
  await setRoleDirect(M.id, "manager");

  for (const [user, role] of [[S1, "sale"], [S2, "sale"], [S3, "sale"], [M2, "manager"], [L, "locked"]]) {
    const r = await rpc(M.token, "admin_set_role", { target: user.id, new_role: role });
    check(`quản lý đặt vai trò ${role} cho tài khoản ${user.name} bằng admin_set_role`, ok(r) && r.body?.id === user.id && r.body?.role === role, show(r));
  }

  // Một chương trình và vài đơn dùng xuyên suốt.
  const P1 = pid("chung");
  {
    // Trình duyệt chỉ được gửi (id, data) khi thêm dòng. Gửi kèm cột khác là cả lệnh bị từ chối.
    const doc = { id: P1, name: "Chương trình thử" };
    const extras = {
      rev: await api(M.token, "POST", "programs", { body: { id: P1, rev: 50, data: doc } }),
      updated_by: await api(M.token, "POST", "programs", { body: { id: P1, updated_by: S1.id, data: doc } }),
      updated_at: await api(M.token, "POST", "programs", { body: { id: P1, updated_at: "2000-01-01T00:00:00Z", data: doc } }),
    };
    check(
      "quản lý tạo chương trình kèm rev / updated_by / updated_at tự đặt: bị từ chối, không có gì được tạo",
      Object.values(extras).every(denied) && (await truth("programs", "id", P1)) === null,
      Object.fromEntries(Object.entries(extras).map(([k, r]) => [k, show(r)])),
    );
    const r = await api(M.token, "POST", "programs", { body: { id: P1, data: doc } });
    const row = rows(r)[0];
    check("quản lý tạo chương trình với (id, data): rev = 1, người sửa = chính mình", r.status === 201 && row?.rev === 1 && row.updated_by === M.id, show(r));
  }

  const O1 = oid("s1-a");
  const O2 = oid("s2-a");
  let o1Created;
  {
    const extras = {
      "owner_id của người khác": await api(S1.token, "POST", "orders", { body: { id: O1, owner_id: S2.id, data: orderDoc(O1, P1) } }),
      "owner_id của chính mình": await api(S1.token, "POST", "orders", { body: { id: O1, owner_id: S1.id, data: orderDoc(O1, P1) } }),
      rev: await api(S1.token, "POST", "orders", { body: { id: O1, rev: 99, data: orderDoc(O1, P1) } }),
      created_at: await api(S1.token, "POST", "orders", { body: { id: O1, created_at: "2000-01-01T00:00:00Z", data: orderDoc(O1, P1) } }),
      updated_at: await api(S1.token, "POST", "orders", { body: { id: O1, updated_at: "2000-01-01T00:00:00Z", data: orderDoc(O1, P1) } }),
    };
    check(
      "sale tạo đơn kèm owner_id / rev / created_at / updated_at tự đặt: bị từ chối, không có gì được tạo",
      Object.values(extras).every(denied) && (await truth("orders", "id", O1)) === null,
      Object.fromEntries(Object.entries(extras).map(([k, r]) => [k, show(r)])),
    );
    const r = await api(S1.token, "POST", "orders", { body: { id: O1, data: orderDoc(O1, P1) } });
    const row = rows(r)[0];
    o1Created = row?.created_at;
    const today = [vnDatePrefix(), vnDatePrefix(new Date(Date.now() - 60_000))];
    check("sale tạo đơn với (id, data): thành công", r.status === 201 && row?.id === O1, show(r));
    check("sale tạo đơn: chủ đơn là chính mình", row?.owner_id === S1.id, row?.owner_id);
    // (Cho phép đồng hồ máy chạy kiểm thử lệch đồng hồ máy chủ tới 10 phút.)
    check("sale tạo đơn: rev = 1, created_at và updated_at do máy chủ đặt (là lúc này)", row?.rev === 1 && Math.abs(Date.parse(row?.created_at) - Date.now()) < 600_000 && row?.updated_at === row?.created_at, row);
    check(
      "sale tạo đơn với mã rỗng: máy chủ cấp mã DHyymmdd-NNN theo ngày Việt Nam, ghi vào cả data.code",
      /^DH\d{6}-\d{3,}$/.test(row?.code ?? "") && today.some((p) => row.code.startsWith(p)) && row.data?.code === row.code,
      { code: row?.code, today },
    );
    check("cột sinh tự động program_id / status khớp với tài liệu", row?.program_id === P1 && row?.status === "draft", row);
  }
  {
    const r = await api(S2.token, "POST", "orders", { body: { id: O2, data: orderDoc(O2, P1, { note: "bí mật của s2" }) } });
    check("sale thứ hai tạo đơn của mình", r.status === 201 && rows(r)[0]?.owner_id === S2.id, show(r));
  }
  const o1Code = (await truth("orders", "id", O1)).code;
  const o2Before = await truth("orders", "id", O2);

  // ───────────────────────── Chưa đăng nhập ─────────────────────────
  section("Chưa đăng nhập (anon): không được gì");

  const settingsText = await currentStateText("settings");
  const stockText = await currentStateText("stock");
  const anonProbes = {
    profiles: {
      insert: () => api(null, "POST", "profiles", { body: { id: randomUUID(), full_name: "x" } }),
      update: () => api(null, "PATCH", `profiles?id=eq.${S1.id}`, { body: { full_name: "x" } }),
      remove: () => api(null, "DELETE", `profiles?id=eq.${S1.id}&email=eq.khong-co`),
    },
    programs: {
      insert: () => api(null, "POST", "programs", { body: { id: pid("anon"), data: {} } }),
      update: () => api(null, "PATCH", `programs?id=eq.${P1}`, { body: { data: { id: P1, name: "hack" } } }),
      remove: () => api(null, "DELETE", `programs?id=eq.${pid("anon")}`),
    },
    orders: {
      insert: () => api(null, "POST", "orders", { body: { id: oid("anon"), data: orderDoc(oid("anon"), P1) } }),
      update: () => api(null, "PATCH", `orders?id=eq.${O1}`, { body: { data: orderDoc(O1, P1, { note: "hack" }) } }),
      remove: () => api(null, "DELETE", `orders?id=eq.${oid("anon")}`),
    },
    app_state: {
      insert: () => api(null, "POST", "app_state", { body: { key: "stock", data: {} } }),
      update: () => api(null, "PATCH", "app_state?key=eq.settings", { rawBody: `{"data": ${settingsText}}` }),
      remove: () => api(null, "DELETE", "app_state?key=eq.settings&rev=eq.-1"),
    },
    order_counters: {
      insert: () => counterInsert(null),
      update: () => api(null, "PATCH", `order_counters?day=eq.${FAR_DAY}`, { body: { last: 1 } }),
      remove: () => api(null, "DELETE", `order_counters?day=eq.${FAR_DAY}`),
    },
  };
  for (const [table, probe] of Object.entries(anonProbes)) {
    const read = await api(null, "GET", `${table}?select=*`);
    const head = await api(null, "HEAD", `${table}?select=*`, { headers: { Prefer: "count=exact" } });
    const insert = await probe.insert();
    const update = await probe.update();
    const remove = await probe.remove();
    check(
      `anon không đọc / đếm / thêm / sửa / xóa được bảng ${table}`,
      denied(read) && head.status === 401 && denied(insert) && denied(update) && denied(remove),
      { read: show(read), head: head.status, insert: show(insert), update: show(update), remove: show(remove) },
    );
  }
  for (const [fn, args] of [
    ["ensure_profile", {}],
    ["is_member", {}],
    ["is_manager", {}],
    ["sync_fingerprint", {}],
    ["create_profile", { target: S1.id }],
    ["admin_set_role", { target: S1.id, new_role: "manager" }],
    ["admin_set_password", { target: S1.id, new_password: "hacked-123" }],
  ]) {
    const r = await rpc(null, fn, args);
    check(`anon không gọi được hàm ${fn}()`, denied(r), show(r));
  }
  {
    const r = await api(null, "GET", "");
    const paths = Object.keys(r.body?.paths ?? {}).filter((p) => p !== "/");
    check("anon không thấy bảng hay hàm nào trong mô tả API (OpenAPI)", ok(r) && paths.length === 0 && Object.keys(r.body?.definitions ?? {}).length === 0, paths);
  }
  {
    const forged = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ role: "service_role", sub: M.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.`;
    const r = await api(forged, "GET", "orders?select=id");
    check("token tự chế (không chữ ký, tự khai service_role) bị từ chối", r.status === 401 || r.status === 403, show(r));
    const other = await api(S1.token, "GET", "users?select=id", { headers: { "Accept-Profile": "auth" } });
    check("không đọc được lược đồ auth qua API (Accept-Profile: auth)", !ok(other), show(other));
  }

  // ───────────────────────── Chờ duyệt / bị khóa ─────────────────────────
  for (const [user, role] of [[P, "pending"], [L, "locked"]]) {
    section(`Tài khoản ${role}: chỉ đọc và sửa được họ tên / điện thoại của chính mình`);
    const t = user.token;

    const reads = await Promise.all(["programs?select=*", "orders?select=*", "app_state?select=*"].map((path) => api(t, "GET", path)));
    const counts = await Promise.all(["programs?select=id", "orders?select=id", "app_state?select=key"].map((path) => exactCount(t, path)));
    check(`${role}: không thấy chương trình, đơn hàng, tồn kho / thiết lập nào`, reads.every(noRows) && counts.every((n) => n === 0), { reads: reads.map(show), counts });

    const byId = await api(t, "GET", `orders?id=eq.${O1}&select=*`);
    const byProgram = await api(t, "GET", `programs?id=eq.${P1}&select=*`);
    check(`${role}: hỏi đích danh id của đơn / chương trình cũng không ra`, noRows(byId) && noRows(byProgram), { byId: show(byId), byProgram: show(byProgram) });

    const own = await api(t, "GET", "profiles?select=*");
    check(`${role}: bảng hồ sơ chỉ có đúng một dòng — của chính mình`, rows(own).length === 1 && rows(own)[0].id === user.id && rows(own)[0].role === role, show(own));

    const newOrderId = oid(`${role}-x`);
    const insertOrder = await api(t, "POST", "orders", { body: { id: newOrderId, data: orderDoc(newOrderId, P1) } });
    const insertOrderAsOwner = await api(t, "POST", "orders", { body: { id: newOrderId, owner_id: user.id, data: orderDoc(newOrderId, P1, { code: "X-1" }) } });
    check(`${role}: không tạo được đơn`, denied(insertOrder) && denied(insertOrderAsOwner) && (await truth("orders", "id", newOrderId)) === null, { insertOrder: show(insertOrder) });

    const editOrder = await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { data: orderDoc(O1, P1, { note: "hack" }) } });
    const dropOrder = await api(t, "DELETE", `orders?id=eq.${O1}`);
    check(`${role}: không sửa / xóa được đơn của ai`, noRows(editOrder) && noRows(dropOrder) && (await truth("orders", "id", O1))?.rev === 1, { editOrder: show(editOrder), dropOrder: show(dropOrder) });

    const insertProgram = await api(t, "POST", "programs", { body: { id: pid(`${role}-x`), data: {} } });
    const editProgram = await api(t, "PATCH", `programs?id=eq.${P1}`, { body: { data: { hack: true } } });
    const dropProgram = await api(t, "DELETE", `programs?id=eq.${P1}`);
    check(`${role}: không thêm / sửa / xóa được chương trình`, denied(insertProgram) && noRows(editProgram) && noRows(dropProgram) && (await truth("programs", "id", P1))?.rev === 1, {
      insertProgram: show(insertProgram),
      editProgram: show(editProgram),
      dropProgram: show(dropProgram),
    });

    const editState = await api(t, "PATCH", "app_state?key=eq.settings", { rawBody: `{"data": ${settingsText}}` });
    const editStock = await api(t, "PATCH", "app_state?key=eq.stock", { rawBody: `{"data": ${stockText}}` });
    const upsertState = await api(t, "POST", "app_state?on_conflict=key", { rawBody: `{"key": "settings", "data": ${settingsText}}`, headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
    const dropState = await api(t, "DELETE", "app_state?key=eq.settings&rev=eq.-1");
    check(`${role}: không sửa / ghi đè / xóa được tồn kho, thiết lập`, noRows(editState) && noRows(editStock) && denied(upsertState) && denied(dropState), { editState: show(editState), editStock: show(editStock), upsertState: show(upsertState), dropState: show(dropState) });

    const counters = [await api(t, "GET", "order_counters?select=*"), await counterInsert(t), await api(t, "PATCH", `order_counters?day=eq.${FAR_DAY}`, { body: { last: 0 } }), await api(t, "DELETE", `order_counters?day=eq.${FAR_DAY}`)];
    check(`${role}: không đọc / ghi được bảng bộ đếm mã đơn`, counters.every(denied), counters.map(show));

    const rename = await api(t, "PATCH", `profiles?id=eq.${user.id}`, { body: { full_name: `   Tên mới ${role}   `, phone: " 0912 345 678 " } });
    check(`${role}: sửa được họ tên và điện thoại của mình (máy chủ gọn khoảng trắng)`, rows(rename).length === 1 && rows(rename)[0].full_name === `Tên mới ${role}` && rows(rename)[0].phone === "0912 345 678", show(rename));

    const others = await api(t, "PATCH", `profiles?id=eq.${S1.id}`, { body: { full_name: "hack" } });
    const everyone = await api(t, "PATCH", `profiles?email=like.t-${TAG}-*`, { body: { phone: "000" } });
    check(
      `${role}: không sửa được hồ sơ của người khác (kể cả khi lọc cả loạt tài khoản)`,
      noRows(others) && rows(everyone).length === 1 && rows(everyone)[0].id === user.id && (await truth("profiles", "id", S1.id)).phone === "0900 000 000",
      { others: show(others), everyone: show(everyone) },
    );

    const attempts = {
      "sửa thẳng cột role": await api(t, "PATCH", `profiles?id=eq.${user.id}`, { body: { role: "manager" } }),
      "sửa họ tên kèm role": await api(t, "PATCH", `profiles?id=eq.${user.id}`, { body: { full_name: "x", role: "sale" } }),
      "upsert hồ sơ với role": await api(t, "POST", "profiles?on_conflict=id", { body: { id: user.id, role: "manager" }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
      "PUT cả hồ sơ với role": await api(t, "PUT", `profiles?id=eq.${user.id}`, { body: { id: user.id, email: user.email, full_name: "x", phone: "", role: "manager", created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }),
      "admin_set_role cho chính mình": await rpc(t, "admin_set_role", { target: user.id, new_role: "sale" }),
      "admin_set_role cho người khác": await rpc(t, "admin_set_role", { target: S1.id, new_role: "locked" }),
      "admin_set_password": await rpc(t, "admin_set_password", { target: M.id, new_password: "hacked-123" }),
      "create_profile": await rpc(t, "create_profile", { target: user.id }),
    };
    const stillRole = (await truth("profiles", "id", user.id)).role;
    check(
      `${role}: mọi cách tự nâng quyền đều bị từ chối (${Object.keys(attempts).length} cách), vai trò vẫn là ${role}`,
      Object.values(attempts).every(denied) && stillRole === role,
      Object.fromEntries(Object.entries(attempts).map(([k, r]) => [k, show(r)])),
    );

    const mine = await rpc(t, "ensure_profile");
    check(`${role}: ensure_profile() trả về hồ sơ của chính mình`, ok(mine) && mine.body?.id === user.id && mine.body?.role === role, show(mine));
    const flags = [await rpc(t, "is_member"), await rpc(t, "is_manager")];
    check(`${role}: is_member() và is_manager() đều là false`, flags.every((r) => ok(r) && r.body === false), flags.map(show));
    const fp = await rpc(t, "sync_fingerprint");
    check(
      `${role}: sync_fingerprint() là hash của chuỗi rỗng cho cả ba bảng (không lộ gì)`,
      ok(fp) && fp.body?.programs === EMPTY_SHA256 && fp.body?.orders === EMPTY_SHA256 && fp.body?.app_state === EMPTY_SHA256,
      show(fp),
    );
  }

  // ───────────────────────── Sale ─────────────────────────
  section("Sale: đọc chương trình / tồn kho, không ghi được; đơn hàng chỉ của mình");
  {
    const t = S1.token;
    const programs = await api(t, "GET", `programs?id=eq.${P1}&select=id,rev,data`);
    check("sale đọc được chương trình", rows(programs).length === 1 && rows(programs)[0].data?.name === "Chương trình thử", show(programs));
    const state = await api(t, "GET", "app_state?select=key,rev,data&order=key");
    check("sale đọc được hai dòng tồn kho / thiết lập", isDeepStrictEqual(rows(state).map((r) => r.key), ["settings", "stock"]), show(state));

    const writes = {
      "thêm chương trình": await api(t, "POST", "programs", { body: { id: pid("sale-x"), data: { name: "lậu" } } }),
      "sửa chương trình": await api(t, "PATCH", `programs?id=eq.${P1}`, { body: { data: { name: "hack" } } }),
      "upsert đè chương trình": await api(t, "POST", "programs?on_conflict=id", { body: { id: P1, data: { name: "hack" } }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
      "PUT đè chương trình": await api(t, "PUT", `programs?id=eq.${P1}`, { body: { id: P1, data: { name: "hack" } } }),
      "xóa chương trình": await api(t, "DELETE", `programs?id=eq.${P1}`),
      "xóa cả loạt chương trình": await api(t, "DELETE", `programs?id=like.${PREFIX}*`),
      "sửa thiết lập": await api(t, "PATCH", "app_state?key=eq.settings", { rawBody: `{"data": ${settingsText}}` }),
      "sửa tồn kho": await api(t, "PATCH", "app_state?key=eq.stock", { rawBody: `{"data": ${stockText}}` }),
      "upsert đè thiết lập": await api(t, "POST", "app_state?on_conflict=key", { rawBody: `{"key": "settings", "data": ${settingsText}}`, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
      "PUT đè tồn kho": await api(t, "PUT", "app_state?key=eq.stock", { rawBody: `{"key": "stock", "data": ${stockText}}` }),
      "thêm dòng app_state": await api(t, "POST", "app_state", { body: { key: "stock", data: {} } }),
      "xóa app_state": await api(t, "DELETE", "app_state?key=eq.stock&rev=eq.-1"),
      "đọc bộ đếm mã đơn": await api(t, "GET", "order_counters?select=*"),
      "ghi bộ đếm mã đơn": await counterInsert(t),
      "sửa bộ đếm mã đơn": await api(t, "PATCH", `order_counters?day=eq.${FAR_DAY}`, { body: { last: 0 } }),
      "xóa bộ đếm mã đơn": await api(t, "DELETE", `order_counters?day=eq.${FAR_DAY}`),
    };
    const program = await truth("programs", "id", P1);
    const stateRows = await adminDb.from("app_state").select("key, updated_by");
    check(
      `sale không ghi được chương trình, tồn kho / thiết lập, bộ đếm — bằng bất kỳ cách nào (${Object.keys(writes).length} cách)`,
      Object.values(writes).every(blocked) && program.rev === 1 && program.data.name === "Chương trình thử" && (stateRows.data ?? []).length === 2 && stateRows.data.every((row) => row.updated_by !== S1.id),
      Object.fromEntries(Object.entries(writes).filter(([, r]) => !blocked(r)).map(([k, r]) => [k, show(r)])),
    );

    // Đơn hàng: chỉ thấy đơn của mình.
    const list = await api(t, "GET", "orders?select=id,owner_id");
    check("sale chỉ thấy đơn của mình trong danh sách", rows(list).length >= 1 && rows(list).every((o) => o.owner_id === S1.id) && !rows(list).some((o) => o.id === O2), show(list));
    const probes = {
      "theo id": await api(t, "GET", `orders?id=eq.${O2}&select=*`),
      "theo mã đơn": await api(t, "GET", `orders?code=eq.${o2Before.code}&select=*`),
      "theo chủ đơn": await api(t, "GET", `orders?owner_id=eq.${S2.id}&select=*`),
      "bằng or=()": await api(t, "GET", `orders?or=(id.eq.${O2},owner_id.eq.${S2.id})&select=*`),
      "theo nội dung JSON": await api(t, "GET", `orders?data->>note=eq.${encodeURIComponent("bí mật của s2")}&select=*`),
    };
    check("sale không đọc được đơn của sale khác dù lọc theo id / mã / chủ đơn / nội dung", Object.values(probes).every(noRows), Object.fromEntries(Object.entries(probes).map(([k, r]) => [k, show(r)])));
    const mineCount = await exactCount(t, "orders?select=id");
    const theirsCount = await exactCount(t, `orders?select=id&owner_id=eq.${S2.id}`);
    check("sale đếm (count=exact) cũng chỉ ra đơn của mình", mineCount === rows(list).length && theirsCount === 0, { mineCount, theirsCount });
    const embed = await api(t, "GET", "orders?select=id,profiles(*)");
    check("không lần được từ đơn hàng sang hồ sơ người khác bằng embed", !ok(embed), show(embed));

    const profiles = await api(t, "GET", "profiles?select=*");
    check("sale chỉ thấy hồ sơ của chính mình", rows(profiles).length === 1 && rows(profiles)[0].id === S1.id, show(profiles));

    // Đụng vào đơn của người khác.
    const attacks = {
      "sửa": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { data: orderDoc(O2, P1, { note: "hack" }) } }),
      "sửa chủ đơn về mình": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { owner_id: S1.id } }),
      "sửa cả loạt đơn không phải của mình": await api(t, "PATCH", `orders?id=like.${PREFIX}*&owner_id=neq.${S1.id}`, { body: { owner_id: S1.id } }),
      "xóa": await api(t, "DELETE", `orders?id=eq.${O2}`),
      "xóa cả loạt đơn không phải của mình": await api(t, "DELETE", `orders?id=like.${PREFIX}*&owner_id=neq.${S1.id}`),
      "upsert đè (merge-duplicates)": await api(t, "POST", "orders?on_conflict=id", { body: { id: O2, data: orderDoc(O2, P1, { note: "hack" }) }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
      "upsert đè kèm owner_id": await api(t, "POST", "orders?on_conflict=id", { body: { id: O2, owner_id: S1.id, data: orderDoc(O2, P1, { note: "hack" }) }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
      "PUT đè": await api(t, "PUT", `orders?id=eq.${O2}`, { body: { id: O2, data: orderDoc(O2, P1, { note: "hack" }) } }),
    };
    const o2After = await truth("orders", "id", O2);
    check(
      "sale không sửa / xóa / chiếm được đơn của sale khác (8 cách); đơn đó còn nguyên",
      Object.values(attacks).every(blocked) && isDeepStrictEqual(o2After, o2Before),
      { failed: Object.fromEntries(Object.entries(attacks).filter(([, r]) => !blocked(r)).map(([k, r]) => [k, show(r)])), o2After },
    );

    // Đơn của mình: trình duyệt chỉ có quyền ghi đúng cột data. Gửi kèm bất kỳ cột nào khác (kể cả id) là cả lệnh bị từ chối;
    // upsert và PUT cũng vậy, vì chúng phải ghi lại cột id.
    const o1Before = await truth("orders", "id", O1);
    const movedId = oid("s1-doi-id");
    const o1Doc = orderDoc(O1, P1, { note: "kèm cột lạ" });
    const mergeDuplicates = { Prefer: "resolution=merge-duplicates,return=representation" };
    const columnWrites = {
      "owner_id → sale khác": await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { owner_id: S2.id } }),
      "owner_id → chính mình": await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { owner_id: S1.id } }),
      "owner_id kèm data": await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { owner_id: S2.id, data: o1Doc } }),
      "rev kèm data": await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { rev: 500, data: o1Doc } }),
      "created_at kèm data": await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { created_at: "2000-01-01T00:00:00Z", data: o1Doc } }),
      "updated_at kèm data": await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { updated_at: "2000-01-01T00:00:00Z", data: o1Doc } }),
      "đổi id": await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { id: movedId } }),
      "đổi id kèm data": await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { id: movedId, data: orderDoc(movedId, P1) } }),
      "upsert (merge-duplicates) lên đơn của mình": await api(t, "POST", "orders?on_conflict=id", { body: { id: O1, data: o1Doc }, headers: mergeDuplicates }),
      "upsert (merge-duplicates) với id chưa có": await api(t, "POST", "orders?on_conflict=id", { body: { id: movedId, data: orderDoc(movedId, P1) }, headers: mergeDuplicates }),
      "PUT lên đơn của mình": await api(t, "PUT", `orders?id=eq.${O1}`, { body: { id: O1, data: o1Doc } }),
    };
    check(
      `sale chỉ ghi được cột data của đơn mình: gửi kèm owner_id / rev / created_at / updated_at, đổi id, upsert, PUT đều bị từ chối (${Object.keys(columnWrites).length} cách); đơn còn nguyên`,
      Object.values(columnWrites).every(denied) && isDeepStrictEqual(await truth("orders", "id", O1), o1Before) && (await truth("orders", "id", movedId)) === null,
      Object.fromEntries(Object.entries(columnWrites).filter(([, r]) => !denied(r)).map(([k, r]) => [k, show(r)])),
    );
    const giveAway = await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { owner_id: null } });
    check("sale không bỏ được chủ đơn (owner_id = null): bị từ chối, chủ đơn vẫn là mình", denied(giveAway) && (await truth("orders", "id", O1)).owner_id === S1.id, show(giveAway));

    // Sửa đúng cách — chỉ gửi data: được ghi, còn mã / chủ đơn / ngày tạo / rev do máy chủ giữ.
    const edit = await api(t, "PATCH", `orders?id=eq.${O1}&rev=eq.1`, { body: { data: orderDoc(O1, P1, { code: "HACK-1", status: "confirmed", note: "đã sửa" }) } });
    const row = rows(edit)[0];
    check("sale sửa đơn của mình: nội dung mới được ghi", row?.data?.note === "đã sửa" && row.status === "confirmed", show(edit));
    check("sale sửa đơn: rev tăng đúng 1", row?.rev === 2, row?.rev);
    check("sale sửa đơn: mã đơn giữ nguyên dù gửi mã khác", row?.code === o1Code && row?.data?.code === o1Code, row?.code);
    check("sale sửa đơn: chủ đơn và ngày tạo giữ nguyên, updated_at là lúc sửa", row?.owner_id === S1.id && row?.created_at === o1Created && Date.parse(row?.updated_at) > Date.parse(o1Created), row);
    const dropCode = await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { data: { id: O1, programId: P1, status: "draft" } } });
    check("sale gửi tài liệu không có mã: mã cũ vẫn được giữ", rows(dropCode)[0]?.code === o1Code, show(dropCode));
    const generated = await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { code: "HACK-2" } });
    const badStatus = await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { data: orderDoc(O1, P1, { status: "bogus" }) } });
    const notObject = await api(t, "PATCH", `orders?id=eq.${O1}`, { body: { data: [1, 2, 3] } });
    const noProgram = await api(t, "POST", "orders", { body: { id: oid("s1-bad"), data: { id: oid("s1-bad"), code: "", status: "draft" } } });
    check(
      "máy chủ từ chối: ghi thẳng cột sinh tự động, trạng thái lạ, tài liệu không phải object, đơn thiếu programId",
      [generated, badStatus, notObject, noProgram].every((r) => r.status === 400) && (await truth("orders", "id", O1)).code === o1Code && (await truth("orders", "id", oid("s1-bad"))) === null,
      [generated, badStatus, notObject, noProgram].map(show),
    );
  }

  // ───────────────────────── rev ─────────────────────────
  section("rev: tăng 1 mỗi lần ghi; người ghi sau với rev cũ không ghi đè được");
  {
    const before = await truth("orders", "id", O1);
    const stale = await api(S1.token, "PATCH", `orders?id=eq.${O1}&rev=eq.1`, { body: { data: orderDoc(O1, P1, { note: "bản cũ ghi đè" }) } });
    const after = await truth("orders", "id", O1);
    check("sửa với rev cũ: không dòng nào được ghi, đơn giữ nguyên", noRows(stale) && isDeepStrictEqual(after, before), { stale: show(stale), rev: after.rev });

    const next = await api(S1.token, "PATCH", `orders?id=eq.${O1}&rev=eq.${before.rev}`, { body: { data: orderDoc(O1, P1, { note: "lần nữa" }) } });
    check("sửa với rev đúng: rev tăng đúng 1", rows(next)[0]?.rev === before.rev + 1, show(next));

    const known = before.rev + 1;
    const race = await Promise.all(
      Array.from({ length: 8 }, (_, i) => api(S1.token, "PATCH", `orders?id=eq.${O1}&rev=eq.${known}`, { body: { data: orderDoc(O1, P1, { note: `người ghi ${i}` }) } })),
    );
    const winners = race.filter((r) => rows(r).length === 1);
    const final = await truth("orders", "id", O1);
    check(
      "8 lần sửa cùng lúc với cùng một rev: đúng một lần thắng, rev chỉ tăng 1",
      race.every(ok) && winners.length === 1 && final.rev === known + 1 && final.data.note === rows(winners[0])[0].data.note,
      { winners: winners.length, statuses: race.map((r) => r.status), finalRev: final.rev },
    );

    const p0 = await truth("programs", "id", P1);
    const pDoc = { id: P1, name: "kèm cột lạ" };
    const pColumnWrites = {
      "rev kèm data": await api(M.token, "PATCH", `programs?id=eq.${P1}`, { body: { rev: 70, data: pDoc } }),
      "updated_by kèm data": await api(M.token, "PATCH", `programs?id=eq.${P1}`, { body: { updated_by: S1.id, data: pDoc } }),
      "updated_at kèm data": await api(M.token, "PATCH", `programs?id=eq.${P1}`, { body: { updated_at: "2000-01-01T00:00:00Z", data: pDoc } }),
      "đổi id": await api(M.token, "PATCH", `programs?id=eq.${P1}`, { body: { id: pid("doi-id") } }),
      "upsert (merge-duplicates)": await api(M.token, "POST", "programs?on_conflict=id", { body: { id: P1, data: pDoc }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
      "PUT": await api(M.token, "PUT", `programs?id=eq.${P1}`, { body: { id: P1, data: pDoc } }),
    };
    check(
      "chương trình: quản lý cũng chỉ ghi được cột data — gửi kèm rev / updated_by / updated_at, đổi id, upsert, PUT đều bị từ chối; chương trình còn nguyên",
      Object.values(pColumnWrites).every(denied) && isDeepStrictEqual(await truth("programs", "id", P1), p0) && (await truth("programs", "id", pid("doi-id"))) === null,
      Object.fromEntries(Object.entries(pColumnWrites).filter(([, r]) => !denied(r)).map(([k, r]) => [k, show(r)])),
    );
    const p1 = await api(M.token, "PATCH", `programs?id=eq.${P1}&rev=eq.${p0.rev}`, { body: { data: { id: P1, name: "Chương trình thử v2" } } });
    const pStale = await api(M.token, "PATCH", `programs?id=eq.${P1}&rev=eq.${p0.rev}`, { body: { data: { id: P1, name: "ghi đè bằng bản cũ" } } });
    check(
      "chương trình: rev tăng đúng 1, người sửa = quản lý; ghi với rev cũ không trúng dòng nào",
      rows(p1)[0]?.rev === p0.rev + 1 && rows(p1)[0]?.updated_by === M.id && noRows(pStale) && (await truth("programs", "id", P1)).data.name === "Chương trình thử v2",
      { p1: show(p1), pStale: show(pStale) },
    );
  }

  // ───────────────────────── Quản lý ─────────────────────────
  section("Quản lý: ghi chương trình / tồn kho, thấy và sửa mọi đơn, thấy mọi hồ sơ");
  {
    const t = M.token;
    const all = await api(t, "GET", `orders?id=like.${PREFIX}*&select=id,owner_id`);
    check("quản lý thấy đơn của mọi sale", [O1, O2].every((id) => rows(all).some((o) => o.id === id)), show(all));
    const profiles = await api(t, "GET", `profiles?email=like.t-${TAG}-*&select=id,email,role`);
    check("quản lý thấy hồ sơ của mọi tài khoản", rows(profiles).length === allUsers.length, { got: rows(profiles).length, want: allUsers.length });

    const edit = await api(t, "PATCH", `orders?id=eq.${O2}&rev=eq.1`, { body: { data: orderDoc(O2, P1, { code: "HACK-M", note: "quản lý sửa" }) } });
    const row = rows(edit)[0];
    check(
      "quản lý sửa được đơn của sale; mã đơn, ngày tạo và chủ đơn vẫn giữ nguyên",
      row?.rev === 2 && row.data.note === "quản lý sửa" && row.code === o2Before.code && row.created_at === o2Before.created_at && row.owner_id === S2.id,
      show(edit),
    );

    // Qua API, quản lý cũng chỉ ghi được cột data của đơn: không chuyển chủ đơn, không đổi id / rev / ngày tạo.
    // (Việc chuyển đơn cho người khác, nếu cần, làm ở máy chủ: SQL Editor hoặc khóa bí mật — xem phần «Xóa tài khoản».)
    const o2Now = await truth("orders", "id", O2);
    const o2Doc = orderDoc(O2, P1, { note: "kèm cột lạ" });
    const mColumnWrites = {
      "chuyển đơn cho sale khác (owner_id)": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { owner_id: S1.id } }),
      "nhận đơn về mình (owner_id)": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { owner_id: M.id } }),
      "bỏ chủ đơn (owner_id = null)": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { owner_id: null } }),
      "owner_id kèm data": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { owner_id: S1.id, data: o2Doc } }),
      "rev kèm data": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { rev: 500, data: o2Doc } }),
      "created_at kèm data": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { created_at: "2000-01-01T00:00:00Z", data: o2Doc } }),
      "updated_at kèm data": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { updated_at: "2000-01-01T00:00:00Z", data: o2Doc } }),
      "đổi id": await api(t, "PATCH", `orders?id=eq.${O2}`, { body: { id: oid("m-doi-id") } }),
      "upsert (merge-duplicates)": await api(t, "POST", "orders?on_conflict=id", { body: { id: O2, data: o2Doc }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
      "PUT": await api(t, "PUT", `orders?id=eq.${O2}`, { body: { id: O2, data: o2Doc } }),
    };
    const s1Sees = await api(S1.token, "GET", `orders?id=eq.${O2}&select=id`);
    const s2Sees = await api(S2.token, "GET", `orders?id=eq.${O2}&select=id`);
    check(
      `quản lý cũng chỉ ghi được cột data của đơn: chuyển chủ đơn, gửi kèm rev / created_at / updated_at, đổi id, upsert, PUT đều bị từ chối (${Object.keys(mColumnWrites).length} cách); đơn còn nguyên, vẫn của chủ cũ`,
      Object.values(mColumnWrites).every(denied) && isDeepStrictEqual(await truth("orders", "id", O2), o2Now) && (await truth("orders", "id", oid("m-doi-id"))) === null && noRows(s1Sees) && rows(s2Sees).length === 1,
      Object.fromEntries(Object.entries(mColumnWrites).filter(([, r]) => !denied(r)).map(([k, r]) => [k, show(r)])),
    );

    const O3 = oid("m-for-s2");
    const onBehalf = await api(t, "POST", "orders", { body: { id: O3, owner_id: S2.id, data: orderDoc(O3, P1) } });
    const O4 = oid("m-own");
    const own = await api(t, "POST", "orders", { body: { id: O4, data: orderDoc(O4, P1) } });
    check(
      "quản lý tạo đơn kèm owner_id của một sale: bị từ chối, không có gì được tạo; tạo với (id, data) thì là đơn của chính quản lý",
      denied(onBehalf) && (await truth("orders", "id", O3)) === null && own.status === 201 && rows(own)[0]?.owner_id === M.id,
      { onBehalf: show(onBehalf), own: show(own) },
    );
    const O5 = oid("s2-de-xoa");
    const theirs = await api(S2.token, "POST", "orders", { body: { id: O5, data: orderDoc(O5, P1) } });
    const dropped = await api(t, "DELETE", `orders?id=in.(${O4},${O5})`);
    check("quản lý xóa được đơn của người khác (và của mình)", theirs.status === 201 && rows(dropped).length === 2 && (await truth("orders", "id", O5)) === null, show(dropped));

    // Tồn kho / thiết lập là hai dòng dùng chung với người khác đang dùng cơ sở dữ liệu này: chỉ ghi lại đúng nội dung
    // đang có (lấy nguyên văn JSON từ máy chủ), nên dữ liệu của họ không đổi — chỉ rev tăng.
    // Trước hết: quản lý cũng chỉ ghi được cột data của app_state. Các lệnh dưới đây phải bị từ chối; chúng gửi lại đúng nội dung
    // đang có, nên dù máy chủ có lỡ cho qua thì dữ liệu dùng chung vẫn y nguyên.
    {
      const settingsNow = await currentStateText("settings");
      const sColumnWrites = {
        "rev kèm data": await api(t, "PATCH", "app_state?key=eq.settings", { rawBody: `{"rev": 900, "data": ${settingsNow}}` }),
        "updated_by kèm data": await api(t, "PATCH", "app_state?key=eq.settings", { rawBody: `{"updated_by": "${S1.id}", "data": ${settingsNow}}` }),
        "updated_at kèm data": await api(t, "PATCH", "app_state?key=eq.settings", { rawBody: `{"updated_at": "2000-01-01T00:00:00Z", "data": ${settingsNow}}` }),
        "ghi cột key": await api(t, "PATCH", "app_state?key=eq.settings", { rawBody: `{"key": "settings", "data": ${settingsNow}}` }),
        "upsert (merge-duplicates)": await api(t, "POST", "app_state?on_conflict=key", { rawBody: `{"key": "settings", "data": ${settingsNow}}`, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
        "PUT": await api(t, "PUT", "app_state?key=eq.settings", { rawBody: `{"key": "settings", "data": ${settingsNow}}` }),
      };
      const stateNow = await adminDb.from("app_state").select("key, updated_by").eq("key", "settings").single();
      check(
        "thiết lập: quản lý cũng chỉ ghi được cột data — gửi kèm rev / updated_by / updated_at / key, upsert, PUT đều bị từ chối",
        Object.values(sColumnWrites).every(denied) && stateNow.data?.updated_by !== S1.id,
        Object.fromEntries(Object.entries(sColumnWrites).filter(([, r]) => !denied(r)).map(([k, r]) => [k, show(r)])),
      );
    }
    let wrote = null;
    let sawStale = null;
    for (let attempt = 0; attempt < 5 && !wrote; attempt += 1) {
      const current = rows(await api(t, "GET", "app_state?key=eq.settings&select=rev,data::text"))[0];
      if (!current) break;
      const r = await api(t, "PATCH", `app_state?key=eq.settings&rev=eq.${current.rev}`, { rawBody: `{"data": ${current.data}}` });
      if (rows(r).length === 1) {
        wrote = { before: current, after: rows(r)[0] };
        sawStale = await api(t, "PATCH", `app_state?key=eq.settings&rev=eq.${current.rev}`, { rawBody: `{"data": ${current.data}}` });
      }
    }
    check(
      "quản lý ghi được thiết lập: rev tăng đúng 1, người sửa = quản lý, nội dung đúng như đã gửi",
      wrote !== null && wrote.after.rev === wrote.before.rev + 1 && wrote.after.updated_by === M.id && isDeepStrictEqual(wrote.after.data, JSON.parse(wrote.before.data)),
      wrote,
    );
    check("thiết lập: ghi với rev cũ không trúng dòng nào", sawStale !== null && noRows(sawStale), sawStale && show(sawStale));
    const dup = await api(t, "POST", "app_state", { body: { key: "stock", data: {} } });
    const badKey = await api(t, "POST", "app_state", { body: { key: `${PREFIX}khac`, data: {} } });
    const dropState = await api(t, "DELETE", "app_state?key=eq.settings&rev=eq.-1");
    check(
      "app_state chỉ có hai dòng stock / settings: quản lý không thêm trùng, không thêm khóa lạ, không có quyền xóa",
      dup.status === 409 && badKey.status === 400 && denied(dropState) && (await adminDb.from("app_state").select("key")).data.length === 2,
      { dup: show(dup), badKey: show(badKey), dropState: show(dropState) },
    );

    const counters = [await api(t, "GET", "order_counters?select=*"), await counterInsert(t), await api(t, "PATCH", `order_counters?day=eq.${FAR_DAY}`, { body: { last: 0 } }), await api(t, "DELETE", `order_counters?day=eq.${FAR_DAY}`)];
    check("quản lý cũng không đụng được bảng bộ đếm mã đơn qua API", counters.every(denied), counters.map(show));

    const others = await api(t, "PATCH", `profiles?id=eq.${S1.id}`, { body: { full_name: "quản lý đặt tên" } });
    const roleColumn = await api(t, "PATCH", `profiles?id=eq.${S1.id}`, { body: { role: "manager" } });
    check("quản lý không sửa thẳng được hồ sơ / vai trò của người khác (chỉ qua admin_set_role)", noRows(others) && denied(roleColumn) && (await truth("profiles", "id", S1.id)).role === "sale", { others: show(others), roleColumn: show(roleColumn) });

    const self = {
      "admin_set_role cho chính mình (hạ xuống sale)": await rpc(t, "admin_set_role", { target: M.id, new_role: "sale" }),
      "admin_set_role cho chính mình (khóa)": await rpc(t, "admin_set_role", { target: M.id, new_role: "locked" }),
      "admin_set_role cho chính mình (vẫn manager)": await rpc(t, "admin_set_role", { target: M.id, new_role: "manager" }),
      "sửa thẳng cột role của mình": await api(t, "PATCH", `profiles?id=eq.${M.id}`, { body: { role: "sale" } }),
    };
    check("quản lý không tự đổi được vai trò của chính mình (nên luôn còn quản lý)", Object.values(self).every(denied) && (await truth("profiles", "id", M.id)).role === "manager", Object.fromEntries(Object.entries(self).map(([k, r]) => [k, show(r)])));

    const invalid = [
      await rpc(t, "admin_set_role", { target: S3.id, new_role: "pending" }),
      await rpc(t, "admin_set_role", { target: S3.id, new_role: "admin" }),
      await rpc(t, "admin_set_role", { target: S3.id, new_role: null }),
      await rpc(t, "admin_set_role", { target: S3.id, new_role: "" }),
    ];
    const unknown = await rpc(t, "admin_set_role", { target: randomUUID(), new_role: "sale" });
    check("admin_set_role từ chối vai trò không hợp lệ và tài khoản không tồn tại", invalid.every((r) => r.status === 400) && !ok(unknown) && (await truth("profiles", "id", S3.id)).role === "sale", { invalid: invalid.map(show), unknown: show(unknown) });
  }

  // ───────────────────────── Leo quyền ─────────────────────────
  section("Sale tự nâng quyền: mọi đường đều đóng");
  {
    const t = S1.token;
    const attempts = {
      "sửa thẳng cột role": await api(t, "PATCH", `profiles?id=eq.${S1.id}`, { body: { role: "manager" } }),
      "sửa họ tên kèm role": await api(t, "PATCH", `profiles?id=eq.${S1.id}`, { body: { full_name: "x", role: "manager" } }),
      "sửa role, ép danh sách cột bằng ?columns=": await api(t, "PATCH", `profiles?id=eq.${S1.id}&columns=role`, { body: { role: "manager" } }),
      "sửa email": await api(t, "PATCH", `profiles?id=eq.${S1.id}`, { body: { email: "giamdoc@example.com" } }),
      "sửa id thành id của quản lý": await api(t, "PATCH", `profiles?id=eq.${S1.id}`, { body: { id: M.id } }),
      "sửa created_at": await api(t, "PATCH", `profiles?id=eq.${S1.id}`, { body: { created_at: "2000-01-01T00:00:00Z" } }),
      "upsert hồ sơ (merge-duplicates)": await api(t, "POST", "profiles?on_conflict=id", { body: { id: S1.id, role: "manager" }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
      "upsert hồ sơ (ignore-duplicates)": await api(t, "POST", "profiles?on_conflict=id", { body: { id: S1.id, role: "manager" }, headers: { Prefer: "resolution=ignore-duplicates,return=representation" } }),
      "PUT cả hồ sơ": await api(t, "PUT", `profiles?id=eq.${S1.id}`, { body: { id: S1.id, email: S1.email, full_name: "x", phone: "", role: "manager", created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }),
      "thêm hồ sơ mới với role manager": await api(t, "POST", "profiles", { body: { id: randomUUID(), role: "manager" } }),
      "xóa hồ sơ của mình (để được tạo lại)": await api(t, "DELETE", `profiles?id=eq.${S1.id}`),
      "admin_set_role cho chính mình": await rpc(t, "admin_set_role", { target: S1.id, new_role: "manager" }),
      "admin_set_role duyệt người khác": await rpc(t, "admin_set_role", { target: P.id, new_role: "sale" }),
      "admin_set_role khóa quản lý": await rpc(t, "admin_set_role", { target: M.id, new_role: "locked" }),
      "admin_set_password của quản lý": await rpc(t, "admin_set_password", { target: M.id, new_password: "hacked-123" }),
      "admin_set_password của chính mình": await rpc(t, "admin_set_password", { target: S1.id, new_password: "hacked-123" }),
      "create_profile": await rpc(t, "create_profile", { target: S1.id }),
    };
    const state = await adminDb.from("profiles").select("id, role, email").in("id", [S1.id, P.id, M.id]);
    const roleOf = Object.fromEntries((state.data ?? []).map((p) => [p.id, p.role]));
    check(
      `sale: ${Object.keys(attempts).length} cách nâng quyền / phá tài khoản khác đều bị từ chối; không vai trò nào đổi`,
      Object.values(attempts).every(denied) && roleOf[S1.id] === "sale" && roleOf[P.id] === "pending" && roleOf[M.id] === "manager",
      { failed: Object.fromEntries(Object.entries(attempts).filter(([, r]) => !denied(r)).map(([k, r]) => [k, show(r)])), roleOf },
    );

    const hidden = [await rpc(t, "handle_new_user"), await rpc(t, "orders_before_write"), await rpc(t, "touch_doc"), await rpc(t, "programs_before_delete"), await rpc(t, "set_config", { setting_name: "request.jwt.claims", new_value: "{}", is_local: true })];
    check("các hàm trigger và hàm hệ thống (set_config) không gọi được qua API", hidden.every((r) => !ok(r)), hidden.map(show));

    const meta = await S1.client.auth.updateUser({ data: { role: "manager", app_role: "manager", is_manager: true } });
    const fresh = await signIn(S1.email, S1.password);
    const flags = [await rpc(fresh.token, "is_manager"), await rpc(fresh.token, "ensure_profile")];
    check(
      "tự ghi role = manager vào thông tin tài khoản (user_metadata) rồi đăng nhập lại: vẫn là sale",
      !meta.error && fresh.ok && flags[0].body === false && flags[1].body?.role === "sale",
      { meta: meta.error?.message, flags: flags.map(show) },
    );
    const mail = await truth("profiles", "id", S1.id);
    check("email trong hồ sơ không đổi qua các lần thử", mail.email === S1.email, mail.email);
  }

  // ───────────────────────── Không xóa chương trình còn đơn ─────────────────────────
  section("Không xóa được chương trình khi còn đơn thuộc về nó");
  {
    const PG = pid("guard");
    const OG = oid("guard");
    await api(M.token, "POST", "programs", { body: { id: PG, data: { id: PG, name: "Có đơn" } } });
    const ins = await api(S1.token, "POST", "orders", { body: { id: OG, data: orderDoc(OG, PG) } });
    const refuse = await api(M.token, "DELETE", `programs?id=eq.${PG}`);
    check(
      "quản lý xóa chương trình còn đơn của sale: bị từ chối, có nói còn bao nhiêu đơn; chương trình còn nguyên",
      ins.status === 201 && refuse.status === 409 && refuse.body?.code === "23503" && /còn 1 đơn hàng/.test(refuse.body?.message ?? "") && (await truth("programs", "id", PG)) !== null,
      show(refuse),
    );
    const bulk = await api(M.token, "DELETE", `programs?id=in.(${PG},${pid("khong-co")})`);
    check("xóa nhiều chương trình trong đó có một cái còn đơn: không cái nào bị xóa", bulk.status === 409 && (await truth("programs", "id", PG)) !== null, show(bulk));
    await api(S1.token, "PATCH", `orders?id=eq.${OG}`, { body: { data: orderDoc(OG, P1) } });
    const moved = await api(M.token, "DELETE", `programs?id=eq.${PG}`);
    check("chuyển đơn sang chương trình khác rồi thì xóa được", rows(moved).length === 1 && (await truth("programs", "id", PG)) === null, show(moved));
    const stillBlocked = await api(M.token, "DELETE", `programs?id=eq.${P1}`);
    check("…và chương trình vừa nhận đơn thì không xóa được", stillBlocked.status === 409, show(stillBlocked));
    await api(S1.token, "DELETE", `orders?id=eq.${OG}`);
  }

  // ───────────────────────── Tài liệu lớn ─────────────────────────
  section("Tài liệu lớn");
  {
    const PL = pid("lon");
    const big = {
      id: PL,
      name: "Chương trình rất lớn — khuyến mãi quý IV",
      groups: Array.from({ length: 40 }, (_, g) => ({
        id: `g${g}`,
        name: `Danh mục số ${g} — vợt cầu lông, giày, quấn cán`,
        products: Array.from({ length: 60 }, (_, i) => ({ sku: `SKU-${g}-${i}`, name: `Vợt cầu lông cao cấp mẫu ${g}/${i} «Sấm Sét»`, retailPrice: 1_250_000 + i, wholesalePrice: 990_000 + g, unit: "cây", note: "Hàng chính hãng, bảo hành 6 tháng" })),
      })),
      rules: Array.from({ length: 30 }, (_, r) => ({ id: `r${r}`, kind: "tier_gift", tiers: [{ min: 10, gift: "Áo thun" }, { min: 50, gift: "Balo" }], description: "Mua đủ số lượng tặng quà theo mức" })),
    };
    const bytes = Buffer.byteLength(JSON.stringify(big));
    const ins = await api(M.token, "POST", "programs", { body: { id: PL, data: big } });
    const read = await api(S1.token, "GET", `programs?id=eq.${PL}&select=rev,data`);
    check(`chương trình ${Math.round(bytes / 1024)} KB: ghi rồi đọc lại (bằng tài khoản sale) y nguyên`, bytes >= 400_000 && ins.status === 201 && isDeepStrictEqual(rows(read)[0]?.data, big), { bytes, ins: ins.status, read: read.status });
    big.groups[39].products[59].name = "Đã sửa ở cuối tài liệu";
    const upd = await api(M.token, "PATCH", `programs?id=eq.${PL}&rev=eq.1`, { body: { data: big } });
    const reread = await api(S1.token, "GET", `programs?id=eq.${PL}&select=rev,data`);
    check("sửa tài liệu lớn: rev = 2, đọc lại y nguyên", rows(upd)[0]?.rev === 2 && rows(reread)[0]?.rev === 2 && isDeepStrictEqual(rows(reread)[0]?.data, big), { upd: upd.status });
    const OL = oid("lon");
    const bigOrder = orderDoc(OL, P1, { lines: Array.from({ length: 1500 }, (_, i) => ({ sku: `SKU-${i}`, name: `Sản phẩm thử số ${i} — tên dài có dấu tiếng Việt`, qty: i + 1, retailPrice: 100_000 + i, wholesalePrice: 80_000 + i })) });
    const insOrder = await api(S1.token, "POST", "orders", { body: { id: OL, data: bigOrder } });
    const got = rows(insOrder)[0];
    check(
      `đơn hàng ${Math.round(Buffer.byteLength(JSON.stringify(bigOrder)) / 1024)} KB: ghi được, nội dung y nguyên (chỉ thêm mã đơn)`,
      insOrder.status === 201 && isDeepStrictEqual({ ...got?.data, code: "" }, bigOrder),
      { status: insOrder.status },
    );
    await api(S1.token, "DELETE", `orders?id=eq.${OL}`);
    await api(M.token, "DELETE", `programs?id=eq.${PL}`);
  }

  // ───────────────────────── sync_fingerprint ─────────────────────────
  section("sync_fingerprint(): dấu vân tay của đúng những gì người gọi được thấy");
  {
    const fpOf = async (user) => (await rpc(user.token, "sync_fingerprint")).body;
    /** id + rev của mọi dòng tài khoản này thấy (đọc hết các trang: máy chủ trả tối đa 1000 dòng mỗi lần). */
    const headsOf = async (user, table) => {
      const column = table === "app_state" ? "key" : "id";
      const select = table === "app_state" ? "id:key,rev" : "id,rev";
      const heads = [];
      for (;;) {
        const page = rows(await api(user.token, "GET", `${table}?select=${select}&order=${column}&limit=1000&offset=${heads.length}`));
        heads.push(...page);
        if (page.length < 1000) return heads;
      }
    };

    const first = await rpc(S3.token, "sync_fingerprint");
    check("sale chưa có đơn nào: phần orders là hash của chuỗi rỗng; programs và app_state thì không rỗng", ok(first) && first.body.orders === EMPTY_SHA256 && first.body.programs !== EMPTY_SHA256 && first.body.app_state !== EMPTY_SHA256, show(first));
    check("kết quả có đúng ba khóa programs / orders / app_state, mỗi khóa là 64 ký tự hex", isDeepStrictEqual(Object.keys(first.body ?? {}).sort(), ["app_state", "orders", "programs"]) && Object.values(first.body).every((h) => /^[0-9a-f]{64}$/.test(h)), first.body);

    // id có '-', '_', chữ hoa / thường lẫn lộn, và cả ký tự ngoài ASCII: máy chủ xếp theo byte UTF-8.
    const suffixes = ["B_x", "a-1", "A_2", "_z", "-y", "Zz", "zZ", "a", "A", "a_", "a-", "0", "~", "é", "Ｚ", "😀"];
    const ids = suffixes.map((s) => `${PREFIX}fp-${s}`);
    const s3Before = await fpOf(S3);
    const mBefore = await fpOf(M);
    const s1Before = await fpOf(S1);
    const made = await api(S3.token, "POST", "orders", { body: ids.map((id) => ({ id, data: orderDoc(id, P1) })) });
    check("tạo loạt đơn có id chứa '-', '_', chữ hoa / thường và ký tự ngoài ASCII", made.status === 201 && rows(made).length === ids.length, show(made));
    await api(S3.token, "PATCH", `orders?id=eq.${encodeURIComponent(ids[1])}`, { body: { data: orderDoc(ids[1], P1, { note: "rev 2" }) } });
    await api(S3.token, "PATCH", `orders?id=eq.${encodeURIComponent(ids[1])}`, { body: { data: orderDoc(ids[1], P1, { note: "rev 3" }) } });

    const s3After = await fpOf(S3);
    const s3Heads = await headsOf(S3, "orders");
    check("dấu vân tay orders của sale đổi khi chính họ thêm / sửa đơn", s3After.orders !== s3Before.orders, { before: s3Before.orders, after: s3After.orders });
    check(
      "bằng đúng SHA-256 tính ở máy khách từ `select id, rev` (xếp theo byte): id có '-', '_', hoa / thường, ngoài ASCII; rev khác nhau",
      s3Heads.length === ids.length && s3After.orders === fingerprintOf(s3Heads),
      { server: s3After.orders, client: fingerprintOf(s3Heads), heads: s3Heads.length },
    );
    const ascii = s3Heads.filter((h) => /^[\x20-\x7e]+$/.test(h.id));
    const jsOrder = [...ascii].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((h) => h.id);
    const byteOrder = [...ascii].sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))).map((h) => h.id);
    check("với id toàn ASCII, thứ tự so chuỗi của JavaScript trùng thứ tự byte của máy chủ", isDeepStrictEqual(jsOrder, byteOrder), { jsOrder, byteOrder });

    check("dấu vân tay orders của sale khác KHÔNG đổi khi sale này thêm / sửa đơn", (await fpOf(S1)).orders === s1Before.orders, { before: s1Before.orders });
    const mAfter = await fpOf(M);
    check("dấu vân tay orders của quản lý đổi khi bất kỳ sale nào thêm / sửa đơn", mAfter.orders !== mBefore.orders, { before: mBefore.orders, after: mAfter.orders });

    const s3Mid = await fpOf(S3);
    const mMid = await fpOf(M);
    await api(S1.token, "PATCH", `orders?id=eq.${O1}`, { body: { data: orderDoc(O1, P1, { note: "s1 sửa để thử dấu vân tay" }) } });
    const s3Late = await fpOf(S3);
    check("sale khác sửa đơn của họ: dấu vân tay orders của sale này đứng yên, của quản lý thì đổi", s3Late.orders === s3Mid.orders && (await fpOf(M)).orders !== mMid.orders, { s3Mid: s3Mid.orders, s3Late: s3Late.orders });

    // Phần dùng chung (programs, app_state, và orders của quản lý) có thể đang được người khác ghi: so khi hai lần đọc id + rev trước / sau trùng nhau.
    for (const [who, user] of [["sale", S3], ["quản lý", M]]) {
      for (const table of ["programs", "app_state", "orders"]) {
        let verdict = null;
        for (let attempt = 0; attempt < 10 && verdict === null; attempt += 1) {
          if (attempt > 0) await sleep(700);
          const before = await headsOf(user, table);
          const fp = await fpOf(user);
          const after = await headsOf(user, table);
          if (isDeepStrictEqual(before, after)) verdict = { same: fp[table] === fingerprintOf(before), server: fp[table], client: fingerprintOf(before), rows: before.length };
        }
        check(`${who}: phần ${table} bằng SHA-256 tính từ id + rev mà ${who} đọc được`, verdict?.same === true, verdict ?? "dữ liệu đổi liên tục, không so được");
      }
    }

    const cleared = await api(S3.token, "DELETE", `orders?id=like.${PREFIX}fp-*`);
    const last = await fpOf(S3);
    check("xóa hết đơn của mình: phần orders quay về hash của chuỗi rỗng", rows(cleared).length === ids.length && last.orders === EMPTY_SHA256, { deleted: rows(cleared).length, orders: last.orders });

    // Ghi nhận (không tính là lỗi): chuỗi "id:rev,id:rev" không phân biệt được ranh giới nếu id chứa ',' và ':'.
    const a = `${PREFIX}fpc-a`;
    const b = `${PREFIX}fpc-b`;
    const merged = `${a}:1,${b}`;
    await api(S3.token, "POST", "orders", { body: [a, b].map((id) => ({ id, data: orderDoc(id, P1) })) });
    const two = await fpOf(S3);
    await api(S3.token, "DELETE", `orders?id=like.${PREFIX}fpc-*`);
    const one = await api(S3.token, "POST", "orders", { body: { id: merged, data: orderDoc(merged, P1) } });
    const single = await fpOf(S3);
    if (one.status === 201 && two.orders === single.orders) {
      note(`sync_fingerprint: hai đơn «…a» + «…b» (rev 1) và MỘT đơn có id «…a:1,…b» cho cùng một dấu vân tay — id chứa ',' và ':' làm chuỗi "id:rev,…" nhập nhằng (chỉ ảnh hưởng tới chính các đơn của người tạo).`);
    }
    await adminDb.from("orders").delete().eq("owner_id", S3.id);
  }

  // ───────────────────────── Realtime ─────────────────────────
  if (process.env.SKIP_REALTIME === "1") {
    section("Realtime");
    skip("Realtime: ai nhận được gì", "SKIP_REALTIME=1");
  } else {
    await realtimeChecks({ M, S1, S2, P, P1 });
  }

  // ───────────────────────── Mã đơn ─────────────────────────
  section("Mã đơn: một dãy số chung mỗi ngày, không trùng, không dùng lại");
  {
    const writers = [S1, S2, M];
    const batch = writers.flatMap((user, u) => Array.from({ length: 20 }, (_, i) => ({ user, id: oid(`seq-${u}-${i}`) })));
    const results = await Promise.all(batch.map(({ user, id }) => api(user.token, "POST", "orders", { body: { id, data: orderDoc(id, P1) } })));
    const codes = results.map((r) => rows(r)[0]?.code).filter(Boolean);
    const prefix = codes[0]?.slice(0, 9) ?? "";
    check("3 tài khoản × 20 đơn tạo cùng lúc: cả 60 đơn đều tạo được", results.every((r) => r.status === 201) && codes.length === 60, results.filter((r) => r.status !== 201).slice(0, 3).map(show));
    check("60 mã khác nhau, cùng tiền tố ngày hôm nay (giờ Việt Nam)", new Set(codes).size === 60 && codes.every((c) => c.startsWith(prefix) && /^DH\d{6}-\d{3,}$/.test(c)) && [vnDatePrefix(), vnDatePrefix(new Date(Date.now() - 60_000))].includes(prefix), { distinct: new Set(codes).size, prefix });
    const numbers = codes.map(codeNumber).sort((x, y) => x - y);
    const have = new Set(numbers);
    const missing = [];
    for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n += 1) if (!have.has(n)) missing.push(n);
    let unexplained = missing;
    if (missing.length > 0) {
      // Số bị hụt chỉ chấp nhận được nếu đúng lúc đó một người khác (ngoài kiểm thử này) cũng tạo đơn và đang giữ số ấy.
      const { data } = await adminDb.from("orders").select("id, code").in("code", missing.map((n) => prefix + formatSeq(n)));
      const foreign = new Set((data ?? []).filter((o) => !o.id.startsWith(PREFIX)).map((o) => o.code));
      unexplained = missing.filter((n) => !foreign.has(prefix + formatSeq(n)));
    }
    check("60 mã là 60 số liên tiếp (không hụt, không nhảy cóc)", codes.length === 60 && unexplained.length === 0, { from: numbers[0], to: numbers[numbers.length - 1], missing, unexplained });
    const owners = await adminDb.from("orders").select("id, owner_id").like("id", `${PREFIX}o-seq-%`);
    check("mỗi đơn trong loạt đó thuộc về đúng tài khoản đã tạo nó", (owners.data ?? []).length === 60 && owners.data.every((o) => o.owner_id === writers[Number(o.id.split("-seq-")[1].split("-")[0])].id), (owners.data ?? []).length);

    // Không dùng lại số của đơn đã xóa.
    const top = Math.max(...numbers);
    const topId = batch[results.findIndex((r) => codeNumber(rows(r)[0]?.code) === top)];
    await api(topId.user.token, "DELETE", `orders?id=eq.${topId.id}`);
    const again = await api(S1.token, "POST", "orders", { body: { id: oid("seq-after-delete"), data: orderDoc(oid("seq-after-delete"), P1) } });
    const next = codeNumber(rows(again)[0]?.code);
    check("xóa đơn có số lớn nhất rồi tạo đơn mới: số mới lớn hơn, không dùng lại số vừa xóa", again.status === 201 && next > top, { deleted: top, next });
    await adminDb.from("orders").delete().like("id", `${PREFIX}o-seq-%`);
    const afterWipe = await api(S2.token, "POST", "orders", { body: { id: oid("seq-after-wipe"), data: orderDoc(oid("seq-after-wipe"), P1) } });
    check("xóa sạch cả loạt rồi tạo đơn mới: số vẫn đi tiếp", codeNumber(rows(afterWipe)[0]?.code) > next, { next, afterWipe: rows(afterWipe)[0]?.code });

    // Mã do máy chủ cấp. Mã rỗng theo mọi kiểu (khoảng trắng, null, không có khóa code) đều được cấp mã.
    // Sale gửi kèm mã tự đặt: máy chủ bỏ qua mã đó và cấp mã theo dãy như mọi đơn khác.
    const serverCode = (code) => /^DH\d{6}-\d{3,}$/.test(code ?? "");
    const variants = await api(S1.token, "POST", "orders", {
      body: [
        { id: oid("code-blank"), data: orderDoc(oid("code-blank"), P1, { code: "   " }) },
        { id: oid("code-null"), data: orderDoc(oid("code-null"), P1, { code: null }) },
        { id: oid("code-own"), data: orderDoc(oid("code-own"), P1, { code: `GIU-${TAG}` }) },
      ],
    });
    const [blank, nul, ownCode] = rows(variants);
    check("mã toàn khoảng trắng hoặc null: máy chủ cấp mã", variants.status === 201 && serverCode(blank?.code) && serverCode(nul?.code) && codeNumber(nul.code) === codeNumber(blank.code) + 1, show(variants));
    check(
      "sale gửi kèm mã tự đặt: máy chủ bỏ qua mã đó, cấp số kế tiếp trong dãy và ghi vào cả data.code; không đơn nào mang mã tự đặt",
      serverCode(ownCode?.code) && codeNumber(ownCode.code) === codeNumber(nul?.code) + 1 && ownCode.data?.code === ownCode.code && ((await adminDb.from("orders").select("id").eq("code", `GIU-${TAG}`)).data ?? [undefined]).length === 0,
      ownCode,
    );
    const noKeyId = oid("code-no-key");
    const noKey = await api(S1.token, "POST", "orders", { body: { id: noKeyId, data: { id: noKeyId, programId: P1, status: "draft" } } });
    check("tài liệu không có khóa code: máy chủ cấp mã và thêm khóa code vào tài liệu", noKey.status === 201 && serverCode(rows(noKey)[0]?.code) && rows(noKey)[0].data?.code === rows(noKey)[0].code, show(noKey));

    // Chỉ quản lý được gửi kèm mã có sẵn (để tải lên đơn cũ của một máy, vốn đã có mã). Mã được giữ nguyên và không tiêu số
    // nào của dãy; quản lý gửi mã rỗng thì cũng được cấp mã theo dãy như sale.
    const lastBefore = codeNumber(rows(noKey)[0]?.code);
    const byManager = await api(M.token, "POST", "orders", {
      body: [
        { id: oid("m-code-kept"), data: orderDoc(oid("m-code-kept"), P1, { code: `GIU-${TAG}` }) },
        { id: oid("m-code-blank"), data: orderDoc(oid("m-code-blank"), P1) },
      ],
    });
    const [mKept, mBlank] = rows(byManager);
    check(
      "quản lý gửi kèm mã có sẵn: mã được giữ nguyên (cột code và data.code), không tiêu số nào của dãy; quản lý gửi mã rỗng: được cấp số kế tiếp",
      byManager.status === 201 && mKept?.code === `GIU-${TAG}` && mKept.data?.code === `GIU-${TAG}` && mKept.owner_id === M.id && serverCode(mBlank?.code) && (await isNextInSequence(mBlank.code.slice(0, 9), lastBefore, codeNumber(mBlank.code))),
      { last: rows(noKey)[0]?.code, byManager: show(byManager) },
    );

    // Không có người gọi (khóa bí mật / SQL Editor): mã và chủ đơn gửi lên được giữ nguyên.
    const byServer = await adminDb.from("orders").insert({ id: oid("srv-code"), owner_id: S1.id, data: orderDoc(oid("srv-code"), P1, { code: `MAYCHU-${TAG}` }) }).select("code, owner_id, rev, data").single();
    check("khóa bí mật (máy chủ) thêm đơn kèm mã và chủ đơn: giữ nguyên cả hai", byServer.data?.code === `MAYCHU-${TAG}` && byServer.data.data?.code === `MAYCHU-${TAG}` && byServer.data.owner_id === S1.id && byServer.data.rev === 1, byServer.error ?? byServer.data);

    // Một sale gửi mã «của hôm nay» với số khổng lồ: máy chủ bỏ qua, đơn nhận số kế tiếp như thường.
    const base = await api(S1.token, "POST", "orders", { body: { id: oid("poison-0"), data: orderDoc(oid("poison-0"), P1) } });
    const n0 = codeNumber(rows(base)[0]?.code);
    const day = rows(base)[0]?.code.slice(0, 9);
    const isoDay = `20${day.slice(2, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    const bySale = await api(S1.token, "POST", "orders", { body: { id: oid("poison-s"), data: orderDoc(oid("poison-s"), P1, { code: `${day}999999999` }) } });
    const nS = codeNumber(rows(bySale)[0]?.code);
    check(
      "sale gửi mã «DHyymmdd-999999999»: máy chủ bỏ qua, đơn nhận số kế tiếp trong dãy",
      bySale.status === 201 && (await isNextInSequence(day, n0, nS)) && rows(bySale)[0]?.data?.code === rows(bySale)[0]?.code,
      { base: rows(base)[0]?.code, got: rows(bySale)[0]?.code },
    );

    // Quản lý tải lên một đơn cũ mang mã «của hôm nay» với số khổng lồ: dãy số của mọi người không được nhảy theo.
    const poison = await api(M.token, "POST", "orders", { body: { id: oid("poison-1"), data: orderDoc(oid("poison-1"), P1, { code: `${day}999999999` }) } });
    const after = await api(S2.token, "POST", "orders", { body: { id: oid("poison-2"), data: orderDoc(oid("poison-2"), P1) } });
    const n1 = codeNumber(rows(after)[0]?.code);
    const counter = (await adminDb.from("order_counters").select("last").eq("day", isoDay).maybeSingle()).data?.last;
    const low = Number.isInteger(nS) && nS - n0 < 200 ? nS : n0;
    const steady = poison.status === 201 && rows(poison)[0]?.code === `${day}999999999` && after.status === 201 && (await isNextInSequence(day, low, n1)) && counter >= n1 && counter - n1 < 200;
    check("quản lý tải lên đơn mang mã «DHyymmdd-999999999»: mã được giữ, đơn kế tiếp của người khác vẫn nhận số kế tiếp bình thường, bộ đếm của ngày không nhảy", steady, { n0, poisonCode: rows(poison)[0]?.code, next: rows(after)[0]?.code, counter });
    if (!steady && Number.isInteger(n0) && (counter > n0 + 200 || !(n1 > n0))) {
      // Lỗi này làm hỏng dãy số của cả ngày trong cơ sở dữ liệu dùng chung: gỡ đơn «độc» và trả bộ đếm về chỗ cũ.
      await adminDb.from("orders").delete().in("id", [oid("poison-s"), oid("poison-1"), oid("poison-2")]);
      await adminDb.from("order_counters").update({ last: n0 }).eq("day", isoDay);
      note("đã trả bộ đếm mã đơn của hôm nay về giá trị trước khi thử.");
    }

    // Số kế tiếp đã bị một đơn (quản lý tải lên kèm mã) chiếm trước: máy chủ bỏ qua số đó, không cấp trùng.
    const a = await api(S1.token, "POST", "orders", { body: { id: oid("taken-a"), data: orderDoc(oid("taken-a"), P1) } });
    const nA = codeNumber(rows(a)[0]?.code);
    const takenCode = `${day}${formatSeq(nA + 1)}`;
    const b = await api(M.token, "POST", "orders", { body: { id: oid("taken-b"), data: orderDoc(oid("taken-b"), P1, { code: takenCode }) } });
    const c = await api(S2.token, "POST", "orders", { body: { id: oid("taken-c"), data: orderDoc(oid("taken-c"), P1) } });
    const cCode = rows(c)[0]?.code;
    const sameCode = await adminDb.from("orders").select("id").eq("code", cCode ?? "");
    check(
      "số kế tiếp đã có đơn (quản lý tải lên kèm mã) dùng: máy chủ nhảy qua đúng một số, mã vừa cấp là duy nhất",
      rows(b)[0]?.code === takenCode && c.status === 201 && cCode !== takenCode && codeNumber(cCode) > nA + 1 && (await isNextInSequence(day, nA, codeNumber(cCode), [oid("taken-b")])) && (sameCode.data ?? []).length === 1,
      { a: rows(a)[0]?.code, b: rows(b)[0]?.code, c: cCode },
    );

    // Sale gửi lại đúng mã của một đơn đang có (cố tạo hai đơn trùng mã): đơn mới vẫn nhận mã riêng.
    const aCode = rows(a)[0]?.code;
    const dupTry = await api(S1.token, "POST", "orders", { body: { id: oid("dup-s"), data: orderDoc(oid("dup-s"), P1, { code: aCode }) } });
    const dupCode = rows(dupTry)[0]?.code;
    const holders = await adminDb.from("orders").select("id, code").in("code", [aCode ?? "", dupCode ?? ""]);
    check(
      "sale gửi lại mã của một đơn đang có: không tạo được hai đơn trùng mã — đơn mới nhận mã riêng theo dãy",
      dupTry.status === 201 && serverCode(dupCode) && dupCode !== aCode && (await isNextInSequence(day, codeNumber(cCode), codeNumber(dupCode))) && isDeepStrictEqual((holders.data ?? []).map((o) => o.id).sort(), [oid("dup-s"), oid("taken-a")].sort()),
      { a: aCode, dup: dupCode, holders: holders.data },
    );

    // Một lần tạo bị từ chối không được làm hụt số; mã đã cấp không đổi được nữa.
    const d = await api(S1.token, "POST", "orders", { body: { id: oid("burn-d"), data: orderDoc(oid("burn-d"), P1) } });
    const refused = [
      await api(P.token, "POST", "orders", { body: { id: oid("burn-p"), data: orderDoc(oid("burn-p"), P1) } }),
      await api(S1.token, "POST", "orders", { body: { id: oid("burn-d"), data: orderDoc(oid("burn-d"), P1) } }),
      await api(S1.token, "POST", "orders", { body: { id: oid("burn-bad"), data: orderDoc(oid("burn-bad"), P1, { status: "bogus" }) } }),
    ];
    const e = await api(S1.token, "POST", "orders", { body: { id: oid("burn-e"), data: orderDoc(oid("burn-e"), P1) } });
    const gapOk = await isNextInSequence(day, codeNumber(rows(d)[0]?.code), codeNumber(rows(e)[0]?.code));
    check("lần tạo đơn bị từ chối (tài khoản chờ duyệt, trùng id, dữ liệu sai) không làm hụt số trong dãy", refused.every((r) => !ok(r)) && gapOk, { d: rows(d)[0]?.code, e: rows(e)[0]?.code, refused: refused.map((r) => r.status) });
  }

  // ───────────────────────── Đặt lại mật khẩu ─────────────────────────
  section("Quản lý đặt lại mật khẩu cho tài khoản khác");
  {
    const R = await newUser("r", { password: "matkhau-cu-1" });
    await setRoleDirect(R.id, "sale");
    const notAllowed = [
      await rpc(S1.token, "admin_set_password", { target: R.id, new_password: "matkhau-moi-1" }),
      await rpc(P.token, "admin_set_password", { target: R.id, new_password: "matkhau-moi-1" }),
      await rpc(L.token, "admin_set_password", { target: R.id, new_password: "matkhau-moi-1" }),
      await rpc(R.token, "admin_set_password", { target: R.id, new_password: "matkhau-moi-1" }),
    ];
    check("sale / chờ duyệt / bị khóa / chính chủ (không phải quản lý) không đặt lại được mật khẩu", notAllowed.every(denied), notAllowed.map(show));
    const invalid = [
      await rpc(M.token, "admin_set_password", { target: R.id, new_password: "12345" }),
      await rpc(M.token, "admin_set_password", { target: R.id, new_password: null }),
      await rpc(M.token, "admin_set_password", { target: R.id, new_password: "a".repeat(73) }),
    ];
    const unknown = await rpc(M.token, "admin_set_password", { target: randomUUID(), new_password: "matkhau-moi-1" });
    check("mật khẩu quá ngắn / trống / quá dài và tài khoản không tồn tại: bị từ chối", invalid.every((r) => r.status === 400) && !ok(unknown), { invalid: invalid.map(show), unknown: show(unknown) });
    const stillOld = await signIn(R.email, "matkhau-cu-1");
    check("sau các lần bị từ chối, mật khẩu cũ vẫn dùng được", stillOld.ok, stillOld.message);

    const reset = await rpc(M.token, "admin_set_password", { target: R.id, new_password: "Mật khẩu mới 2" });
    check("quản lý đặt lại mật khẩu thành công", ok(reset), show(reset));
    const oldLogin = await signIn(R.email, "matkhau-cu-1");
    const newLogin = await signIn(R.email, "Mật khẩu mới 2");
    check("mật khẩu cũ không đăng nhập được nữa", !oldLogin.ok, oldLogin.message || "vẫn đăng nhập được");
    check("mật khẩu mới đăng nhập được, tài khoản vẫn là sale", newLogin.ok && (await rpc(newLogin.token, "ensure_profile")).body?.role === "sale", newLogin.message);
    const refreshOld = await R.client.auth.refreshSession();
    const refreshStolen = await newClient().auth.refreshSession({ refresh_token: stillOld.client ? (await stillOld.client.auth.getSession()).data.session?.refresh_token ?? "" : "" });
    check("các phiên mở từ trước khi đặt lại mật khẩu không gia hạn được nữa", Boolean(refreshOld.error) && Boolean(refreshStolen.error), { refreshOld: refreshOld.error?.message ?? "vẫn gia hạn được", refreshStolen: refreshStolen.error?.message ?? "vẫn gia hạn được" });
    const roleAfter = (await truth("profiles", "id", R.id)).role;
    check("đặt lại mật khẩu không đổi vai trò", roleAfter === "sale", roleAfter);
  }

  // ───────────────────────── Khóa tài khoản ─────────────────────────
  section("Khóa tài khoản: token còn hạn cũng không lấy được gì");
  {
    const K = await newUser("k");
    await setRoleDirect(K.id, "sale");
    const OK1 = oid("k-a");
    const made = await api(K.token, "POST", "orders", { body: { id: OK1, data: orderDoc(OK1, P1) } });
    const sees = [await api(K.token, "GET", "programs?select=id"), await api(K.token, "GET", "orders?select=id"), await api(K.token, "GET", "app_state?select=key")];
    check("trước khi bị khóa: sale này thấy chương trình, đơn của mình, tồn kho", made.status === 201 && sees.every((r) => rows(r).length > 0), sees.map((r) => r.status));

    const lock = await rpc(M.token, "admin_set_role", { target: K.id, new_role: "locked" });
    check("quản lý khóa tài khoản", ok(lock) && lock.body?.role === "locked", show(lock));
    const t = K.token; // vẫn là token đã cấp từ trước, còn hạn
    const reads = [await api(t, "GET", "programs?select=*"), await api(t, "GET", "orders?select=*"), await api(t, "GET", "app_state?select=*"), await api(t, "GET", `orders?id=eq.${OK1}&select=*`)];
    check("token cũ còn hạn: không còn thấy chương trình, đơn hàng (kể cả đơn của chính mình), tồn kho", reads.every(noRows), reads.map(show));
    const writes = [
      await api(t, "POST", "orders", { body: { id: oid("k-b"), data: orderDoc(oid("k-b"), P1) } }),
      await api(t, "PATCH", `orders?id=eq.${OK1}`, { body: { data: orderDoc(OK1, P1, { note: "sửa sau khi bị khóa" }) } }),
      await api(t, "DELETE", `orders?id=eq.${OK1}`),
      await api(t, "POST", "orders?on_conflict=id", { body: { id: OK1, data: orderDoc(OK1, P1, { note: "upsert sau khi bị khóa" }) }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
    ];
    const kept = await truth("orders", "id", OK1);
    check("token cũ còn hạn: không tạo / sửa / xóa được đơn nào; đơn cũ còn nguyên cho quản lý", writes.every(blocked) && kept?.rev === 1 && kept.owner_id === K.id, writes.map(show));
    const fp = await rpc(t, "sync_fingerprint");
    const profile = await rpc(t, "ensure_profile");
    check("tài khoản bị khóa: dấu vân tay rỗng, hồ sơ báo vai trò locked", fp.body?.orders === EMPTY_SHA256 && fp.body?.programs === EMPTY_SHA256 && profile.body?.role === "locked", { fp: show(fp), role: profile.body?.role });
    const relog = await signIn(K.email, K.password);
    const afterLogin = relog.ok ? [await api(relog.token, "GET", "programs?select=id"), await api(relog.token, "GET", "orders?select=id")] : [];
    check("đăng nhập lại cũng không thấy gì", relog.ok && afterLogin.every(noRows), { login: relog.message, afterLogin: afterLogin.map(show) });
    const selfUnlock = [await rpc(t, "admin_set_role", { target: K.id, new_role: "sale" }), await api(t, "PATCH", `profiles?id=eq.${K.id}`, { body: { role: "sale" } })];
    check("tài khoản bị khóa không tự mở khóa được", selfUnlock.every(denied) && (await truth("profiles", "id", K.id)).role === "locked", selfUnlock.map(show));
    const unlock = await rpc(M.token, "admin_set_role", { target: K.id, new_role: "sale" });
    const back = await api(t, "GET", `orders?id=eq.${OK1}&select=id`);
    check("quản lý mở khóa: thấy lại đơn của mình", ok(unlock) && rows(back).length === 1, { unlock: show(unlock), back: show(back) });
  }

  // ───────────────────────── ensure_profile ─────────────────────────
  section("ensure_profile(): tạo bù hồ sơ bị thiếu");
  {
    const E = await newUser("e");
    await setRoleDirect(E.id, "sale");
    await adminDb.from("profiles").delete().eq("id", E.id);
    const gone = await api(E.token, "GET", "profiles?select=id");
    const nothing = [await api(E.token, "GET", "programs?select=id"), await rpc(E.token, "is_member")];
    check("tài khoản mất hồ sơ: không thấy hồ sơ, không còn là thành viên", noRows(gone) && noRows(nothing[0]) && nothing[1].body === false, { gone: show(gone) });
    const made = await rpc(E.token, "ensure_profile");
    check("ensure_profile() tạo lại hồ sơ với email đúng, ở trạng thái chờ duyệt (không lấy lại vai trò cũ)", ok(made) && made.body?.id === E.id && made.body?.email === E.email && made.body?.role === "pending" && made.body?.full_name === "Thử e", show(made));
    const again = await rpc(E.token, "ensure_profile");
    const count = await adminDb.from("profiles").select("id").eq("id", E.id);
    check("gọi lại lần nữa: trả về đúng hồ sơ đó, không tạo thêm", ok(again) && again.body?.created_at === made.body?.created_at && (count.data ?? []).length === 1, show(again));
  }

  // ───────────────────────── Xóa tài khoản ─────────────────────────
  section("Xóa tài khoản: đơn vẫn còn, không còn chủ");
  {
    const D = await newUser("d");
    await setRoleDirect(D.id, "sale");
    const OD = oid("d-a");
    const made = await api(D.token, "POST", "orders", { body: { id: OD, data: orderDoc(OD, P1) } });
    const reassign = await adminDb.from("orders").update({ owner_id: S2.id }).eq("id", OD).select("owner_id").single();
    const reassignBack = await adminDb.from("orders").update({ owner_id: D.id }).eq("id", OD).select("owner_id, rev").single();
    check("khóa bí mật (không có người gọi) đổi được chủ đơn", made.status === 201 && reassign.data?.owner_id === S2.id && reassignBack.data?.owner_id === D.id, { reassign: reassign.data, error: reassign.error?.message });
    const { error } = await adminDb.auth.admin.deleteUser(D.id);
    allUsers.splice(allUsers.indexOf(D), 1);
    const left = await truth("orders", "id", OD);
    check("xóa tài khoản đang có đơn: xóa được", !error && (await truth("profiles", "id", D.id)) === null, error?.message);
    check("đơn của tài khoản đã xóa vẫn còn, owner_id về NULL (không trỏ vào tài khoản không còn tồn tại), rev tăng 1", left !== null && left.owner_id === null && left.rev === reassignBack.data.rev + 1, left && { owner_id: left.owner_id, rev: left.rev });
    const mSees = await api(M.token, "GET", `orders?id=eq.${OD}&select=id,owner_id`);
    const sSees = await api(S1.token, "GET", `orders?id=eq.${OD}&select=id`);
    const dSees = await api(D.token, "GET", `orders?id=eq.${OD}&select=id`);
    const dProfile = await rpc(D.token, "ensure_profile");
    check("đơn không chủ: quản lý thấy, sale không thấy; token còn hạn của tài khoản đã xóa không thấy gì và không tạo lại được hồ sơ", rows(mSees).length === 1 && noRows(sSees) && noRows(dSees) && (await truth("profiles", "id", D.id)) === null, { mSees: show(mSees), dSees: show(dSees), dProfile: show(dProfile) });
  }

  // ───────────────────────── Vào thẳng cơ sở dữ liệu ─────────────────────────
  await databaseChecks({ M, M2, S1, P1 });
}

// ───────────────────────── Realtime ─────────────────────────

function listen(label, client, tables) {
  const events = [];
  const info = { status: "", errors: [], system: [] };
  const channel = client.channel(`rt-${TAG}-${label}`);
  for (const table of tables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
      events.push({ table: payload.table, type: payload.eventType, new: payload.new ?? {}, old: payload.old ?? {}, errors: payload.errors ?? null });
    });
  }
  channel.on("system", {}, (payload) => info.system.push(payload));
  channel.subscribe((status, error) => {
    info.status = status;
    if (error) info.errors.push(String(error?.message ?? error));
  });
  realtimeChannels.push([client, channel]);
  return { label, events, info };
}

async function realtimeChecks({ M, S1, S2, P, P1 }) {
  section("Realtime (postgres_changes trên programs, orders và profiles): ai nhận được gì");
  const tables = ["programs", "orders", "profiles"];
  const anonClient = newClient();
  const subs = { M: listen("m", M.client, tables), S1: listen("s1", S1.client, tables), S2: listen("s2", S2.client, tables), P: listen("p", P.client, tables), anon: listen("anon", anonClient, tables) };
  const describe = () => Object.fromEntries(Object.values(subs).map((s) => [s.label, { status: s.info.status, errors: s.info.errors, system: s.info.system.map((m) => m.message ?? m.status), events: s.events.length }]));

  const joined = await until(() => Object.values(subs).every((s) => s.info.status === "SUBSCRIBED"), 20_000);
  if (!check("cả năm kết nối (quản lý, hai sale, chờ duyệt, chưa đăng nhập) đăng ký được kênh", joined, describe())) return;

  // Sau khi báo SUBSCRIBED, máy chủ còn cần vài giây mới bắt đầu phát thay đổi; thay đổi trong lúc đó không được phát lại.
  // Nên: quản lý sửa một chương trình «mồi» lặp đi lặp lại cho tới khi quản lý và cả hai sale cùng nhận được.
  const canary = `${PREFIX}p-rt-moi`;
  await api(M.token, "POST", "programs", { body: { id: canary, data: { id: canary, name: "mồi", n: 0 } } });
  let flowing = false;
  for (let i = 1; i <= 20 && !flowing; i += 1) {
    await api(M.token, "PATCH", `programs?id=eq.${canary}`, { body: { data: { id: canary, name: "mồi", n: i } } });
    flowing = await until(() => [subs.M, subs.S1, subs.S2].every((s) => s.events.some((e) => e.table === "programs" && e.new.id === canary)), 2_500);
  }
  if (!check("Realtime bắt đầu phát: quản lý và hai sale nhận được thay đổi của chương trình «mồi»", flowing, describe())) {
    note("Realtime không phát thay đổi trong ~50 giây → các phép thử Realtime còn lại không chạy. Trạng thái các kênh ở dòng FAIL phía trên.");
    return;
  }

  /** Làm `action(lần)` rồi chờ `sub` nhận được sự kiện khớp; sự kiện có thể bị rơi (giới hạn tốc độ) nên thử lại vài lần. */
  async function delivered(sub, action, match, { tries = 4, waitMs = 6_000 } = {}) {
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const expected = await action(attempt);
      if (await until(() => sub.events.some((e) => match(e, expected)), waitMs)) return true;
    }
    return false;
  }

  // 1. Sale nhận được thay đổi chương trình do quản lý ghi.
  const gotProgram = await delivered(
    subs.S1,
    async (attempt) => rows(await api(M.token, "PATCH", `programs?id=eq.${P1}`, { body: { data: { id: P1, name: `Chương trình thử — realtime ${attempt}` } } }))[0]?.rev,
    (e, rev) => e.table === "programs" && e.type === "UPDATE" && e.new.id === P1 && e.new.rev === rev && typeof e.new.data?.name === "string",
  );
  check("sale nhận được lần sửa chương trình của quản lý (kèm id, rev, nội dung)", gotProgram, subs.S1.events.filter((e) => e.table === "programs").slice(-3));

  // 2. Sale nhận được thay đổi trên đơn của chính mình.
  const mine = `${PREFIX}o-rt-s1`;
  const gotOwnInsert = await delivered(
    subs.S1,
    async (attempt) => {
      const id = `${mine}-${attempt}`;
      await api(S1.token, "POST", "orders", { body: { id, data: orderDoc(id, P1) } });
      return id;
    },
    (e, id) => e.table === "orders" && e.type === "INSERT" && e.new.id === id && e.new.owner_id === S1.id && e.new.rev === 1,
  );
  check("sale nhận được sự kiện tạo đơn của chính mình", gotOwnInsert, subs.S1.events.filter((e) => e.table === "orders").slice(-3));
  const ownId = subs.S1.events.find((e) => e.table === "orders" && e.type === "INSERT" && String(e.new.id).startsWith(mine))?.new.id ?? `${mine}-0`;
  const gotOwnUpdate = await delivered(
    subs.S1,
    async (attempt) => rows(await api(S1.token, "PATCH", `orders?id=eq.${ownId}`, { body: { data: orderDoc(ownId, P1, { note: `sửa ${attempt}` }) } }))[0]?.rev,
    (e, rev) => e.table === "orders" && e.type === "UPDATE" && e.new.id === ownId && e.new.rev === rev,
  );
  check("sale nhận được sự kiện sửa đơn của chính mình", gotOwnUpdate, subs.S1.events.filter((e) => e.table === "orders").slice(-3));

  // 3. Sale KHÔNG nhận được nội dung đơn của sale khác. Đối chứng: quản lý nhận được chính những sự kiện đó.
  const theirs = `${PREFIX}o-rt-s2`;
  const secrets = [];
  const managerSaw = await delivered(
    subs.M,
    async (attempt) => {
      const secret = `bi-mat-${TAG}-${attempt}-${Math.random().toString(36).slice(2)}`;
      secrets.push(secret);
      const doc = orderDoc(theirs, P1, { customerName: secret, note: secret });
      const created = attempt === 0 ? await api(S2.token, "POST", "orders", { body: { id: theirs, data: doc } }) : null;
      const updated = await api(S2.token, "PATCH", `orders?id=eq.${theirs}`, { body: { data: doc } });
      return { created: created?.status, rev: rows(updated)[0]?.rev };
    },
    (e, expected) => e.table === "orders" && e.type === "UPDATE" && e.new.id === theirs && e.new.rev === expected.rev,
  );
  check("đối chứng: quản lý nhận được sự kiện tạo / sửa đơn của sale thứ hai (kèm nội dung)", managerSaw && subs.M.events.some((e) => e.new.id === theirs && secrets.includes(e.new.data?.note)), subs.M.events.filter((e) => e.table === "orders").slice(-3));
  const ownerSaw = await until(() => subs.S2.events.some((e) => e.table === "orders" && e.new.id === theirs), 6_000);
  check("đối chứng: chính sale thứ hai nhận được sự kiện về đơn của mình", ownerSaw, subs.S2.events.filter((e) => e.table === "orders").slice(-3));

  // Hồ sơ (có email, điện thoại): sale thứ hai sửa hồ sơ của mình — quản lý và chính chủ nhận được, người khác thì không.
  const profileSeen = await delivered(
    subs.M,
    async (attempt) => {
      const secret = `sdt-${TAG}-${attempt}-${Math.random().toString(36).slice(2)}`;
      secrets.push(secret);
      await api(S2.token, "PATCH", `profiles?id=eq.${S2.id}`, { body: { phone: secret } });
      return secret;
    },
    (e, secret) => e.table === "profiles" && e.type === "UPDATE" && e.new.id === S2.id && e.new.phone === secret,
  );
  check("đối chứng: quản lý nhận được sự kiện sửa hồ sơ của sale thứ hai", profileSeen, subs.M.events.filter((e) => e.table === "profiles").slice(-3));

  // «Hàng rào»: một thay đổi mà sale thứ nhất chắc chắn được nhận, ghi SAU các thay đổi trên. Khi nó tới nơi thì mọi sự kiện
  // trước nó (nếu có gửi cho sale thứ nhất) cũng đã tới.
  const fence = await delivered(
    subs.S1,
    async (attempt) => rows(await api(M.token, "PATCH", `programs?id=eq.${canary}`, { body: { data: { id: canary, name: "hàng rào", n: 100 + attempt } } }))[0]?.rev,
    (e, rev) => e.table === "programs" && e.new.id === canary && e.new.rev === rev,
  );
  check("«hàng rào» sau các thay đổi trên tới được sale thứ nhất (để chắc là đã chờ đủ)", fence, describe());

  const leaks = (sub) => sub.events.filter((e) => (e.type !== "DELETE" && (e.new.id === theirs || e.new.owner_id === S2.id)) || secrets.some((s) => JSON.stringify(e).includes(s)));
  check("sale thứ nhất KHÔNG nhận được sự kiện tạo / sửa nào về đơn của sale thứ hai, không thấy nội dung của nó", fence && leaks(subs.S1).length === 0, leaks(subs.S1).slice(0, 3));
  const foreignOrders = subs.S1.events.filter((e) => e.table === "orders" && e.type !== "DELETE" && e.new.owner_id !== S1.id);
  check("mọi sự kiện tạo / sửa đơn mà sale thứ nhất nhận được đều là đơn của chính mình", foreignOrders.length === 0, foreignOrders.slice(0, 3));
  const foreignProfiles = (sub, self) => sub.events.filter((e) => e.table === "profiles" && e.type !== "DELETE" && e.new.id !== self.id);
  check(
    "sale và tài khoản chờ duyệt không nhận được sự kiện tạo / sửa hồ sơ của người khác (email, điện thoại)",
    fence && foreignProfiles(subs.S1, S1).length === 0 && foreignProfiles(subs.P, P).length === 0 && foreignProfiles(subs.S2, S2).length === 0,
    [...foreignProfiles(subs.S1, S1), ...foreignProfiles(subs.P, P), ...foreignProfiles(subs.S2, S2)].slice(0, 3),
  );
  const pendingData = subs.P.events.filter((e) => e.table !== "profiles" && (e.type !== "DELETE" || Object.keys(e.new).length > 0));
  check("tài khoản chờ duyệt không nhận được sự kiện tạo / sửa nào của chương trình và đơn hàng", pendingData.length === 0 && leaks(subs.P).length === 0, pendingData.slice(0, 3));
  const anonData = subs.anon.events.filter((e) => Object.keys(e.new).length > 0 || Object.keys(e.old).length > 0);
  check("kết nối chưa đăng nhập không nhận được dữ liệu của dòng nào (kể cả khóa chính)", anonData.length === 0, anonData.slice(0, 3));

  // 4. Sự kiện XÓA: Realtime không áp RLS được cho dòng đã xóa → gửi cho mọi tài khoản đã đăng nhập, nhưng chỉ kèm khóa chính.
  await api(S2.token, "DELETE", `orders?id=eq.${theirs}`);
  await delivered(subs.M, async () => null, (e) => e.table === "orders" && e.type === "DELETE" && e.old.id === theirs, { tries: 1, waitMs: 8_000 });
  await sleep(1_500);
  const deletes = (sub) => sub.events.filter((e) => e.type === "DELETE");
  const onlyKey = (e) => Object.keys(e.new).length === 0 && Object.keys(e.old).every((k) => k === "id");
  check("sự kiện XÓA gửi tới sale khác / tài khoản chờ duyệt chỉ kèm khóa chính (id), không kèm nội dung", [subs.S1, subs.P].every((s) => deletes(s).every(onlyKey)) && leaks(subs.S1).length === 0 && leaks(subs.P).length === 0, [...deletes(subs.S1), ...deletes(subs.P)].filter((e) => !onlyKey(e)).slice(0, 3));
  const s1SawDelete = deletes(subs.S1).some((e) => e.old.id === theirs);
  const pSawDelete = deletes(subs.P).some((e) => e.old.id === theirs);
  note(`Realtime, sự kiện XÓA đơn của sale thứ hai: sale thứ nhất ${s1SawDelete ? "CÓ" : "không"} nhận, tài khoản chờ duyệt ${pSawDelete ? "CÓ" : "không"} nhận — nội dung chỉ gồm {"id": "…"} (RLS không áp được cho dòng đã xóa).`);
  const anonStubs = subs.anon.events.length;
  note(`Realtime, kết nối chưa đăng nhập: nhận ${anonStubs} thông báo rỗng kèm lỗi «${subs.anon.events[0]?.errors?.[0] ?? "—"}» — biết được bảng nào vừa có thay đổi loại gì, vào lúc nào; không có dữ liệu.`);

  for (const [client, channel] of realtimeChannels.splice(0)) await client.removeChannel(channel).catch(() => {});
  await adminDb.from("orders").delete().like("id", `${PREFIX}o-rt-%`);
  await api(M.token, "DELETE", `programs?id=eq.${canary}`);
}

// ───────────────────────── Những gì phải vào thẳng cơ sở dữ liệu ─────────────────────────

async function databaseChecks({ M, M2, S1, P1 }) {
  section("Vào thẳng cơ sở dữ liệu bằng psql (quyền trên bảng / hàm, tài khoản đầu tiên, mã đơn sau số 999, hai giao dịch chen nhau)");
  const names = ["quyền trên bảng và hàm, RLS, Realtime", "tài khoản đầu tiên là quản lý", "mã đơn sau số 999", "hàng rào thứ hai (trigger) khi quyền theo cột bị nới", "hai quản lý hạ quyền lẫn nhau cùng lúc", "xóa chương trình đúng lúc có đơn mới"];
  if (process.env.SKIP_PSQL === "1") return names.forEach((name) => skip(name, "SKIP_PSQL=1"));
  if (!IS_LOCAL && !process.env.SUPABASE_DB_CONTAINER) return names.forEach((name) => skip(name, "SUPABASE_URL không phải máy này và không đặt SUPABASE_DB_CONTAINER"));
  const ping = psql("select 1;");
  if (!ping.ok || ping.out !== "1") return names.forEach((name) => skip(name, `không chạy được psql trong container ${DB_CONTAINER}: ${brief(ping.err, 200)}`));

  // 1. Quyền thực tế của từng vai trò (kể cả quyền thừa hưởng từ PUBLIC).
  const catalog = psql(`
    with t(name) as (values ('profiles'), ('programs'), ('orders'), ('app_state'), ('order_counters')),
         r(role) as (values ('anon'), ('authenticated')),
         p(priv) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'))
    select json_build_object(
      'tables', (select json_object_agg(r.role || '.' || t.name, (select coalesce(json_agg(p.priv order by p.priv) filter (where has_table_privilege(r.role, 'public.' || t.name, p.priv)), '[]'::json) from p)) from t, r),
      'columns', (select json_object_agg(r.role, (
          select coalesce(json_agg(c.relname || '.' || a.attname || ':' || p.priv order by c.relname, a.attname, p.priv), '[]'::json)
            from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped, p
           where c.relnamespace = 'public'::regnamespace and c.relname in (select name from t) and p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
             and has_column_privilege(r.role, c.oid, a.attname, p.priv) and not has_table_privilege(r.role, c.oid, p.priv))) from r),
      'rls', (select json_object_agg(c.relname, c.relrowsecurity) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (select name from t)),
      'functions', (select json_object_agg(f.proname, json_build_object(
          'definer', f.prosecdef, 'path', f.proconfig,
          'anon', has_function_privilege('anon', f.oid, 'execute'), 'authenticated', has_function_privilege('authenticated', f.oid, 'execute'), 'public', has_function_privilege('public', f.oid, 'execute')))
        from pg_proc f where f.pronamespace = 'public'::regnamespace),
      'publication', (select coalesce(json_agg(tablename order by tablename), '[]'::json) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'),
      'policies', (select json_object_agg(tablename, n) from (select tablename, count(*) as n from pg_policies where schemaname = 'public' group by tablename) x)
    );`);
  let c = null;
  try {
    c = JSON.parse(catalog.out);
  } catch {
    c = null;
  }
  if (!check("đọc được danh mục quyền từ cơ sở dữ liệu", catalog.ok && c !== null, catalog.err || catalog.out)) return;
  // Quyền cả bảng: chỉ đọc và xóa. Quyền ghi (INSERT / UPDATE) chỉ cấp theo cột — xem phép thử kế tiếp.
  const expectTables = {
    "anon.profiles": [], "anon.programs": [], "anon.orders": [], "anon.app_state": [], "anon.order_counters": [],
    "authenticated.profiles": ["SELECT"], "authenticated.programs": ["DELETE", "SELECT"], "authenticated.orders": ["DELETE", "SELECT"], "authenticated.app_state": ["SELECT"], "authenticated.order_counters": [],
  };
  check("quyền cả bảng: anon không có gì; authenticated chỉ đọc (và xóa chương trình / đơn hàng) — không INSERT / UPDATE cả bảng, không TRUNCATE / REFERENCES / TRIGGER", isDeepStrictEqual(c.tables, expectTables), c.tables);
  const expectColumns = {
    anon: [],
    authenticated: [
      "app_state.data:INSERT", "app_state.data:UPDATE", "app_state.key:INSERT",
      "orders.data:INSERT", "orders.data:UPDATE", "orders.id:INSERT",
      "profiles.full_name:UPDATE", "profiles.phone:UPDATE",
      "programs.data:INSERT", "programs.data:UPDATE", "programs.id:INSERT",
    ],
  };
  check(
    "quyền ghi theo cột: authenticated thêm dòng với đúng (id, data) / (key, data), sửa đúng cột data — và full_name, phone của profiles; anon không có quyền trên cột nào",
    isDeepStrictEqual(c.columns, expectColumns),
    c.columns,
  );
  check("RLS bật trên cả năm bảng", isDeepStrictEqual(c.rls, { profiles: true, programs: true, orders: true, app_state: true, order_counters: true }), c.rls);
  check("bảng bộ đếm bật RLS mà không có policy nào (không ai qua API đọc được)", c.policies.order_counters === undefined && ["profiles", "programs", "orders", "app_state"].every((t) => c.policies[t] > 0), c.policies);
  const callable = ["is_member", "is_manager", "ensure_profile", "admin_set_role", "admin_set_password", "sync_fingerprint"];
  check(
    "hàm: authenticated gọi được đúng 6 hàm dành cho trình duyệt; anon và PUBLIC không gọi được hàm nào trong đó; create_profile không ai gọi được",
    callable.every((f) => c.functions[f]?.authenticated === true && c.functions[f].anon === false && c.functions[f].public === false) &&
      c.functions.create_profile?.authenticated === false && c.functions.create_profile.anon === false && c.functions.create_profile.public === false,
    Object.fromEntries([...callable, "create_profile"].map((f) => [f, c.functions[f]])),
  );
  const definers = Object.entries(c.functions).filter(([, f]) => f.definer);
  check(
    "mọi hàm security definer đều khóa search_path rỗng; sync_fingerprint KHÔNG phải security definer",
    definers.length >= 8 && definers.every(([, f]) => (f.path ?? []).includes('search_path=""')) && c.functions.sync_fingerprint?.definer === false && (c.functions.sync_fingerprint.path ?? []).includes('search_path=""'),
    Object.fromEntries(Object.entries(c.functions).map(([name, f]) => [name, `${f.definer ? "definer" : "invoker"} ${f.path}`])),
  );
  check("bốn bảng profiles / programs / orders / app_state nằm trong publication supabase_realtime; bảng bộ đếm thì không", isDeepStrictEqual(c.publication, ["app_state", "orders", "profiles", "programs"]), c.publication);

  // 2. Tài khoản đầu tiên là quản lý — thử trong giao dịch có ROLLBACK với bảng hồ sơ tạm coi như trống.
  const a = randomUUID();
  const b = randomUUID();
  const first = psql(`
    begin;
    delete from public.profiles;
    insert into auth.users (id, email, raw_user_meta_data) values ('${a}', 't-${TAG}-first@example.com', '{"full_name": "  Người đầu tiên  ", "role": "locked"}');
    insert into auth.users (id, email, raw_user_meta_data) values ('${b}', 't-${TAG}-second@example.com', '{"full_name": "Người thứ hai", "role": "manager"}');
    select 'trigger:' || string_agg(role || '/' || full_name, ',' order by created_at, email) from public.profiles;
    delete from public.profiles where id = '${b}';
    ${actAs(b)}
    select 'ensure-second:' || role from public.ensure_profile();
    reset role;
    delete from public.profiles;
    ${actAs(b)}
    select 'ensure-empty:' || role from public.ensure_profile();
    reset role;
    rollback;
    select 'left:' || count(*) from auth.users where id in ('${a}', '${b}');`);
  const lines = first.out.split("\n").filter((line) => /^[a-z-]+:/.test(line));
  check(
    "bảng hồ sơ trống: tài khoản đăng ký đầu tiên thành quản lý, tài khoản sau là pending (role tự khai bị bỏ qua)",
    first.ok && lines[0] === "trigger:manager/Người đầu tiên,pending/Người thứ hai",
    first.err || first.out,
  );
  check("ensure_profile() tạo bù: còn hồ sơ khác → pending; bảng hồ sơ trống → quản lý; giao dịch thử đã rollback sạch", lines[1] === "ensure-second:pending" && lines[2] === "ensure-empty:manager" && lines[3] === "left:0", first.err || first.out);

  // 3. Mã đơn sau số 999 — đặt tạm bộ đếm của hôm nay lên 998 trong giao dịch có ROLLBACK.
  //    Dòng đầu là ba số phải ra: 999, 1000, 1001 — trừ số nào hôm nay đã có đơn thật mang mã đó (máy chủ bỏ qua số ấy).
  const over = psql(`
    begin;
    select pg_advisory_xact_lock(hashtext('kmdb.order_code')) is null;
    select 'want:' || string_agg(n::text, ',' order by n) from (
      select n from generate_series(999, 1200) n
       where not exists (select 1 from public.orders o where o.code = 'DH' || to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYMMDD') || '-' || n::text)
       order by n limit 3) free;
    insert into public.order_counters (day, last) values ((now() at time zone 'Asia/Ho_Chi_Minh')::date, 998) on conflict (day) do update set last = 998;
    insert into public.orders (id, data) values ('${PREFIX}o-k1', '{"code": "", "programId": "x", "status": "draft"}') returning split_part(code, '-', 2);
    insert into public.orders (id, data) values ('${PREFIX}o-k2', '{"code": "", "programId": "x", "status": "draft"}') returning split_part(code, '-', 2);
    insert into public.orders (id, data) values ('${PREFIX}o-k3', '{"code": "", "programId": "x", "status": "draft"}') returning split_part(code, '-', 2);
    rollback;`);
  const overLines = over.out.split(/\s+/);
  const wantLine = overLines.find((line) => line.startsWith("want:")) ?? "";
  const gotNumbers = overLines.filter((line) => /^\d+$/.test(line));
  check(
    "đơn thứ 999, 1000, 1001 trong ngày nhận số 999, 1000, 1001 (không bị cắt thành «100» và trùng nhau)",
    over.ok && /^want:\d{3,4},\d{4},\d{4}$/.test(wantLine) && gotNumbers.length === 3 && gotNumbers.join(",") === wantLine.slice(5),
    over.err || over.out,
  );

  // 3b. Hàng rào thứ hai. Quyền theo cột đã chặn trình duyệt gửi owner_id / rev / created_at; nếu một ngày quyền đó bị nới ra
  //     thì trigger vẫn phải giữ các cột ấy. Thử bằng vai trò có đủ quyền trên bảng (postgres) nhưng mang danh tính của một
  //     sale, rồi của quản lý — trong giao dịch có ROLLBACK.
  {
    const id = `${PREFIX}o-rao`;
    const asUser = (userId) => `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true) is null;`;
    const doc = (code) => JSON.stringify({ id, code, programId: P1, status: "draft" });
    const fence = psql(`
      begin;
      ${asUser(S1.id)}
      insert into public.orders (id, owner_id, rev, created_at, updated_at, data) values ('${id}', '${M.id}', 99, '2000-01-01', '2000-01-01', '${doc("TU-DAT")}')
        returning 'sale-insert:' || (owner_id = '${S1.id}') || '/' || rev || '/' || (created_at > '2020-01-01') || '/' || (updated_at > '2020-01-01') || '/' || (code ~ '^DH[0-9]{6}-[0-9]{3,}$') || '/' || (data ->> 'code' = code);
      update public.orders set owner_id = '${M.id}', rev = 500, created_at = '2000-01-01', updated_at = '2000-01-01', data = '${doc("DOI-MA")}' where id = '${id}'
        returning 'sale-update:' || (owner_id = '${S1.id}') || '/' || rev || '/' || (created_at > '2020-01-01') || '/' || (updated_at > '2020-01-01') || '/' || (code ~ '^DH[0-9]{6}-[0-9]{3,}$');
      update public.orders set owner_id = null where id = '${id}' returning 'sale-null:' || coalesce(owner_id::text = '${S1.id}', false) || '/' || rev;
      delete from public.orders where id = '${id}';
      ${asUser(M.id)}
      insert into public.orders (id, owner_id, rev, created_at, data) values ('${id}', '${S1.id}', 99, '2000-01-01', '${doc("MA-CU")}')
        returning 'manager-insert:' || (owner_id = '${S1.id}') || '/' || rev || '/' || (created_at > '2020-01-01') || '/' || code;
      update public.orders set owner_id = '${M.id}', rev = 500, created_at = '2000-01-01', data = '${doc("DOI-MA")}' where id = '${id}'
        returning 'manager-update:' || (owner_id = '${M.id}') || '/' || rev || '/' || (created_at > '2020-01-01') || '/' || code;
      rollback;
      select 'left:' || count(*) from public.orders where id = '${id}';`);
    const got = fence.out.split("\n").filter((line) => /^[a-z-]+:/.test(line));
    check(
      "hàng rào thứ hai (trigger), khi vai trò có đủ quyền trên bảng: sale vẫn không đặt được owner_id / rev / created_at / updated_at / mã; quản lý đặt được chủ đơn và mã, không đặt được rev / created_at",
      fence.ok &&
        isDeepStrictEqual(got, [
          "sale-insert:true/1/true/true/true/true",
          "sale-update:true/2/true/true/true",
          "sale-null:true/3",
          "manager-insert:true/1/true/MA-CU",
          "manager-update:true/2/true/MA-CU",
          "left:0",
        ]),
      fence.err || fence.out,
    );
  }

  // 4. Hai quản lý hạ quyền lẫn nhau cùng một lúc: phiên A hạ B nhưng chưa commit, phiên B hạ A.
  {
    const marker = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const sessionA = psqlAsync(`
      begin;
      ${actAs(M.id)}
      select 'A:' || role from public.admin_set_role('${M2.id}', 'sale');
      select pg_advisory_xact_lock(${marker}) is null;
      select pg_sleep(1.5) is null;
      commit;`);
    const sessionB = psqlAsync(`
      ${waitForMarker(marker)}
      begin;
      ${actAs(M2.id)}
      select 'B:' || role from public.admin_set_role('${M.id}', 'sale');
      commit;`);
    const [ra, rb] = await Promise.all([sessionA, sessionB]);
    const roles = await adminDb.from("profiles").select("id, role").in("id", [M.id, M2.id]);
    const roleOf = Object.fromEntries((roles.data ?? []).map((p) => [p.id, p.role]));
    check(
      "hai quản lý hạ quyền lẫn nhau cùng lúc: chỉ một bên thành công, hệ thống vẫn còn quản lý",
      ra.ok && ra.out.includes("A:sale") && !rb.ok && /Chỉ người quản lý/.test(rb.err) && roleOf[M.id] === "manager" && roleOf[M2.id] === "sale",
      { A: ra.out || ra.err, B: rb.out || rb.err, roleOf },
    );
    if (roleOf[M.id] !== "manager") await setRoleDirect(M.id, "manager");
  }

  // 5. Xóa chương trình đúng lúc một sale đang tạo đơn thuộc chương trình đó (đơn đã ghi nhưng giao dịch chưa commit).
  {
    const PR = `${PREFIX}p-race`;
    const OR = `${PREFIX}o-race`;
    await api(M.token, "POST", "programs", { body: { id: PR, data: { id: PR, name: "chen nhau" } } });
    const marker = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const inserting = psqlAsync(`
      begin;
      ${actAs(S1.id)}
      insert into public.orders (id, data) values ('${OR}', '${JSON.stringify({ id: OR, code: "", programId: PR, status: "draft" })}') returning 'I:' || id;
      select pg_advisory_xact_lock(${marker}) is null;
      select pg_sleep(1.5) is null;
      commit;`);
    const deleting = psqlAsync(`
      ${waitForMarker(marker)}
      begin;
      ${actAs(M.id)}
      delete from public.programs where id = '${PR}' returning 'D:' || id;
      commit;`);
    const [ri, rd] = await Promise.all([inserting, deleting]);
    const program = await truth("programs", "id", PR);
    const order = await truth("orders", "id", OR);
    check(
      "xóa chương trình đúng lúc có đơn mới đang ghi dở: lệnh xóa chờ rồi bị từ chối; không có đơn nào mồ côi",
      ri.ok && order !== null && order.owner_id === S1.id && program !== null && !rd.ok && /còn 1 đơn hàng/.test(rd.err),
      { insert: ri.out || ri.err, delete: rd.out || rd.err, programStillThere: program !== null, order: order && order.id },
    );
    await adminDb.from("orders").delete().eq("id", OR);
    await adminDb.from("programs").delete().eq("id", PR);
  }
  void P1;
}

// ───────────────────────── Dọn dẹp ─────────────────────────

async function cleanup() {
  section("Dọn dẹp");
  for (const [client, channel] of realtimeChannels.splice(0)) await client.removeChannel(channel).catch(() => {});
  const problems = [];
  const run = async (label, promise) => {
    const { error } = await promise;
    if (error) problems.push(`${label}: ${error.message}`);
  };
  await run("xóa đơn theo id", adminDb.from("orders").delete().like("id", `${PREFIX}%`));
  const ids = allUsers.map((u) => u.id);
  if (ids.length > 0) await run("xóa đơn theo chủ", adminDb.from("orders").delete().in("owner_id", ids));
  await run("xóa chương trình", adminDb.from("programs").delete().like("id", `${PREFIX}%`));
  // Chỉ có khi một lệnh «thử ghi bộ đếm» lọt qua (đã báo FAIL ở trên): gỡ dòng của ngày giả đó đi.
  if (counterRowLeaked) await run("xóa dòng bộ đếm thử", adminDb.from("order_counters").delete().eq("day", FAR_DAY));
  for (const user of allUsers) {
    const { error } = await adminDb.auth.admin.deleteUser(user.id);
    if (error) problems.push(`xóa tài khoản ${user.name}: ${error.message}`);
  }
  const left = await Promise.all([
    adminDb.from("orders").select("id").like("id", `${PREFIX}%`),
    adminDb.from("programs").select("id").like("id", `${PREFIX}%`),
    adminDb.from("profiles").select("id").like("email", `t-${TAG}-%`),
  ]);
  const remaining = left.map((r) => (r.data ?? []).length);
  check("đã dọn sạch đơn hàng, chương trình và tài khoản thử của lần chạy này", problems.length === 0 && remaining.every((n) => n === 0), { problems, remaining });
}

const watchdog = setTimeout(() => {
  console.log("FAIL  kiểm thử chạy quá 8 phút — dừng lại");
  process.exit(2);
}, 8 * 60_000);

let crashed = null;
try {
  await main();
} catch (error) {
  crashed = error;
  failed += 1;
  failures.push("kiểm thử dừng giữa chừng");
  console.log(`FAIL  kiểm thử dừng giữa chừng\n        → ${error?.stack ?? error}`);
}
try {
  await cleanup();
} catch (error) {
  failed += 1;
  failures.push("dọn dẹp");
  console.log(`FAIL  dọn dẹp\n        → ${error?.stack ?? error}`);
}
clearTimeout(watchdog);

console.log(`\n══ Kết quả: ${passed} PASS, ${failed} FAIL${skipped ? `, ${skipped} SKIP` : ""}${crashed ? " (dừng giữa chừng)" : ""}`);
if (failed > 0) {
  console.log("Các mục FAIL:");
  for (const name of failures) console.log(`  • ${name}`);
}
process.exit(failed > 0 ? 1 : 0);
