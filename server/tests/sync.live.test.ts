// Kiểm thử bộ đồng bộ của trình duyệt (src/lib/cloud/sync.ts + remote.ts + api.ts) với máy chủ THẬT: lớp API chạy qua HTTP,
// nối vào một PostgreSQL thật. Hai «trình duyệt» (một quản lý, một sale) cùng làm việc; thay đổi của người này phải tới
// người kia, và máy chủ phải chặn những việc không được phép.
//
// Chạy:  npm run test:db   (tự dựng một PostgreSQL tạm bằng Docker — xem run.mjs)
// Bài này XÓA SẠCH dữ liệu của database nó nối vào, nên chỉ nhận database chạy ngay trên máy (KM_TEST_DATABASE_URL).
import pg from "pg";
import { createApiClient, type ApiClient } from "../../src/lib/cloud/api";
import { httpRemote, type PollInfo } from "../../src/lib/cloud/remote";
import { SYNC_TIMING, SyncEngine } from "../../src/lib/cloud/sync";
import { normalizeOrder, normalizeProgram, normalizeSettings, normalizeStock } from "../../src/lib/store";
import type { DB, Order, Program } from "../../src/types";

const DATABASE_URL = process.env.KM_TEST_DATABASE_URL ?? "";
function localOnly(url: string): void {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    // để trống → từ chối
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(
      "Bài kiểm thử này xóa sạch dữ liệu, nên chỉ chạy với database trên chính máy này.\n" +
        "Hãy chạy bằng `npm run test:db` (tự dựng database tạm), hoặc đặt KM_TEST_DATABASE_URL trỏ tới localhost.",
    );
    process.exit(2);
  }
}
localOnly(DATABASE_URL);

// Lớp API đọc DATABASE_URL lúc có yêu cầu đầu tiên; giữ kết nối giữa các yêu cầu cho nhanh.
process.env.DATABASE_URL = DATABASE_URL;
process.env.KM_KEEP_POOL = "1";
const { startApiServer } = await import("../node.js");
const { closePool } = await import("../app.js");

// Không có kênh báo thay đổi tức thời: việc của người khác tới nhờ nhịp hỏi định kỳ. Rút ngắn nhịp cho bài thử chạy nhanh.
SYNC_TIMING.pollOfflineMs = 700;
SYNC_TIMING.debounceMs = 100;

const tag = `sync${Date.now().toString(36)}`;
// Mã hàng được chuẩn hóa thành chữ hoa.
const SKU = `${tag.toUpperCase()}-SKU`;
const PASSWORD = "matkhau-thu";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  →  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chờ tới khi `test()` đúng (tối đa `ms`). */
async function until(test: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(40);
  }
  return test();
}

interface Account {
  api: ApiClient;
  id: string;
  email: string;
  unauthorized: number;
}

async function signUp(apiUrl: string, name: string): Promise<Account> {
  const api = createApiClient({ url: apiUrl, storage: null });
  const email = `${tag}-${name}@example.com`;
  const { token, profile } = await api.call<{ token: string; profile: { id: string } }>("auth.signUp", {
    email,
    password: PASSWORD,
    fullName: name,
    phone: "0900 000 000",
  });
  api.setToken(token);
  const account: Account = { api, id: profile.id, email, unauthorized: 0 };
  api.onUnauthorized(() => (account.unauthorized += 1));
  return account;
}

/** Một «trình duyệt»: dữ liệu trên máy + bộ đồng bộ, như CloudStoreProvider. */
function browser(api: ApiClient, role: "manager" | "sale") {
  let db: DB = {
    version: 1,
    programs: [],
    orders: [],
    stock: { bySku: {}, updatedAt: null },
    settings: { role, salesperson: "", salespersonPhone: "", lowStockThreshold: 5 },
  };
  const notes: string[] = [];
  const polls: PollInfo[] = [];
  let state = "idle";
  const engine = new SyncEngine(httpRemote(api, { onPoll: (info) => polls.push(info) }), {
    get: () => db,
    apply(fn) {
      db = fn(db);
    },
    onStatus: (status) => (state = status.state),
    notify: (message) => notes.push(message),
    normalize: {
      program: normalizeProgram,
      order: normalizeOrder,
      stock: normalizeStock,
      threshold: (raw) => normalizeSettings(raw).lowStockThreshold,
    },
  });
  return {
    engine,
    notes,
    polls,
    get db() {
      return db;
    },
    get state() {
      return state;
    },
    edit(fn: (db: DB) => DB) {
      db = fn(db);
      engine.localChanged();
    },
    program: (id: string) => db.programs.find((p) => p.id === id),
    order: (id: string) => db.orders.find((o) => o.id === id),
    saved: () => until(() => state === "idle"),
    lastRole: () => (polls[polls.length - 1]?.me as { role?: string } | null)?.role,
  };
}

