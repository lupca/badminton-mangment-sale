// Kiểm thử lớp máy chủ: lược đồ database (server/schema.sql) + lớp API (server/app.js), đi đúng đường mà trình duyệt đi —
// gọi hàm handle() của lớp API với khóa phiên của từng vai trò — và cố tình gọi sai cách (thiếu quyền, tham số tự chế,
// hai yêu cầu chen nhau…) để chắc rằng máy chủ là nơi giữ quyền và giữ dữ liệu đúng, chứ không phải giao diện.
//
// Chạy:  npm run test:db   (server/tests/run.mjs tự dựng một PostgreSQL thử bằng Docker rồi gọi file này).
// File này XÓA SẠCH dữ liệu trước mỗi nhóm phép thử, nên chỉ chạy được trên database thử — xem helpers.mjs.
//
// In ra từng dòng PASS / FAIL, cuối cùng là «PASS=n FAIL=m»; có FAIL thì thoát với mã khác 0.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { MAX_BODY_BYTES, RESPONSE_HEADERS, SCHEMA_VERSION, handleFetch, hashPassword } from "../app.js";
import { startApiServer } from "../node.js";
import {
  TEST_MARK_KEY,
  api,
  check,
  closeApi,
  closeDatabase,
  compareAsUtf8,
  fingerprintOf,
  freshIp,
  group,
  note,
  ok,
  openSession,
  orderDoc,
  programDoc,
  refused,
  resetDatabase,
  show,
  signIn,
  signUp,
  sleep,
  sql,
  stateDigest,
  summary,
  team,
  until,
  useTestDatabase,
  vietnamDay,
} from "./helpers.mjs";

const { url: TEST_URL, adminUrl: ADMIN_URL } = useTestDatabase();
/** Database thử do chính server/tests/run.mjs dựng bằng Docker (dùng xong bỏ): được phép chỉnh cả cấu hình máy chủ của nó. */
const THROWAWAY = process.env.KM_TEST_THROWAWAY === "1";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const watchdog = setTimeout(() => {
  console.log("FAIL  kiểm thử chạy quá 10 phút — dừng lại");
  process.exit(2);
}, 10 * 60_000);

// ───────────────────────── Đồ dùng riêng của file này ─────────────────────────

const OK = /** @type {const} */ ([200, null]);
const DENIED = /** @type {const} */ ([403, "forbidden"]);
const BAD = /** @type {const} */ ([400, "bad_request"]);
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const CODE_FORMAT = /^DH\d{6}-\d{3,}$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Bước chuẩn bị: lệnh phải thành công, nếu không thì dừng nhóm phép thử. */
function must(r, what = "bước chuẩn bị") {
  if (!ok(r)) throw new Error(`${what} thất bại: ${JSON.stringify(show(r))}`);
  return r.result;
}

const insertProgram = (who, id, extra) => api("sync.insert", { table: "programs", id, data: programDoc(id, extra) }, { token: who.token });
const insertOrder = (who, id, programId, extra) => api("sync.insert", { table: "orders", id, data: orderDoc(id, programId, extra) }, { token: who.token });
const orderRow = async (id) =>
  (await sql("select id, owner_id, rev, code, status, program_id, data, created_at::text as created_at, updated_at::text as updated_at from km.orders where id = $1", [id]))[0] ?? null;
const programRow = async (id) => (await sql("select id, rev, data, updated_by from km.programs where id = $1", [id]))[0] ?? null;
const stateRow = async (key) => (await sql("select key, rev, data, updated_by from km.app_state where key = $1", [key]))[0] ?? null;
const count = async (table, where = "true", params = []) => (await sql(`select count(*)::int as n from km.${table} where ${where}`, params))[0].n;
const tokenHashHex = (token) => createHash("sha256").update(token).digest("hex");
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
/** Số phiên database đang đứng chờ một khóa (để biết một yêu cầu đã thật sự «kẹt lại chờ» hay chưa). */
const lockWaiters = async () =>
  (await sql("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'"))[0].n;
/** Số kết nối mà lớp API đang mở tới database. */
const apiConnections = async () => (await sql("select count(*)::int as n from pg_stat_activity where application_name = 'km-api'"))[0].n;

/** Gọi một lệnh và kiểm tra rằng nó bị từ chối đúng kiểu, đồng thời không có gì trong database đổi. */
async function expectRefused(name, call, status, code, extra) {
  const before = await stateDigest();
  const r = await call();
  const after = await stateDigest();
  return check(
    `${name} → ${status} ${code}, dữ liệu giữ nguyên`,
    refused(r, status, code) && before === after && (!extra || extra(r)),
    { ...show(r), dataChanged: before !== after },
  );
}

/**
 * Một trạm trung chuyển TCP đứng trước database thử, để dựng tình huống «đường truyền đứng hình đúng lúc lớp API đóng kết
 * nối»: khi bật blackHoleOnClose, lời chào tạm biệt của lớp API (tin «Terminate» của giao thức Postgres) bị nuốt mất và
 * kết nối không bao giờ được đáp lại — như khi mạng giữa Vercel và database vừa đứt.
 * @param {number} targetPort
 * @returns {Promise<{ port: number, blackHoleOnClose(on: boolean): void, swallowed(): number, close(): Promise<void> }>}
 */
function startBlackHoleProxy(targetPort) {
  /** @type {Set<net.Socket>} */
  const sockets = new Set();
  const goodbye = Buffer.from([0x58, 0, 0, 0, 4]);
  let swallowGoodbye = false;
  let swallowed = 0;
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    const upstream = net.connect({ host: "127.0.0.1", port: targetPort, allowHalfOpen: true });
    let silent = false;
    client.on("data", (chunk) => {
      if (swallowGoodbye && chunk.length >= goodbye.length && chunk.subarray(chunk.length - goodbye.length).equals(goodbye)) {
        silent = true;
        swallowed += 1;
        return;
      }
      if (!silent) upstream.write(chunk);
    });
    client.on("end", () => {
      if (!silent) upstream.end();
    });
    upstream.on("data", (chunk) => {
      if (!silent) client.write(chunk);
    });
    upstream.on("end", () => {
      if (!silent) client.end();
    });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: /** @type {net.AddressInfo} */ (server.address()).port,
        blackHoleOnClose(on) {
          swallowGoodbye = on;
        },
        swallowed: () => swallowed,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

// ═════════════════════════ Giao thức ═════════════════════════

await group("Giao thức", async () => {
  const health = await api("", {}, { method: "GET" });
  check(
    "GET: tình trạng — database «ok», lược đồ đúng phiên bản mã nguồn cần",
    health.status === 200 && health.body.ok === true && health.body.database === "ok" && health.body.schema === SCHEMA_VERSION && health.body.expects === SCHEMA_VERSION,
    show(health),
  );
  const head = await api("", {}, { method: "HEAD" });
  check("HEAD: trả lời như GET", head.status === 200 && head.body.database === "ok", show(head));
  check(
    "tình trạng không lộ địa chỉ hay mật khẩu của database",
    !/postgres(ql)?:\/\/|127\.0\.0\.1|localhost|password/i.test(JSON.stringify(health.body)) && !JSON.stringify(health.body).includes(new URL(TEST_URL).password),
    health.body,
  );
  check("các đầu mục trả lời: JSON, không cho lưu đệm", RESPONSE_HEADERS["cache-control"] === "no-store" && /^application\/json/.test(RESPONSE_HEADERS["content-type"]) && RESPONSE_HEADERS["x-content-type-options"] === "nosniff", RESPONSE_HEADERS);

  for (const method of ["PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const r = await api("me", {}, { method });
    check(`${method} → 405 bad_request`, refused(r, 405, "bad_request"), show(r));
  }
  for (const [label, contentType] of [["text/plain", "text/plain"], ["để trống", ""], ["application/x-www-form-urlencoded", "application/x-www-form-urlencoded"], ["application/jsonp", "application/jsonp"]]) {
    const r = await api("me", {}, { contentType });
    check(`Content-Type ${label} → 400 bad_request`, refused(r, 400, "bad_request"), show(r));
  }
  const withCharset = await api("me", {}, { contentType: "application/json; charset=utf-8" });
  check("Content-Type «application/json; charset=utf-8» được nhận (rồi 401 vì chưa đăng nhập)", refused(withCharset, 401, "unauthorized"), show(withCharset));

  for (const [label, raw] of [["không phải JSON", "{not json"], ["rỗng", ""], ["null", "null"], ["một mảng", "[]"], ["một con số", "5"], ["một chuỗi", '"me"']]) {
    const r = await api("", {}, { raw });
    check(`thân yêu cầu ${label} → 400 bad_request`, refused(r, 400, "bad_request"), show(r));
  }
  for (const [label, raw] of [["thiếu op", "{}"], ["op là số", '{"op":5}'], ["op là null", '{"op":null}'], ["op dài quá 64 ký tự", JSON.stringify({ op: "x".repeat(65) })]]) {
    const r = await api("", {}, { raw });
    check(`${label} → 400 bad_request`, refused(r, 400, "bad_request"), show(r));
  }
  for (const [label, args] of [["một mảng", "[]"], ["một chuỗi", '"x"'], ["một con số", "7"]]) {
    const r = await api("", {}, { raw: `{"op":"auth.signIn","args":${args}}` });
    check(`args là ${label} → 400 bad_request`, refused(r, 400, "bad_request"), show(r));
  }

  const user = await signUp("giaothuc");
  const nullArgs = await api("", {}, { raw: '{"op":"me","args":null}', token: user.token });
  check("args là null được coi như không có tham số", ok(nullArgs) && nullArgs.result?.id === user.id, show(nullArgs));
  const unknown = await api("khong.co.lenh.nay", {}, { token: user.token });
  check("lệnh lạ (đã đăng nhập) → 400 bad_request", refused(unknown, 400, "bad_request"), show(unknown));
  for (const op of ["__proto__", "constructor", "toString", "me ", "ME", "me;drop"]) {
    const r = await api(op, {}, { token: user.token });
    check(`tên lệnh «${op}» → 400 bad_request`, refused(r, 400, "bad_request"), show(r));
  }

  for (const [label, authorization] of [
    ["thiếu khóa", "Bearer"],
    ["khóa quá ngắn", "Bearer abc"],
    ["kiểu Basic", `Basic ${user.token}`],
    ["khóa có khoảng trắng", `Bearer ${user.token.slice(0, 20)} ${user.token.slice(20)}`],
    ["khóa có ký tự lạ", `Bearer ${user.token.slice(0, 30)}+/=${user.token.slice(33)}`],
    ["khóa dài quá 200 ký tự", `Bearer ${"a".repeat(201)}`],
    ["không có chữ Bearer", user.token],
  ]) {
    const r = await api("me", {}, { authorization });
    check(`Authorization sai dạng (${label}) → 401 unauthorized`, refused(r, 401, "unauthorized"), show(r));
  }
  const lower = await api("me", {}, { authorization: `bearer ${user.token}` });
  check("«bearer» viết thường không được nhận (đúng dạng là «Bearer <khóa>») → 401", refused(lower, 401, "unauthorized"), show(lower));
  const padded = await api("me", {}, { authorization: `  Bearer   ${user.token}  ` });
  check("khoảng trắng thừa quanh khóa phiên được bỏ qua", ok(padded) && padded.result?.id === user.id, show(padded));
  const forged = await api("me", {}, { token: "A".repeat(43) });
  check("khóa đúng dạng nhưng không có thật → 401 unauthorized", refused(forged, 401, "unauthorized"), show(forged));
  const hashAsToken = await api("me", {}, { token: tokenHashHex(user.token) });
  check("mã băm của khóa phiên (thứ nằm trong database) không dùng thay khóa phiên được → 401", refused(hashAsToken, 401, "unauthorized"), show(hashAsToken));

  const before = await stateDigest();
  const protectedOps = [
    ["me", {}],
    ["me.update", { fullName: "x" }],
    ["me.password", { newPassword: "mat-khau-moi" }],
    ["accounts.list", {}],
    ["accounts.setRole", { id: user.id, role: "sale" }],
    ["accounts.setPassword", { id: user.id, newPassword: "mat-khau-moi" }],
    ["sync.poll", {}],
    ["sync.heads", { table: "programs" }],
    ["sync.load", { table: "orders" }],
    ["sync.insert", { table: "programs", id: "p", data: { id: "p" } }],
    ["sync.update", { table: "app_state", id: "stock", rev: 1, data: {} }],
    ["sync.remove", { table: "orders", id: "o" }],
    ["khong.co", {}],
  ];
  for (const [op, args] of protectedOps) {
    const r = await api(op, args);
    check(`chưa đăng nhập: ${op} → 401 unauthorized`, refused(r, 401, "unauthorized"), show(r));
  }
  check("các lệnh gọi khi chưa đăng nhập không đổi gì trong database", before === (await stateDigest()));

  const big = await api("", {}, { raw: JSON.stringify({ op: "me.update", args: { fullName: "x".repeat(MAX_BODY_BYTES) } }), token: user.token });
  check("thân yêu cầu lớn hơn giới hạn → 413 too_large", refused(big, 413, "too_large"), { status: big.status, code: big.code });
  const envelope = JSON.stringify({ op: "me.update", args: { fullName: "" } }).length;
  const nearLimit = await api("", {}, { raw: JSON.stringify({ op: "me.update", args: { fullName: "y".repeat(MAX_BODY_BYTES - envelope) } }), token: user.token });
  check(
    "thân yêu cầu vừa đúng giới hạn vẫn được xử lý (họ tên bị cắt còn 120 ký tự)",
    ok(nearLimit) && nearLimit.result?.fullName === "y".repeat(120),
    { status: nearLimit.status, code: nearLimit.code },
  );
});

await group("Giao thức qua HTTP thật (máy chủ Node ở máy mình)", async () => {
  const server = await startApiServer(0);
  try {
    const get = await fetch(server.url);
    const getBody = await get.json();
    check(
      "GET /api: 200, JSON, «no-store», «nosniff», database ok",
      get.status === 200 &&
        /^application\/json/.test(get.headers.get("content-type") ?? "") &&
        get.headers.get("cache-control") === "no-store" &&
        get.headers.get("x-content-type-options") === "nosniff" &&
        getBody.database === "ok",
      { status: get.status, headers: Object.fromEntries(get.headers), body: getBody },
    );
    const head = await fetch(server.url, { method: "HEAD" });
    check("HEAD /api: 200, không có thân", head.status === 200 && (await head.text()) === "", { status: head.status });
    const slash = await fetch(`${server.url}/`);
    check("GET /api/ cũng trả lời", slash.status === 200, { status: slash.status });
    const elsewhere = await fetch(server.url.replace(/\/api$/, "/khac"));
    check("đường dẫn khác → 404", elsewhere.status === 404 && (await elsewhere.json()).error?.code === "not_found", { status: elsewhere.status });

    const post = (body, headers = {}) => fetch(server.url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    const signUpResponse = await post(JSON.stringify({ op: "auth.signUp", args: { email: "http@example.com", password: "qua-http-1", fullName: "Qua HTTP", phone: "" } }));
    const signedUp = await signUpResponse.json();
    check("POST đăng ký qua HTTP → 200, có khóa phiên", signUpResponse.status === 200 && typeof signedUp.result?.token === "string", { status: signUpResponse.status, body: signedUp });
    const me = await post(JSON.stringify({ op: "me" }), { authorization: `Bearer ${signedUp.result?.token}` });
    const meBody = await me.json();
    check("POST «me» kèm khóa phiên qua HTTP → hồ sơ của mình", me.status === 200 && meBody.result?.email === "http@example.com", { status: me.status, body: meBody });
    const denied = await post(JSON.stringify({ op: "me" }));
    check(
      "câu trả lời lỗi cũng là JSON «no-store»",
      denied.status === 401 && denied.headers.get("cache-control") === "no-store" && (await denied.json()).error?.code === "unauthorized",
      { status: denied.status },
    );
    const put = await fetch(server.url, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
    check("PUT qua HTTP → 405", put.status === 405 && (await put.json()).error?.code === "bad_request", { status: put.status });

    const accountsBefore = await count("accounts");
    const huge = await post(JSON.stringify({ op: "auth.signUp", args: { email: "to@example.com", password: "qua-lon-1", fullName: "z".repeat(MAX_BODY_BYTES + 200_000) } }));
    const hugeBody = await huge.json().catch(() => null);
    check(
      "POST thân lớn hơn giới hạn qua HTTP → 413 too_large, không tạo gì",
      huge.status === 413 && hugeBody?.error?.code === "too_large" && (await count("accounts")) === accountsBefore,
      { status: huge.status, body: hugeBody },
    );
    const after = await post(JSON.stringify({ op: "me" }), { authorization: `Bearer ${signedUp.result?.token}` });
    check("sau yêu cầu quá lớn, máy chủ vẫn phục vụ bình thường", after.status === 200, { status: after.status });
  } finally {
    await server.close();
  }
});

await group("Cửa vào chuẩn Web — handleFetch (đường chạy trên Vercel)", async () => {
  const url = "https://vi-du.test/api";
  const get = await handleFetch(new Request(url));
  const getBody = await get.json();
  check(
    "GET: Response 200, JSON, «no-store»",
    get.status === 200 && getBody.database === "ok" && get.headers.get("cache-control") === "no-store" && /^application\/json/.test(get.headers.get("content-type") ?? ""),
    { status: get.status, body: getBody },
  );
  const head = await handleFetch(new Request(url, { method: "HEAD" }));
  check("HEAD: 200, không có thân", head.status === 200 && (await head.text()) === "", { status: head.status });

  const post = (body, headers = {}) => handleFetch(new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const first = await post({ op: "auth.signUp", args: { email: "web1@example.com", password: "chuan-web-1" } }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  const firstBody = await first.json();
  const viaForwarded = (await sql("select key from km.auth_events where kind = 'signup' order by id desc limit 1"))[0]?.key;
  check("POST đăng ký: 200; địa chỉ mạng lấy từ mục đầu của X-Forwarded-For", first.status === 200 && typeof firstBody.result?.token === "string" && viaForwarded === "203.0.113.9", { status: first.status, key: viaForwarded });
  const second = await post({ op: "auth.signUp", args: { email: "web2@example.com", password: "chuan-web-2" } }, { "x-forwarded-for": "198.51.100.200", "x-real-ip": "203.0.113.77" });
  const viaRealIp = (await sql("select key from km.auth_events where kind = 'signup' order by id desc limit 1"))[0]?.key;
  check("X-Real-IP được ưu tiên hơn X-Forwarded-For", second.status === 200 && viaRealIp === "203.0.113.77", { status: second.status, key: viaRealIp });
  const me = await post({ op: "me" }, { authorization: `Bearer ${firstBody.result?.token}` });
  const meBody = await me.json();
  check("POST «me» kèm khóa phiên → hồ sơ; tài khoản đầu tiên là quản lý", me.status === 200 && meBody.result?.email === "web1@example.com" && meBody.result?.role === "manager", { status: me.status, body: meBody });
  const noType = await handleFetch(new Request(url, { method: "POST", body: "{}" }));
  check("POST không khai Content-Type JSON → 400", noType.status === 400, { status: noType.status });

  // Thân quá lớn theo Content-Length: trả lời 413 mà không đọc thân vào bộ nhớ.
  let read = false;
  const oversized = await handleFetch(
    /** @type {any} */ ({
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "content-length": String(MAX_BODY_BYTES + 1) }),
      text: async () => {
        read = true;
        return "{}";
      },
    }),
  );
  check("Content-Length vượt giới hạn → 413 too_large, không đọc thân", oversized.status === 413 && (await oversized.json()).error?.code === "too_large" && read === false, { status: oversized.status, read });
  const undeclared = await handleFetch(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "me", args: { x: "q".repeat(MAX_BODY_BYTES) } }) }));
  check("thân quá lớn (không dựa vào Content-Length) → 413 too_large", undeclared.status === 413 && (await undeclared.json()).error?.code === "too_large", { status: undeclared.status });
});

// ═════════════════════════ Đăng ký ═════════════════════════

