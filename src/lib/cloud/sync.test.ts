// Bộ đồng bộ chạy với một máy chủ giả trong bộ nhớ: có `rev`, cấp mã đơn, từ chối theo quyền, giả lập mất mạng,
// và một «người khác» sửa dữ liệu ngay trên máy chủ.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB, Order, Program } from "../../types";
import { normalizeOrder, normalizeProgram, normalizeSettings, normalizeStock } from "../store";
import type { SyncStatus } from "../syncStatus";
import { RemoteError, fingerprintOf, type DocTable, type ListTable, type Remote, type RemoteEvent } from "./remote";
import { SYNC_TIMING, SyncEngine, sameJson } from "./sync";

// ───────────────────────── Máy chủ giả ─────────────────────────

interface Row {
  rev: number;
  data: any;
}

class FakeServer implements Remote {
  tables: Record<DocTable, Map<string, Row>> = {
    programs: new Map(),
    orders: new Map(),
    app_state: new Map<string, Row>([
      ["stock", { rev: 1, data: { bySku: {}, updatedAt: null } }],
      ["settings", { rev: 1, data: { lowStockThreshold: 5 } }],
    ]),
  };
  /** Nhật ký các lệnh gọi, vd "update orders/o1". */
  calls: string[] = [];
  offline = false;
  /** Bảng mà tài khoản này không được ghi (máy chủ thật: RLS). */
  readOnly = new Set<DocTable>();
  /** Lệnh ghi kế tiếp vẫn được máy chủ thực hiện nhưng phản hồi bị mất (rớt mạng giữa chừng). */
  loseNextResponse = false;
  /** Số lệnh ghi đang chạy cùng lúc, và mức cao nhất từng thấy. */
  running = 0;
  maxRunning = 0;
  /** Khác null: mọi lệnh ghi chờ tới khi được thả (để giả lập yêu cầu đang bay). */
  gate: Promise<void> | null = null;
  /** Tài khoản là sale: máy chủ tự cấp mã cho mọi đơn mới, kể cả đơn gửi lên kèm mã. */
  assignsEveryCode = false;
  /** Máy chủ có hàm so dấu vân tay hay không (mặc định không: các kiểm thử cũ đi đường so danh sách id + rev). */
  supportsFingerprints = false;
  private orderSeq = 0;
  private listener: ((event: RemoteEvent) => void) | null = null;
  private liveListener: ((live: boolean) => void) | null = null;

  private check(): void {
    if (this.offline) throw new RemoteError("network", "Không kết nối được máy chủ.");
  }

  private async write<T>(name: string, work: () => T): Promise<T> {
    this.calls.push(name);
    this.running += 1;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      await Promise.resolve();
      if (this.gate) await this.gate;
      this.check();
      const result = work();
      if (this.loseNextResponse) {
        this.loseNextResponse = false;
        throw new RemoteError("network", "Mất phản hồi.");
      }
      return result;
    } finally {
      this.running -= 1;
    }
  }

  async fingerprints() {
    if (!this.supportsFingerprints) return null;
    this.calls.push("fingerprints");
    this.check();
    const of = (table: DocTable) => fingerprintOf([...this.tables[table]].map(([id, row]) => ({ id, rev: row.rev })));
    return { programs: (await of("programs"))!, orders: (await of("orders"))!, app_state: (await of("app_state"))! };
  }

  async heads(table: DocTable) {
    this.calls.push(`heads ${table}`);
    await Promise.resolve();
    this.check();
    return [...this.tables[table]].map(([id, row]) => ({ id, rev: row.rev }));
  }

  async load(table: DocTable, ids: string[] | null) {
    this.calls.push(`load ${table}${ids ? ` [${ids.join(",")}]` : " *"}`);
    await Promise.resolve();
    this.check();
    return [...this.tables[table]]
      .filter(([id]) => ids === null || ids.includes(id))
      .map(([id, row]) => ({ id, rev: row.rev, data: structuredClone(row.data) }));
  }

  insert(table: ListTable, id: string, data: unknown) {
    return this.write(`insert ${table}/${id}`, () => {
      if (this.readOnly.has(table)) throw new RemoteError("denied", "Tài khoản của bạn không có quyền làm việc này.");
      if (this.tables[table].has(id)) throw new RemoteError("conflict", "Bản ghi này đã có trên máy chủ.");
      const doc = structuredClone(data) as any;
      if (table === "orders" && (!doc.code || this.assignsEveryCode)) doc.code = `DH-${String(++this.orderSeq).padStart(3, "0")}`;
      this.tables[table].set(id, { rev: 1, data: doc });
      return { id, rev: 1, code: table === "orders" ? (doc.code as string) : undefined };
    });
  }

  update(table: DocTable, id: string, rev: number, data: unknown) {
    return this.write(`update ${table}/${id}`, () => {
      const row = this.tables[table].get(id);
      if (!row || row.rev !== rev || this.readOnly.has(table)) return null;
      const doc = structuredClone(data) as any;
      if (table === "orders") doc.code = row.data.code;
      this.tables[table].set(id, { rev: rev + 1, data: doc });
      return { id, rev: rev + 1 };
    });
  }

  remove(table: ListTable, id: string) {
    return this.write(`delete ${table}/${id}`, () => {
      if (this.readOnly.has(table)) return false;
      if (table === "programs") {
        const orders = [...this.tables.orders.values()].filter((row) => row.data.programId === id).length;
        if (orders > 0) throw new RemoteError("rejected", `Không xóa được: còn ${orders} đơn hàng thuộc chương trình này.`);
      }
      return this.tables[table].delete(id);
    });
  }

  subscribe(onEvent: (event: RemoteEvent) => void, onLive: (live: boolean) => void) {
    this.listener = onEvent;
    this.liveListener = onLive;
    return () => {
      this.listener = null;
      this.liveListener = null;
    };
  }

  // ── Việc của «người khác», làm thẳng trên máy chủ ──

  put(table: DocTable, id: string, data: unknown, announce = false): void {
    const rev = (this.tables[table].get(id)?.rev ?? 0) + 1;
    this.tables[table].set(id, { rev, data: structuredClone(data) });
    if (announce) this.listener?.({ table, id, rev });
  }

  drop(table: DocTable, id: string, announce = false): void {
    this.tables[table].delete(id);
    if (announce) this.listener?.({ table, id, rev: null });
  }

  emit(event: RemoteEvent): void {
    this.listener?.(event);
  }

  setLive(live: boolean): void {
    this.liveListener?.(live);
  }

  writes(): string[] {
    return this.calls.filter((call) => /^(insert|update|delete) /.test(call));
  }
}

