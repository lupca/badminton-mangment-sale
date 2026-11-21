// Kiểm thử bộ đồng bộ (src/lib/cloud/sync.ts + remote.ts) với một Supabase THẬT đang chạy cục bộ:
// hai «trình duyệt» (một quản lý, một sale) cùng làm việc, thay đổi của người này phải tới người kia.
//
// Chạy:  npx supabase start   (một lần)   rồi   npx tsx supabase/tests/sync.live.test.ts
// Dùng Supabase nào: xem stack.mjs (mặc định là bản đang chạy trên máy).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseRemote } from "../../src/lib/cloud/remote";
import { SyncEngine } from "../../src/lib/cloud/sync";
import { normalizeOrder, normalizeProgram, normalizeSettings, normalizeStock } from "../../src/lib/store";
import type { DB, Order, Program } from "../../src/types";
import { stack } from "./stack.mjs";

const { url: URL, key: KEY, secret: SECRET } = stack();

const tag = `sync${Date.now().toString(36)}`;
// Mã hàng được chuẩn hóa thành chữ hoa.
const SKU = `${tag.toUpperCase()}-SKU`;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(URL, SECRET, options);

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
    await sleep(50);
  }
  return test();
}

// Thay đổi tới máy kia bằng hai đường: Realtime (nhanh, có thể rớt tín hiệu) và lần hỏi định kỳ (chậm hơn, chắc chắn).
// Kiểm thử chờ Realtime vài giây; chưa thấy thì gọi luôn lần hỏi định kỳ thay vì chờ tới giờ — và đếm số lần phải làm vậy.
let viaRealtime = 0;
let viaPolling = 0;
async function arrives(receiver: { engine: SyncEngine }, test: () => boolean): Promise<boolean> {
  if (await until(test, 4000)) {
    viaRealtime += 1;
    return true;
  }
  receiver.engine.requestPull();
  if (await until(test, 6000)) {
    viaPolling += 1;
    return true;
  }
  return false;
}

async function signUp(name: string): Promise<{ sb: SupabaseClient; id: string }> {
  const sb = createClient(URL, KEY, options);
  const { data, error } = await sb.auth.signUp({
    email: `${tag}-${name}@example.com`,
    password: "matkhau-thu",
    options: { data: { full_name: name, phone: "0900 000 000" } },
  });
  if (error || !data.user || !data.session) throw new Error(`Không đăng ký được ${name}: ${error?.message ?? "không có phiên"}`);
  return { sb, id: data.user.id };
}