await group("Đăng ký", async () => {
  const first = await api("auth.signUp", { email: "  Sep.Dau@Example.COM ", password: "matkhau1", fullName: "  Sếp Đầu  ", phone: " 0901 " }, { ip: freshIp() });
  const p = first.result?.profile ?? {};
  check("tài khoản đăng ký đầu tiên là quản lý", ok(first) && p.role === "manager", show(first));
  check("email được đưa về chữ thường, bỏ khoảng trắng hai đầu; họ tên và điện thoại được gọn lại", p.email === "sep.dau@example.com" && p.fullName === "Sếp Đầu" && p.phone === "0901", p);
  check(
    "hồ sơ trả về đúng sáu mục: id, email, fullName, phone, role, createdAt",
    isDeepStrictEqual(Object.keys(p).sort(), ["createdAt", "email", "fullName", "id", "phone", "role"]) && UUID_FORMAT.test(p.id) && !Number.isNaN(Date.parse(p.createdAt)),
    p,
  );
  const token = first.result?.token ?? "";
  check("khóa phiên: 43 ký tự ngẫu nhiên (base64url của 32 byte)", /^[A-Za-z0-9_-]{43}$/.test(token), token.length);
  const me = await api("me", {}, { token });
  check("khóa phiên vừa nhận dùng được ngay", ok(me) && me.result?.id === p.id, show(me));
  const stored = (await sql("select encode(s.token_hash, 'hex') as hash, a.password_hash from km.sessions s join km.accounts a on a.id = s.account_id where a.id = $1", [p.id]))[0];
  check("database chỉ giữ mã băm SHA-256 của khóa phiên", stored?.hash === tokenHashHex(token), stored?.hash);
  check("database chỉ giữ mã băm scrypt của mật khẩu, không giữ mật khẩu gốc", /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(stored?.password_hash ?? "") && !stored.password_hash.includes("matkhau1"), stored?.password_hash?.slice(0, 20));
  const leak = (await sql("select count(*)::int as n from km.accounts where password_hash like '%matkhau1%' or email like '%matkhau1%'"))[0].n;
  check("mật khẩu gốc không nằm ở cột nào của bảng tài khoản", leak === 0);

  const second = await api("auth.signUp", { email: "nguoi.hai@example.com", password: "matkhau2", fullName: "Người Hai", phone: "0902" }, { ip: freshIp() });
  check("tài khoản đăng ký sau ở trạng thái chờ duyệt", ok(second) && second.result?.profile.role === "pending", show(second));
  const omitted = await api("auth.signUp", { email: "khong.ten@example.com", password: "matkhau3" }, { ip: freshIp() });
  check("không gửi họ tên / điện thoại thì để trống", ok(omitted) && omitted.result?.profile.fullName === "" && omitted.result?.profile.phone === "", show(omitted));

  for (const [label, email] of [["y hệt", "nguoi.hai@example.com"], ["khác chữ hoa", "Nguoi.Hai@EXAMPLE.com"], ["thêm khoảng trắng hai đầu", "   nguoi.hai@example.com  "]]) {
    await expectRefused(`đăng ký trùng email (${label})`, () => api("auth.signUp", { email, password: "matkhau9", fullName: "Kẻ trùng" }, { ip: freshIp() }), 409, "conflict", (r) => /đã được đăng ký/.test(r.message));
  }
  for (const email of ["", "   ", "khong-co-a-cong", "a@b", "a b@c.d", "a@b c.d", "@b.c", "a@.c", "a@b.", "a@@b.c", "ten@gmail.com\nx", `${"d".repeat(250)}@x.vn`]) {
    await expectRefused(`email không hợp lệ ${JSON.stringify(email.length > 30 ? `${email.slice(0, 12)}…(${email.length} ký tự)` : email)}`, () => api("auth.signUp", { email, password: "matkhau9" }, { ip: freshIp() }), 422, "rejected");
  }
  for (const [label, email] of [["thiếu", undefined], ["là số", 12345], ["là null", null], ["dài quá 320 ký tự", `${"e".repeat(330)}@x.vn`]]) {
    await expectRefused(`email ${label}`, () => api("auth.signUp", { email, password: "matkhau9" }, { ip: freshIp() }), 400, "bad_request");
  }
  for (const [label, password] of [["5 ký tự", "12345"], ["rỗng", ""], ["thiếu", undefined], ["là số", 12345678], ["201 ký tự", "p".repeat(201)]]) {
    await expectRefused(`mật khẩu ${label}`, () => api("auth.signUp", { email: "mk@example.com", password }, { ip: freshIp() }), 422, "rejected", (r) => /Mật khẩu/.test(r.message));
  }
  const six = await api("auth.signUp", { email: "sau@example.com", password: "123456" }, { ip: freshIp() });
  const twoHundred = await api("auth.signUp", { email: "haitram@example.com", password: "p".repeat(200) }, { ip: freshIp() });
  check("mật khẩu đúng 6 ký tự và đúng 200 ký tự đều được nhận", ok(six) && ok(twoHundred), [show(six).status, show(twoHundred).status]);

  const long = await api("auth.signUp", { email: "dai@example.com", password: "matkhau4", fullName: `   ${"Â".repeat(300)}   `, phone: `  ${"9".repeat(100)}  ` }, { ip: freshIp() });
  check("họ tên bị cắt còn 120 ký tự, điện thoại còn 40 ký tự (sau khi bỏ khoảng trắng hai đầu)", ok(long) && long.result?.profile.fullName === "Â".repeat(120) && long.result?.profile.phone === "9".repeat(40), show(long));
  await expectRefused("họ tên dài quá 500 ký tự", () => api("auth.signUp", { email: "dai2@example.com", password: "matkhau4", fullName: "n".repeat(501) }, { ip: freshIp() }), 400, "bad_request");
  await expectRefused("điện thoại dài quá 200 ký tự", () => api("auth.signUp", { email: "dai3@example.com", password: "matkhau4", phone: "1".repeat(201) }, { ip: freshIp() }), 400, "bad_request");
  await expectRefused("họ tên không phải chuỗi", () => api("auth.signUp", { email: "dai4@example.com", password: "matkhau4", fullName: { a: 1 } }, { ip: freshIp() }), 400, "bad_request");
  await expectRefused("họ tên chứa ký tự \\u0000", () => api("auth.signUp", { email: "nul@example.com", password: "matkhau4", fullName: "a\u0000b" }, { ip: freshIp() }), 422, "rejected");

  const fancy = await api("auth.signUp", { email: "dep@example.com", password: "mật khẩu 🔐 đẹp", fullName: "Nguyễn Thị Ánh 🏸" }, { ip: freshIp() });
  const fancyIn = await api("auth.signIn", { email: "dep@example.com", password: "mật khẩu 🔐 đẹp" }, { ip: freshIp() });
  check("mật khẩu và họ tên có dấu tiếng Việt, emoji đều dùng được", ok(fancy) && fancy.result?.profile.fullName === "Nguyễn Thị Ánh 🏸" && ok(fancyIn), [show(fancy).status, show(fancyIn).status]);
});

await group("Đăng ký: nhiều người cùng lúc", async () => {
  for (let round = 1; round <= 3; round++) {
    await resetDatabase();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => api("auth.signUp", { email: `cung-luc-${round}-${i}@example.com`, password: "cung-luc-1", fullName: `Người ${i}` }, { ip: freshIp() })),
    );
    const roles = results.map((r) => r.result?.profile?.role);
    const inDb = await sql("select role, count(*)::int as n from km.accounts group by role order by role");
    check(
      `lượt ${round}: 8 người đăng ký cùng lúc trên hệ thống trống → đúng một quản lý, bảy người chờ duyệt`,
      results.every(ok) && roles.filter((role) => role === "manager").length === 1 && roles.filter((role) => role === "pending").length === 7 && isDeepStrictEqual(inDb, [{ role: "manager", n: 1 }, { role: "pending", n: 7 }]),
      { roles, inDb },
    );
  }
  const same = await Promise.all(Array.from({ length: 6 }, () => api("auth.signUp", { email: "Cung.Email@example.com", password: "cung-email-1" }, { ip: freshIp() })));
  check(
    "6 lượt đăng ký cùng một email cùng lúc → đúng một lượt thành công, còn lại 409",
    same.filter(ok).length === 1 && same.filter((r) => refused(r, 409, "conflict")).length === 5 && (await count("accounts", "email = 'cung.email@example.com'")) === 1,
    same.map((r) => r.status),
  );
});

await group("Đăng ký: giới hạn theo địa chỉ mạng", async () => {
  const ip = freshIp();
  const twenty = await Promise.all(Array.from({ length: 20 }, (_, i) => api("auth.signUp", { email: `gioi-han-${i}@example.com`, password: "gioi-han-1" }, { ip })));
  check("20 lượt đăng ký từ một địa chỉ mạng trong một giờ đều được", twenty.every(ok), twenty.map((r) => r.status));
  await expectRefused("lượt thứ 21 từ địa chỉ đó", () => api("auth.signUp", { email: "gioi-han-21@example.com", password: "gioi-han-1" }, { ip }), 429, "rate_limited");
  const elsewhere = await api("auth.signUp", { email: "noi-khac@example.com", password: "gioi-han-1" }, { ip: freshIp() });
  check("địa chỉ mạng khác không bị ảnh hưởng", ok(elsewhere), show(elsewhere));
  const noIp = await api("auth.signUp", { email: "khong-ro-ip@example.com", password: "gioi-han-1" }, { ip: "" });
  check("không rõ địa chỉ mạng vẫn đăng ký được (tính chung vào một nhóm «?»)", ok(noIp) && (await count("auth_events", "kind = 'signup' and key = '?'")) === 1, show(noIp));
  await sql("update km.auth_events set at = at - interval '61 minutes' where kind = 'signup' and key = $1", [ip]);
  const later = await api("auth.signUp", { email: "gioi-han-21@example.com", password: "gioi-han-1" }, { ip });
  check("hơn một giờ sau, địa chỉ đó đăng ký lại được", ok(later), show(later));

  // Nhiều lượt tới CÙNG LÚC: giữ khóa «tài khoản đầu tiên» cho cả 5 lượt cùng đứng chờ, rồi thả ra một lượt.
  const burstIp = freshIp();
  await sql("insert into km.auth_events (kind, key) select 'signup', $1 from generate_series(1, 19)", [burstIp]);
  const gate = await openSession();
  await gate.query("begin");
  await gate.query("select pg_advisory_xact_lock(hashtext('km.first_account'))");
  const racing = Array.from({ length: 5 }, (_, i) => api("auth.signUp", { email: `don-dap-${i}@example.com`, password: "don-dap-12" }, { ip: burstIp }));
  const queued = await until(async () => (await lockWaiters()) === 5);
  await gate.query("commit");
  await gate.end();
  const raced = await Promise.all(racing);
  check(
    "địa chỉ đã có 19 lượt, 5 lượt nữa tới cùng lúc: đúng 1 lượt được (lượt thứ 20), 4 lượt còn lại 429 và không tạo tài khoản",
    queued && raced.filter(ok).length === 1 && raced.filter((r) => refused(r, 429, "rate_limited")).length === 4 && (await count("accounts", "email like 'don-dap-%'")) === 1 && (await count("auth_events", "kind = 'signup' and key = $1", [burstIp])) === 20,
    { queued, statuses: raced.map((r) => r.status) },
  );
});

await group("Không băm mật khẩu cho yêu cầu chắc chắn bị từ chối", async () => {
  // Băm một mật khẩu (scrypt) tốn cỡ trăm mili giây. 10 yêu cầu bị từ chối mà xong nhanh hơn 3 lần băm thì chắc chắn
  // không lần nào phải băm.
  const t0 = performance.now();
  await hashPassword("do-thoi-gian-1");
  const oneHash = performance.now() - t0;
  const timed = async (fn) => {
    const start = performance.now();
    const results = [];
    for (let i = 0; i < 10; i++) results.push(await fn(i));
    return { ms: performance.now() - start, results };
  };
  const boss = await api("auth.signUp", { email: "da-co@example.com", password: "da-co-123" }, { ip: freshIp() });
  const sale = await api("auth.signUp", { email: "sale-bam@example.com", password: "sale-bam-1" }, { ip: freshIp() });
  await sql("update km.accounts set role = 'sale' where email = 'sale-bam@example.com'");
  await sql("update km.accounts set role = 'manager' where email = 'da-co@example.com'");
  const fast = (label, run, status, code) => async () => {
    const { ms, results } = await timed(run);
    check(`${label}: 10 lần đều ${status}, không lần nào băm mật khẩu (${Math.round(ms)} ms, một lần băm ${Math.round(oneHash)} ms)`, results.every((r) => refused(r, status, code)) && ms < 3 * oneHash, { ms, statuses: results.map((r) => r.status) });
  };
  const dupIp = freshIp();
  await fast("đăng ký trùng email", () => api("auth.signUp", { email: "Da-Co@example.com", password: "khac-nhau-1" }, { ip: dupIp }), 409, "conflict")();
  await fast("đăng ký với email sai dạng", () => api("auth.signUp", { email: "khong-phai-email", password: "khac-nhau-1" }, { ip: freshIp() }), 422, "rejected")();
  await fast("đổi mật khẩu khi chưa đăng nhập", () => api("me.password", { newPassword: "moi-moi-1" }), 401, "unauthorized")();
  await fast("đổi mật khẩu với phiên giả", () => api("me.password", { newPassword: "moi-moi-1" }, { token: "x".repeat(43) }), 401, "unauthorized")();
  await fast("sale đặt lại mật khẩu người khác", () => api("accounts.setPassword", { id: boss.result.profile.id, newPassword: "chiem-quyen-1" }, { token: sale.result.token }), 403, "forbidden")();
  await fast("đăng nhập với mật khẩu dài hơn 200 ký tự", () => api("auth.signIn", { email: "da-co@example.com", password: "p".repeat(201) }, { ip: freshIp() }), 400, "invalid_credentials")();

  check("lượt đăng ký trùng email được ghi lại để tính giới hạn", (await count("auth_events", "kind = 'signup_fail' and key = $1", [dupIp])) === 10);
  for (let i = 10; i < 20; i++) await api("auth.signUp", { email: "da-co@example.com", password: "khac-nhau-1" }, { ip: dupIp });
  await expectRefused("dò email bằng cách đăng ký trùng: sau 20 lượt trong một giờ thì bị chặn", () => api("auth.signUp", { email: "moi-tinh@example.com", password: "khac-nhau-1" }, { ip: dupIp }), 429, "rate_limited");
  await expectRefused("đăng nhập với mật khẩu dài hơn 200 ký tự: báo như sai mật khẩu", () => api("auth.signIn", { email: "da-co@example.com", password: "p".repeat(201) }, { ip: freshIp() }), 400, "invalid_credentials", (r) => r.message === "Email hoặc mật khẩu không đúng.");
  const stillOk = await api("auth.signIn", { email: "da-co@example.com", password: "da-co-123" }, { ip: freshIp() });
  check("chủ tài khoản vẫn đăng nhập bình thường", ok(stillOk), show(stillOk));
  const bossReset = await api("accounts.setPassword", { id: sale.result.profile.id, newPassword: "dat-lai-moi-1" }, { token: stillOk.result.token });
  check("quản lý vẫn đặt lại được mật khẩu cho sale", ok(bossReset) && bossReset.result === true, show(bossReset));
});

// ═════════════════════════ Đăng nhập ═════════════════════════

await group("Đăng nhập", async () => {
  const {
    boss,
    sales: [sale],
    pending: [waiting],
    locked: [blocked],
  } = await team({ sales: 1, pending: 1, locked: 1 });

  const good = await api("auth.signIn", { email: sale.email, password: sale.password }, { ip: freshIp() });
  check("đúng email + mật khẩu → khóa phiên mới và hồ sơ", ok(good) && /^[A-Za-z0-9_-]{43}$/.test(good.result?.token) && good.result?.token !== sale.token && good.result?.profile.id === sale.id && good.result?.profile.role === "sale", show(good));
  const cased = await api("auth.signIn", { email: `  ${sale.email.toUpperCase()} `, password: sale.password }, { ip: freshIp() });
  check("email không phân biệt hoa thường, bỏ khoảng trắng hai đầu", ok(cased) && cased.result?.profile.id === sale.id, show(cased));

  const eventsBefore = await count("auth_events", "kind = 'signin_fail'");
  const wrongIp = freshIp();
  const wrong = await api("auth.signIn", { email: sale.email, password: "sai-mat-khau" }, { ip: wrongIp });
  const nobody = await api("auth.signIn", { email: "khong.co.ai@example.com", password: "sai-mat-khau" }, { ip: freshIp() });
  check("sai mật khẩu → 400 invalid_credentials", refused(wrong, 400, "invalid_credentials"), show(wrong));
  check("email không tồn tại → cùng mã lỗi và cùng lời báo như sai mật khẩu (không lộ email nào có tài khoản)", refused(nobody, 400, "invalid_credentials") && nobody.message === wrong.message, show(nobody));
  const events = await sql("select key from km.auth_events where kind = 'signin_fail' order by id");
  check(
    "mỗi lần đăng nhập sai ghi đúng hai dòng: theo email và theo địa chỉ mạng",
    events.length === eventsBefore + 4 && events.some((e) => e.key === `e:${sale.email}`) && events.some((e) => e.key === `i:${wrongIp}`) && events.some((e) => e.key === "e:khong.co.ai@example.com"),
    events,
  );
  // Email không có tài khoản vẫn phải tốn một lần băm mật khẩu: thời gian trả lời không tố cáo email nào có thật.
  const timeOf = async (email) => {
    const started = performance.now();
    await api("auth.signIn", { email, password: "sai-mat-khau" }, { ip: freshIp() });
    return performance.now() - started;
  };
  const known = [];
  const unknown = [];
  for (let i = 0; i < 4; i++) {
    known.push(await timeOf(blocked.email));
    unknown.push(await timeOf(`khong-co-${i}@example.com`));
  }
  const median = (values) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)];
  check("email không tồn tại không được trả lời nhanh hơn hẳn so với sai mật khẩu (vẫn băm một lần)", median(unknown) > 0.5 * median(known), { known: known.map(Math.round), unknown: unknown.map(Math.round) });

  const padded = await api("auth.signIn", { email: sale.email, password: ` ${sale.password} ` }, { ip: freshIp() });
  check("mật khẩu thêm khoảng trắng là mật khẩu khác → 400", refused(padded, 400, "invalid_credentials"), show(padded));

  for (const [label, args] of [["thiếu email", { password: "x" }], ["thiếu mật khẩu", { email: sale.email }], ["mật khẩu là số", { email: sale.email, password: 123456 }], ["email là mảng", { email: [sale.email], password: "x" }]]) {
    const r = await api("auth.signIn", args, { ip: freshIp() });
    check(`đăng nhập ${label} → 400 bad_request`, refused(r, 400, "bad_request"), show(r));
  }

  // Cùng một mật khẩu tiếng Việt, gõ trên hai máy cho ra hai dãy mã Unicode khác nhau (dựng sẵn / tổ hợp).
  const nfc = "mật khẩu ổn định".normalize("NFC");
  const nfd = nfc.normalize("NFD");
  const a = await signUp("dau", { password: nfc });
  const b = await signUp("dau", { password: nfd });
  const aWithNfd = await api("auth.signIn", { email: a.email, password: nfd }, { ip: freshIp() });
  const bWithNfc = await api("auth.signIn", { email: b.email, password: nfc }, { ip: freshIp() });
  check("mật khẩu có dấu: đăng ký dạng dựng sẵn (NFC), đăng nhập dạng tổ hợp (NFD) vẫn đúng — và ngược lại", nfc !== nfd && ok(aWithNfd) && ok(bWithNfc), [show(aWithNfd).status, show(bWithNfc).status]);

  const pendingIn = await api("auth.signIn", { email: waiting.email, password: waiting.password }, { ip: freshIp() });
  const lockedIn = await api("auth.signIn", { email: blocked.email, password: blocked.password }, { ip: freshIp() });
  check("tài khoản chờ duyệt / bị khóa vẫn đăng nhập được (để thấy màn hình chờ), hồ sơ ghi đúng vai trò", ok(pendingIn) && pendingIn.result?.profile.role === "pending" && ok(lockedIn) && lockedIn.result?.profile.role === "locked", [show(pendingIn).status, show(lockedIn).status]);

  // Đăng xuất chỉ gỡ đúng phiên đó.
  const t1 = good.result?.token;
  const t2 = cased.result?.token;
  const out = await api("auth.signOut", {}, { token: t1 });
  const afterOut1 = await api("me", {}, { token: t1 });
  const afterOut2 = await api("me", {}, { token: t2 });
  const afterOut0 = await api("me", {}, { token: sale.token });
  check("đăng xuất: phiên đó hết dùng được, các phiên khác của cùng tài khoản vẫn còn", ok(out) && out.result === true && refused(afterOut1, 401, "unauthorized") && ok(afterOut2) && ok(afterOut0), [afterOut1.status, afterOut2.status, afterOut0.status]);
  const digest = await stateDigest();
  const outAgain = await api("auth.signOut", {}, { token: t1 });
  const outNoToken = await api("auth.signOut", {});
  const outForged = await api("auth.signOut", {}, { token: "Z".repeat(43) });
  check("đăng xuất lần nữa / không có khóa / khóa không có thật: vẫn trả lời 200 và không đổi gì", ok(outAgain) && ok(outNoToken) && ok(outForged) && digest === (await stateDigest()), [outAgain.status, outNoToken.status, outForged.status]);
  const bossStill = await api("me", {}, { token: boss.token });
  check("phiên của người khác không bị ảnh hưởng", ok(bossStill), show(bossStill));
});