const now = () => new Date().toISOString();
const newProgram = (id: string, name: string): Program => normalizeProgram({ id, name, brand: "Thử", createdAt: now(), updatedAt: now() });
const newOrder = (id: string, programId: string, extra: Partial<Order> = {}): Order =>
  normalizeOrder({ id, code: "", programId, status: "draft", createdAt: now(), updatedAt: now(), ...extra });

const sql = new pg.Client({ connectionString: DATABASE_URL.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""), ssl: false });
const disposables: Array<{ engine: SyncEngine }> = [];
let server: { url: string; close(): Promise<void> } | null = null;

async function main(): Promise<void> {
  await sql.connect();
  // Bắt đầu từ một hệ thống trống: tài khoản đăng ký đầu tiên phải là quản lý.
  await sql.query("truncate km.accounts, km.sessions, km.auth_events, km.programs, km.orders, km.order_counters, km.app_state");
  await sql.query(
    `insert into km.app_state (key, data) values ('stock', '{"bySku": {}, "updatedAt": null}'::jsonb), ('settings', '{"lowStockThreshold": 5}'::jsonb)`,
  );

  server = await startApiServer(0);
  const m = await signUp(server.url, "quanly");
  const s = await signUp(server.url, "sale");
  const s2 = await signUp(server.url, "sale2");
  const roleOf = async (account: Account) => (await account.api.call<{ role: string }>("me")).role;
  check("first account is the manager, later ones wait for approval", (await roleOf(m)) === "manager" && (await roleOf(s)) === "pending", [await roleOf(m), await roleOf(s)]);

  // Tài khoản chờ duyệt chưa tải được gì.
  const waiting = browser(s.api, "sale");
  let refused = "";
  await waiting.engine.start().catch((error: Error) => (refused = `${error.name}: ${error.message}`));
  waiting.engine.dispose();
  check("pending account: the first load is refused", refused.startsWith("RemoteError") && refused.includes("chưa được duyệt"), refused);

  await m.api.call("accounts.setRole", { id: s.id, role: "sale" });
  await m.api.call("accounts.setRole", { id: s2.id, role: "sale" });

  const manager = browser(m.api, "manager");
  const sale = browser(s.api, "sale");
  disposables.push(manager, sale);
  await manager.engine.start();
  await sale.engine.start();
  check("both browsers load", manager.db.programs.length === 0 && sale.db.orders.length === 0);

  // ── Quản lý tạo chương trình → sale thấy (nhờ nhịp hỏi định kỳ của chính bộ đồng bộ) ──
  const pid = `${tag}-p1`;
  manager.edit((db) => ({ ...db, programs: [newProgram(pid, "Chương trình thử"), ...db.programs] }));
  check("manager: new program is saved", await manager.saved(), manager.state);
  check("sale: sees the new program without reloading", await until(() => sale.program(pid) !== undefined));

  manager.edit((db) => ({ ...db, programs: db.programs.map((p) => (p.id === pid ? { ...p, name: "Chương trình thử (đã sửa)" } : p)) }));
  await manager.saved();
  check("sale: sees the program edit", await until(() => sale.program(pid)?.name === "Chương trình thử (đã sửa)"), sale.program(pid)?.name);

  // ── Sale không sửa được chương trình ──
  sale.edit((db) => ({ ...db, programs: db.programs.map((p) => (p.id === pid ? { ...p, name: "Sale tự sửa" } : p)) }));
  check("sale: program edit is reverted", await until(() => sale.program(pid)?.name === "Chương trình thử (đã sửa)" && sale.state === "idle"), sale.program(pid)?.name);
  check("sale: is told why, in the server's words", sale.notes.some((n) => n.includes("Chỉ người quản lý mới sửa được chương trình")), sale.notes);
  sale.notes.length = 0;
  sale.edit((db) => ({ ...db, programs: [newProgram(`${tag}-p-sale`, "Sale tự tạo"), ...db.programs] }));
  check("sale: a program it creates is removed again", await until(() => sale.program(`${tag}-p-sale`) === undefined && sale.state === "idle"));
  check("sale: is told it cannot create programs", sale.notes.some((n) => n.includes("Chỉ người quản lý mới tạo được chương trình")), sale.notes);
  sale.notes.length = 0;

  // ── Sale tạo đơn → mã do máy chủ cấp, quản lý thấy ──
  const o1 = await sale.engine.createOrder(newOrder(`${tag}-o1`, pid, { customerName: "Đại lý A", salesperson: "sale" }));
  check("sale: order gets a server code", /^DH\d{6}-\d{3,}$/.test(o1.code), o1.code);
  check("manager: sees the sale's order", await until(() => manager.order(o1.id) !== undefined));
  const o2 = await manager.engine.createOrder(newOrder(`${tag}-o2`, pid, { customerName: "Đại lý B", salesperson: "quanly" }));
  check("manager: own order gets the next code", o2.code !== o1.code && o2.code.slice(0, 9) === o1.code.slice(0, 9), [o1.code, o2.code]);
  await sleep(SYNC_TIMING.pollOfflineMs * 3);
  check("sale: does NOT see the manager's order", sale.order(o2.id) === undefined);

  // Đơn thêm qua đường thường (không phải «tạo đơn»), chưa có mã: máy chủ cấp mã và máy nhận lại mã đó.
  const o3id = `${tag}-o3`;
  sale.edit((db) => ({ ...db, orders: [newOrder(o3id, pid, { customerName: "Đại lý C" }), ...db.orders] }));
  await sale.saved();
  check("sale: an order synced without a code receives the server's code", /^DH\d{6}-\d{3,}$/.test(sale.order(o3id)?.code ?? ""), sale.order(o3id)?.code);

  // ── Sửa đơn hai chiều ──
  sale.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o1.id ? { ...o, note: "giao buổi sáng" } : o)) }));
  await sale.saved();
  check("manager: sees the sale's edit", await until(() => manager.order(o1.id)?.note === "giao buổi sáng"), manager.order(o1.id)?.note);
  manager.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o1.id ? { ...o, note: "quản lý đã xem" } : o)) }));
  await manager.saved();
  check("sale: sees the manager's edit", await until(() => sale.order(o1.id)?.note === "quản lý đã xem"), sale.order(o1.id)?.note);
  check("order code never changes", manager.order(o1.id)?.code === o1.code && sale.order(o1.id)?.code === o1.code);

  // ── Hai người sửa cùng một đơn cùng lúc: không ai bị ghi đè âm thầm ──
  manager.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o1.id ? { ...o, customerPhone: "0911" } : o)) }));
  sale.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o1.id ? { ...o, customerPhone: "0922" } : o)) }));
  await manager.saved();
  await sale.saved();
  await until(() => manager.order(o1.id)?.customerPhone === sale.order(o1.id)?.customerPhone);
  const phones = [manager.order(o1.id)?.customerPhone, sale.order(o1.id)?.customerPhone];
  check("simultaneous edits: both browsers end with the same value", phones[0] === phones[1] && (phones[0] === "0911" || phones[0] === "0922"), phones);
  check("simultaneous edits: the loser is told", manager.notes.length + sale.notes.length === 1, { manager: manager.notes, sale: sale.notes });
  manager.notes.length = 0;
  sale.notes.length = 0;

  // ── Tồn kho và ngưỡng cảnh báo ──
  manager.edit((db) => ({ ...db, stock: { bySku: { [SKU]: 3 }, updatedAt: now() }, settings: { ...db.settings, lowStockThreshold: 9 } }));
  await manager.saved();
  check("sale: sees the new stock", await until(() => sale.db.stock.bySku[SKU] === 3), sale.db.stock.bySku);
  check("sale: sees the new low-stock threshold", await until(() => sale.db.settings.lowStockThreshold === 9), sale.db.settings.lowStockThreshold);
  sale.edit((db) => ({ ...db, stock: { bySku: { [SKU]: 999 }, updatedAt: now() } }));
  check("sale: stock edit is reverted", await until(() => sale.db.stock.bySku[SKU] === 3 && sale.state === "idle"), sale.db.stock.bySku);
  check("sale: is told the stock edit was not allowed", sale.notes.some((n) => n.includes("Chỉ người quản lý mới sửa được tồn kho")), sale.notes);
  sale.notes.length = 0;

  // ── Không xóa được chương trình còn đơn ──
  manager.edit((db) => ({ ...db, programs: db.programs.filter((p) => p.id !== pid) }));
  check("manager: program with orders comes back", await until(() => manager.program(pid) !== undefined && manager.state === "idle"));
  check("manager: is told why", manager.notes.some((n) => n.includes("đơn hàng thuộc chương trình")), manager.notes);
  manager.notes.length = 0;

  // ── Xóa đơn ──
  manager.edit((db) => ({ ...db, orders: db.orders.filter((o) => o.id !== o1.id) }));
  await manager.saved();
  check("sale: order deleted by the manager disappears", await until(() => sale.order(o1.id) === undefined));

  // ── Lần hỏi định kỳ mang theo hồ sơ và (với quản lý) tình hình tài khoản ──
  await until(() => manager.polls.length > 0 && sale.polls.length > 0);
  const managerPoll = manager.polls[manager.polls.length - 1];
  check("poll: the manager learns its role and the account list state", manager.lastRole() === "manager" && managerPoll.accounts?.pending === 0 && typeof managerPoll.accounts?.stamp === "string", managerPoll);
  check("poll: a sale learns its role and nothing about other accounts", sale.lastRole() === "sale" && sale.polls[sale.polls.length - 1].accounts === null);
  const stampBefore = managerPoll.accounts?.stamp;
  const late = await signUp(server.url, "den-sau");
  check(
    "poll: a new sign-up shows up as a pending account and a new stamp",
    await until(() => {
      const last = manager.polls[manager.polls.length - 1]?.accounts;
      return last?.pending === 1 && last.stamp !== stampBefore;
    }),
    manager.polls[manager.polls.length - 1]?.accounts,
  );
  void late;

  // ── Nhiều đơn hơn một trang của máy chủ (200 dòng): vẫn tải đủ ──
  await sql.query(
    `insert into km.orders (id, owner_id, data)
     select $1 || '-bulk-' || lpad(i::text, 4, '0'), $2::uuid,
            jsonb_build_object('id', $1 || '-bulk-' || lpad(i::text, 4, '0'), 'code', 'BULK-' || i, 'programId', $3::text, 'status', 'draft',
                               'createdAt', now(), 'updatedAt', now())
       from generate_series(0, 1049) as i`,
    [tag, s.id, pid],
  );
  const fresh = browser(m.api, "manager");
  disposables.push(fresh);
  await fresh.engine.start();
  const bulkLoaded = fresh.db.orders.filter((o) => o.id.startsWith(`${tag}-bulk-`)).length;
  check("a fresh browser loads all 1050 orders (several server pages)", bulkLoaded === 1050, bulkLoaded);
  check("an open sale browser picks them up on its next poll", await until(() => sale.db.orders.filter((o) => o.id.startsWith(`${tag}-bulk-`)).length === 1050, 15000), sale.db.orders.length);
  const sale2 = browser(s2.api, "sale");
  disposables.push(sale2);
  await sale2.engine.start();
  check("another sale sees none of them", sale2.db.orders.length === 0 && sale2.db.programs.length === 1, { orders: sale2.db.orders.length, programs: sale2.db.programs.length });
  fresh.engine.dispose();

  // ── Tài liệu nặng: máy chủ chia trang theo dung lượng, máy vẫn nhận đủ ──
  await sql.query(
    `insert into km.programs (id, data)
     select $1 || '-big-' || i, jsonb_build_object('id', $1 || '-big-' || i, 'name', 'Nặng ' || i, 'pad', repeat('x', 1200000),
                                                 'createdAt', now(), 'updatedAt', now())
       from generate_series(1, 5) as i`,
    [tag],
  );
  check("five 1.2 MB documents all arrive (more than one response can hold)", await until(() => sale2.db.programs.filter((p) => p.id.startsWith(`${tag}-big-`)).length === 5, 20000), sale2.db.programs.map((p) => p.id));
  await sql.query("delete from km.programs where id like $1", [`${tag}-big-%`]);
  check("…and disappear again when deleted on the server", await until(() => sale2.db.programs.length === 1, 10000), sale2.db.programs.length);

  // ── Đổi vai trò: sale thành quản lý thì thấy hết ──
  await m.api.call("accounts.setRole", { id: s2.id, role: "manager" });
  check("promoted to manager: the poll reports the new role", await until(() => sale2.lastRole() === "manager"), sale2.lastRole());
  sale2.engine.requestPull();
  check("promoted to manager: now sees every order", await until(() => sale2.db.orders.length === manager.db.orders.length && sale2.db.orders.length >= 1050, 15000), [sale2.db.orders.length, manager.db.orders.length]);

  // ── Tài khoản bị khóa: lần hỏi kế tiếp báo vai trò mới, và không ghi được gì nữa ──
  await m.api.call("accounts.setRole", { id: s.id, role: "locked" });
  check("locked account: the next poll reports it", await until(() => sale.lastRole() === "locked"), sale.lastRole());
  const before = sale.order(o3id)?.note;
  sale.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o3id ? { ...o, note: "sửa sau khi bị khóa" } : o)) }));
  check("locked account: an edit is refused and reverted", await until(() => sale.order(o3id)?.note === before && sale.state === "idle"), sale.order(o3id)?.note);
  check("locked account: is told why", sale.notes.some((n) => n.includes("chưa được duyệt hoặc đã bị khóa")), sale.notes);
  const stored = await sql.query("select data ->> 'note' as note from km.orders where id = $1", [o3id]);
  check("locked account: nothing changed on the server", (stored.rows[0]?.note ?? "") === (before ?? ""), stored.rows[0]);
  sale.notes.length = 0;

  // ── Quản lý đặt lại mật khẩu: phiên đang mở của người kia hết hiệu lực, thay đổi của họ được giữ lại chờ đăng nhập ──
  await m.api.call("accounts.setRole", { id: s.id, role: "sale" });
  await until(() => sale.lastRole() === "sale");
  await m.api.call("accounts.setPassword", { id: s.id, newPassword: "mat-khau-moi" });
  sale.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o3id ? { ...o, note: "sửa khi phiên đã hết hạn" } : o)) }));
  check("signed out by a password reset: the app is told the session is gone", await until(() => s.unauthorized > 0), s.unauthorized);
  check("signed out by a password reset: the edit is kept for retry, not thrown away", await until(() => sale.state === "retrying") && sale.order(o3id)?.note === "sửa khi phiên đã hết hạn", sale.state);
  check("signed out by a password reset: nobody is blamed", sale.notes.length === 0, sale.notes);
  // Đăng nhập lại bằng mật khẩu mới (cùng trình duyệt): thay đổi đang chờ được gửi đi.
  const again = await s.api.call<{ token: string }>("auth.signIn", { email: s.email, password: "mat-khau-moi" });
  s.api.setToken(again.token);
  check("after signing in again the pending edit is saved", (await sale.engine.flushNow()) && sale.state === "idle", sale.state);
  const kept = await sql.query("select data ->> 'note' as note from km.orders where id = $1", [o3id]);
  check("…and is on the server", kept.rows[0]?.note === "sửa khi phiên đã hết hạn", kept.rows[0]);
}

main()
  .catch((error) => {
    failed += 1;
    console.log(`FAIL  the test crashed  →  ${error instanceof Error ? error.stack : String(error)}`);
  })
  .finally(async () => {
    for (const item of disposables) item.engine.dispose();
    await server?.close().catch(() => {});
    await closePool();
    await sql.end().catch(() => {});
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