// ───────────────────────── Máy khách giả ─────────────────────────

function program(id: string, name = `CT ${id}`): Program {
  return normalizeProgram({ id, name, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
}

function order(id: string, programId = "p1", extra: Partial<Order> = {}): Order {
  return normalizeOrder({
    id,
    code: `DH-${id}`,
    programId,
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...extra,
  });
}

function client(server: FakeServer) {
  let db: DB = {
    version: 1,
    programs: [],
    orders: [],
    stock: { bySku: {}, updatedAt: null },
    settings: { role: "manager", salesperson: "", salespersonPhone: "", lowStockThreshold: 5 },
  };
  const notes: string[] = [];
  const statuses: SyncStatus[] = [];
  const engine = new SyncEngine(server, {
    get: () => db,
    apply(fn) {
      db = fn(db);
    },
    onStatus: (status) => statuses.push(status),
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
    statuses,
    get db() {
      return db;
    },
    /** Một thay đổi của người dùng (như `commit` của kho dữ liệu). */
    edit(fn: (db: DB) => DB) {
      db = fn(db);
      engine.localChanged();
    },
    editOrder(id: string, patch: Partial<Order>) {
      this.edit((cur) => ({ ...cur, orders: cur.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
    },
    editProgram(id: string, patch: Partial<Program>) {
      this.edit((cur) => ({ ...cur, programs: cur.programs.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },
    status: () => statuses[statuses.length - 1] ?? { state: "idle", pending: 0 },
  };
}

/** Cho thời gian trôi đủ để lần gửi đang chờ (sau khoảng gom thay đổi) chạy xong. */
const settle = () => vi.advanceTimersByTimeAsync(SYNC_TIMING.debounceMs + 50);

async function started(server: FakeServer) {
  const c = client(server);
  await c.engine.start();
  server.calls.length = 0;
  return c;
}

function seeded(): FakeServer {
  const server = new FakeServer();
  server.put("programs", "p1", program("p1"));
  server.put("programs", "p2", program("p2"));
  server.put("orders", "o1", order("o1"));
  server.put("orders", "o2", order("o2"));
  return server;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ───────────────────────── Kiểm thử ─────────────────────────

describe("sameJson", () => {
  it("ignores key order and undefined keys, but not values", () => {
    expect(sameJson({ a: 1, b: [1, { c: 2, d: undefined }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: null }, {})).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson("x", "x")).toBe(true);
  });
});

describe("start", () => {
  it("loads everything the account can see and reports nothing to save", async () => {
    const server = seeded();
    server.put("app_state", "stock", { bySku: { A: 3 }, updatedAt: "2026-11-20T00:00:00.000Z" });
    server.put("app_state", "settings", { lowStockThreshold: 10 });
    const c = client(server);
    await c.engine.start();
    expect(c.db.programs.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(c.db.orders.map((o) => o.id).sort()).toEqual(["o1", "o2"]);
    expect(c.db.stock.bySku).toEqual({ A: 3 });
    expect(c.db.settings.lowStockThreshold).toBe(10);
    expect(c.db.settings.role).toBe("manager");
    await settle();
    expect(server.writes()).toEqual([]);
    expect(c.status().state).toBe("idle");
  });

  it("fails with a network error when the server cannot be reached", async () => {
    const server = seeded();
    server.offline = true;
    const c = client(server);
    await expect(c.engine.start()).rejects.toMatchObject({ kind: "network" });
    expect(c.db.programs).toEqual([]);
  });
});

describe("saving local changes", () => {
  it("sends one update after the user stops typing, with the latest content", async () => {
    const server = seeded();
    const c = await started(server);
    c.editOrder("o1", { customerName: "Đ" });
    c.editOrder("o1", { customerName: "Đại" });
    expect(c.status()).toEqual({ state: "saving", pending: 1 });
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.debounceMs - 100);
    c.editOrder("o1", { customerName: "Đại lý A" });
    expect(server.writes()).toEqual([]);
    await settle();
    expect(server.writes()).toEqual(["update orders/o1"]);
    expect(server.tables.orders.get("o1")).toMatchObject({ rev: 2, data: { customerName: "Đại lý A" } });
    expect(c.status()).toEqual({ state: "idle", pending: 0 });
    // Lần sửa sau dùng rev mới.
    c.editOrder("o1", { note: "giao sớm" });
    await settle();
    expect(server.tables.orders.get("o1")).toMatchObject({ rev: 3, data: { customerName: "Đại lý A", note: "giao sớm" } });
    expect(c.notes).toEqual([]);
  });

  it("inserts new programs and deletes removed ones", async () => {
    const server = seeded();
    const c = await started(server);
    c.edit((db) => ({ ...db, programs: [program("p3", "Mới"), ...db.programs.filter((p) => p.id !== "p2")] }));
    await settle();
    expect(server.writes().sort()).toEqual(["delete programs/p2", "insert programs/p3"]);
    expect([...server.tables.programs.keys()].sort()).toEqual(["p1", "p3"]);
    expect(c.status().state).toBe("idle");
    // Không gửi lại lần nữa.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.writes()).toHaveLength(2);
  });

  it("saves stock and the low-stock threshold", async () => {
    const server = seeded();
    const c = await started(server);
    c.edit((db) => ({ ...db, stock: { bySku: { A: 7 }, updatedAt: "2026-11-21T00:00:00.000Z" } }));
    c.edit((db) => ({ ...db, settings: { ...db.settings, lowStockThreshold: 12 } }));
    expect(c.status().pending).toBe(2);
    await settle();
    expect(server.tables.app_state.get("stock")).toMatchObject({ rev: 2, data: { bySku: { A: 7 } } });
    expect(server.tables.app_state.get("settings")).toEqual({ rev: 2, data: { lowStockThreshold: 12 } });
    expect(c.status().state).toBe("idle");
  });

  it("does not treat a role or sale-name change as something to save", async () => {
    const server = seeded();
    const c = await started(server);
    c.edit((db) => ({ ...db, settings: { ...db.settings, role: "sale", salesperson: "Lan" } }));
    await settle();
    expect(server.writes()).toEqual([]);
    expect(c.status().state).toBe("idle");
  });

  it("writes programs before orders, orders before program deletions, at most 4 requests at a time", async () => {
    const server = seeded();
    const c = await started(server);
    const newOrders = Array.from({ length: 30 }, (_, i) => order(`n${i}`, "p9"));
    c.edit((db) => ({
      ...db,
      programs: [program("p9"), ...db.programs.filter((p) => p.id !== "p1")],
      orders: [...newOrders, ...db.orders.filter((o) => o.programId !== "p1")],
    }));
    await settle();
    const writes = server.writes();
    expect(writes).toHaveLength(1 + 30 + 2 + 1);
    expect(writes[0]).toBe("insert programs/p9");
    expect(writes[writes.length - 1]).toBe("delete programs/p1");
    expect(server.maxRunning).toBeLessThanOrEqual(4);
    expect(server.maxRunning).toBeGreaterThan(1);
    expect(server.tables.orders.size).toBe(30);
    expect(c.notes).toEqual([]);
    expect(c.status().state).toBe("idle");
  });

  it("keeps edits made while a request is in flight and sends them next", async () => {
    const server = seeded();
    const c = await started(server);
    let open!: () => void;
    server.gate = new Promise<void>((resolve) => (open = resolve));
    c.editOrder("o1", { note: "một" });
    await settle();
    expect(server.writes()).toEqual(["update orders/o1"]);
    c.editOrder("o1", { note: "hai" });
    server.gate = null;
    open();
    await settle();
    await settle();
    expect(server.writes()).toEqual(["update orders/o1", "update orders/o1"]);
    expect(server.tables.orders.get("o1")).toMatchObject({ rev: 3, data: { note: "hai" } });
    expect(c.db.orders.find((o) => o.id === "o1")?.note).toBe("hai");
    expect(c.notes).toEqual([]);
    expect(c.status().state).toBe("idle");
  });
});

describe("creating an order", () => {
  it("writes to the server first and takes the order code the server assigned", async () => {
    const server = seeded();
    const c = await started(server);
    const saved = await c.engine.createOrder(order("o9", "p1", { code: "" }));
    expect(saved.code).toBe("DH-001");
    expect(c.db.orders[0]).toBe(saved);
    await settle();
    expect(server.writes()).toEqual(["insert orders/o9"]);
    expect(c.status().state).toBe("idle");
    // Sửa tiếp là một lệnh sửa bình thường với rev 1.
    c.editOrder("o9", { customerName: "A" });
    await settle();
    expect(server.tables.orders.get("o9")).toMatchObject({ rev: 2, data: { code: "DH-001", customerName: "A" } });
  });

  it("sends a program that has not reached the server yet before the order that uses it", async () => {
    const server = seeded();
    const c = await started(server);
    server.offline = true;
    c.edit((db) => ({ ...db, programs: [...db.programs, program("pNew")] }));
    await settle();
    server.offline = false;
    const saved = await c.engine.createOrder(order("o9", "pNew", { code: "" }));
    expect(saved.code).toBe("DH-001");
    // Lần gửi chương trình lúc mất mạng (thất bại), rồi chương trình, rồi đơn.
    expect(server.writes()).toEqual(["insert programs/pNew", "insert programs/pNew", "insert orders/o9"]);
    await settle();
    expect(server.writes()).toHaveLength(3);
    expect(c.status().state).toBe("idle");
  });

  it("rejects without touching local data when the server is unreachable", async () => {
    const server = seeded();
    const c = await started(server);
    server.offline = true;
    await expect(c.engine.createOrder(order("o9", "p1", { code: "" }))).rejects.toMatchObject({ kind: "network" });
    expect(c.db.orders.map((o) => o.id).sort()).toEqual(["o1", "o2"]);
  });

  it("fills in the code of an imported order that had none", async () => {
    const server = seeded();
    const c = await started(server);
    c.edit((db) => ({ ...db, orders: [order("imp", "p1", { code: "" }), ...db.orders] }));
    await settle();
    expect(c.db.orders.find((o) => o.id === "imp")?.code).toBe("DH-001");
    await settle();
    expect(server.writes()).toEqual(["insert orders/imp"]);
    expect(c.status().state).toBe("idle");
  });
});

describe("no network", () => {
  it("keeps the change, reports it as unsaved, and saves it once the network is back", async () => {
    const server = seeded();
    const c = await started(server);
    server.offline = true;
    c.editOrder("o1", { note: "ngoại tuyến" });
    await settle();
    expect(c.status()).toEqual({ state: "retrying", pending: 1 });
    expect(await c.engine.flushNow()).toBe(false);
    c.editOrder("o2", { note: "thêm" });
    expect(c.status()).toEqual({ state: "retrying", pending: 2 });
    expect(c.db.orders.find((o) => o.id === "o1")?.note).toBe("ngoại tuyến");

    server.offline = false;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(server.tables.orders.get("o1")?.data.note).toBe("ngoại tuyến");
    expect(server.tables.orders.get("o2")?.data.note).toBe("thêm");
    expect(c.status()).toEqual({ state: "idle", pending: 0 });
    expect(c.notes).toEqual([]);
  });

  it("wake() retries at once instead of waiting for the back-off", async () => {
    const server = seeded();
    const c = await started(server);
    server.offline = true;
    c.editOrder("o1", { note: "x" });
    await settle();
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.retryMs[0] + SYNC_TIMING.retryMs[1] + 100);
    expect(c.status().state).toBe("retrying");
    server.offline = false;
    c.engine.wake();
    await vi.advanceTimersByTimeAsync(10);
    expect(server.tables.orders.get("o1")?.data.note).toBe("x");
    expect(c.status().state).toBe("idle");
  });

  it("does not report a conflict when the write went through but the reply was lost", async () => {
    const server = seeded();
    const c = await started(server);
    server.loseNextResponse = true;
    c.editOrder("o1", { note: "đã tới nơi" });
    await settle();
    expect(server.tables.orders.get("o1")).toMatchObject({ rev: 2, data: { note: "đã tới nơi" } });
    expect(c.status().state).toBe("retrying");
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.retryMs[0] + 100);
    expect(c.status().state).toBe("idle");
    expect(c.notes).toEqual([]);
    expect(c.db.orders.find((o) => o.id === "o1")?.note).toBe("đã tới nơi");
    // rev đã được ghi nhận đúng: lần sửa sau thành công ngay.
    c.editOrder("o1", { note: "tiếp" });
    await settle();
    expect(server.tables.orders.get("o1")).toMatchObject({ rev: 3, data: { note: "tiếp" } });
    expect(c.notes).toEqual([]);
  });

  it("does not duplicate a new record whose insert went through but the reply was lost", async () => {
    const server = seeded();
    const c = await started(server);
    server.loseNextResponse = true;
    c.edit((db) => ({ ...db, programs: [program("p3"), ...db.programs] }));
    await settle();
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.retryMs[0] + 100);
    expect(server.tables.programs.get("p3")?.rev).toBe(1);
    expect(c.status().state).toBe("idle");
    expect(c.notes).toEqual([]);
    expect(c.db.programs.filter((p) => p.id === "p3")).toHaveLength(1);
  });

  it("takes the code the server gave a new order even when the reply to the insert was lost", async () => {
    const server = seeded();
    const c = await started(server);
    server.loseNextResponse = true;
    c.edit((db) => ({ ...db, orders: [order("imp", "p1", { code: "" }), ...db.orders] }));
    await settle();
    expect(server.tables.orders.get("imp")?.data.code).toBe("DH-001");
    expect(c.status().state).toBe("retrying");
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.retryMs[0] + 100);
    expect(c.status().state).toBe("idle");
    expect(c.notes).toEqual([]);
    expect(c.db.orders.find((o) => o.id === "imp")?.code).toBe("DH-001");
    expect(server.tables.orders.size).toBe(3);
    // Mã đã nhận đúng và rev đã khớp: sửa tiếp là lưu được ngay, mã không đổi.
    c.editOrder("imp", { note: "tiếp" });
    await settle();
    expect(server.tables.orders.get("imp")).toMatchObject({ rev: 2, data: { note: "tiếp", code: "DH-001" } });
    expect(c.notes).toEqual([]);
  });

  it("accepts the server's own code for an order sent with one, reply lost or not", async () => {
    const server = seeded();
    server.assignsEveryCode = true;
    const c = await started(server);
    c.edit((db) => ({ ...db, orders: [order("a", "p1", { code: "TU-DAT-1" }), ...db.orders] }));
    await settle();
    expect(c.db.orders.find((o) => o.id === "a")?.code).toBe("DH-001");
    server.loseNextResponse = true;
    c.edit((db) => ({ ...db, orders: [order("b", "p1", { code: "TU-DAT-2" }), ...db.orders] }));
    await settle();
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.retryMs[0] + 100);
    expect(c.db.orders.find((o) => o.id === "b")?.code).toBe("DH-002");
    expect(c.status().state).toBe("idle");
    expect(c.notes).toEqual([]);
    expect(server.writes().filter((call) => call.startsWith("insert"))).toEqual(["insert orders/a", "insert orders/b", "insert orders/b"]);
  });
});

describe("someone else changed the same record", () => {
  it("does not overwrite: takes the server version and tells the user", async () => {
    const server = seeded();
    const c = await started(server);
    server.put("orders", "o1", order("o1", "p1", { note: "của quản lý" }));
    c.editOrder("o1", { note: "của sale" });
    await settle();
    expect(server.tables.orders.get("o1")).toMatchObject({ rev: 2, data: { note: "của quản lý" } });
    expect(c.db.orders.find((o) => o.id === "o1")?.note).toBe("của quản lý");
    expect(c.notes).toHaveLength(1);
    expect(c.notes[0]).toContain("Đơn DH-o1 vừa được sửa ở nơi khác");
    expect(c.status().state).toBe("idle");
    // Sửa lại trên bản mới thì lưu được.
    c.editOrder("o1", { note: "sale sửa lại" });
    await settle();
    expect(server.tables.orders.get("o1")).toMatchObject({ rev: 3, data: { note: "sale sửa lại" } });
  });

  it("drops a record that was deleted elsewhere, even if it had unsaved edits", async () => {
    const server = seeded();
    const c = await started(server);
    server.drop("orders", "o1");
    c.editOrder("o1", { note: "muộn rồi" });
    await settle();
    expect(c.db.orders.map((o) => o.id)).toEqual(["o2"]);
    expect(c.notes[0]).toContain("đã bị xóa ở nơi khác");
    expect(c.status().state).toBe("idle");
    expect(server.tables.orders.has("o1")).toBe(false);
  });

  it("treats a delete of something already deleted as done", async () => {
    const server = seeded();
    const c = await started(server);
    server.drop("orders", "o1");
    c.edit((db) => ({ ...db, orders: db.orders.filter((o) => o.id !== "o1") }));
    await settle();
    expect(c.notes).toEqual([]);
    expect(c.status().state).toBe("idle");
  });
});

describe("the server refuses", () => {
  it("reverts an edit the account is not allowed to make", async () => {
    const server = seeded();
    const c = await started(server);
    server.readOnly.add("programs");
    c.editProgram("p1", { name: "Sale tự sửa" });
    await settle();
    expect(c.db.programs.find((p) => p.id === "p1")?.name).toBe("CT p1");
    expect(server.tables.programs.get("p1")).toMatchObject({ rev: 1, data: { name: "CT p1" } });
    expect(c.notes[0]).toContain("không được sửa chương trình «Sale tự sửa»");
    expect(c.status().state).toBe("idle");
  });

  it("removes a new record the account is not allowed to add", async () => {
    const server = seeded();
    const c = await started(server);
    server.readOnly.add("programs");
    c.edit((db) => ({ ...db, programs: [program("p3", "Lậu"), ...db.programs] }));
    await settle();
    expect(c.db.programs.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(c.notes[0]).toContain("Không lưu được chương trình «Lậu»");
    expect(c.status().state).toBe("idle");
  });

  it("puts back a record the account is not allowed to delete", async () => {
    const server = seeded();
    const c = await started(server);
    server.readOnly.add("programs");
    c.edit((db) => ({ ...db, programs: db.programs.filter((p) => p.id !== "p2") }));
    await settle();
    expect(c.db.programs.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(c.notes[0]).toContain("Không xóa được chương trình «CT p2»");
    expect(c.status().state).toBe("idle");
  });

  it("puts back a program that still has orders on the server, with the server's reason", async () => {
    const server = seeded();
    const c = await started(server);
    // Một sale khác vừa tạo đơn cho chương trình p2 mà máy này chưa thấy.
    server.put("orders", "hidden", order("hidden", "p2"));
    c.edit((db) => ({ ...db, programs: db.programs.filter((p) => p.id !== "p2") }));
    await settle();
    expect(c.db.programs.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(c.notes[0]).toContain("còn 1 đơn hàng thuộc chương trình này");
    expect(c.status().state).toBe("idle");
  });

  it("deletes a program together with its orders when both go in one step", async () => {
    const server = seeded();
    const c = await started(server);
    c.edit((db) => ({ ...db, orders: [], programs: db.programs.filter((p) => p.id !== "p1") }));
    await settle();
    expect(server.tables.orders.size).toBe(0);
    expect([...server.tables.programs.keys()]).toEqual(["p2"]);
    expect(c.notes).toEqual([]);
  });
});

describe("changes made elsewhere arrive", () => {
  it("pull adds, replaces and removes records, and leaves untouched ones as they are", async () => {
    const server = seeded();
    const c = await started(server);
    const untouched = c.db.orders.find((o) => o.id === "o2");
    server.put("programs", "p3", { ...program("p3"), createdAt: "2026-11-20T00:00:00.000Z" });
    server.put("orders", "o1", order("o1", "p1", { note: "sửa ở máy khác" }));
    server.drop("programs", "p2");
    server.put("app_state", "settings", { lowStockThreshold: 8 });
    c.engine.requestPull();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.db.programs.map((p) => p.id)).toEqual(["p3", "p1"]);
    expect(c.db.orders.find((o) => o.id === "o1")?.note).toBe("sửa ở máy khác");
    expect(c.db.orders.find((o) => o.id === "o2")).toBe(untouched);
    expect(c.db.settings.lowStockThreshold).toBe(8);
    expect(c.notes).toEqual([]);
    await settle();
    expect(server.writes()).toEqual([]);
    // Chỉ tải các dòng đã đổi.
    expect(server.calls.filter((call) => call.startsWith("load"))).toEqual(["load programs [p3]", "load orders [o1]", "load app_state [settings]"]);
  });

  it("pull keeps a new local record that has not been saved yet", async () => {
    const server = seeded();
    const c = await started(server);
    server.offline = true;
    c.edit((db) => ({ ...db, programs: [program("p3", "Chưa lưu"), ...db.programs] }));
    await settle();
    server.offline = false;
    c.engine.requestPull();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.db.programs.map((p) => p.id)).toContain("p3");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(server.tables.programs.has("p3")).toBe(true);
    expect(c.notes).toEqual([]);
  });

  it("pull replaces a record with unsaved local edits and says so", async () => {
    const server = seeded();
    const c = await started(server);
    server.offline = true;
    c.editOrder("o1", { note: "chưa lưu" });
    await settle();
    server.offline = false;
    server.put("orders", "o1", order("o1", "p1", { note: "máy khác" }));
    c.engine.requestPull();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.db.orders.find((o) => o.id === "o1")?.note).toBe("máy khác");
    expect(c.notes[0]).toContain("Đơn DH-o1 vừa được sửa hoặc xóa ở nơi khác");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(server.writes()).toEqual(["update orders/o1"]); // chỉ có lần gửi thất bại lúc mất mạng
    expect(c.status().state).toBe("idle");
  });

  it("a live signal loads just that row; our own echo loads nothing", async () => {
    const server = seeded();
    const c = await started(server);
    c.editOrder("o1", { note: "của mình" });
    await settle();
    server.calls.length = 0;
    server.emit({ table: "orders", id: "o1", rev: 2 }); // dội lại từ chính lần ghi vừa rồi
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.eventDelayMs + 50);
    expect(server.calls).toEqual([]);

    server.put("orders", "o2", order("o2", "p1", { note: "quản lý sửa" }), true);
    server.put("programs", "p7", program("p7"), true);
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.eventDelayMs + 50);
    expect(server.calls.sort()).toEqual(["load orders [o2]", "load programs [p7]"]);
    expect(c.db.orders.find((o) => o.id === "o2")?.note).toBe("quản lý sửa");
    expect(c.db.programs[0].id).toBe("p7");

    server.calls.length = 0;
    server.drop("orders", "o2", true);
    server.emit({ table: "orders", id: "someone-elses", rev: null }); // đơn của người khác bị xóa: không liên quan
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.eventDelayMs + 50);
    expect(server.calls).toEqual(["load orders [o2]"]);
    expect(c.db.orders.map((o) => o.id)).toEqual(["o1"]);
    expect(c.notes).toEqual([]);
  });

  it("polls often while the live channel is down and rarely while it is up", async () => {
    const server = seeded();
    const c = await started(server);
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.pollOfflineMs + 100);
    expect(server.calls.filter((call) => call === "heads orders")).toHaveLength(1);
    server.setLive(true);
    // Kênh vừa thông: hỏi bù vài lần trong mươi giây đầu (máy chủ cần thời gian mới thật sự phát thay đổi).
    server.calls.length = 0;
    const lastCatchUp = SYNC_TIMING.liveCatchUpMs[SYNC_TIMING.liveCatchUpMs.length - 1];
    await vi.advanceTimersByTimeAsync(lastCatchUp + 100);
    expect(server.calls.filter((call) => call === "heads orders")).toHaveLength(SYNC_TIMING.liveCatchUpMs.length);
    server.calls.length = 0;
    // Kênh thông thì nhịp hỏi thưa hơn: tính từ lúc kênh thông, chưa tới `pollLiveMs` thì chưa hỏi.
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.pollLiveMs - lastCatchUp - 1000);
    expect(server.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.calls.filter((call) => call === "heads orders")).toHaveLength(1);
    c.engine.dispose();
  });

  it("catches up again each time the channel reports ready, and stops when it drops", async () => {
    const server = seeded();
    const c = await started(server);
    const pulls = () => server.calls.filter((call) => call === "heads orders").length;
    const [first, second] = SYNC_TIMING.liveCatchUpMs;
    server.setLive(true);
    await vi.advanceTimersByTimeAsync(first + 50);
    expect(pulls()).toBe(1);
    // Máy chủ báo «đã sẵn sàng phát thay đổi» sau khi kênh đã nối: tính lại từ đầu, hỏi bù ngay.
    server.calls.length = 0;
    server.setLive(true);
    await vi.advanceTimersByTimeAsync(first + 50);
    expect(pulls()).toBe(1);
    // Kênh đứt: thôi hỏi bù, chờ nhịp hỏi định kỳ (dày hơn) lo.
    server.calls.length = 0;
    server.setLive(false);
    await vi.advanceTimersByTimeAsync(second);
    expect(server.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.pollOfflineMs - second + 100);
    expect(pulls()).toBe(1);
    c.engine.dispose();
  });
});