await group("Đăng nhập: tạm khóa khi thử sai nhiều lần", async () => {
  const {
    boss,
    sales: [a, b],
  } = await team({ sales: 2 });
  const wrongs = (email, n, ip) => Promise.all(Array.from({ length: n }, () => api("auth.signIn", { email, password: "sai-roi" }, { ip: ip ?? freshIp() })));

  const ten = (await Promise.all([wrongs(a.email, 5), wrongs(`  ${a.email.toUpperCase()} `, 5)])).flat();
  check("10 lần sai đầu tiên đều được xét (400 invalid_credentials) — email viết hoa hay thường đều tính chung", ten.every((r) => refused(r, 400, "invalid_credentials")), ten.map((r) => r.status));
  const lockedOut = await api("auth.signIn", { email: a.email, password: a.password }, { ip: freshIp() });
  check("sau 10 lần sai trong 15 phút: kể cả mật khẩu ĐÚNG cũng bị từ chối → 429 rate_limited", refused(lockedOut, 429, "rate_limited"), show(lockedOut));
  const eventsAtLock = await count("auth_events", "kind = 'signin_fail' and key = $1", [`e:${a.email}`]);
  check("lượt bị từ chối vì tạm khóa không được tính thêm là một lần sai", eventsAtLock === 10, eventsAtLock);
  const other = await api("auth.signIn", { email: b.email, password: b.password }, { ip: freshIp() });
  check("email khác không bị ảnh hưởng", ok(other), show(other));
  const oldSession = await api("me", {}, { token: a.token });
  check("phiên đang mở của tài khoản bị tạm khóa đăng nhập vẫn dùng được", ok(oldSession), show(oldSession));
  await sql("update km.auth_events set at = at - interval '16 minutes' where kind = 'signin_fail' and key = $1", [`e:${a.email}`]);
  const afterWait = await api("auth.signIn", { email: a.email, password: a.password }, { ip: freshIp() });
  check("15 phút sau thì đăng nhập lại được", ok(afterWait), show(afterWait));

  // Một lần đăng nhập đúng xóa bộ đếm của email đó.
  await sql("delete from km.auth_events");
  const nine = await wrongs(b.email, 9);
  const success = await api("auth.signIn", { email: b.email, password: b.password }, { ip: freshIp() });
  const cleared = await count("auth_events", "kind = 'signin_fail' and key = $1", [`e:${b.email}`]);
  const nineMore = await wrongs(b.email, 9);
  const stillFine = await api("auth.signIn", { email: b.email, password: b.password }, { ip: freshIp() });
  check(
    "9 lần sai rồi một lần đúng → bộ đếm của email về 0; 9 lần sai nữa vẫn chưa bị khóa",
    nine.every((r) => r.status === 400) && ok(success) && cleared === 0 && nineMore.every((r) => r.status === 400) && ok(stillFine),
    { cleared, nineMore: nineMore.map((r) => r.status), stillFine: stillFine.status },
  );

  // Email không có tài khoản cũng bị tạm khóa y như vậy (không dùng việc khóa để dò email nào có thật).
  await wrongs("ma@example.com", 10);
  const ghost = await api("auth.signIn", { email: "ma@example.com", password: "gi-cung-duoc" }, { ip: freshIp() });
  check("email không có tài khoản: sau 10 lần cũng 429 như email có thật", refused(ghost, 429, "rate_limited"), show(ghost));

  // Theo địa chỉ mạng: 50 lần sai (bất kể email nào) trong 15 phút.
  await sql("delete from km.auth_events");
  const ip = freshIp();
  await sql("insert into km.auth_events (kind, key) select 'signin_fail', $1 from generate_series(1, 49)", [`i:${ip}`]);
  const fiftieth = await api("auth.signIn", { email: "ai-do@example.com", password: "sai-roi" }, { ip });
  check("lần sai thứ 50 từ một địa chỉ mạng vẫn được xét (400)", refused(fiftieth, 400, "invalid_credentials"), show(fiftieth));
  const ipLocked = await api("auth.signIn", { email: b.email, password: b.password }, { ip });
  check("sau 50 lần sai từ một địa chỉ mạng: mọi lần đăng nhập từ đó bị từ chối, kể cả đúng mật khẩu → 429", refused(ipLocked, 429, "rate_limited"), show(ipLocked));
  const sameAccountElsewhere = await api("auth.signIn", { email: b.email, password: b.password }, { ip: freshIp() });
  check("cùng tài khoản đó đăng nhập từ địa chỉ mạng khác thì được", ok(sameAccountElsewhere), show(sameAccountElsewhere));
  const bossFine = await api("me", {}, { token: boss.token });
  check("các lệnh khác không bị giới hạn này ảnh hưởng", ok(bossFine), show(bossFine));

  // Dò mật khẩu bằng cách gửi thật nhiều lần thử CÙNG MỘT LÚC: giới hạn vẫn phải đúng từng lần một.
  const tally = (list) => ({ examined: list.filter((r) => refused(r, 400, "invalid_credentials")).length, limited: list.filter((r) => refused(r, 429, "rate_limited")).length, total: list.length });
  await sql("delete from km.auth_events");
  const burst = tally(await wrongs(a.email, 60));
  check(
    "60 lần thử sai gửi cùng lúc cho một email (mỗi lần một địa chỉ mạng): đúng 10 lần được xét, 50 lần còn lại 429",
    burst.examined === 10 && burst.limited === 50 && (await count("auth_events", "kind = 'signin_fail' and key = $1", [`e:${a.email}`])) === 10,
    burst,
  );
  const ownerAfterBurst = await api("auth.signIn", { email: a.email, password: a.password }, { ip: freshIp() });
  check("…và sau loạt đó email bị tạm khóa như thường (429 kể cả đúng mật khẩu)", refused(ownerAfterBurst, 429, "rate_limited"), show(ownerAfterBurst));

  await sql("delete from km.auth_events");
  const sprayIp = freshIp();
  const spray = tally(await Promise.all(Array.from({ length: 80 }, (_, i) => api("auth.signIn", { email: `do-${i}@example.com`, password: "sai-roi" }, { ip: sprayIp }))));
  check(
    "80 lần thử sai gửi cùng lúc từ một địa chỉ mạng (mỗi lần một email): đúng 50 lần được xét, 30 lần còn lại 429",
    spray.examined === 50 && spray.limited === 30 && (await count("auth_events", "kind = 'signin_fail' and key = $1", [`i:${sprayIp}`])) === 50,
    spray,
  );

  // Đăng nhập đúng không để lại gì trong nhật ký thử sai; các lần sai trước đó của cùng địa chỉ mạng thì vẫn tính.
  await sql("delete from km.auth_events");
  const shared = freshIp();
  await wrongs(b.email, 3, shared);
  await wrongs("nguoi-khac@example.com", 2, shared);
  const right = await api("auth.signIn", { email: b.email, password: b.password }, { ip: shared });
  const afterRight = {
    email: await count("auth_events", "kind = 'signin_fail' and key = $1", [`e:${b.email}`]),
    otherEmail: await count("auth_events", "kind = 'signin_fail' and key = 'e:nguoi-khac@example.com'"),
    ip: await count("auth_events", "kind = 'signin_fail' and key = $1", [`i:${shared}`]),
  };
  check(
    "3 lần sai + 2 lần sai của email khác, rồi một lần đúng — cùng một địa chỉ mạng: bộ đếm của email về 0, địa chỉ mạng vẫn mang đúng 5 lần sai",
    ok(right) && afterRight.email === 0 && afterRight.otherEmail === 2 && afterRight.ip === 5,
    { status: right.status, ...afterRight },
  );

  // Cả văn phòng (chung một địa chỉ mạng) đăng nhập đúng cùng lúc, có tài khoản mở trên vài máy.
  await sql("delete from km.auth_events");
  const office = freshIp();
  const together = await Promise.all([a, b, boss, a, b, boss, a, b].map((who) => api("auth.signIn", { email: who.email, password: who.password }, { ip: office })));
  check(
    "8 lượt đăng nhập ĐÚNG cùng lúc từ một địa chỉ mạng (3 tài khoản): đều được, nhật ký thử sai không còn dòng nào",
    together.every(ok) && new Set(together.map((r) => r.result?.token)).size === 8 && (await count("auth_events", "kind = 'signin_fail'")) === 0,
    { statuses: together.map((r) => r.status), left: await sql("select key, count(*)::int as n from km.auth_events group by key") },
  );
});

// ═════════════════════════ Phiên đăng nhập ═════════════════════════

await group("Phiên đăng nhập", async () => {
  const {
    boss,
    sales: [sale, other],
  } = await team({ sales: 2 });
  const hashOf = (token) => Buffer.from(tokenHashHex(token), "hex");
  const session = async (token) => (await sql("select extract(epoch from expires_at - now())::float8 as left_s, extract(epoch from now() - seen_at)::float8 as idle_s from km.sessions where token_hash = $1", [hashOf(token)]))[0] ?? null;

  const fresh = await session(sale.token);
  check("phiên mới có hạn 30 ngày", fresh && Math.abs(fresh.left_s - 30 * 86_400) < 120, fresh);

  const extra = await signIn(sale);
  await sql("update km.sessions set expires_at = now() - interval '1 second' where token_hash = $1", [hashOf(extra)]);
  const expired = await api("me", {}, { token: extra });
  check("phiên quá hạn → 401 unauthorized", refused(expired, 401, "unauthorized"), show(expired));
  const expiredWrite = await api("sync.insert", { table: "orders", id: "don-het-han", data: orderDoc("don-het-han", "x") }, { token: extra });
  check("phiên quá hạn không ghi được gì", refused(expiredWrite, 401, "unauthorized") && (await orderRow("don-het-han")) === null, show(expiredWrite));
  const sessionsBefore = await count("sessions");
  const again = await signIn(sale);
  check("lần đăng nhập thành công kế tiếp dọn luôn các phiên đã quá hạn", (await count("sessions")) === sessionsBefore && (await session(extra)) === null && ok(await api("me", {}, { token: again })), { before: sessionsBefore, after: await count("sessions") });

  // Tự gia hạn: phiên còn dùng thì hạn được đẩy lại 30 ngày, nhưng ghi nhiều nhất mỗi giờ một lần.
  await sql("update km.sessions set seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day' where token_hash = $1", [hashOf(again)]);
  const renewedCall = await api("sync.poll", {}, { token: again });
  const renewed = await session(again);
  check("phiên đã hơn một giờ chưa ghi nhận: lệnh gọi kế tiếp gia hạn lại 30 ngày", ok(renewedCall) && renewed.left_s > 29 * 86_400 && renewed.idle_s < 60, renewed);
  await sql("update km.sessions set seen_at = now() - interval '10 minutes', expires_at = now() + interval '1 day' where token_hash = $1", [hashOf(again)]);
  await api("me", {}, { token: again });
  const notRenewed = await session(again);
  check("mới ghi nhận trong vòng một giờ: không ghi lại (hạn giữ nguyên)", notRenewed.left_s < 86_400 + 60 && notRenewed.idle_s > 500, notRenewed);
  await sql("update km.sessions set seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day' where token_hash = $1", [hashOf(again)]);
  const failedCall = await api("accounts.list", {}, { token: again });
  const afterFailed = await session(again);
  check("lệnh bị từ chối (403) không làm mất phiên", refused(failedCall, 403, "forbidden") && afterFailed !== null && ok(await api("me", {}, { token: again })), afterFailed);

  // Tự đổi mật khẩu: phiên đang dùng còn, các phiên khác của mình bị đăng xuất.
  const t1 = await signIn(sale);
  const t2 = await signIn(sale);
  await expectRefused("tự đổi mật khẩu quá ngắn", () => api("me.password", { newPassword: "12345" }, { token: t1 }), 422, "rejected");
  await expectRefused("tự đổi mật khẩu mà không gửi mật khẩu mới", () => api("me.password", {}, { token: t1 }), 422, "rejected");
  const changed = await api("me.password", { newPassword: "mat-khau-tu-doi" }, { token: t1 });
  const [stillT1, deadT2, deadOriginal] = await Promise.all([api("me", {}, { token: t1 }), api("me", {}, { token: t2 }), api("me", {}, { token: sale.token })]);
  check("tự đổi mật khẩu: phiên đang dùng còn nguyên, mọi phiên khác của tài khoản bị đăng xuất", ok(changed) && changed.result === true && ok(stillT1) && refused(deadT2, 401, "unauthorized") && refused(deadOriginal, 401, "unauthorized"), [stillT1.status, deadT2.status, deadOriginal.status]);
  const oldPassword = await api("auth.signIn", { email: sale.email, password: sale.password }, { ip: freshIp() });
  const newPassword = await api("auth.signIn", { email: sale.email, password: "mat-khau-tu-doi" }, { ip: freshIp() });
  check("mật khẩu cũ hết dùng được, mật khẩu mới dùng được", refused(oldPassword, 400, "invalid_credentials") && ok(newPassword), [oldPassword.status, newPassword.status]);
  check("đổi mật khẩu của mình không đụng tới phiên của người khác", ok(await api("me", {}, { token: other.token })) && ok(await api("me", {}, { token: boss.token })));

  // Quản lý đặt lại mật khẩu: mọi phiên của tài khoản đó bị đăng xuất, bộ đếm «thử sai» của email đó được xóa.
  const o1 = await signIn(other);
  await Promise.all(Array.from({ length: 10 }, () => api("auth.signIn", { email: other.email, password: "sai-roi" }, { ip: freshIp() })));
  const lockedOut = await api("auth.signIn", { email: other.email, password: other.password }, { ip: freshIp() });
  const reset = await api("accounts.setPassword", { id: other.id, newPassword: "quan-ly-dat-lai" }, { token: boss.token });
  const [dead1, dead2] = await Promise.all([api("me", {}, { token: o1 }), api("me", {}, { token: other.token })]);
  check("quản lý đặt lại mật khẩu: mọi phiên đang mở của tài khoản đó bị đăng xuất", refused(lockedOut, 429, "rate_limited") && ok(reset) && reset.result === true && refused(dead1, 401, "unauthorized") && refused(dead2, 401, "unauthorized"), [lockedOut.status, reset.status, dead1.status, dead2.status]);
  const withOld = await api("auth.signIn", { email: other.email, password: other.password }, { ip: freshIp() });
  const withNew = await api("auth.signIn", { email: other.email, password: "quan-ly-dat-lai" }, { ip: freshIp() });
  check("…mật khẩu cũ hết dùng được; mật khẩu mới dùng được NGAY dù email đó vừa bị tạm khóa vì thử sai", refused(withOld, 400, "invalid_credentials") && ok(withNew), [withOld.status, withNew.status]);
  check("…phiên của quản lý vẫn còn", ok(await api("me", {}, { token: boss.token })));
});

// ═════════════════════════ Ma trận vai trò × lệnh ═════════════════════════

await group("Ma trận vai trò × lệnh", async () => {
  const {
    boss,
    sales: [sale, other],
    pending: [waiting],
    locked: [blocked],
  } = await team({ sales: 2, pending: 1, locked: 1 });
  must(await insertProgram(boss, "ct-chung"));
  const isFingerprints = (value) => value && ["programs", "orders", "app_state"].every((table) => /^[0-9a-f]{64}$/.test(value[table] ?? ""));

  for (const [label, actor, role] of /** @type {const} */ ([
    ["chờ duyệt", waiting, "pending"],
    ["bị khóa", blocked, "locked"],
    ["sale", sale, "sale"],
    ["quản lý", boss, "manager"],
  ])) {
    const member = role === "sale" || role === "manager";
    const manager = role === "manager";
    // Đồ riêng cho lượt của vai trò này, để lượt trước không ảnh hưởng lượt sau.
    const target = await signUp(`muc-tieu-${role}`);
    must(await insertProgram(boss, `ct-sua-${role}`));
    must(await insertProgram(boss, `ct-xoa-${role}`));
    must(await insertOrder(other, `don-la-sua-${role}`, "ct-chung"));
    must(await insertOrder(other, `don-la-xoa-${role}`, "ct-chung"));
    if (member) {
      must(await insertOrder(actor, `don-minh-sua-${role}`, "ct-chung"));
      must(await insertOrder(actor, `don-minh-xoa-${role}`, "ct-chung"));
    }

    /**
     * @param {string} name
     * @param {string} op
     * @param {Record<string, unknown>} args
     * @param {readonly [number, string | null]} expected
     * @param {(r: any) => boolean} [extra] điều kiện thêm trên kết quả khi lệnh được chấp nhận
     * @param {boolean} [unchanged] lệnh được chấp nhận nhưng không được đổi gì (vd sửa đơn của người khác → null)
     */
    const run = async (name, op, args, expected, extra, unchanged = false) => {
      const refusal = expected[0] !== 200;
      const before = refusal || unchanged ? await stateDigest() : null;
      const r = await api(op, args, { token: actor.token });
      const same = before === null || before === (await stateDigest());
      if (refusal) {
        check(`${label} · ${name} → ${expected[0]} ${expected[1]}, dữ liệu giữ nguyên`, refused(r, expected[0], /** @type {string} */ (expected[1])) && same, { ...show(r), dataChanged: !same });
      } else {
        check(`${label} · ${name} → được${unchanged ? " nhưng không đổi gì" : ""}`, ok(r) && same && (!extra || extra(r)), { ...show(r), dataChanged: !same });
      }
      return r;
    };

    await run("me", "me", {}, OK, (r) => r.result?.id === actor.id && r.result?.role === role);
    await run("me.update", "me.update", { fullName: `Tên mới ${role}`, phone: "0911" }, OK, (r) => r.result?.fullName === `Tên mới ${role}` && r.result?.phone === "0911" && r.result?.role === role);
    await run("sync.poll", "sync.poll", {}, OK, (r) => r.result?.me.id === actor.id && (member ? isFingerprints(r.result?.fingerprints) : r.result?.fingerprints === null) && (manager ? Number.isInteger(r.result?.accounts?.pending) && typeof r.result?.accounts.stamp === "string" : r.result?.accounts === null), true);
    await run("accounts.list", "accounts.list", {}, manager ? OK : DENIED, (r) => Array.isArray(r.result) && r.result?.length >= 5, true);
    await run("accounts.setRole", "accounts.setRole", { id: target.id, role: "sale" }, manager ? OK : DENIED, (r) => r.result?.id === target.id && r.result?.role === "sale");
    await run("accounts.setPassword", "accounts.setPassword", { id: target.id, newPassword: "mat-khau-moi-1" }, manager ? OK : DENIED, (r) => r.result === true);
    for (const table of ["programs", "orders", "app_state"]) {
      await run(`sync.heads ${table}`, "sync.heads", { table }, member ? OK : DENIED, (r) => Array.isArray(r.result) && r.result?.every((h) => typeof h.id === "string" && Number.isInteger(h.rev)), true);
      await run(`sync.load ${table}`, "sync.load", { table }, member ? OK : DENIED, (r) => Array.isArray(r.result?.rows) && r.result?.next === null, true);
    }
    await run("sync.insert programs", "sync.insert", { table: "programs", id: `ct-moi-${role}`, data: programDoc(`ct-moi-${role}`) }, manager ? OK : DENIED, (r) => r.result?.id === `ct-moi-${role}` && r.result?.rev === 1);
    await run("sync.insert orders", "sync.insert", { table: "orders", id: `don-moi-${role}`, data: orderDoc(`don-moi-${role}`, "ct-chung") }, member ? OK : DENIED, (r) => r.result?.rev === 1 && CODE_FORMAT.test(r.result?.code));
    await run("sync.insert app_state", "sync.insert", { table: "app_state", id: "stock", data: { bySku: {} } }, member ? BAD : DENIED);
    await run("sync.update programs", "sync.update", { table: "programs", id: `ct-sua-${role}`, rev: 1, data: programDoc(`ct-sua-${role}`, { name: "đã sửa" }) }, manager ? OK : DENIED, (r) => r.result?.rev === 2);
    const settings = await stateRow("settings");
    await run("sync.update app_state/settings", "sync.update", { table: "app_state", id: "settings", rev: settings.rev, data: { lowStockThreshold: 9 } }, manager ? OK : DENIED, (r) => r.result?.rev === settings.rev + 1);
    const stock = await stateRow("stock");
    await run("sync.update app_state/stock", "sync.update", { table: "app_state", id: "stock", rev: stock.rev, data: { bySku: { A1: 3 }, updatedAt: "2026-11-21T00:00:00.000Z" } }, manager ? OK : DENIED, (r) => r.result?.rev === stock.rev + 1);

    // Đơn của người khác.
    const foreignEdit = { table: "orders", id: `don-la-sua-${role}`, rev: 1, data: orderDoc(`don-la-sua-${role}`, "ct-chung", { note: "bị sửa" }) };
    const foreignDrop = { table: "orders", id: `don-la-xoa-${role}` };
    if (!member) {
      await run("sync.update đơn của người khác", "sync.update", foreignEdit, DENIED);
      await run("sync.remove đơn của người khác", "sync.remove", foreignDrop, DENIED);
    } else if (!manager) {
      await run("sync.update đơn của người khác (kết quả null)", "sync.update", foreignEdit, OK, (r) => r.result === null, true);
      await run("sync.remove đơn của người khác (kết quả false)", "sync.remove", foreignDrop, OK, (r) => r.result === false, true);
    } else {
      await run("sync.update đơn của người khác", "sync.update", foreignEdit, OK, (r) => r.result?.rev === 2);
      await run("sync.remove đơn của người khác", "sync.remove", foreignDrop, OK, (r) => r.result === true);
    }
    // Đơn của chính mình.
    if (member) {
      await run("sync.update đơn của mình", "sync.update", { table: "orders", id: `don-minh-sua-${role}`, rev: 1, data: orderDoc(`don-minh-sua-${role}`, "ct-chung", { status: "confirmed" }) }, OK, (r) => r.result?.rev === 2);
      await run("sync.remove đơn của mình", "sync.remove", { table: "orders", id: `don-minh-xoa-${role}` }, OK, (r) => r.result === true);
    }
    await run("sync.remove programs", "sync.remove", { table: "programs", id: `ct-xoa-${role}` }, manager ? OK : DENIED, (r) => r.result === true);
    await run("sync.remove app_state", "sync.remove", { table: "app_state", id: "stock" }, member ? BAD : DENIED);
    await run("lệnh lạ", "khong.co.lenh", {}, BAD);
    await run("me.password", "me.password", { newPassword: `mat-khau-doi-${role}` }, OK, (r) => r.result === true);
    await run("auth.signOut", "auth.signOut", {}, OK, (r) => r.result === true);
    const after = await api("me", {}, { token: actor.token });
    check(`${label} · sau khi đăng xuất, khóa phiên cũ → 401`, refused(after, 401, "unauthorized"), show(after));
  }
});