/** Một «trình duyệt»: dữ liệu trên máy + bộ đồng bộ, như CloudStoreProvider. */
function browser(sb: SupabaseClient, role: "manager" | "sale") {
  let db: DB = {
    version: 1,
    programs: [],
    orders: [],
    stock: { bySku: {}, updatedAt: null },
    settings: { role, salesperson: "", salespersonPhone: "", lowStockThreshold: 5 },
  };
  const notes: string[] = [];
  let state = "idle";
  const engine = new SyncEngine(supabaseRemote(sb), {
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
  };
}

const now = () => new Date().toISOString();
const newProgram = (id: string, name: string): Program => normalizeProgram({ id, name, brand: "Thử", createdAt: now(), updatedAt: now() });
const newOrder = (id: string, programId: string, extra: Partial<Order> = {}): Order =>
  normalizeOrder({ id, code: "", programId, status: "draft", createdAt: now(), updatedAt: now(), ...extra });

const userIds: string[] = [];
const programIds: string[] = [];

async function main(): Promise<void> {
  const m = await signUp("quanly");
  const s = await signUp("sale");
  userIds.push(m.id, s.id);
  for (const [id, role] of [
    [m.id, "manager"],
    [s.id, "sale"],
  ] as const) {
    const { error } = await admin.from("profiles").update({ role }).eq("id", id);
    if (error) throw new Error(`Không đặt được vai trò: ${error.message}`);
  }

  const manager = browser(m.sb, "manager");
  const sale = browser(s.sb, "sale");
  await manager.engine.start();
  await sale.engine.start();
  check("both browsers load", true);
  // Kênh Realtime cần vài giây sau khi đăng ký mới thật sự phát thay đổi.
  await sleep(5000);

  // ── Quản lý tạo chương trình → sale thấy ──
  const pid = `${tag}-p1`;
  programIds.push(pid);
  manager.edit((db) => ({ ...db, programs: [newProgram(pid, "Chương trình thử"), ...db.programs] }));
  check("manager: new program is saved", await manager.saved(), manager.state);
  check("sale: sees the new program without reloading", await arrives(sale, () => sale.program(pid) !== undefined));

  manager.edit((db) => ({ ...db, programs: db.programs.map((p) => (p.id === pid ? { ...p, name: "Chương trình thử (đã sửa)" } : p)) }));
  await manager.saved();
  check("sale: sees the program edit", await arrives(sale, () => sale.program(pid)?.name === "Chương trình thử (đã sửa)"), sale.program(pid)?.name);

  // ── Sale không sửa được chương trình ──
  sale.edit((db) => ({ ...db, programs: db.programs.map((p) => (p.id === pid ? { ...p, name: "Sale tự sửa" } : p)) }));
  check("sale: program edit is reverted", await until(() => sale.program(pid)?.name === "Chương trình thử (đã sửa)" && sale.state === "idle"), sale.program(pid)?.name);
  check("sale: is told the edit was not allowed", sale.notes.some((n) => n.includes("không được sửa")), sale.notes);
  sale.notes.length = 0;

  // ── Sale tạo đơn → mã do máy chủ cấp, quản lý thấy ──
  const o1 = await sale.engine.createOrder(newOrder(`${tag}-o1`, pid, { customerName: "Đại lý A", salesperson: "sale" }));
  check("sale: order gets a server code", /^DH\d{6}-\d{3,}$/.test(o1.code), o1.code);
  check("manager: sees the sale's order", await arrives(manager, () => manager.order(o1.id) !== undefined));
  const o2 = await manager.engine.createOrder(newOrder(`${tag}-o2`, pid, { customerName: "Đại lý B", salesperson: "quanly" }));
  check("manager: own order gets the next code", o2.code !== o1.code && o2.code.slice(0, 9) === o1.code.slice(0, 9), [o1.code, o2.code]);
  await sleep(1200);
  check("sale: does NOT see the manager's order", sale.order(o2.id) === undefined);

  // ── Sửa đơn hai chiều ──
  sale.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o1.id ? { ...o, note: "giao buổi sáng" } : o)) }));
  await sale.saved();
  check("manager: sees the sale's edit", await arrives(manager, () => manager.order(o1.id)?.note === "giao buổi sáng"), manager.order(o1.id)?.note);
  manager.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o1.id ? { ...o, note: "quản lý đã xem" } : o)) }));
  await manager.saved();
  check("sale: sees the manager's edit", await arrives(sale, () => sale.order(o1.id)?.note === "quản lý đã xem"), sale.order(o1.id)?.note);
  check("order code never changes", manager.order(o1.id)?.code === o1.code && sale.order(o1.id)?.code === o1.code);

  // ── Hai người sửa cùng một đơn cùng lúc: không ai bị ghi đè âm thầm ──
  manager.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o1.id ? { ...o, customerPhone: "0911" } : o)) }));
  sale.edit((db) => ({ ...db, orders: db.orders.map((o) => (o.id === o1.id ? { ...o, customerPhone: "0922" } : o)) }));
  await manager.saved();
  await sale.saved();
  if (!(await until(() => manager.order(o1.id)?.customerPhone === sale.order(o1.id)?.customerPhone, 4000))) {
    manager.engine.requestPull();
    sale.engine.requestPull();
    await until(() => manager.order(o1.id)?.customerPhone === sale.order(o1.id)?.customerPhone, 6000);
  }
  const phones = [manager.order(o1.id)?.customerPhone, sale.order(o1.id)?.customerPhone];
  check("simultaneous edits: both browsers end with the same value", phones[0] === phones[1] && (phones[0] === "0911" || phones[0] === "0922"), phones);
  check("simultaneous edits: the loser is told", manager.notes.length + sale.notes.length === 1, { manager: manager.notes, sale: sale.notes });
  manager.notes.length = 0;
  sale.notes.length = 0;

  // ── Tồn kho và ngưỡng cảnh báo ──
  manager.edit((db) => ({ ...db, stock: { bySku: { [SKU]: 3 }, updatedAt: now() }, settings: { ...db.settings, lowStockThreshold: 9 } }));
  await manager.saved();
  check("sale: sees the new stock", await arrives(sale, () => sale.db.stock.bySku[SKU] === 3), sale.db.stock.bySku);
  check("sale: sees the new low-stock threshold", await arrives(sale, () => sale.db.settings.lowStockThreshold === 9), sale.db.settings.lowStockThreshold);
  sale.edit((db) => ({ ...db, stock: { bySku: { [SKU]: 999 }, updatedAt: now() } }));
  check("sale: stock edit is reverted", await until(() => sale.db.stock.bySku[SKU] === 3 && sale.state === "idle"), sale.db.stock.bySku);
  check("sale: is told the stock edit was not allowed", sale.notes.some((n) => n.includes("không được sửa tồn kho")), sale.notes);
  sale.notes.length = 0;

  // ── Không xóa được chương trình còn đơn ──
  manager.edit((db) => ({ ...db, programs: db.programs.filter((p) => p.id !== pid) }));
  check("manager: program with orders comes back", await until(() => manager.program(pid) !== undefined && manager.state === "idle"));
  check("manager: is told why", manager.notes.some((n) => n.includes("đơn hàng thuộc chương trình")), manager.notes);
  manager.notes.length = 0;

  // ── Xóa đơn ──
  manager.edit((db) => ({ ...db, orders: db.orders.filter((o) => o.id !== o1.id) }));
  await manager.saved();
  check("sale: order deleted by the manager disappears", await arrives(sale, () => sale.order(o1.id) === undefined));

  // ── Nhiều đơn hơn một trang của máy chủ (1000 dòng): vẫn tải đủ ──
  const many = Array.from({ length: 1050 }, (_, i) => {
    const id = `${tag}-bulk-${String(i).padStart(4, "0")}`;
    return { id, owner_id: s.id, data: newOrder(id, pid, { code: `BULK-${i}` }) };
  });
  for (let at = 0; at < many.length; at += 500) {
    const { error } = await admin.from("orders").insert(many.slice(at, at + 500));
    if (error) throw new Error(`Không thêm được đơn hàng loạt: ${error.message}`);
  }
  const fresh = browser(m.sb, "manager");
  await fresh.engine.start();
  const bulkLoaded = fresh.db.orders.filter((o) => o.id.startsWith(`${tag}-bulk-`)).length;
  check("a fresh browser loads all 1050 orders (more than one server page)", bulkLoaded === 1050, bulkLoaded);
  // Ghi hàng loạt làm Realtime vượt giới hạn tín hiệu mỗi giây và bỏ bớt tín hiệu — lần hỏi định kỳ phải bù đủ.
  sale.engine.requestPull();
  check("existing sale browser picks them up too", await until(() => sale.db.orders.filter((o) => o.id.startsWith(`${tag}-bulk-`)).length === 1050, 15000), sale.db.orders.length);
  fresh.engine.dispose();

  // ── Tài khoản bị khóa: không còn thấy gì ──
  await admin.from("profiles").update({ role: "locked" }).eq("id", s.id);
  sale.engine.requestPull();
  check("locked account: local data empties on the next pull", await until(() => sale.db.programs.length === 0 && sale.db.orders.length === 0, 10000), {
    programs: sale.db.programs.length,
    orders: sale.db.orders.length,
  });

  manager.engine.dispose();
  sale.engine.dispose();
}

async function cleanup(): Promise<void> {
  await admin.from("orders").delete().like("id", `${tag}-%`);
  for (const id of programIds) await admin.from("programs").delete().eq("id", id);
  await admin.from("app_state").update({ data: { bySku: {}, updatedAt: null } }).eq("key", "stock");
  await admin.from("app_state").update({ data: { lowStockThreshold: 5 } }).eq("key", "settings");
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
}

main()
  .catch((error) => {
    failed += 1;
    console.log(`FAIL  the test crashed  →  ${error instanceof Error ? error.stack : String(error)}`);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.log(`(dọn dẹp lỗi: ${error instanceof Error ? error.message : error})`));
    console.log(`\nThay đổi tới máy kia: ${viaRealtime} lần qua Realtime, ${viaPolling} lần nhờ hỏi lại máy chủ.`);
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