describe("polling pace", () => {
  it("asks less often once the user leaves the app alone, and catches up as soon as they touch it again", async () => {
    const server = seeded();
    const c = await started(server);
    const pulls = () => server.calls.filter((call) => call === "heads orders").length;
    // Vừa mở / đang làm việc: nhịp dày.
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.idleAfterMs);
    expect(pulls()).toBe(SYNC_TIMING.idleAfterMs / SYNC_TIMING.pollOfflineMs);
    // Để yên quá `idleAfterMs`: nhịp thưa.
    server.calls.length = 0;
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.pollIdleMs * 3);
    expect(pulls()).toBe(3);
    // Đụng vào lại: hỏi ngay (lần hỏi gần nhất đã cách đủ lâu), rồi trở về nhịp dày.
    server.calls.length = 0;
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.focusGapMs + 1000);
    c.engine.noteActivity();
    await vi.advanceTimersByTimeAsync(100);
    expect(pulls()).toBe(1);
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.pollOfflineMs);
    expect(pulls()).toBe(2);
    // Đang làm việc thì các lần đụng tiếp theo không gây thêm lần hỏi nào.
    c.engine.noteActivity();
    c.engine.noteActivity();
    await vi.advanceTimersByTimeAsync(100);
    expect(pulls()).toBe(2);
    c.engine.dispose();
  });

  it("does not ask at all while the tab is hidden", async () => {
    const server = seeded();
    const c = await started(server);
    // Kiểm thử chạy ngoài trình duyệt: dựng một `document` giả chỉ có thứ bộ đồng bộ nhìn tới.
    vi.stubGlobal("document", { visibilityState: "hidden" });
    try {
      await vi.advanceTimersByTimeAsync(SYNC_TIMING.pollIdleMs * 5);
      expect(server.calls).toEqual([]);
      // Tab hiện lại: nhịp hỏi tiếp tục.
      vi.stubGlobal("document", { visibilityState: "visible" });
      await vi.advanceTimersByTimeAsync(SYNC_TIMING.pollIdleMs);
      expect(server.calls.filter((call) => call === "heads orders")).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
    c.engine.dispose();
  });
});