// ═════════════════════════ Sale và quản lý ═════════════════════════

await group("Giới hạn của sale", async () => {
  const {
    boss,
    sales: [s1, s2],
  } = await team({ sales: 2 });
  must(await insertProgram(boss, "ct-1"));
  must(await insertOrder(s1, "don-s1-a", "ct-1"));
  must(await insertOrder(s1, "don-s1-b", "ct-1"));
  must(await insertOrder(s2, "don-s2-a", "ct-1"));
  must(await insertOrder(boss, "don-ql-a", "ct-1"));

  const made = await insertOrder(s1, "don-s1-ma", "ct-1", { code: "TU-DAT-999" });
  const madeRow = await orderRow("don-s1-ma");
  check("đơn do sale thêm thuộc về chính sale đó", ok(made) && madeRow.owner_id === s1.id, madeRow?.owner_id);
  check("mã đơn sale gửi kèm bị thay bằng mã do máy chủ cấp", CODE_FORMAT.test(made.result?.code ?? "") && madeRow.code === made.result?.code && madeRow.data.code === made.result?.code, { returned: made.result?.code, stored: madeRow?.code });

  const heads = await api("sync.heads", { table: "orders" }, { token: s1.token });
  check("sync.heads: sale chỉ thấy đơn của chính mình", ok(heads) && isDeepStrictEqual(heads.result?.map((h) => h.id), ["don-s1-a", "don-s1-b", "don-s1-ma"]), heads.result);
  const loadAll = await api("sync.load", { table: "orders" }, { token: s1.token });
  check("sync.load (mọi dòng): chỉ trả về đơn của chính mình", ok(loadAll) && isDeepStrictEqual(loadAll.result?.rows.map((row) => row.id), ["don-s1-a", "don-s1-b", "don-s1-ma"]), loadAll.result?.rows?.map((row) => row.id));
  const loadTheirs = await api("sync.load", { table: "orders", ids: ["don-s2-a", "don-ql-a", "don-s1-a"] }, { token: s1.token });
  check("sync.load theo id: hỏi cả đơn của người khác thì chỉ nhận được đơn của mình", ok(loadTheirs) && isDeepStrictEqual(loadTheirs.result?.rows.map((row) => row.id), ["don-s1-a"]), loadTheirs.result?.rows?.map((row) => row.id));
  const poll = await api("sync.poll", {}, { token: s1.token });
  const bossPoll = await api("sync.poll", {}, { token: boss.token });
  check("dấu vân tay «orders» của sale chỉ tính trên đơn của mình", poll.result?.fingerprints.orders === fingerprintOf(heads.result) && poll.result?.fingerprints.orders !== bossPoll.result?.fingerprints.orders, poll.result?.fingerprints);
  check("sale vẫn thấy mọi chương trình, tồn kho, thiết lập (dấu vân tay giống của quản lý)", poll.result?.fingerprints.programs === bossPoll.result?.fingerprints.programs && poll.result?.fingerprints.app_state === bossPoll.result?.fingerprints.app_state);

  const theirs = await orderRow("don-s2-a");
  const digest = await stateDigest();
  const edit = await api("sync.update", { table: "orders", id: "don-s2-a", rev: theirs.rev, data: orderDoc("don-s2-a", "ct-1", { note: "sale khác sửa" }) }, { token: s1.token });
  const drop = await api("sync.remove", { table: "orders", id: "don-s2-a" }, { token: s1.token });
  const dropBoss = await api("sync.remove", { table: "orders", id: "don-ql-a" }, { token: s1.token });
  check("sửa đơn của sale khác (đúng rev) → null; xóa → false; đơn của quản lý cũng vậy; dữ liệu giữ nguyên", ok(edit) && edit.result === null && ok(drop) && drop.result === false && ok(dropBoss) && dropBoss.result === false && digest === (await stateDigest()), [show(edit), show(drop), show(dropBoss)]);
  await expectRefused("thêm đơn trùng id với đơn của người khác", () => insertOrder(s1, "don-s2-a", "ct-1"), 409, "conflict");

  for (const [name, call] of [
    ["thêm chương trình", () => insertProgram(s1, "ct-cua-sale")],
    ["sửa chương trình", () => api("sync.update", { table: "programs", id: "ct-1", rev: 1, data: programDoc("ct-1", { name: "sale sửa" }) }, { token: s1.token })],
    ["xóa chương trình", () => api("sync.remove", { table: "programs", id: "ct-1" }, { token: s1.token })],
    ["sửa tồn kho", () => api("sync.update", { table: "app_state", id: "stock", rev: 1, data: { bySku: { X: 1 } } }, { token: s1.token })],
    ["sửa thiết lập chung", () => api("sync.update", { table: "app_state", id: "settings", rev: 1, data: { lowStockThreshold: 0 } }, { token: s1.token })],
    ["xem danh sách tài khoản", () => api("accounts.list", {}, { token: s1.token })],
    ["tự nâng mình lên quản lý", () => api("accounts.setRole", { id: s1.id, role: "manager" }, { token: s1.token })],
    ["khóa tài khoản quản lý", () => api("accounts.setRole", { id: boss.id, role: "locked" }, { token: s1.token })],
    ["đặt lại mật khẩu của quản lý", () => api("accounts.setPassword", { id: boss.id, newPassword: "chiem-quyen-1" }, { token: s1.token })],
  ]) {
    await expectRefused(`sale ${name}`, call, 403, "forbidden");
  }
  const sneaky = await api("me.update", { fullName: "Vẫn là sale", role: "manager", id: boss.id, email: "khac@example.com", password_hash: "x" }, { token: s1.token });
  const mine = (await sql("select role, email, id from km.accounts where id = $1", [s1.id]))[0];
  check("me.update kèm role / id / email / password_hash tự chế: chỉ họ tên đổi, vai trò và email giữ nguyên", ok(sneaky) && sneaky.result?.role === "sale" && mine.role === "sale" && mine.email === s1.email && (await count("accounts", "role = 'manager'")) === 1, show(sneaky));
  const bossLogin = await api("auth.signIn", { email: boss.email, password: boss.password }, { ip: freshIp() });
  check("mật khẩu của quản lý vẫn như cũ", ok(bossLogin), show(bossLogin));
});

await group("Quyền của quản lý với đơn hàng", async () => {
  const {
    boss,
    sales: [s1, s2],
  } = await team({ sales: 2 });
  must(await insertProgram(boss, "ct-1"));
  must(await insertOrder(s1, "don-s1", "ct-1"));
  must(await insertOrder(s2, "don-s2", "ct-1"));
  must(await insertOrder(boss, "don-ql", "ct-1"));
  const heads = await api("sync.heads", { table: "orders" }, { token: boss.token });
  check("quản lý thấy đơn của mọi người", ok(heads) && isDeepStrictEqual(heads.result?.map((h) => h.id), ["don-ql", "don-s1", "don-s2"]), heads.result);
  const edit = await api("sync.update", { table: "orders", id: "don-s1", rev: 1, data: orderDoc("don-s1", "ct-1", { status: "confirmed", note: "quản lý duyệt" }) }, { token: boss.token });
  const edited = await orderRow("don-s1");
  check("quản lý sửa được đơn của sale; chủ đơn vẫn là sale đó", ok(edit) && edit.result?.rev === 2 && edited.owner_id === s1.id && edited.status === "confirmed" && edited.data.note === "quản lý duyệt", edited);
  const stillVisible = await api("sync.load", { table: "orders", ids: ["don-s1"] }, { token: s1.token });
  check("…và sale đó vẫn thấy đơn của mình với nội dung mới", ok(stillVisible) && stillVisible.result?.rows[0]?.rev === 2 && stillVisible.result?.rows[0]?.data.note === "quản lý duyệt", stillVisible.result);
  const drop = await api("sync.remove", { table: "orders", id: "don-s2" }, { token: boss.token });
  check("quản lý xóa được đơn của sale", ok(drop) && drop.result === true && (await orderRow("don-s2")) === null, show(drop));

  const kept = await insertOrder(boss, "don-cu", "ct-1", { code: "DH250101-007" });
  const keptRow = await orderRow("don-cu");
  check("mã đơn quản lý gửi kèm (đưa đơn cũ lên) được giữ nguyên", ok(kept) && kept.result?.code === "DH250101-007" && keptRow.code === "DH250101-007" && keptRow.owner_id === boss.id, show(kept));
  const assigned = await insertOrder(boss, "don-moi", "ct-1", { code: "" });
  const spaces = await insertOrder(boss, "don-trang", "ct-1", { code: "   " });
  const noKey = await api("sync.insert", { table: "orders", id: "don-khong-ma", data: { id: "don-khong-ma", programId: "ct-1", status: "draft" } }, { token: boss.token });
  check("quản lý gửi mã trống / toàn khoảng trắng / không có mục code → máy chủ cấp mã", [assigned, spaces, noKey].every((r) => ok(r) && CODE_FORMAT.test(r.result?.code)), [assigned.result, spaces.result, noKey.result]);
});

// ═════════════════════════ Mã đơn ═════════════════════════

await group("Mã đơn", async () => {
  const {
    boss,
    sales: [s1, s2],
  } = await team({ sales: 2 });
  must(await insertProgram(boss, "ct-ma"));
  const prefix = `DH${vietnamDay()}-`;
  const codeOf = async (who, id, extra) => must(await insertOrder(who, id, "ct-ma", extra)).code;

  const c1 = await codeOf(s1, "m-1");
  const c2 = await codeOf(s2, "m-2");
  const c3 = await codeOf(boss, "m-3");
  check("mã đơn có dạng DHyymmdd-NNN, ngày theo giờ Việt Nam, đánh số chung cho mọi tài khoản", isDeepStrictEqual([c1, c2, c3], [`${prefix}001`, `${prefix}002`, `${prefix}003`]), [c1, c2, c3]);
  const counterDay = (await sql("select day::text as day, last from km.order_counters"))[0];
  const vnToday = (await sql("select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as day"))[0].day;
  check("bộ đếm ghi theo ngày Việt Nam", counterDay.day === vnToday && counterDay.last === 3 && vnToday.replaceAll("-", "").slice(2) === vietnamDay(), counterDay);
  const stored = await orderRow("m-1");
  check("mã nằm trong chính tài liệu của đơn (data.code) và trùng cột code", stored.data.code === c1 && stored.code === c1, stored);

  must(await api("sync.remove", { table: "orders", id: "m-3" }, { token: boss.token }));
  const c4 = await codeOf(s1, "m-4");
  check("số của đơn đã xóa không được cấp lại", c4 === `${prefix}004`, c4);

  // Đơn cũ quản lý đưa lên mang sẵn mã trùng với số sắp cấp: số đó bị bỏ qua.
  const taken = await codeOf(boss, "m-cu", { code: `${prefix}005` });
  const c6 = await codeOf(s1, "m-6");
  const c7 = await codeOf(s2, "m-7");
  check("số đã có đơn mang (quản lý đưa lên kèm mã) thì bỏ qua, lấy số kế tiếp", taken === `${prefix}005` && c6 === `${prefix}006` && c7 === `${prefix}007`, [taken, c6, c7]);
  // Mã tự đặt rất lớn, hoặc của một ngày sắp tới, không đẩy được dãy số của mọi người.
  must(await insertOrder(boss, "m-xa", "ct-ma", { code: `${prefix}900` }));
  must(await insertOrder(boss, "m-mai", "ct-ma", { code: "DH991231-050" }));
  const c8 = await codeOf(s1, "m-8");
  check("mã tự đặt rất lớn / của ngày khác không làm nhảy dãy số", c8 === `${prefix}008`, c8);
  await expectRefused("thêm đơn trùng id: không tiêu mất một số", () => insertOrder(s1, "m-8", "ct-ma"), 409, "conflict");
  await expectRefused("thêm đơn thiếu trạng thái: không tiêu mất một số", () => api("sync.insert", { table: "orders", id: "m-hong", data: { id: "m-hong", programId: "ct-ma" } }, { token: s1.token }), 422, "rejected");
  const c9 = await codeOf(s2, "m-9");
  check("các lần thêm bị từ chối không làm mất số nào", c9 === `${prefix}009`, c9);

  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => insertOrder([s1, s2, boss][i % 3], `m-dong-thoi-${i}`, "ct-ma")));
  const codes = burst.map((r) => r.result?.code);
  const numbers = codes.map((code) => Number(String(code).slice(prefix.length))).sort((x, y) => x - y);
  check("20 đơn tạo cùng lúc bởi 3 tài khoản: 20 mã khác nhau, số liền nhau", burst.every(ok) && new Set(codes).size === 20 && isDeepStrictEqual(numbers, Array.from({ length: 20 }, (_, i) => 10 + i)), codes);

  await sql("update km.order_counters set last = 997");
  const c998 = await codeOf(s1, "m-998");
  const c999 = await codeOf(s1, "m-999");
  const c1000 = await codeOf(s2, "m-1000");
  const c1001 = await codeOf(s1, "m-1001");
  check("qua số 999 thì mã dài thêm một chữ số (không cắt, không trùng)", isDeepStrictEqual([c998, c999, c1000, c1001], [`${prefix}998`, `${prefix}999`, `${prefix}1000`, `${prefix}1001`]), [c998, c999, c1000, c1001]);

  // Sửa đơn không đổi được mã, chủ đơn, ngày tạo.
  const before = await orderRow("m-1");
  const rename = await api("sync.update", { table: "orders", id: "m-1", rev: 1, data: orderDoc("m-1", "ct-ma", { code: "DOI-MA", note: "sửa" }) }, { token: s1.token });
  const afterRename = await orderRow("m-1");
  check("sale sửa đơn kèm mã khác: nội dung đổi, mã giữ nguyên", ok(rename) && afterRename.code === c1 && afterRename.data.code === c1 && afterRename.data.note === "sửa" && afterRename.rev === 2, afterRename);
  const bossRename = await api("sync.update", { table: "orders", id: "m-1", rev: 2, data: { id: "m-1", programId: "ct-ma", status: "confirmed" } }, { token: boss.token });
  const afterBoss = await orderRow("m-1");
  check("quản lý sửa đơn (tài liệu không có mục code): mã vẫn được giữ; chủ đơn và ngày tạo không đổi", ok(bossRename) && afterBoss.code === c1 && afterBoss.data.code === c1 && afterBoss.owner_id === s1.id && afterBoss.created_at === before.created_at && afterBoss.rev === 3, afterBoss);

  // Hàng rào ngay trong database: kể cả khi câu lệnh SQL (mang danh một tài khoản) cố đổi các cột đó.
  const tx = await openSession();
  await tx.query("begin");
  await tx.query("select set_config('km.actor', $1, true)", [s1.id]);
  const forced = await tx.query(
    "update km.orders set owner_id = $2, rev = 500, created_at = '2000-01-01', updated_at = '2000-01-01', data = jsonb_set(data, '{code}', '\"EP-MA\"') where id = $1 returning owner_id, rev, code, created_at::text as created_at, (updated_at > '2020-01-01') as touched",
    ["m-1", s2.id],
  );
  const forcedInsert = await tx.query(
    "insert into km.orders (id, owner_id, rev, created_at, data) values ($1, $2, 99, '2000-01-01', $3::jsonb) returning owner_id, rev, code, (created_at > '2020-01-01') as fresh",
    ["m-ep", s2.id, JSON.stringify(orderDoc("m-ep", "ct-ma", { code: "EP-MA-2" }))],
  );
  await tx.query("rollback");
  await tx.end();
  check(
    "trigger giữ chủ đơn, rev, mã, ngày tạo dù câu lệnh UPDATE cố đổi (người gọi là một sale)",
    forced.rows[0].owner_id === s1.id && forced.rows[0].rev === 4 && forced.rows[0].code === c1 && forced.rows[0].created_at === before.created_at && forced.rows[0].touched === true,
    forced.rows[0],
  );
  check(
    "trigger gán chủ đơn = người gọi, rev = 1, mã do máy chủ cấp, ngày tạo = bây giờ dù câu lệnh INSERT tự đặt",
    forcedInsert.rows[0].owner_id === s1.id && forcedInsert.rows[0].rev === 1 && CODE_FORMAT.test(forcedInsert.rows[0].code) && forcedInsert.rows[0].fresh === true,
    forcedInsert.rows[0],
  );
});

// ═════════════════════════ Tài liệu ═════════════════════════

await group("Tài liệu: thêm, sửa, xóa", async () => {
  const {
    boss,
    sales: [s1],
  } = await team({ sales: 1 });
  const b = { token: boss.token };

  const created = await insertProgram(boss, "ct-1", { products: [{ sku: "A", price: 120000.5 }], nested: { a: [1, 2, { b: null }], vi: "Khuyến mãi tháng 11 🏸" } });
  check("thêm chương trình → { id, rev: 1 }", ok(created) && isDeepStrictEqual(created.result, { id: "ct-1", rev: 1 }), show(created));
  const loaded = await api("sync.load", { table: "programs", ids: ["ct-1"] }, b);
  check(
    "tải lại: tài liệu y nguyên như lúc gửi (số lẻ, null, mảng lồng nhau, tiếng Việt, emoji)",
    ok(loaded) && isDeepStrictEqual(loaded.result?.rows, [{ id: "ct-1", rev: 1, data: programDoc("ct-1", { products: [{ sku: "A", price: 120000.5 }], nested: { a: [1, 2, { b: null }], vi: "Khuyến mãi tháng 11 🏸" } }) }]),
    loaded.result,
  );
  check("máy chủ ghi lại ai vừa sửa chương trình", (await programRow("ct-1")).updated_by === boss.id);
  await expectRefused("thêm chương trình trùng id", () => insertProgram(boss, "ct-1", { name: "bản khác" }), 409, "conflict");

  const u1 = await api("sync.update", { table: "programs", id: "ct-1", rev: 1, data: programDoc("ct-1", { name: "lần 2" }) }, b);
  const u2 = await api("sync.update", { table: "programs", id: "ct-1", rev: 2, data: programDoc("ct-1", { name: "lần 3" }) }, b);
  check("mỗi lần sửa đúng rev thì rev tăng đúng 1", ok(u1) && isDeepStrictEqual(u1.result, { id: "ct-1", rev: 2 }) && ok(u2) && u2.result?.rev === 3, [u1.result, u2.result]);
  const digest = await stateDigest();
  const stale = await api("sync.update", { table: "programs", id: "ct-1", rev: 1, data: programDoc("ct-1", { name: "ghi đè bản cũ" }) }, b);
  const future = await api("sync.update", { table: "programs", id: "ct-1", rev: 99, data: programDoc("ct-1", { name: "rev tự chế" }) }, b);
  const missing = await api("sync.update", { table: "programs", id: "khong-co", rev: 1, data: programDoc("khong-co") }, b);
  check("sửa với rev cũ / rev tự chế / dòng không có → null, không ghi đè gì", [stale, future, missing].every((r) => ok(r) && r.result === null) && digest === (await stateDigest()), [stale.body, future.body, missing.body]);

  const race = await Promise.all(Array.from({ length: 8 }, (_, i) => api("sync.update", { table: "programs", id: "ct-1", rev: 3, data: programDoc("ct-1", { name: `đua ${i}` }) }, b)));
  const winners = race.filter((r) => r.result !== null);
  const final = await programRow("ct-1");
  check("8 lần sửa cùng lúc với cùng một rev: đúng một lần thắng, rev chỉ tăng 1", race.every(ok) && winners.length === 1 && final.rev === 4 && race.some((r, i) => r.result !== null && final.data.name === `đua ${i}`), { winners: winners.length, rev: final.rev, name: final.data.name });

  for (const [label, data] of [["một mảng", [1]], ["một chuỗi", "x"], ["một con số", 5], ["null", null], ["true", true]]) {
    await expectRefused(`thêm với data là ${label}`, () => api("sync.insert", { table: "programs", id: "ct-sai", data }, b), 400, "bad_request");
    await expectRefused(`sửa với data là ${label}`, () => api("sync.update", { table: "programs", id: "ct-1", rev: 4, data }, b), 400, "bad_request");
  }
  await expectRefused("thêm thiếu data", () => api("sync.insert", { table: "programs", id: "ct-sai" }, b), 400, "bad_request");
  for (const [label, id] of [["rỗng", ""], ["dài 201 ký tự", "i".repeat(201)], ["là số", 5], ["là null", null], ["là mảng", ["a"]], ["là đối tượng", { a: 1 }]]) {
    await expectRefused(`thêm với id ${label}`, () => api("sync.insert", { table: "programs", id, data: { name: "x" } }, b), 400, "bad_request");
  }
  await expectRefused("thêm thiếu id", () => api("sync.insert", { table: "programs", data: { name: "x" } }, b), 400, "bad_request");
  const id200 = "đ".repeat(200);
  const longId = await insertProgram(boss, id200);
  check("id dài đúng 200 ký tự (có dấu) được nhận", ok(longId) && (await programRow(id200)) !== null, show(longId));
  for (const [label, table] of [["accounts", "accounts"], ["sessions", "sessions"], ["km.orders", "km.orders"], ["rỗng", ""], ["là số", 1], ["có lệnh SQL", "programs; drop table km.orders"]]) {
    await expectRefused(`bảng ${label}`, () => api("sync.heads", { table }, b), 400, "bad_request");
    await expectRefused(`thêm vào bảng ${label}`, () => api("sync.insert", { table, id: "x", data: {} }, b), 400, "bad_request");
  }
  await expectRefused("thiếu tên bảng", () => api("sync.load", {}, b), 400, "bad_request");
  for (const [label, rev] of [["thiếu", undefined], ["là chuỗi", "4"], ["là null", null], ["là mảng", [4]]]) {
    await expectRefused(`sửa với rev ${label}`, () => api("sync.update", { table: "programs", id: "ct-1", rev, data: programDoc("ct-1") }, b), 400, "bad_request");
  }
  for (const [label, rev] of [["số lẻ 3.5 (làm tròn sẽ thành rev đang có)", 3.5], ["số lẻ 4.4", 4.4], ["rất lớn (1e30)", 1e30], ["âm", -4]]) {
    const before = await stateDigest();
    const r = await api("sync.update", { table: "programs", id: "ct-1", rev, data: programDoc("ct-1", { name: "rev lạ" }) }, b);
    check(`sửa với rev ${label}: không ghi gì, không phải lỗi máy chủ`, r.status < 500 && !(ok(r) && r.result !== null) && before === (await stateDigest()), show(r));
  }

  // Đơn hàng: các mục bắt buộc.
  for (const [label, data] of [
    ["thiếu chương trình", { id: "d", status: "draft", code: "" }],
    ["chương trình là null", { id: "d", programId: null, status: "draft" }],
    ["thiếu trạng thái", { id: "d", programId: "ct-1" }],
    ["trạng thái lạ", { id: "d", programId: "ct-1", status: "paid" }],
    ["trạng thái là số", { id: "d", programId: "ct-1", status: 1 }],
  ]) {
    await expectRefused(`thêm đơn ${label}`, () => api("sync.insert", { table: "orders", id: "d", data }, { token: s1.token }), 422, "rejected");
  }
  await expectRefused("thêm đơn vào chương trình không tồn tại", () => insertOrder(s1, "d-mo-coi", "ct-khong-co"), 422, "rejected", (r) => /không có trên máy chủ/.test(r.message));
  await expectRefused("quản lý thêm đơn vào chương trình không tồn tại", () => insertOrder(boss, "d-mo-coi", "ct-khong-co", { code: "CU-1" }), 422, "rejected");
  must(await insertOrder(s1, "d-1", "ct-1"));
  must(await insertOrder(s1, "d-2", "ct-1"));
  await expectRefused("sửa đơn thành trạng thái lạ", () => api("sync.update", { table: "orders", id: "d-1", rev: 1, data: orderDoc("d-1", "ct-1", { status: "xong" }) }, { token: s1.token }), 422, "rejected");
  await expectRefused("sửa đơn làm mất chương trình", () => api("sync.update", { table: "orders", id: "d-1", rev: 1, data: { id: "d-1", status: "draft" } }, { token: s1.token }), 422, "rejected");
  await expectRefused("chuyển đơn sang chương trình không tồn tại", () => api("sync.update", { table: "orders", id: "d-1", rev: 1, data: orderDoc("d-1", "ct-khong-co") }, { token: s1.token }), 422, "rejected");
  must(await insertProgram(boss, "ct-2"));
  const moved = await api("sync.update", { table: "orders", id: "d-1", rev: 1, data: orderDoc("d-1", "ct-2") }, { token: s1.token });
  check("chuyển đơn sang một chương trình khác đang có thì được", ok(moved) && moved.result?.rev === 2 && (await orderRow("d-1")).program_id === "ct-2", show(moved));
  const confirmed = await api("sync.update", { table: "orders", id: "d-2", rev: 1, data: orderDoc("d-2", "ct-1", { status: "confirmed" }) }, { token: s1.token });
  check("đổi trạng thái đơn draft → confirmed", ok(confirmed) && (await orderRow("d-2")).status === "confirmed", show(confirmed));

  // Xóa chương trình.
  must(await insertOrder(boss, "d-3", "ct-1"));
  await expectRefused("xóa chương trình còn 2 đơn hàng", () => api("sync.remove", { table: "programs", id: "ct-1" }, b), 422, "rejected", (r) => /còn 2 đơn hàng/.test(r.message));
  must(await api("sync.remove", { table: "orders", id: "d-2" }, b));
  await expectRefused("xóa chương trình còn 1 đơn hàng", () => api("sync.remove", { table: "programs", id: "ct-1" }, b), 422, "rejected", (r) => /còn 1 đơn hàng/.test(r.message));
  must(await api("sync.remove", { table: "orders", id: "d-3" }, b));
  const removed = await api("sync.remove", { table: "programs", id: "ct-1" }, b);
  const removedAgain = await api("sync.remove", { table: "programs", id: "ct-1" }, b);
  check("hết đơn thì xóa được chương trình (true); xóa lần nữa → false", ok(removed) && removed.result === true && ok(removedAgain) && removedAgain.result === false && (await programRow("ct-1")) === null, [removed.body, removedAgain.body]);
  const removeMissing = await api("sync.remove", { table: "orders", id: "khong-co" }, b);
  check("xóa đơn không tồn tại → false", ok(removeMissing) && removeMissing.result === false, show(removeMissing));

  // Tồn kho và thiết lập: hai dòng có sẵn, chỉ sửa.
  await expectRefused("thêm dòng app_state", () => api("sync.insert", { table: "app_state", id: "khac", data: {} }, b), 400, "bad_request");
  await expectRefused("xóa dòng app_state", () => api("sync.remove", { table: "app_state", id: "settings" }, b), 400, "bad_request");
  const unknownKey = await api("sync.update", { table: "app_state", id: "khac", rev: 1, data: { a: 1 } }, b);
  check("sửa một khóa app_state không có → null", ok(unknownKey) && unknownKey.result === null && (await count("app_state")) === 2, show(unknownKey));
  const stock = await api("sync.update", { table: "app_state", id: "stock", rev: 1, data: { bySku: { "YY-100": 12, "YY-200": 0 }, updatedAt: "2026-11-21T03:00:00.000Z" } }, b);
  const stockRow = await stateRow("stock");
  check("quản lý sửa tồn kho: rev 1 → 2, ghi lại người sửa", ok(stock) && stock.result?.rev === 2 && stockRow.data.bySku["YY-100"] === 12 && stockRow.updated_by === boss.id, stockRow);
  const stockStale = await api("sync.update", { table: "app_state", id: "stock", rev: 1, data: { bySku: {} } }, b);
  check("sửa tồn kho với rev cũ → null, tồn kho giữ nguyên", ok(stockStale) && stockStale.result === null && (await stateRow("stock")).data.bySku["YY-100"] === 12, show(stockStale));

  // Chuỗi mà jsonb của Postgres không nhận.
  await expectRefused("tài liệu chứa ký tự \\u0000 (thêm)", () => insertProgram(boss, "ct-nul", { name: "a\u0000b" }), 422, "rejected");
  await expectRefused("tài liệu chứa ký tự \\u0000 (sửa)", () => api("sync.update", { table: "programs", id: "ct-2", rev: 1, data: programDoc("ct-2", { note: "x\u0000" }) }, b), 422, "rejected");
  await expectRefused("id chứa ký tự \\u0000", () => api("sync.insert", { table: "programs", id: "a\u0000b", data: { name: "x" } }, b), 422, "rejected");
  await expectRefused("tài liệu chứa nửa ký tự Unicode lẻ loi", () => insertProgram(boss, "ct-nua", { name: "x\ud83d" }), 422, "rejected");
  const megabyte = await insertProgram(boss, "ct-to", { blob: "k".repeat(1_000_000) });
  check("tài liệu 1 MB lưu được", ok(megabyte), show(megabyte));
});

await group("Xóa chương trình đúng lúc có đơn mới", async () => {
  const {
    boss,
    sales: [s1],
  } = await team({ sales: 1 });
  for (const id of ["ct-a", "ct-b", "ct-c", "ct-d", "ct-con"]) must(await insertProgram(boss, id));
  must(await insertOrder(s1, "don-chuyen", "ct-con"));

  // 1. Đơn đang ghi dở (giao dịch chưa xong) thì lệnh xóa phải chờ, rồi bị từ chối.
  {
    const tx = await openSession();
    await tx.query("begin");
    await tx.query("select set_config('km.actor', $1, true)", [s1.id]);
    await tx.query("insert into km.orders (id, data) values ($1, $2::jsonb)", ["don-dang-ghi", JSON.stringify(orderDoc("don-dang-ghi", "ct-a"))]);
    const deleting = api("sync.remove", { table: "programs", id: "ct-a" }, { token: boss.token });
    const waited = await until(async () => (await lockWaiters()) >= 1);
    await tx.query("commit");
    await tx.end();
    const r = await deleting;
    check(
      "đơn đang ghi dở → lệnh xóa chương trình chờ, rồi bị từ chối (còn 1 đơn hàng); chương trình và đơn đều còn",
      waited && refused(r, 422, "rejected") && /còn 1 đơn hàng/.test(r.message) && (await programRow("ct-a")) !== null && (await orderRow("don-dang-ghi")) !== null,
      { waited, ...show(r) },
    );
  }
  // 2. Chiều ngược lại: chương trình đang bị xóa dở thì đơn mới phải chờ, rồi bị từ chối — không thành đơn mồ côi.
  {
    const counter = (await sql("select coalesce(max(last), 0) as last from km.order_counters"))[0].last;
    const tx = await openSession();
    await tx.query("begin");
    await tx.query("delete from km.programs where id = $1", ["ct-b"]);
    const inserting = insertOrder(s1, "don-den-muon", "ct-b");
    const waited = await until(async () => (await lockWaiters()) >= 1);
    await tx.query("commit");
    await tx.end();
    const r = await inserting;
    check(
      "chương trình đang bị xóa dở → đơn mới chờ, rồi bị từ chối (422); không có đơn mồ côi, không mất số nào của dãy mã đơn",
      waited && refused(r, 422, "rejected") && (await orderRow("don-den-muon")) === null && (await programRow("ct-b")) === null && (await sql("select coalesce(max(last), 0) as last from km.order_counters"))[0].last === counter,
      { waited, ...show(r) },
    );
  }
  // 3. Lệnh xóa bị hủy giữa chừng thì đơn đang chờ được ghi bình thường.
  {
    const tx = await openSession();
    await tx.query("begin");
    await tx.query("delete from km.programs where id = $1", ["ct-c"]);
    const inserting = insertOrder(s1, "don-cho-roi-duoc", "ct-c");
    const waited = await until(async () => (await lockWaiters()) >= 1);
    await tx.query("rollback");
    await tx.end();
    const r = await inserting;
    check("lệnh xóa bị hủy giữa chừng → đơn đang chờ được ghi bình thường", waited && ok(r) && (await orderRow("don-cho-roi-duoc"))?.program_id === "ct-c" && (await programRow("ct-c")) !== null, { waited, ...show(r) });
  }
  // 4. Chuyển một đơn sang chương trình đang bị xóa dở.
  {
    const tx = await openSession();
    await tx.query("begin");
    await tx.query("delete from km.programs where id = $1", ["ct-d"]);
    const moving = api("sync.update", { table: "orders", id: "don-chuyen", rev: 1, data: orderDoc("don-chuyen", "ct-d") }, { token: s1.token });
    const waited = await until(async () => (await lockWaiters()) >= 1);
    await tx.query("commit");
    await tx.end();
    const r = await moving;
    const row = await orderRow("don-chuyen");
    check("chuyển đơn sang chương trình đang bị xóa dở → chờ, rồi bị từ chối; đơn vẫn ở chương trình cũ", waited && refused(r, 422, "rejected") && row.program_id === "ct-con" && row.rev === 1, { waited, ...show(r), row });
  }
  // 5. Bắn hai yêu cầu cùng lúc, nhiều lượt: bên nào tới trước cũng không bao giờ để lại đơn của chương trình đã mất.
  {
    const rounds = 60;
    let orphans = 0;
    let inconsistent = 0;
    let deleteWon = 0;
    let insertWon = 0;
    /** @type {unknown[]} */
    const odd = [];
    for (let i = 0; i < rounds; i++) {
      const program = `ct-dua-${i}`;
      const order = `don-dua-${i}`;
      must(await insertProgram(boss, program));
      const jitter = Math.floor(Math.random() * 4);
      const late = (work) => (jitter === 0 ? work() : sleep(jitter).then(work));
      const [removal, insertion] = await Promise.all(
        i % 2 === 0
          ? [api("sync.remove", { table: "programs", id: program }, { token: boss.token }), late(() => insertOrder(s1, order, program))]
          : [late(() => api("sync.remove", { table: "programs", id: program }, { token: boss.token })), insertOrder(s1, order, program)],
      );
      const programLeft = (await programRow(program)) !== null;
      const orderLeft = (await orderRow(order)) !== null;
      if (orderLeft && !programLeft) orphans += 1;
      const deleteSucceeded = ok(removal) && removal.result === true;
      const insertSucceeded = ok(insertion);
      // Chỉ có hai kết cục hợp lệ: (xóa được, đơn bị từ chối, không còn gì) hoặc (đơn ghi được, lệnh xóa bị từ chối, còn cả hai).
      const deleteFirst = deleteSucceeded && refused(insertion, 422, "rejected") && !programLeft && !orderLeft;
      const insertFirst = insertSucceeded && refused(removal, 422, "rejected") && programLeft && orderLeft;
      if (deleteFirst) deleteWon += 1;
      else if (insertFirst) insertWon += 1;
      else {
        inconsistent += 1;
        if (odd.length < 3) odd.push({ round: i, removal: show(removal), insertion: show(insertion), programLeft, orderLeft });
      }
    }
    check(`${rounds} lượt «xóa chương trình» chen với «thêm đơn vào chương trình đó»: không lượt nào để lại đơn của chương trình đã mất`, orphans === 0, { orphans });
    check("…và lượt nào cũng kết thúc gọn: hoặc xóa được + đơn bị từ chối, hoặc đơn ghi được + lệnh xóa bị từ chối", inconsistent === 0, { inconsistent, examples: odd });
    note(`trong ${rounds} lượt: lệnh xóa tới trước ${deleteWon} lượt, đơn tới trước ${insertWon} lượt`);
    const total = (await sql("select coalesce(max(last), 0) as last from km.order_counters"))[0].last;
    const used = (await sql("select count(*)::int as n from km.orders where code ~ '^DH[0-9]{6}-[0-9]+$'"))[0].n;
    check("các đơn bị từ chối trong cuộc đua không tiêu mất số nào của dãy mã đơn", total === used, { counter: total, orders: used });
  }
});

// ═════════════════════════ Quản lý tài khoản ═════════════════════════

await group("Quản lý tài khoản", async () => {
  const {
    boss,
    sales: [sale],
    pending: [waiting],
  } = await team({ sales: 1, pending: 1 });
  const b = { token: boss.token };

  const list = await api("accounts.list", {}, b);
  check(
    "accounts.list: mọi tài khoản, xếp theo thời điểm đăng ký, mỗi dòng đúng sáu mục của hồ sơ",
    ok(list) &&
      list.result?.[0]?.email === boss.email &&
      isDeepStrictEqual(list.result?.map((p) => p.email).sort(), [boss.email, sale.email, waiting.email].sort()) &&
      list.result?.every((p, i, all) => i === 0 || Date.parse(all[i - 1].createdAt) <= Date.parse(p.createdAt)) &&
      list.result?.every((p) => isDeepStrictEqual(Object.keys(p).sort(), ["createdAt", "email", "fullName", "id", "phone", "role"])),
    list.result,
  );
  check("danh sách tài khoản không chứa mật khẩu, mã băm hay khóa phiên", !/password|hash|scrypt|token/i.test(JSON.stringify(list.result)));

  for (const [label, role] of [["lạ", "admin"], ["«pending» (không đưa ngược về chờ duyệt được)", "pending"], ["viết hoa", "Manager"], ["rỗng", ""], ["là số", 1], ["là null", null]]) {
    await expectRefused(`đổi vai trò thành giá trị ${label}`, () => api("accounts.setRole", { id: sale.id, role }, b), 422, "rejected");
  }
  await expectRefused("đổi vai trò mà thiếu vai trò", () => api("accounts.setRole", { id: sale.id }, b), 422, "rejected");
  for (const role of ["sale", "locked", "manager"]) {
    await expectRefused(`tự đổi vai trò của chính mình thành «${role}»`, () => api("accounts.setRole", { id: boss.id, role }, b), 403, "forbidden");
  }
  for (const [label, id] of [["không có thật", "00000000-0000-4000-8000-000000000000"], ["sai dạng", "abc"], ["rỗng", ""], ["là số", 5], ["là null", null], ["có lệnh SQL", "x'; drop table km.accounts; --"]]) {
    await expectRefused(`đổi vai trò của tài khoản có id ${label}`, () => api("accounts.setRole", { id, role: "sale" }, b), 404, "not_found");
    await expectRefused(`đặt lại mật khẩu của tài khoản có id ${label}`, () => api("accounts.setPassword", { id, newPassword: "mat-khau-moi-1" }, b), 404, "not_found");
  }
  await expectRefused("đổi vai trò mà thiếu id", () => api("accounts.setRole", { role: "sale" }, b), 404, "not_found");
  await expectRefused("quản lý đặt lại mật khẩu của chính mình bằng lệnh quản trị", () => api("accounts.setPassword", { id: boss.id, newPassword: "mat-khau-moi-1" }, b), 403, "forbidden");
  await expectRefused("đặt lại mật khẩu quá ngắn", () => api("accounts.setPassword", { id: sale.id, newPassword: "12345" }, b), 422, "rejected");
  await expectRefused("đặt lại mật khẩu dài 201 ký tự", () => api("accounts.setPassword", { id: sale.id, newPassword: "p".repeat(201) }, b), 422, "rejected");
  await expectRefused("đặt lại mật khẩu mà không gửi mật khẩu mới", () => api("accounts.setPassword", { id: sale.id }, b), 422, "rejected");

  // Đổi vai trò có hiệu lực ngay ở lệnh gọi kế tiếp của tài khoản đó, với chính khóa phiên đang dùng.
  const w = { token: waiting.token };
  const before = await api("sync.heads", { table: "programs" }, w);
  const approve = await api("accounts.setRole", { id: waiting.id, role: "sale" }, b);
  const asSale = await api("sync.heads", { table: "programs" }, w);
  const asSaleAdmin = await api("accounts.list", {}, w);
  check("duyệt tài khoản chờ thành sale: lệnh trả về hồ sơ mới; ngay lệnh gọi kế tiếp tài khoản đó đọc được dữ liệu", refused(before, 403, "forbidden") && ok(approve) && approve.result?.role === "sale" && approve.result?.id === waiting.id && ok(asSale) && refused(asSaleAdmin, 403, "forbidden"), [before.status, approve.status, asSale.status, asSaleAdmin.status]);
  must(await api("accounts.setRole", { id: waiting.id, role: "manager" }, b));
  const asManager = await api("accounts.list", {}, w);
  check("nâng lên quản lý: dùng được lệnh quản trị ngay", ok(asManager) && asManager.result?.length === 3, show(asManager));
  must(await api("accounts.setRole", { id: waiting.id, role: "locked" }, b));
  const asLocked = await api("sync.heads", { table: "programs" }, w);
  const lockedAdmin = await api("accounts.setRole", { id: sale.id, role: "manager" }, w);
  const lockedMe = await api("me", {}, w);
  check("khóa một quản lý: ngay lập tức hết đọc dữ liệu, hết dùng lệnh quản trị; vẫn xem được hồ sơ của mình (vai trò «locked»)", refused(asLocked, 403, "forbidden") && refused(lockedAdmin, 403, "forbidden") && ok(lockedMe) && lockedMe.result?.role === "locked", [asLocked.status, lockedAdmin.status, lockedMe.body]);
  const unlock = await api("accounts.setRole", { id: waiting.id, role: "sale" }, b);
  check("mở khóa (đưa về sale) thì dùng lại được", ok(unlock) && ok(await api("sync.heads", { table: "programs" }, w)), show(unlock));

  check("hệ thống chỉ có một quản lý thì người đó không tự bỏ vai trò được → luôn còn quản lý", (await count("accounts", "role = 'manager'")) === 1);
});