describe("dispose", () => {
  it("stops talking to the server", async () => {
    const server = seeded();
    const c = await started(server);
    c.editOrder("o1", { note: "x" });
    c.engine.dispose();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(server.calls).toEqual([]);
  });
});

describe("fingerprints (the cheap «anything new?» check)", () => {
  // SHA-256 của trình duyệt chạy ngoài vòng hẹn giờ giả, nên các kiểm thử này dùng đồng hồ thật.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

  it("fingerprintOf sorts by id and matches a known SHA-256", async () => {
    expect(await fingerprintOf([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const a = await fingerprintOf([{ id: "b", rev: 2 }, { id: "a-b", rev: 1 }, { id: "a", rev: 10 }]);
    const b = await fingerprintOf([{ id: "a", rev: 10 }, { id: "a-b", rev: 1 }, { id: "b", rev: 2 }]);
    expect(a).toBe(b);
    // sha256("a:10,a-b:1,b:2")
    const expected = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("a:10,a-b:1,b:2"))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(a).toBe(expected);
    expect(await fingerprintOf([{ id: "a", rev: 11 }, { id: "a-b", rev: 1 }, { id: "b", rev: 2 }])).not.toBe(a);
  });

  it("a pull asks only for the fingerprint when nothing changed, and only for the changed table when something did", async () => {
    vi.useRealTimers();
    const server = seeded();
    server.supportsFingerprints = true;
    const c = client(server);
    await c.engine.start();
    server.calls.length = 0;

    c.engine.requestPull();
    await tick();
    expect(server.calls).toEqual(["fingerprints"]);

    // Thay đổi của chính máy này không làm lệch dấu vân tay.
    c.editOrder("o1", { note: "của mình" });
    expect(await c.engine.flushNow()).toBe(true);
    server.calls.length = 0;
    c.engine.requestPull();
    await tick();
    expect(server.calls).toEqual(["fingerprints"]);

    // Người khác sửa một đơn và xóa một đơn: chỉ bảng đơn hàng được xem lại.
    server.put("orders", "o1", order("o1", "p1", { note: "người khác" }));
    server.drop("orders", "o2");
    server.calls.length = 0;
    c.engine.requestPull();
    await tick();
    expect(server.calls).toEqual(["fingerprints", "heads orders", "load orders [o1]"]);
    expect(c.db.orders.map((o) => [o.id, o.note])).toEqual([["o1", "người khác"]]);
    expect(c.notes).toEqual([]);
    c.engine.dispose();
  });
});