await group("Hai quản lý hạ quyền lẫn nhau cùng lúc", async () => {
  const {
    managers: [a, b],
  } = await team({ managers: 2, sales: 0 });

  // Cả hai lệnh cùng đứng chờ rồi được thả ra một lượt.
  {
    const gate = await openSession();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(hashtext('km.roles'))");
    const first = api("accounts.setRole", { id: b.id, role: "sale" }, { token: a.token });
    const second = api("accounts.setRole", { id: a.id, role: "sale" }, { token: b.token });
    const waited = await until(async () => (await lockWaiters()) >= 2);
    await gate.query("commit");
    await gate.end();
    const results = await Promise.all([first, second]);
    const roles = await sql("select id, role from km.accounts where id = any($1::uuid[])", [[a.id, b.id]]);
    const managersLeft = roles.filter((row) => row.role === "manager").length;
    check(
      "hai lệnh hạ quyền cùng chờ rồi cùng được thả: đúng một bên thành công, bên kia 403, hệ thống còn đúng một quản lý",
      waited && results.filter(ok).length === 1 && results.filter((r) => refused(r, 403, "forbidden")).length === 1 && managersLeft === 1,
      { waited, statuses: results.map((r) => r.status), roles },
    );
  }

  const restore = async () => {
    const rows = await sql("select id, role from km.accounts where id = any($1::uuid[])", [[a.id, b.id]]);
    const winner = rows.find((row) => row.role === "manager");
    const loser = rows.find((row) => row.role !== "manager");
    if (winner && loser) must(await api("accounts.setRole", { id: loser.id, role: "manager" }, { token: winner.id === a.id ? a.token : b.token }));
    return rows;
  };
  await restore();

  const rounds = 30;
  let bad = 0;
  /** @type {unknown[]} */
  const examples = [];
  for (let i = 0; i < rounds; i++) {
    const targetRole = i % 3 === 0 ? "locked" : "sale";
    const results = await Promise.all([
      api("accounts.setRole", { id: b.id, role: targetRole }, { token: a.token }),
      api("accounts.setRole", { id: a.id, role: targetRole }, { token: b.token }),
    ]);
    const rows = await restore();
    const managersLeft = rows.filter((row) => row.role === "manager").length;
    const fine = managersLeft === 1 && results.filter(ok).length === 1 && results.filter((r) => refused(r, 403, "forbidden")).length === 1;
    if (!fine) {
      bad += 1;
      if (examples.length < 3) examples.push({ round: i, statuses: results.map((r) => r.status), rows });
    }
  }
  check(`${rounds} lượt hai quản lý hạ quyền / khóa lẫn nhau cùng lúc: lượt nào cũng còn đúng một quản lý, đúng một lệnh thành công`, bad === 0, { bad, examples });
});

// ═════════════════════════ Dấu vân tay và lần hỏi định kỳ ═════════════════════════

await group("Dấu vân tay và lần hỏi định kỳ", async () => {
  const {
    boss,
    sales: [s1, s2],
    pending: [waiting],
  } = await team({ sales: 2, pending: 1 });
  const b = { token: boss.token };

  const empty = await api("sync.poll", {}, b);
  check(
    "hệ thống chưa có dữ liệu: dấu vân tay của bảng trống là SHA-256 của chuỗi rỗng; app_state là «settings:1,stock:1»",
    ok(empty) && empty.result?.fingerprints.programs === EMPTY_SHA256 && empty.result?.fingerprints.orders === EMPTY_SHA256 && empty.result?.fingerprints.app_state === sha256("settings:1,stock:1"),
    empty.result?.fingerprints,
  );
  const me = await api("me", {}, b);
  check("sync.poll.me đúng là hồ sơ của người gọi", isDeepStrictEqual(empty.result?.me, me.result), empty.result?.me);

  // id đủ kiểu: chữ hoa / thường, tiếng Việt, emoji (ngoài mặt phẳng cơ bản), ký tự vùng U+E000–U+FFFF, dấu câu.
  const ids = ["a", "B", "Z", "a-1", "a:1", "a,1", "ct-đơn-ầ", "ct-Ánh", "é", "z\u{1F3F8}", "z～", "z", "z퟿", "\u{1F600}đầu", "�x", "zz", "10", "9"];
  for (const id of ids) must(await insertProgram(boss, id));
  const byBytes = [...ids].sort((x, y) => Buffer.compare(Buffer.from(x, "utf8"), Buffer.from(y, "utf8")));
  check(
    "phép so «thứ tự byte UTF-8» của bài kiểm thử (viết lại từ mã của trình duyệt) khớp với Buffer.compare — và khác thứ tự mặc định của JavaScript",
    isDeepStrictEqual([...ids].sort(compareAsUtf8), byBytes) && !isDeepStrictEqual([...ids].sort(), byBytes),
    [...ids].sort(compareAsUtf8),
  );
  // Sửa vài chương trình để rev không đồng loạt bằng 1.
  must(await api("sync.update", { table: "programs", id: "z\u{1F3F8}", rev: 1, data: programDoc("z\u{1F3F8}", { name: "2" }) }, b));
  must(await api("sync.update", { table: "programs", id: "z\u{1F3F8}", rev: 2, data: programDoc("z\u{1F3F8}", { name: "3" }) }, b));
  must(await api("sync.update", { table: "programs", id: "ct-đơn-ầ", rev: 1, data: programDoc("ct-đơn-ầ", { name: "2" }) }, b));

  const heads = await api("sync.heads", { table: "programs" }, b);
  check("sync.heads trả về theo thứ tự byte của id", ok(heads) && isDeepStrictEqual(heads.result?.map((h) => h.id), byBytes), heads.result?.map((h) => h.id));
  const independent = sha256(byBytes.map((id) => `${id}:${heads.result?.find((h) => h.id === id).rev}`).join(","));
  const poll = await api("sync.poll", {}, b);
  check(
    "dấu vân tay «programs» = SHA-256 của \"id:rev,…\" xếp theo byte (tính theo cách của trình duyệt, và tính độc lập bằng Buffer.compare)",
    poll.result?.fingerprints.programs === fingerprintOf(heads.result) && poll.result?.fingerprints.programs === independent && heads.result?.find((h) => h.id === "z\u{1F3F8}").rev === 3,
    { server: poll.result?.fingerprints?.programs, browser: fingerprintOf(heads.result), independent },
  );

  for (const [who, id] of [[s1, "đơn-1"], [s1, "\u{1F3F8}-2"], [s1, "-3"], [s2, "đơn-4"], [s2, "Đơn-5"]]) must(await insertOrder(who, id, "a"));
  must(await api("sync.update", { table: "orders", id: "đơn-1", rev: 1, data: orderDoc("đơn-1", "a", { note: "2" }) }, { token: s1.token }));
  const allOrders = await api("sync.heads", { table: "orders" }, b);
  const s1Orders = await api("sync.heads", { table: "orders" }, { token: s1.token });
  const [bossPoll, s1Poll, s2Poll] = await Promise.all([api("sync.poll", {}, b), api("sync.poll", {}, { token: s1.token }), api("sync.poll", {}, { token: s2.token })]);
  check("dấu vân tay «orders» của quản lý tính trên mọi đơn", allOrders.result?.length === 5 && bossPoll.result?.fingerprints.orders === fingerprintOf(allOrders.result), bossPoll.result?.fingerprints);
  check(
    "dấu vân tay «orders» của từng sale tính trên đơn của riêng người đó",
    s1Orders.result?.length === 3 && s1Poll.result?.fingerprints.orders === fingerprintOf(s1Orders.result) && s2Poll.result?.fingerprints.orders === fingerprintOf(allOrders.result?.filter((h) => !s1Orders.result?.some((mine) => mine.id === h.id))),
    { s1: s1Poll.result?.fingerprints?.orders, s2: s2Poll.result?.fingerprints?.orders },
  );
  const stateHeads = await api("sync.heads", { table: "app_state" }, b);
  check("dấu vân tay «app_state» khớp với sync.heads", bossPoll.result?.fingerprints.app_state === fingerprintOf(stateHeads.result) && isDeepStrictEqual(stateHeads.result, [{ id: "settings", rev: 1 }, { id: "stock", rev: 1 }]), stateHeads.result);

  const steady = await api("sync.poll", {}, b);
  await api("sync.update", { table: "programs", id: "a", rev: 99, data: programDoc("a") }, b);
  await api("sync.insert", { table: "programs", id: "a", data: programDoc("a") }, b);
  const afterRefusals = await api("sync.poll", {}, b);
  check("không có gì đổi (kể cả sau các lệnh bị từ chối) thì dấu vân tay giữ nguyên", isDeepStrictEqual(afterRefusals.result?.fingerprints, steady.result?.fingerprints));
  must(await api("sync.update", { table: "app_state", id: "settings", rev: 1, data: { lowStockThreshold: 7 } }, b));
  must(await api("sync.remove", { table: "orders", id: "đơn-4" }, b));
  const changed = await api("sync.poll", {}, b);
  check(
    "sửa thiết lập và xóa một đơn: đúng hai dấu vân tay tương ứng đổi, «programs» giữ nguyên",
    changed.result?.fingerprints.app_state !== steady.result?.fingerprints.app_state && changed.result?.fingerprints.orders !== steady.result?.fingerprints.orders && changed.result?.fingerprints.programs === steady.result?.fingerprints.programs,
    changed.result?.fingerprints,
  );

  // Phần «accounts» của lần hỏi định kỳ: chỉ quản lý nhận được.
  const waitingPoll = await api("sync.poll", {}, { token: waiting.token });
  check("sale: accounts = null; tài khoản chờ duyệt: fingerprints = null và accounts = null", s1Poll.result?.accounts === null && ok(waitingPoll) && waitingPoll.result?.fingerprints === null && waitingPoll.result?.accounts === null && waitingPoll.result?.me.role === "pending", waitingPoll.result);
  const stamp0 = (await api("sync.poll", {}, b)).result?.accounts;
  check("quản lý: accounts.pending đếm số tài khoản đang chờ duyệt; accounts.stamp là một chuỗi", stamp0.pending === 1 && typeof stamp0.stamp === "string" && stamp0.stamp.length >= 8, stamp0);

  // Những việc KHÔNG đụng tới tài khoản nào thì «dấu» giữ nguyên.
  must(await insertProgram(boss, "ct-khong-lien-quan"));
  must(await insertOrder(s1, "don-khong-lien-quan", "a"));
  const extraSession = await signIn(s1);
  must(await api("auth.signOut", {}, { token: extraSession }));
  await api("auth.signIn", { email: s1.email, password: "sai" }, { ip: freshIp() });
  await api("accounts.setRole", { id: boss.id, role: "sale" }, b);
  await api("accounts.setRole", { id: s1.id, role: "khong-co" }, b);
  await api("auth.signUp", { email: s1.email, password: "trung-email-1" }, { ip: freshIp() });
  const stamp1 = (await api("sync.poll", {}, b)).result?.accounts;
  check("ghi dữ liệu, đăng nhập / đăng xuất, và các lệnh tài khoản bị từ chối: «dấu» và số chờ duyệt giữ nguyên", isDeepStrictEqual(stamp1, stamp0), { stamp0, stamp1 });

  const newcomer = await signUp("moi");
  const stamp2 = (await api("sync.poll", {}, b)).result?.accounts;
  check("có người mới đăng ký: số chờ duyệt tăng 1 và «dấu» đổi", stamp2.pending === 2 && stamp2.stamp !== stamp1.stamp, stamp2);
  must(await api("accounts.setRole", { id: newcomer.id, role: "sale" }, b));
  const stamp3 = (await api("sync.poll", {}, b)).result?.accounts;
  check("duyệt một tài khoản: số chờ duyệt giảm 1 và «dấu» đổi", stamp3.pending === 1 && stamp3.stamp !== stamp2.stamp, stamp3);
  must(await api("accounts.setRole", { id: newcomer.id, role: "locked" }, b));
  const stamp4 = (await api("sync.poll", {}, b)).result?.accounts;
  check("khóa một tài khoản (số chờ duyệt không đổi): «dấu» vẫn đổi", stamp4.pending === 1 && stamp4.stamp !== stamp3.stamp, stamp4);
  must(await api("me.update", { fullName: "Tên vừa sửa" }, { token: s2.token }));
  const stamp5 = (await api("sync.poll", {}, b)).result?.accounts;
  check("một người sửa họ tên của mình: «dấu» đổi", stamp5.pending === 1 && stamp5.stamp !== stamp4.stamp, stamp5);
  const stamp6 = (await api("sync.poll", {}, b)).result?.accounts;
  check("hỏi lại ngay sau đó: «dấu» giữ nguyên", isDeepStrictEqual(stamp6, stamp5), { stamp5, stamp6 });
});

// ═════════════════════════ Tải theo trang ═════════════════════════

await group("Tải tài liệu theo trang", async () => {
  const {
    boss,
    sales: [s1, s2],
  } = await team({ sales: 2 });
  const b = { token: boss.token };
  const ids = Array.from({ length: 23 }, (_, i) => `p-${String(i).padStart(2, "0")}`).concat(["đặc-biệt", "\u{1F3F8}"]);
  await Promise.all(ids.map((id) => insertProgram(boss, id).then(must)));
  const sorted = [...ids].sort(compareAsUtf8);

  /** Đi hết các trang; trả về kích thước từng trang và mọi dòng theo thứ tự nhận được. */
  const walk = async (who, args) => {
    /** @type {any[]} */
    const rows = [];
    /** @type {number[]} */
    const pages = [];
    let after;
    for (let guard = 0; guard < 500; guard++) {
      const r = await api("sync.load", after === undefined ? args : { ...args, after }, { token: who.token });
      if (!ok(r)) throw new Error(`sync.load thất bại: ${JSON.stringify(show(r)).slice(0, 300)}`);
      pages.push(r.result?.rows.length);
      rows.push(...r.result?.rows);
      if (r.result?.next === null) return { pages, rows };
      if (r.result?.rows.length === 0) throw new Error("trang trống mà vẫn báo còn nữa");
      after = r.result?.next;
    }
    throw new Error("đi mãi không hết trang");
  };

  const all = await walk(boss, { table: "programs" });
  check("không đặt giới hạn: 25 dòng về trong một trang, theo thứ tự byte của id", isDeepStrictEqual(all.pages, [25]) && isDeepStrictEqual(all.rows.map((row) => row.id), sorted), all.pages);
  check("mỗi dòng có id, rev và tài liệu", all.rows.every((row) => row.rev === 1 && row.data.id === row.id && Object.keys(row).length === 3));
  const paged = await walk(boss, { table: "programs", limit: 7 });
  check("limit 7: các trang 7, 7, 7, 4 — mỗi dòng đúng một lần, không sót, không lặp", isDeepStrictEqual(paged.pages, [7, 7, 7, 4]) && isDeepStrictEqual(paged.rows.map((row) => row.id), sorted), paged.pages);
  const exact = await walk(boss, { table: "programs", limit: 25 });
  check("limit đúng bằng số dòng: một trang, không báo «còn nữa»", isDeepStrictEqual(exact.pages, [25]), exact.pages);
  const one = await walk(boss, { table: "programs", limit: 1 });
  check("limit 1: 25 trang một dòng", one.pages.length === 25 && one.pages.every((n) => n === 1) && isDeepStrictEqual(one.rows.map((row) => row.id), sorted), one.pages.length);
  for (const [label, limit, expected] of [["0 → 1 dòng", 0, 1], ["âm → 1 dòng", -5, 1], ["2.9 → 2 dòng", 2.9, 2], ["là chuỗi → bỏ qua, dùng mặc định", "3", 25], ["null → mặc định", null, 25]]) {
    const r = await api("sync.load", { table: "programs", limit }, b);
    check(`limit ${label}`, ok(r) && r.result?.rows.length === expected, { status: r.status, rows: r.result?.rows?.length });
  }
  const afterLast = await api("sync.load", { table: "programs", after: sorted.at(-1) }, b);
  const afterMiddle = await api("sync.load", { table: "programs", after: "p-20" }, b);
  check("after = id cuối → không còn dòng nào; after ở giữa → đúng các dòng đứng sau nó", ok(afterLast) && afterLast.result?.rows.length === 0 && afterLast.result?.next === null && isDeepStrictEqual(afterMiddle.result?.rows.map((row) => row.id), sorted.slice(sorted.indexOf("p-20") + 1)), afterMiddle.result?.rows?.map((row) => row.id));

  // Theo danh sách id.
  const some = await api("sync.load", { table: "programs", ids: ["p-03", "khong-co", "đặc-biệt", "p-01", "p-03"] }, b);
  check("ids: chỉ trả về các id có thật, mỗi dòng một lần, xếp theo id", ok(some) && isDeepStrictEqual(some.result?.rows.map((row) => row.id), ["p-01", "p-03", "đặc-biệt"]) && some.result?.next === null, some.result?.rows?.map((row) => row.id));
  const none = await api("sync.load", { table: "programs", ids: [] }, b);
  check("ids rỗng → không có dòng nào", ok(none) && none.result?.rows.length === 0 && none.result?.next === null, none.result);
  const tenIds = sorted.slice(5, 15);
  const idPages = await walk(boss, { table: "programs", ids: tenIds, limit: 4 });
  check("ids + limit: 10 id về theo các trang 4, 4, 2 (hỏi tiếp bằng after với cùng danh sách)", isDeepStrictEqual(idPages.pages, [4, 4, 2]) && isDeepStrictEqual(idPages.rows.map((row) => row.id), tenIds), idPages.pages);
  const fiveHundred = await api("sync.load", { table: "programs", ids: Array.from({ length: 500 }, (_, i) => `x-${i}`).concat() }, b);
  check("đúng 500 id trong một lần hỏi thì được", ok(fiveHundred) && fiveHundred.result?.rows.length === 0, show(fiveHundred).status);
  await expectRefused("hơn 500 id trong một lần hỏi", () => api("sync.load", { table: "programs", ids: Array.from({ length: 501 }, (_, i) => `x-${i}`) }, b), 400, "bad_request");
  for (const [label, value] of [["một chuỗi", "p-01"], ["một con số", 5], ["một đối tượng", { a: 1 }]]) {
    await expectRefused(`ids là ${label}`, () => api("sync.load", { table: "programs", ids: value }, b), 400, "bad_request");
  }
  const nullIds = await api("sync.load", { table: "programs", ids: null }, b);
  check("ids = null nghĩa là mọi dòng", ok(nullIds) && nullIds.result?.rows.length === 25, show(nullIds).status);

  // Đơn hàng: phân trang vẫn chỉ trong phạm vi được thấy.
  await Promise.all(Array.from({ length: 9 }, (_, i) => insertOrder(i % 3 === 0 ? s2 : s1, `d-${i}`, "p-00").then(must)));
  const s1Pages = await walk(s1, { table: "orders", limit: 4 });
  const s2Asking = await api("sync.load", { table: "orders", ids: ["d-0", "d-1", "d-2", "d-3"] }, { token: s2.token });
  check("sale đi hết các trang đơn hàng: chỉ gặp đơn của mình (6 đơn: 4 + 2)", isDeepStrictEqual(s1Pages.pages, [4, 2]) && isDeepStrictEqual(s1Pages.rows.map((row) => row.id), ["d-1", "d-2", "d-4", "d-5", "d-7", "d-8"]), s1Pages.rows.map((row) => row.id));
  check("sale hỏi theo id lẫn đơn của người khác: chỉ nhận đơn của mình", isDeepStrictEqual(s2Asking.result?.rows.map((row) => row.id), ["d-0", "d-3"]), s2Asking.result?.rows?.map((row) => row.id));

  // Nhiều dòng: trang mặc định 200, tối đa 500.
  await sql("insert into km.programs (id, data) select 'n-' || lpad(g::text, 4, '0'), jsonb_build_object('id', 'n-' || lpad(g::text, 4, '0'), 'name', 'hàng loạt') from generate_series(1, 620) g");
  const defaults = await walk(boss, { table: "programs" });
  check("645 dòng, không đặt giới hạn: các trang 200, 200, 200, 45", isDeepStrictEqual(defaults.pages, [200, 200, 200, 45]) && new Set(defaults.rows.map((row) => row.id)).size === 645, defaults.pages);
  const capped = await walk(boss, { table: "programs", limit: 100000 });
  check("limit rất lớn bị ép về 500 dòng mỗi trang: 500, 145", isDeepStrictEqual(capped.pages, [500, 145]), capped.pages);
  const headsMany = await api("sync.heads", { table: "programs" }, b);
  check("sync.heads trả về đủ 645 dòng trong một lần", ok(headsMany) && headsMany.result?.length === 645, headsMany.result?.length);
});

await group("Tải tài liệu theo trang: giới hạn dung lượng", async () => {
  const { boss } = await team({ sales: 0 });
  const b = { token: boss.token };
  const bytes = (rows) => rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row.data), "utf8"), 0);

  for (let i = 0; i < 5; i++) must(await insertProgram(boss, `nang-${i}`, { blob: String(i).repeat(1_100_000) }));
  must(await insertProgram(boss, "nhe-cuoi"));
  /** @type {any[][]} */
  const pages = [];
  let after;
  for (let guard = 0; guard < 20; guard++) {
    const r = await api("sync.load", after === undefined ? { table: "programs" } : { table: "programs", after }, b);
    must(r, "sync.load");
    pages.push(r.result?.rows);
    if (r.result?.next === null) break;
    after = r.result?.next;
  }
  const seen = pages.flat().map((row) => row.id);
  check("5 tài liệu ~1,1 MB + 1 tài liệu nhỏ: về qua nhiều trang, trang nào cũng có dòng, không sót không lặp", pages.length >= 2 && pages.every((page) => page.length > 0) && isDeepStrictEqual(seen, ["nang-0", "nang-1", "nang-2", "nang-3", "nang-4", "nhe-cuoi"]), pages.map((page) => page.map((row) => row.id)));
  check("ngân sách 3 MB: mỗi trang dừng TRƯỚC khi vượt 3 MB (2 tài liệu ~1,1 MB một trang), phần còn lại ở các trang sau", isDeepStrictEqual(pages.map((page) => page.length), [2, 2, 2]), pages.map((page) => page.length));
  check("mỗi trang nhẹ hơn ngân sách 3 MB", pages.every((page) => bytes(page) <= 3_000_000), pages.map(bytes));
  check("nội dung các tài liệu lớn về nguyên vẹn", pages.flat().slice(0, 5).every((row, i) => row.data.blob.length === 1_100_000 && row.data.blob[0] === String(i) && row.data.blob.at(-1) === String(i)));

  await resetDatabase();
  const again = await team({ sales: 0 });
  const t = { token: again.boss.token };
  must(await insertProgram(again.boss, "a-rat-nang", { blob: "x".repeat(3_600_000) }));
  must(await insertProgram(again.boss, "b-nhe"));
  must(await insertProgram(again.boss, "c-nhe"));
  const first = await api("sync.load", { table: "programs" }, t);
  const second = await api("sync.load", { table: "programs", after: first.result?.next }, t);
  check(
    "một tài liệu nặng hơn cả ngân sách (3,6 MB) vẫn về được, đứng riêng một trang",
    ok(first) && isDeepStrictEqual(first.result?.rows.map((row) => row.id), ["a-rat-nang"]) && first.result?.next === "a-rat-nang" && first.result?.rows[0].data.blob.length === 3_600_000 && ok(second) && isDeepStrictEqual(second.result?.rows.map((row) => row.id), ["b-nhe", "c-nhe"]) && second.result?.next === null,
    { first: first.result?.rows?.map((row) => row.id), next: first.result?.next, second: second.result?.rows?.map((row) => row.id) },
  );
  const byId = await api("sync.load", { table: "programs", ids: ["a-rat-nang", "c-nhe"] }, t);
  const byIdNext = await api("sync.load", { table: "programs", ids: ["a-rat-nang", "c-nhe"], after: byId.result?.next }, t);
  check("hỏi theo id cũng chia trang theo dung lượng", ok(byId) && byId.result?.rows.length === 1 && byId.result?.next === "a-rat-nang" && isDeepStrictEqual(byIdNext.result?.rows.map((row) => row.id), ["c-nhe"]), { next: byId.result?.next });

  // Các tài liệu vài MB đứng cạnh nhau (một chương trình có bảng giá rất dài): gộp chung một trang thì câu trả lời vượt
  // 4,5 MB — mức mà nơi chạy lớp API (Vercel) cho phép — và không máy nào tải nổi dữ liệu nữa.
  await resetDatabase();
  const heavy = await team({ sales: 0 });
  const h = { token: heavy.boss.token };
  must(await insertProgram(heavy.boss, "a-vua", { blob: "a".repeat(2_400_000) }));
  must(await insertProgram(heavy.boss, "b-vua", { blob: "b".repeat(2_400_000) }));
  must(await insertProgram(heavy.boss, "c-lon", { blob: "c".repeat(4_300_000) }));
  must(await insertProgram(heavy.boss, "d-nhe"));
  must(await insertProgram(heavy.boss, "e-nhe"));
  /** @type {{ ids: string[], bytes: number }[]} */
  const heavyPages = [];
  let heavyAfter;
  for (let guard = 0; guard < 20; guard++) {
    const r = await api("sync.load", heavyAfter === undefined ? { table: "programs" } : { table: "programs", after: heavyAfter }, h);
    must(r, "sync.load");
    // Đúng số byte của câu trả lời gửi về trình duyệt.
    heavyPages.push({ ids: r.result?.rows.map((row) => row.id), bytes: Buffer.byteLength(JSON.stringify(r.body), "utf8") });
    if (r.result?.next === null) break;
    heavyAfter = r.result?.next;
  }
  check(
    "tài liệu 2,4 MB + 2,4 MB + 4,3 MB đứng liền nhau: không câu trả lời nào vượt 4,5 MB",
    heavyPages.every((page) => page.bytes < 4_500_000),
    heavyPages.map((page) => `${page.ids.join("+")} = ${page.bytes} byte`),
  );
  check(
    "…mỗi tài liệu nặng đứng riêng một trang, các tài liệu nhẹ đi chung; không sót, không lặp",
    isDeepStrictEqual(heavyPages.map((page) => page.ids), [["a-vua"], ["b-vua"], ["c-lon"], ["d-nhe", "e-nhe"]]),
    heavyPages.map((page) => page.ids),
  );
});

// ═════════════════════════ SQL trực tiếp ═════════════════════════

await group("SQL trực tiếp (người quản trị database, không qua lớp API)", async () => {
  const {
    boss,
    sales: [s1, s2],
  } = await team({ sales: 2 });
  must(await insertProgram(boss, "ct-1"));
  must(await insertOrder(s1, "don-s1-a", "ct-1"));
  must(await insertOrder(s1, "don-s1-b", "ct-1"));
  must(await insertOrder(s2, "don-s2-a", "ct-1"));
  const codeBefore = (await orderRow("don-s1-a")).code;

  await sql("delete from km.accounts where id = $1", [s1.id]);
  const kept = await sql("select id, owner_id, code from km.orders order by id");
  check("xóa hẳn một tài khoản: đơn của tài khoản đó vẫn còn, chủ đơn để trống, mã đơn giữ nguyên", kept.length === 3 && kept.filter((row) => row.owner_id === null).length === 2 && kept.find((row) => row.id === "don-s1-a").code === codeBefore, kept);
  const dead = await api("me", {}, { token: s1.token });
  check("phiên đăng nhập của tài khoản đã xóa hết dùng được → 401", refused(dead, 401, "unauthorized") && (await count("sessions", "account_id = $1", [s1.id])) === 0, show(dead));
  const s2Heads = await api("sync.heads", { table: "orders" }, { token: s2.token });
  const bossHeads = await api("sync.heads", { table: "orders" }, { token: boss.token });
  check("đơn không còn chủ: sale khác không thấy, quản lý thấy đủ", isDeepStrictEqual(s2Heads.result?.map((h) => h.id), ["don-s2-a"]) && isDeepStrictEqual(bossHeads.result?.map((h) => h.id), ["don-s1-a", "don-s1-b", "don-s2-a"]), { s2: s2Heads.result, boss: bossHeads.result });
  const s2Edit = await api("sync.update", { table: "orders", id: "don-s1-a", rev: bossHeads.result[0].rev, data: orderDoc("don-s1-a", "ct-1", { note: "chiếm" }) }, { token: s2.token });
  const s2Drop = await api("sync.remove", { table: "orders", id: "don-s1-a" }, { token: s2.token });
  check("sale khác không sửa / xóa được đơn không còn chủ", ok(s2Edit) && s2Edit.result === null && ok(s2Drop) && s2Drop.result === false && (await orderRow("don-s1-a")).data.note === undefined, [s2Edit.body, s2Drop.body]);
  const bossEdit = await api("sync.update", { table: "orders", id: "don-s1-a", rev: bossHeads.result[0].rev, data: orderDoc("don-s1-a", "ct-1", { note: "quản lý nhận" }) }, { token: boss.token });
  const afterEdit = await orderRow("don-s1-a");
  check("quản lý sửa được đơn không còn chủ; chủ đơn vẫn để trống, mã giữ nguyên", ok(bossEdit) && afterEdit.owner_id === null && afterEdit.code === codeBefore && afterEdit.data.note === "quản lý nhận", afterEdit);
  const bossDrop = await api("sync.remove", { table: "orders", id: "don-s1-b" }, { token: boss.token });
  check("quản lý xóa được đơn không còn chủ", ok(bossDrop) && bossDrop.result === true, show(bossDrop));
  const reRegister = await api("auth.signUp", { email: s1.email, password: "dang-ky-lai-1" }, { ip: freshIp() });
  const reHeads = ok(reRegister) ? await api("sync.heads", { table: "orders" }, { token: reRegister.result?.token }) : null;
  check("email của tài khoản đã xóa đăng ký lại được — thành tài khoản mới (chờ duyệt), không thừa hưởng đơn cũ", ok(reRegister) && reRegister.result?.profile.role === "pending" && reRegister.result?.profile.id !== s1.id && refused(reHeads, 403, "forbidden"), show(reRegister));

  // Câu lệnh SQL không mang danh tài khoản nào: người quản trị tự chịu trách nhiệm, trigger không gán chủ đơn.
  await sql("insert into km.orders (id, owner_id, data) values ($1, $2, $3::jsonb)", ["don-sql", s2.id, JSON.stringify(orderDoc("don-sql", "ct-1", { code: "NHAP-TAY-1" }))]);
  await sql("insert into km.orders (id, data) values ($1, $2::jsonb)", ["don-sql-2", JSON.stringify(orderDoc("don-sql-2", "chuong-trinh-da-xoa-tu-lau"))]);
  const direct = await orderRow("don-sql");
  const direct2 = await orderRow("don-sql-2");
  check("thêm đơn bằng SQL: chủ đơn và mã do người quản trị đặt được giữ; mã trống thì vẫn được cấp", direct.owner_id === s2.id && direct.code === "NHAP-TAY-1" && direct2.owner_id === null && CODE_FORMAT.test(direct2.code), [direct, direct2]);
  check("…và người quản trị được phép thêm đơn của một chương trình không còn (vd khi khôi phục dữ liệu cũ)", direct2.program_id === "chuong-trinh-da-xoa-tu-lau");
  const orphanEdit = await api("sync.update", { table: "orders", id: "don-sql-2", rev: direct2.rev, data: orderDoc("don-sql-2", "chuong-trinh-da-xoa-tu-lau", { note: "vẫn sửa được" }) }, { token: boss.token });
  const orphanMove = await api("sync.update", { table: "orders", id: "don-sql-2", rev: direct2.rev + 1, data: orderDoc("don-sql-2", "ct-1") }, { token: boss.token });
  const orphanDrop = await api("sync.remove", { table: "orders", id: "don-sql-2" }, { token: boss.token });
  check(
    "đơn có sẵn của một chương trình không còn: qua ứng dụng vẫn sửa được (không đổi chương trình), chuyển được sang chương trình đang có, và xóa được",
    ok(orphanEdit) && orphanEdit.result?.rev === direct2.rev + 1 && ok(orphanMove) && orphanMove.result?.rev === direct2.rev + 2 && ok(orphanDrop) && orphanDrop.result === true,
    [show(orphanEdit), show(orphanMove), show(orphanDrop)],
  );
  await sql("update km.orders set owner_id = null where id = $1", ["don-sql"]);
  check("đổi chủ đơn bằng SQL (không qua lớp API) thì được", (await orderRow("don-sql")).owner_id === null);
  await sql("update km.programs set data = data || '{\"note\": \"sửa tay\"}'::jsonb where id = 'ct-1'");
  const touched = await programRow("ct-1");
  check("sửa chương trình bằng SQL: rev vẫn tăng (để trình duyệt biết mà tải lại), người sửa để trống", touched.rev === 2 && touched.updated_by === null && touched.data.note === "sửa tay", touched);
});

// ═════════════════════════ Cài lại lược đồ, kết nối ═════════════════════════

await group("Cài lại lược đồ trên database đang có dữ liệu", async () => {
  const {
    boss,
    sales: [s1],
  } = await team({ sales: 1 });
  must(await insertProgram(boss, "ct-1"));
  must(await insertOrder(s1, "don-1", "ct-1"));
  must(await api("sync.update", { table: "app_state", id: "settings", rev: 1, data: { lowStockThreshold: 3 } }, { token: boss.token }));
  const before = await stateDigest();
  const env = { ...process.env, DATABASE_URL: TEST_URL };
  delete env.DATABASE_CA;
  const setup = spawnSync(process.execPath, [join(root, "server", "setup.mjs")], { cwd: root, env, encoding: "utf8" });
  check("chạy lại server/setup.mjs: thành công", setup.status === 0, (setup.stdout + setup.stderr).slice(-600));
  check("…dữ liệu (tài khoản, phiên đăng nhập, chương trình, đơn hàng, tồn kho, thiết lập, bộ đếm) giữ nguyên", before === (await stateDigest()));
  check("…dấu «database thử» và phiên bản lược đồ vẫn đó", (await count("meta", "key = $1", [TEST_MARK_KEY])) === 1 && (await sql("select value from km.meta where key = 'schema_version'"))[0].value === SCHEMA_VERSION);
  const stillWorks = await insertOrder(s1, "don-2", "ct-1");
  check("…khóa phiên cũ vẫn dùng được, mã đơn đánh số tiếp", ok(stillWorks) && /-002$/.test(stillWorks.result?.code), show(stillWorks));
  const verify = spawnSync(process.execPath, [join(root, "server", "setup.mjs"), "--check"], { cwd: root, env, encoding: "utf8" });
  check("server/setup.mjs --check: báo lược đồ đúng phiên bản (mã thoát 0)", verify.status === 0, (verify.stdout + verify.stderr).slice(-400));
  check("lệnh cài đặt không in mật khẩu database ra màn hình", !(setup.stdout + setup.stderr + verify.stdout + verify.stderr).includes(new URL(TEST_URL).password));

  await sql("update km.meta set value = '0' where key = 'schema_version'");
  try {
    const outdated = spawnSync(process.execPath, [join(root, "server", "setup.mjs"), "--check"], { cwd: root, env, encoding: "utf8" });
    check("--check khi lược đồ trong database là phiên bản khác: mã thoát khác 0, nói rõ cần chạy db:setup", outdated.status === 1 && /db:setup/.test(outdated.stdout + outdated.stderr), { status: outdated.status, out: (outdated.stdout + outdated.stderr).slice(-300) });
    check("--check không sửa gì (phiên bản lệch vẫn nguyên đó)", (await sql("select value from km.meta where key = 'schema_version'"))[0].value === "0");
  } finally {
    await sql("update km.meta set value = $1 where key = 'schema_version'", [SCHEMA_VERSION]);
  }
  const closedPort = new URL(TEST_URL);
  closedPort.port = "1";
  const unreachable = spawnSync(process.execPath, [join(root, "server", "setup.mjs"), "--check"], { cwd: root, env: { ...env, DATABASE_URL: closedPort.toString() }, encoding: "utf8" });
  check("--check khi không nối được database: mã thoát khác 0, không in mật khẩu", unreachable.status === 1 && !(unreachable.stdout + unreachable.stderr).includes(new URL(TEST_URL).password), { status: unreachable.status, out: (unreachable.stdout + unreachable.stderr).slice(-300) });
});

await group("Database chưa sẵn sàng: lớp API báo rõ tình trạng, không lộ chi tiết", async () => {
  const user = await signUp("san-sang");
  /** Cho lớp API dùng một địa chỉ database khác (null = không cấu hình). Các lệnh SQL của bài kiểm thử vẫn vào database thử. */
  const pointApiAt = async (url) => {
    await closeApi();
    if (url === null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = url;
  };
  const probe = async () => ({ health: await api("", {}, { method: "GET" }), call: await api("me", {}, { token: user.token }), signIn: await api("auth.signIn", { email: user.email, password: user.password }, { ip: freshIp() }) });
  const secretFree = (r) => !/127\.0\.0\.1|ECONN|password authentication|role "|database "|schema "|km\./i.test(JSON.stringify(r.body)) && !JSON.stringify(r.body).includes(new URL(TEST_URL).password);
  try {
    await pointApiAt(null);
    const none = await probe();
    check("không có DATABASE_URL: tình trạng «not_configured»; mọi lệnh → 503 not_configured", none.health.status === 200 && none.health.body.database === "not_configured" && refused(none.call, 503, "not_configured") && refused(none.signIn, 503, "not_configured"), [none.health.body, show(none.call)]);

    const closedPort = new URL(TEST_URL);
    closedPort.port = "1";
    await pointApiAt(closedPort.toString());
    const down = await probe();
    check("database không nối được: tình trạng «unreachable»; lệnh → 503 unavailable (trình duyệt sẽ tự thử lại)", down.health.status === 200 && down.health.body.database === "unreachable" && refused(down.call, 503, "unavailable") && refused(down.signIn, 503, "unavailable"), [down.health.body, show(down.call)]);
    check("…lời báo không lộ địa chỉ, cổng hay lỗi kỹ thuật của database", secretFree(down.call) && secretFree(down.health) && secretFree(down.signIn), [down.call.body, down.health.body]);

    const wrongPassword = new URL(TEST_URL);
    wrongPassword.password = "sai-mat-khau-database";
    await pointApiAt(wrongPassword.toString());
    const denied = await probe();
    check("sai mật khẩu database: tình trạng «unreachable»; lệnh → 503 unavailable, không lộ chi tiết", denied.health.body.database === "unreachable" && refused(denied.call, 503, "unavailable") && secretFree(denied.call), [denied.health.body, show(denied.call)]);

    const otherDatabase = new URL(TEST_URL);
    otherDatabase.pathname = "/postgres";
    await pointApiAt(otherDatabase.toString());
    const bare = await probe();
    check("database chưa cài lược đồ: tình trạng «not_installed»; lệnh → 503 not_installed", bare.health.body.database === "not_installed" && refused(bare.call, 503, "not_installed") && refused(bare.signIn, 503, "not_installed"), [bare.health.body, show(bare.call)]);

    await pointApiAt(TEST_URL);
    await sql("update km.meta set value = '0' where key = 'schema_version'");
    const outdated = await api("", {}, { method: "GET" });
    check("lược đồ khác phiên bản mã nguồn cần: tình trạng «outdated», kèm phiên bản đang có", outdated.body.database === "outdated" && outdated.body.schema === "0" && outdated.body.expects === SCHEMA_VERSION, outdated.body);
  } finally {
    await pointApiAt(TEST_URL);
    await sql("update km.meta set value = $1 where key = 'schema_version'", [SCHEMA_VERSION]);
  }
  const back = await probe();
  check("trỏ lại đúng database: mọi thứ chạy lại bình thường với khóa phiên cũ", back.health.body.database === "ok" && ok(back.call) && back.call.result?.id === user.id && ok(back.signIn), [back.health.body, show(back.call)]);
});

await group("Kết nối database: đóng hết khi không còn yêu cầu nào (cách chạy thật, ngoài kiểm thử)", async () => {
  const {
    boss,
    sales: [s1],
  } = await team({ sales: 1 });
  must(await insertProgram(boss, "ct-1"));
  process.env.KM_KEEP_POOL = "0";
  try {
    const first = await api("me", {}, { token: boss.token });
    const idle = await until(async () => (await apiConnections()) === 0, 3000);
    check("sau một yêu cầu lẻ: không còn kết nối nào của lớp API mở tới database", ok(first) && idle, { status: first.status, connections: await apiConnections() });
    const sequence = [];
    for (let i = 0; i < 6; i++) sequence.push(await api("sync.poll", {}, { token: s1.token }));
    check("6 yêu cầu nối tiếp nhau (mỗi yêu cầu mở rồi đóng kết nối) đều được", sequence.every(ok), sequence.map((r) => r.status));
    const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? insertOrder(s1, `don-don-dap-${i}`, "ct-1") : api("sync.heads", { table: "orders" }, { token: boss.token }))));
    const idleAfterBurst = await until(async () => (await apiConnections()) === 0, 3000);
    check("40 yêu cầu dồn dập (gối lên nhau, dùng chung kết nối) đều được, xong thì đóng hết kết nối", burst.every(ok) && idleAfterBurst, { statuses: [...new Set(burst.map((r) => r.status))], connections: await apiConnections() });

    // Một yêu cầu đang chạy dở (chờ khóa) thì các yêu cầu khác vẫn chạy, và kết nối của nó không bị đóng ngang.
    const gate = await openSession();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(hashtext('km.order_code'))");
    const slow = insertOrder(s1, "don-cham", "ct-1");
    const waited = await until(async () => (await lockWaiters()) >= 1);
    const quick = [];
    for (let i = 0; i < 4; i++) quick.push(await api("me", {}, { token: boss.token }));
    await gate.query("commit");
    await gate.end();
    const slowResult = await slow;
    const idleAtEnd = await until(async () => (await apiConnections()) === 0, 3000);
    check("yêu cầu đang chờ dở không bị các yêu cầu khác (đến rồi xong trong lúc đó) làm đứt kết nối", waited && quick.every(ok) && ok(slowResult) && idleAtEnd, { waited, quick: quick.map((r) => r.status), slow: show(slowResult) });

    // Đường truyền tới database đứng hình đúng lúc lớp API đóng kết nối: câu trả lời cho trình duyệt không được treo theo.
    const proxy = await startBlackHoleProxy(Number(new URL(TEST_URL).port));
    const viaProxy = new URL(TEST_URL);
    viaProxy.port = String(proxy.port);
    await closeApi();
    process.env.DATABASE_URL = viaProxy.toString();
    try {
      const through = await api("me", {}, { token: boss.token });
      check("qua một trạm trung chuyển TCP: yêu cầu vẫn chạy bình thường", ok(through), show(through));
      proxy.blackHoleOnClose(true);
      const started = Date.now();
      const first = await Promise.race([api("me", {}, { token: boss.token }), sleep(8000).then(() => "treo")]);
      const second = await Promise.race([insertOrder(s1, "don-luc-mang-dung", "ct-1"), sleep(8000).then(() => "treo")]);
      check(
        "đường truyền đứng hình đúng lúc đóng kết nối: câu trả lời vẫn về trong vài giây, yêu cầu kế tiếp cũng vậy",
        first !== "treo" && second !== "treo" && ok(first) && ok(second) && proxy.swallowed() >= 2 && Date.now() - started < 8000,
        { first: first === "treo" ? first : show(first), second: second === "treo" ? second : show(second), swallowed: proxy.swallowed(), ms: Date.now() - started },
      );
    } finally {
      proxy.blackHoleOnClose(false);
      process.env.DATABASE_URL = TEST_URL;
      await proxy.close();
      await closeApi();
    }
    const direct = await api("me", {}, { token: boss.token });
    check("trở lại nối thẳng: chạy bình thường", ok(direct), show(direct));
  } finally {
    process.env.KM_KEEP_POOL = "1";
  }
});

await group("Database trục trặc giữa lúc đang xử lý một yêu cầu", async () => {
  const {
    boss,
    sales: [s1],
  } = await team({ sales: 1 });
  must(await insertProgram(boss, "ct-1"));
  /** Phiên database của lớp API đang đứng chờ khóa (tức đang xử lý dở một yêu cầu). */
  const stuckBackend = async () => (await sql("select pid from pg_stat_activity where application_name = 'km-api' and wait_event_type = 'Lock' limit 1"))[0]?.pid;
  const holdOrderCodes = async () => {
    const gate = await openSession();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(hashtext('km.order_code'))");
    return gate;
  };
  const before = await stateDigest();
  {
    const gate = await holdOrderCodes();
    const pending = insertOrder(s1, "don-bi-huy", "ct-1");
    const waited = await until(async () => (await stuckBackend()) !== undefined);
    await sql("select pg_cancel_backend($1)", [await stuckBackend()]);
    const r = await pending;
    await gate.query("rollback");
    await gate.end();
    check("câu lệnh bị database hủy giữa chừng (như khi chờ quá lâu) → 503 unavailable để trình duyệt thử lại, không phải lỗi 500", waited && refused(r, 503, "unavailable"), { waited, ...show(r) });
  }
  {
    const gate = await holdOrderCodes();
    const pending = insertOrder(s1, "don-bi-ngat", "ct-1");
    const waited = await until(async () => (await stuckBackend()) !== undefined);
    await sql("select pg_terminate_backend($1)", [await stuckBackend()]);
    const r = await pending;
    await gate.query("rollback");
    await gate.end();
    check("kết nối bị database ngắt giữa chừng (database khởi động lại / chuyển máy) → 503 unavailable", waited && refused(r, 503, "unavailable"), { waited, ...show(r) });
    check("…lời báo không lộ chi tiết kỹ thuật", !/terminat|administrator|connection|57P01/i.test(JSON.stringify(r.body)), r.body);
  }
  check("hai yêu cầu dở dang đó không để lại gì trong database", before === (await stateDigest()));
  const after = await insertOrder(s1, "don-sau-su-co", "ct-1");
  check("sau sự cố, yêu cầu kế tiếp chạy bình thường; mã đơn không bị nhảy số", ok(after) && /-001$/.test(after.result?.code ?? ""), show(after));
});

await group("Lỗi của database và đường truyền: đúng loại mã trả về, không lộ chi tiết", async () => {
  const user = await signUp("loi");
  /**
   * Cho mọi câu lệnh mà lớp API gửi trong lúc chạy `work` thất bại với `error` — như thể database (hoặc đường truyền tới
   * nó) vừa báo đúng lỗi đó. Dùng cho các lỗi không dựng được bằng cách thật (đứt đường truyền giữa chừng, database hết chỗ…).
   */
  const withQueryError = async (error, work) => {
    const proto = /** @type {any} */ (pg.Pool.prototype);
    const own = Object.hasOwn(proto, "query");
    const original = proto.query;
    proto.query = () => Promise.reject(error);
    try {
      return await work();
    } finally {
      if (own) proto.query = original;
      else delete proto.query;
    }
  };
  const SECRET = "chi-tiet-noi-bo 10.9.8.7 relation km.accounts";
  const nodeError = (code, message = `${code} ${SECRET}`) => Object.assign(new Error(message), { code, errno: -1, syscall: "write" });
  const dbError = (code, message = `${code} ${SECRET}`) => Object.assign(new Error(message), { code, severity: "ERROR" });
  const plain = (message) => new Error(message);
  const before = await stateDigest();

  for (const [label, error] of [
    ["đường truyền đứt lúc đang gửi (EPIPE)", nodeError("EPIPE")],
    ["đường truyền bị ngắt (ECONNRESET)", nodeError("ECONNRESET")],
    ["hết thời gian chờ mạng (ETIMEDOUT)", nodeError("ETIMEDOUT")],
    ["không tìm thấy tên máy chủ database (ENOTFOUND)", nodeError("ENOTFOUND")],
    ["database từ chối kết nối (ECONNREFUSED)", nodeError("ECONNREFUSED")],
    ["kết nối đứt giữa chừng (không có mã lỗi)", plain(`Connection terminated unexpectedly ${SECRET}`)],
    ["hết thời gian chờ lấy kết nối (không có mã lỗi)", plain("timeout exceeded when trying to connect")],
    ["hết thời gian chờ câu trả lời (không có mã lỗi)", plain("Query read timeout")],
    ["câu lệnh chạy quá lâu, database tự hủy (57014)", dbError("57014")],
    ["database đang tắt (57P01)", dbError("57P01")],
    ["database đang khởi động (57P03)", dbError("57P03")],
    ["database hết chỗ cho kết nối mới (53300)", dbError("53300")],
    ["kết nối hỏng (08006)", dbError("08006")],
    ["sai mật khẩu database (28P01)", dbError("28P01")],
  ]) {
    const r = await withQueryError(error, () => api("me", {}, { token: user.token }));
    check(`${label} → 503 unavailable (trình duyệt tự thử lại), không lộ chi tiết`, refused(r, 503, "unavailable") && !JSON.stringify(r.body).includes("chi-tiet") && !/10\.9\.8\.7|km\.accounts/.test(JSON.stringify(r.body)), show(r));
  }
  for (const code of ["3F000", "42883", "42P01"]) {
    const r = await withQueryError(dbError(code), () => api("me", {}, { token: user.token }));
    check(`database chưa có lược đồ / hàm / bảng (${code}) → 503 not_installed, không lộ chi tiết`, refused(r, 503, "not_installed") && !JSON.stringify(r.body).includes("chi-tiet"), show(r));
  }
  for (const [code, status, apiCode] of [["23505", 409, "conflict"], ["22P05", 422, "rejected"], ["22021", 422, "rejected"], ["23514", 422, "rejected"], ["23502", 422, "rejected"]]) {
    const r = await withQueryError(dbError(code), () => api("me", {}, { token: user.token }));
    check(`lỗi dữ liệu của database (${code}) → ${status} ${apiCode}, lời báo tiếng Việt soạn sẵn (không phải lời của database)`, refused(r, status, apiCode) && !JSON.stringify(r.body).includes("chi-tiet"), show(r));
  }
  for (const code of ["XX000", "42601", "40P01", "25P02", "54001"]) {
    const r = await withQueryError(dbError(code), () => api("me", {}, { token: user.token }));
    check(`lỗi database chưa lường (${code}) → 5xx với lời báo chung, không lộ chi tiết`, r.status >= 500 && r.status < 600 && typeof r.message === "string" && !JSON.stringify(r.body).includes("chi-tiet") && !/10\.9\.8\.7|km\.accounts/.test(JSON.stringify(r.body)), show(r));
  }
  const thrown = await withQueryError(null, () => api("me", {}, { token: user.token }));
  check("lỗi không có nội dung gì (null) → vẫn là một câu trả lời 5xx đúng dạng", thrown.status >= 500 && typeof thrown.code === "string" && typeof thrown.message === "string", show(thrown));
  const km = await withQueryError(dbError("KM403", "Bạn không có quyền làm việc này."), () => api("me", {}, { token: user.token }));
  check("lỗi do chính các hàm của ứng dụng báo (KM403) → 403 forbidden, giữ nguyên lời báo tiếng Việt", refused(km, 403, "forbidden") && km.message === "Bạn không có quyền làm việc này.", show(km));

  const health = await withQueryError(nodeError("EPIPE"), () => api("", {}, { method: "GET" }));
  check("tình trạng (GET) lúc đường truyền đứt: vẫn trả lời 200, ghi «unreachable», không lộ chi tiết", health.status === 200 && health.body.database === "unreachable" && !JSON.stringify(health.body).includes("chi-tiet"), show(health));
  const signInDown = await withQueryError(nodeError("ECONNRESET"), () => api("auth.signIn", { email: user.email, password: user.password }, { ip: freshIp() }));
  const signUpDown = await withQueryError(dbError("57P01"), () => api("auth.signUp", { email: "luc-su-co@example.com", password: "luc-su-co-1" }, { ip: freshIp() }));
  check("đăng nhập / đăng ký lúc database trục trặc → 503 unavailable (không phải «sai mật khẩu»)", refused(signInDown, 503, "unavailable") && refused(signUpDown, 503, "unavailable"), [show(signInDown), show(signUpDown)]);

  check("các lỗi giả lập trên không làm đổi gì trong database", before === (await stateDigest()));
  const after = await api("me", {}, { token: user.token });
  check("hết lỗi: lệnh chạy lại bình thường", ok(after) && after.result?.id === user.id, show(after));
});

await group("Kết nối mã hóa (TLS) tới database", async () => {
  // Database thật nằm ngoài Internet nên lớp API nối tới nó qua TLS; database thử thì mặc định không bật TLS. Nhóm này bật
  // TLS trên máy chủ database thử (ghi chứng chỉ vào thư mục dữ liệu của nó, sửa cấu hình rồi nạp lại) — chỉ làm với
  // database do chính bộ kiểm thử dựng bằng Docker, không bao giờ với một database có sẵn được giao cho.
  if (!THROWAWAY) {
    note("bỏ qua nhóm này: chỉ chạy với database dựng bằng Docker (npm run test:db, không đặt KM_TEST_DATABASE_URL)");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "km-test-tls-"));
  /** Tạo một chứng chỉ tự ký (dùng 3 ngày) bằng lệnh openssl của máy; null nếu không tạo được. */
  const makeCertificate = (name) => {
    const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3", "-subj", `/CN=${name}`, "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.crt`)], { encoding: "utf8" });
    return made.status === 0 ? { cert: readFileSync(join(dir, `${name}.crt`), "utf8"), key: readFileSync(join(dir, `${name}.key`), "utf8") } : null;
  };
  const server = makeCertificate("km-test-database");
  const stranger = makeCertificate("km-test-ca-khac");
  rmSync(dir, { recursive: true, force: true });
  if (!server || !stranger) {
    note("bỏ qua nhóm này: máy không có lệnh openssl để tạo chứng chỉ thử");
    return;
  }

  const user = await signUp("tls");
  const admin = await openSession(ADMIN_URL);
  const dataDir = (await admin.query("show data_directory")).rows[0].data_directory;
  /**
   * Ghi một file PEM vào thư mục dữ liệu của máy chủ database. File do chính tiến trình PostgreSQL tạo (đúng chủ) và chỉ
   * chủ đọc được (umask 077) — PostgreSQL không nhận file khóa mà người khác cũng đọc được.
   */
  const writeServerFile = (name, pem) =>
    admin.query(
      `copy (select line from unnest(string_to_array($km$${pem.trim()}$km$, chr(10))) as line) to program 'rm -f "${dataDir}/${name}" && umask 077 && cat > "${dataDir}/${name}"'`,
    );
  const tlsUrl = new URL(TEST_URL);
  tlsUrl.searchParams.delete("sslmode");
  /** Nối thử một kết nối có mã hóa (không kiểm tra chứng chỉ). */
  const canConnectWithTls = async () => {
    const client = new pg.Client({ connectionString: tlsUrl.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 2000 });
    client.on("error", () => {});
    try {
      await client.connect();
      return true;
    } catch {
      return false;
    } finally {
      await client.end().catch(() => {});
    }
  };
  /** Cho lớp API dùng một địa chỉ / chứng chỉ CA khác. */
  const pointApiAt = async (url, ca) => {
    await closeApi();
    process.env.DATABASE_URL = url;
    if (ca === undefined) delete process.env.DATABASE_CA;
    else process.env.DATABASE_CA = ca;
  };
  /** Các kết nối lớp API đang mở: có mã hóa hay không. */
  const apiEncrypted = async () => (await sql("select s.ssl from pg_stat_ssl s join pg_stat_activity a using (pid) where a.application_name = 'km-api'")).map((row) => row.ssl);
  const checkSetup = (url, ca) => spawnSync(process.execPath, [join(root, "server", "setup.mjs"), "--check"], { cwd: root, env: { ...process.env, DATABASE_URL: url, DATABASE_CA: ca, KM_SERVER: "" }, encoding: "utf8" });
  const quiet = (r) => !/certificate|self.signed|SSL|TLS|ECONN|127\.0\.0\.1/i.test(JSON.stringify(r.body));

  try {
    await writeServerFile("km-test-tls.crt", server.cert);
    await writeServerFile("km-test-tls.key", server.key);
    for (const statement of ["alter system set ssl_cert_file = 'km-test-tls.crt'", "alter system set ssl_key_file = 'km-test-tls.key'", "alter system set ssl = 'on'", "select pg_reload_conf()"]) await admin.query(statement);
    const tlsOn = await until(canConnectWithTls, 10_000, 200);
    check("bật được TLS trên máy chủ database thử", tlsOn);
    if (!tlsOn) return;

    await pointApiAt(tlsUrl.toString());
    const plainUrl = await api("me", {}, { token: user.token });
    check("địa chỉ không ghi sslmode: lớp API nối bằng kết nối CÓ mã hóa (không cần chứng chỉ CA)", ok(plainUrl) && isDeepStrictEqual(await apiEncrypted(), [true]), [show(plainUrl), await apiEncrypted()]);
    const healthTls = await api("", {}, { method: "GET" });
    check("…tình trạng (GET) qua TLS: database «ok»", healthTls.body.database === "ok", healthTls.body);

    await pointApiAt(tlsUrl.toString(), server.cert);
    const withCa = await api("me", {}, { token: user.token });
    check("có DATABASE_CA đúng: nối được, có mã hóa, chứng chỉ của máy chủ được kiểm tra theo CA đó", ok(withCa) && isDeepStrictEqual(await apiEncrypted(), [true]), [show(withCa), await apiEncrypted()]);
    const writeWithCa = await api("me.update", { fullName: "Qua TLS" }, { token: user.token });
    check("…và ghi dữ liệu qua kết nối đó bình thường", ok(writeWithCa) && writeWithCa.result?.fullName === "Qua TLS", show(writeWithCa));

    await pointApiAt(tlsUrl.toString(), stranger.cert);
    const wrongCa = await api("me", {}, { token: user.token });
    const wrongCaHealth = await api("", {}, { method: "GET" });
    const wrongCaSignIn = await api("auth.signIn", { email: user.email, password: user.password }, { ip: freshIp() });
    check(
      "DATABASE_CA là của một CA khác (máy chủ giả mạo): lớp API KHÔNG nối — 503 unavailable, tình trạng «unreachable», không gửi gì đi",
      refused(wrongCa, 503, "unavailable") && wrongCaHealth.body.database === "unreachable" && refused(wrongCaSignIn, 503, "unavailable") && (await apiEncrypted()).length === 0,
      [show(wrongCa), wrongCaHealth.body, show(wrongCaSignIn)],
    );
    check("…lời báo không lộ chi tiết về chứng chỉ hay địa chỉ database", quiet(wrongCa) && quiet(wrongCaHealth) && quiet(wrongCaSignIn), [wrongCa.body, wrongCaHealth.body]);

    await pointApiAt(tlsUrl.toString(), "đây không phải một chứng chỉ");
    const brokenCa = await api("me", {}, { token: user.token });
    check("DATABASE_CA không phải chứng chỉ hợp lệ: 503 unavailable (không sập, không âm thầm bỏ qua việc kiểm tra)", refused(brokenCa, 503, "unavailable") && (await apiEncrypted()).length === 0, show(brokenCa));

    await pointApiAt(TEST_URL);
    const disabled = await api("me", {}, { token: user.token });
    check("địa chỉ ghi sslmode=disable: nối không mã hóa (chỉ dành cho database ngay trên máy)", ok(disabled) && isDeepStrictEqual(await apiEncrypted(), [false]), [show(disabled), await apiEncrypted()]);

    const setupTls = checkSetup(tlsUrl.toString(), "");
    const setupCa = checkSetup(tlsUrl.toString(), server.cert);
    const setupWrongCa = checkSetup(tlsUrl.toString(), stranger.cert);
    check(
      "lệnh cài đặt (--check) chọn TLS cùng cách với lớp API: không CA → được; CA đúng → được; CA khác → dừng với mã thoát 1",
      setupTls.status === 0 && setupCa.status === 0 && setupWrongCa.status === 1,
      { noCa: setupTls.status, ca: setupCa.status, wrongCa: setupWrongCa.status, out: (setupWrongCa.stdout + setupWrongCa.stderr).slice(-200) },
    );
  } finally {
    for (const statement of ["alter system reset ssl", "alter system reset ssl_cert_file", "alter system reset ssl_key_file", "select pg_reload_conf()"]) await admin.query(statement).catch(() => {});
    await until(async () => !(await canConnectWithTls()), 10_000, 200);
    await admin.query(`copy (select 1) to program 'cat > /dev/null; rm -f "${dataDir}/km-test-tls.crt" "${dataDir}/km-test-tls.key"'`).catch(() => {});
    await pointApiAt(TEST_URL);
    await admin.end().catch(() => {});
  }

  // Máy chủ database không bật TLS mà địa chỉ lại không ghi sslmode=disable.
  try {
    await pointApiAt(tlsUrl.toString());
    const noTls = await api("me", {}, { token: user.token });
    const noTlsHealth = await api("", {}, { method: "GET" });
    check("database không bật TLS, địa chỉ không ghi sslmode=disable: lớp API không tự hạ xuống kết nối không mã hóa — 503 unavailable, «unreachable»", refused(noTls, 503, "unavailable") && noTlsHealth.body.database === "unreachable", [show(noTls), noTlsHealth.body]);
  } finally {
    await pointApiAt(TEST_URL);
  }
  const back = await api("me", {}, { token: user.token });
  check("trả cấu hình về như cũ: mọi thứ chạy lại bình thường", ok(back) && back.result?.fullName === "Qua TLS", show(back));
});

// ───────────────────────── Tổng kết ─────────────────────────

clearTimeout(watchdog);
const good = summary("Kiểm thử lớp máy chủ (API + database)");
await closeApi();
await closeDatabase();
process.exit(good ? 0 : 1);
