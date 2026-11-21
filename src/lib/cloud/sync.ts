// Bộ đồng bộ giữa dữ liệu đang mở trên máy (React state của kho dữ liệu) và máy chủ.
//
// Cách làm: với mỗi bản ghi, bộ đồng bộ nhớ «bản máy chủ đang giữ» (shadow) gồm số `rev` và CHÍNH đối tượng đã gửi /
// đã nhận. Kho dữ liệu sửa bản ghi theo kiểu bất biến (mỗi lần sửa là một đối tượng mới), nên:
//   • bản ghi trên máy khác đối tượng với shadow  → có thay đổi chưa lưu → gửi lên (kèm rev đang biết);
//   • bản ghi có trên máy mà chưa có shadow        → bản ghi mới → thêm;
//   • có shadow mà trên máy không còn              → đã xóa → xóa trên máy chủ.
// Nhờ vậy các thao tác của kho dữ liệu không cần biết gì về máy chủ.
//
// Hai người sửa cùng một bản ghi: người gửi sau bị lệch rev nên không ghi được; máy đó tải bản mới nhất về và báo
// cho người dùng — không bao giờ âm thầm ghi đè lên việc của người khác.
import type { DB, Order, Program, Stock } from "../../types";
import { SYNC_IDLE, type SyncStatus } from "../syncStatus";
import {
  RemoteError,
  fingerprintOf,
  type DocTable,
  type ListTable,
  type Remote,
  type RemoteEvent,
  type RemoteHead,
  type RemoteRow,
} from "./remote";

export interface SyncHost {
  /** Dữ liệu đang có trên máy. */
  get(): DB;
  /** Thay dữ liệu trên máy bằng kết quả của `fn` (đồng bộ, đi qua kho dữ liệu để màn hình vẽ lại). */
  apply(fn: (db: DB) => DB): void;
  onStatus(status: SyncStatus): void;
  /** Báo cho người dùng một việc họ cần biết: thay đổi bị từ chối, bản ghi vừa được người khác sửa… */
  notify(message: string, tone: "error" | "info"): void;
  /** Hồ sơ của một tài khoản vừa đổi trên máy chủ (vd quản lý vừa đổi vai trò). */
  onProfileEvent?(id: string): void;
  /** Nhật ký từng bước của bộ đồng bộ, để tìm lỗi (không có thì không ghi). */
  debug?(message: string): void;
  /** Biến tài liệu JSON nhận từ máy chủ thành bản ghi hợp lệ. */
  normalize: {
    program(raw: unknown): Program;
    order(raw: unknown): Order;
    stock(raw: unknown): Stock;
    threshold(raw: unknown): number;
  };
}

export const SYNC_TIMING = {
  /** Chờ người dùng ngừng gõ bấy lâu rồi mới gửi. */
  debounceMs: 700,
  /** Gửi thất bại vì mạng: thử lại sau các khoảng này (khoảng cuối lặp lại mãi). */
  retryMs: [2000, 5000, 10000, 30000],
  /**
   * Hỏi lại máy chủ định kỳ «có gì mới không» (một lệnh gọi nhỏ so dấu vân tay): thưa khi kênh Realtime đang thông, dày
   * khi kênh đứt. Realtime chỉ là đường nhanh — nó có thể rớt tín hiệu; lần hỏi định kỳ này mới là thứ bảo đảm bắt kịp.
   */
  pollLiveMs: 30_000,
  pollOfflineMs: 15_000,
  /** Quay lại tab: hỏi lại máy chủ nếu lần hỏi gần nhất đã cách bấy lâu. */
  focusGapMs: 5_000,
  /** Gom các tín hiệu Realtime đến dồn dập. */
  eventDelayMs: 300,
  /**
   * Kênh Realtime vừa thông: những gì xảy ra giữa lần tải gần nhất và lúc máy chủ bắt đầu phát thay đổi thì không được
   * phát, nên hỏi lại ngay sau khi thông (khoảng đầu) để lấy phần đó. Hai lần sau chỉ là phòng xa.
   */
  liveCatchUpMs: [500, 4000, 12000],
  /** Một lệnh gọi máy chủ không xong sau bấy lâu thì coi là mất mạng. */
  writeTimeoutMs: 30_000,
  readTimeoutMs: 60_000,
};

const CONCURRENCY = 4;
const STOCK_KEY = "app_state/stock";
const SETTINGS_KEY = "app_state/settings";

interface Shadow {
  rev: number;
  /** Đối tượng đang nằm trên máy chủ (với ngưỡng cảnh báo: con số). */
  doc: unknown;
}

interface Op {
  kind: "insert" | "update" | "delete";
  table: DocTable;
  id: string;
  /** rev đang biết (0 với bản ghi mới). */
  rev: number;
  /** Đối tượng trên máy tại lúc lập lệnh — gửi xong mà trên máy vẫn là nó thì bản ghi đã sạch. */
  doc: unknown;
  /** Tài liệu JSON gửi lên. */
  payload: unknown;
}

interface TableChange {
  table: DocTable;
  rows: RemoteRow[];
  /** id các dòng không còn trên máy chủ (hoặc tài khoản không còn được thấy). */
  gone: string[];
}

const keyOf = (table: DocTable, id: string) => `${table}/${id}`;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** So hai tài liệu JSON, không kể thứ tự khóa (Postgres jsonb không giữ thứ tự) và coi khóa `undefined` như không có. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] === undefined && b[key] === undefined) continue;
    if (!sameJson(a[key], b[key])) return false;
  }
  return true;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RemoteError("network", "Máy chủ không phản hồi. Kiểm tra mạng rồi thử lại.")),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Chạy `work` cho từng phần tử, mỗi lúc tối đa `limit` việc. Việc nào lỗi thì các việc còn lại vẫn chạy hết rồi mới ném lỗi đầu tiên. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const runner = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  if (failure) throw failure;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export class SyncEngine {
  private shadow = new Map<string, Shadow>();
  private chain: Promise<unknown> = Promise.resolve();
  private status: SyncStatus = SYNC_IDLE;
  private started = false;
  private disposed = false;
  private flushing = false;
  private retryIndex = 0;
  private live = false;
  private lastPullAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private eventTimer: ReturnType<typeof setTimeout> | null = null;
  private catchUpTimers: Array<ReturnType<typeof setTimeout>> = [];
  private pendingEvents = new Map<string, RemoteEvent>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly remote: Remote,
    private readonly host: SyncHost,
  ) {}

  // ───────────────────────── Vòng đời ─────────────────────────

  /** Tải toàn bộ dữ liệu tài khoản được thấy, rồi bắt đầu theo dõi thay đổi. Ném RemoteError nếu không tải được. */
  async start(): Promise<void> {
    await this.enqueue(() => this.pull(true));
    if (this.disposed) return;
    this.started = true;
    this.unsubscribe = this.remote.subscribe(
      (event) => this.onRemoteEvent(event),
      (live) => this.onLive(live),
    );
    this.schedulePoll();
    this.localChanged();
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of [this.flushTimer, this.pollTimer, this.eventTimer, ...this.catchUpTimers]) if (timer) clearTimeout(timer);
    this.flushTimer = this.pollTimer = this.eventTimer = null;
    this.catchUpTimers = [];
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Kho dữ liệu gọi sau mỗi lần dữ liệu trên máy đổi. */
  localChanged(): void {
    if (this.disposed || !this.started) return;
    const pending = this.computeOps(this.host.get()).length;
    if (pending === 0) {
      if (!this.flushing) this.setStatus(SYNC_IDLE);
      return;
    }
    if (this.status.state === "retrying") {
      // Đang chờ thử lại vì mất mạng: giữ nhịp thử lại, chỉ cập nhật số thay đổi đang chờ.
      this.setStatus({ state: "retrying", pending });
      return;
    }
    this.setStatus({ state: "saving", pending });
    this.scheduleFlush(SYNC_TIMING.debounceMs);
  }

  /** Gửi ngay mọi thay đổi đang chờ. Trả về true nếu sau đó không còn gì chưa lưu. */
  async flushNow(): Promise<boolean> {
    if (this.disposed || !this.started) return true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.enqueue(() => this.flush());
    return this.computeOps(this.host.get()).length === 0;
  }

  /** Có mạng trở lại / người dùng quay lại tab: gửi cái đang chờ, và hỏi lại máy chủ nếu đã lâu chưa hỏi. */
  wake(): void {
    if (this.disposed || !this.started) return;
    if (this.status.state !== "idle") void this.flushNow();
    if (Date.now() - this.lastPullAt >= SYNC_TIMING.focusGapMs) this.requestPull();
  }

  /** Tải lại từ máy chủ những gì đã đổi (vd sau khi vai trò của tài khoản đổi nên phạm vi được thấy cũng đổi). */
  requestPull(): void {
    if (this.disposed || !this.started) return;
    void this.enqueue(() => this.pull(false)).catch(() => {
      // Hỏi lại thất bại (mất mạng): lần hỏi định kỳ sau sẽ bù.
    });
  }

  /**
   * Tạo đơn mới: ghi lên máy chủ TRƯỚC (để nhận mã đơn do máy chủ cấp), xong mới đưa vào dữ liệu trên máy.
   * Ném RemoteError nếu không tạo được.
   */
  createOrder(order: Order): Promise<Order> {
    return this.enqueue(async () => {
      const head = await withTimeout(this.remote.insert("orders", order.id, order), SYNC_TIMING.writeTimeoutMs);
      const saved: Order = head.code != null && head.code !== order.code ? { ...order, code: head.code } : order;
      if (this.disposed) return saved;
      this.shadow.set(keyOf("orders", saved.id), { rev: head.rev, doc: saved });
      this.host.apply((db) => ({ ...db, orders: [saved, ...db.orders] }));
      return saved;
    });
  }

  // ───────────────────────── Hàng đợi và trạng thái ─────────────────────────

  /** Mọi việc nói chuyện với máy chủ chạy lần lượt, để tải về và gửi lên không giẫm lên nhau. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private log(message: string): void {
    this.host.debug?.(message);
  }

  private setStatus(status: SyncStatus): void {
    if (this.status.state === status.state && this.status.pending === status.pending) return;
    this.log(`status ${status.state} pending=${status.pending}`);
    this.status = status;
    if (!this.disposed) this.host.onStatus(status);
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.enqueue(() => this.flush());
    }, delayMs);
  }

  private schedulePoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.disposed) return;
    this.pollTimer = setTimeout(
      () => {
        this.pollTimer = null;
        // Tab đang ẩn thì không hỏi; lúc người dùng quay lại, `wake()` sẽ hỏi.
        if (typeof document === "undefined" || document.visibilityState !== "hidden") this.requestPull();
        this.schedulePoll();
      },
      this.live ? SYNC_TIMING.pollLiveMs : SYNC_TIMING.pollOfflineMs,
    );
  }

  private onLive(live: boolean): void {
    if (this.disposed) return;
    if (live !== this.live) this.log(`realtime ${live ? "connected" : "disconnected"}`);
    this.live = live;
    this.schedulePoll();
    for (const timer of this.catchUpTimers) clearTimeout(timer);
    this.catchUpTimers = [];
    if (!live) return;
    // Kênh vừa thông (lần đầu, sau khi đứt, hoặc máy chủ vừa báo đã sẵn sàng phát thay đổi): có thể đã lỡ tín hiệu, và
    // vài giây tới vẫn còn có thể lỡ — hỏi bù.
    this.catchUpTimers = SYNC_TIMING.liveCatchUpMs.map((delay) => setTimeout(() => this.requestPull(), delay));
  }

  // ───────────────────────── Gửi lên ─────────────────────────

  /** So dữ liệu trên máy với bản máy chủ đang giữ → các lệnh cần gửi. */
  private computeOps(db: DB): Op[] {
    const ops: Op[] = [];
    const scan = (table: ListTable, list: Array<{ id: string }>) => {
      const seen = new Set<string>();
      for (const doc of list) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        const known = this.shadow.get(keyOf(table, doc.id));
        if (!known) ops.push({ kind: "insert", table, id: doc.id, rev: 0, doc, payload: doc });
        else if (known.doc !== doc) ops.push({ kind: "update", table, id: doc.id, rev: known.rev, doc, payload: doc });
      }
      const prefix = `${table}/`;
      for (const [key, known] of this.shadow) {
        if (!key.startsWith(prefix)) continue;
        const id = key.slice(prefix.length);
        if (!seen.has(id)) ops.push({ kind: "delete", table, id, rev: known.rev, doc: known.doc, payload: null });
      }
    };
    scan("programs", db.programs);
    scan("orders", db.orders);
    const stock = this.shadow.get(STOCK_KEY);
    if (stock && stock.doc !== db.stock) {
      ops.push({ kind: "update", table: "app_state", id: "stock", rev: stock.rev, doc: db.stock, payload: db.stock });
    }
    const settings = this.shadow.get(SETTINGS_KEY);
    const threshold = db.settings.lowStockThreshold;
    if (settings && settings.doc !== threshold) {
      ops.push({
        kind: "update",
        table: "app_state",
        id: "settings",
        rev: settings.rev,
        doc: threshold,
        payload: { lowStockThreshold: threshold },
      });
    }
    return ops;
  }

  private async flush(): Promise<void> {
    if (this.disposed || !this.started) return;
    const ops = this.computeOps(this.host.get());
    if (ops.length === 0) {
      this.retryIndex = 0;
      this.setStatus(SYNC_IDLE);
      return;
    }
    this.setStatus({ state: this.status.state === "retrying" ? "retrying" : "saving", pending: ops.length });
    this.log(`flush ${ops.map((op) => `${op.kind} ${op.table}/${op.id}@${op.rev}`).join(", ")}`);
    this.flushing = true;
    try {
      // Thứ tự: chương trình mới / sửa → đơn hàng → xóa chương trình (máy chủ không cho xóa chương trình còn đơn) → tồn kho, thiết lập.
      const phases = [
        ops.filter((op) => op.table === "programs" && op.kind !== "delete"),
        ops.filter((op) => op.table === "orders"),
        ops.filter((op) => op.table === "programs" && op.kind === "delete"),
        ops.filter((op) => op.table === "app_state"),
      ];
      for (const phase of phases) await pool(phase, CONCURRENCY, (op) => this.runOp(op));
    } catch (error) {
      if (!(error instanceof RemoteError)) console.error("Lỗi khi lưu lên máy chủ.", error);
      this.log(`flush failed: ${error instanceof Error ? error.message : String(error)}`);
      this.flushing = false;
      if (this.disposed) return;
      // Mất mạng (hoặc lỗi chưa lường): giữ nguyên thay đổi trên máy, thử lại sau.
      const delay = SYNC_TIMING.retryMs[Math.min(this.retryIndex, SYNC_TIMING.retryMs.length - 1)];
      this.retryIndex += 1;
      this.setStatus({ state: "retrying", pending: this.computeOps(this.host.get()).length });
      this.scheduleFlush(delay);
      return;
    }
    this.flushing = false;
    if (this.disposed) return;
    this.retryIndex = 0;
    const left = this.computeOps(this.host.get()).length;
    if (left === 0) {
      this.setStatus(SYNC_IDLE);
    } else {
      // Người dùng đã sửa tiếp trong lúc đang gửi.
      this.setStatus({ state: "saving", pending: left });
      this.scheduleFlush(SYNC_TIMING.debounceMs);
    }
  }

  private async runOp(op: Op): Promise<void> {
    const key = keyOf(op.table, op.id);
    try {
      if (op.kind === "insert") {
        const head = await withTimeout(this.remote.insert(op.table as ListTable, op.id, op.payload), SYNC_TIMING.writeTimeoutMs);
        if (this.disposed) return;
        let doc = op.doc;
        if (op.table === "orders" && head.code != null && head.code !== (op.doc as Order).code) {
          doc = this.adoptOrderCode(op.doc as Order, head.code);
        }
        this.shadow.set(key, { rev: head.rev, doc });
      } else if (op.kind === "update") {
        const head = await withTimeout(this.remote.update(op.table, op.id, op.rev, op.payload), SYNC_TIMING.writeTimeoutMs);
        if (this.disposed) return;
        if (head) this.shadow.set(key, { rev: head.rev, doc: op.doc });
        else await this.settleWithServer(op);
      } else {
        const removed = await withTimeout(this.remote.remove(op.table as ListTable, op.id), SYNC_TIMING.writeTimeoutMs);
        if (this.disposed) return;
        if (removed) this.shadow.delete(key);
        else await this.settleWithServer(op);
      }
    } catch (error) {
      if (!(error instanceof RemoteError) || error.kind === "network") throw error;
      if (this.disposed) return;
      if (error.kind === "conflict") await this.settleWithServer(op);
      else this.revert(op, error);
    }
  }

  /** Máy chủ vừa cấp mã cho một đơn gửi lên chưa có mã: ghi mã đó vào đơn trên máy. Trả về đối tượng nay là «bản máy chủ giữ». */
  private adoptOrderCode(sent: Order, code: string): Order {
    const saved: Order = { ...sent, code };
    this.host.apply((db) => ({
      ...db,
      // Người dùng đã sửa tiếp đơn trong lúc gửi thì chỉ điền mã, giữ các thay đổi của họ (đơn vẫn còn phải gửi tiếp).
      orders: db.orders.map((order) => (order.id !== sent.id ? order : order === sent ? saved : { ...order, code })),
    }));
    return saved;
  }

  /**
   * Lệnh không ghi được vào dòng nào (hoặc thêm trùng id): xem máy chủ đang có gì rồi theo đó.
   *  • Máy chủ đang giữ đúng nội dung vừa gửi (lần gửi trước thật ra đã tới, chỉ là phản hồi bị mất) → coi như đã lưu.
   *  • Máy chủ có bản khác → lấy bản máy chủ, báo cho người dùng biết thay đổi của họ chưa được lưu.
   *  • Máy chủ không còn dòng đó → bỏ trên máy.
   */
  private async settleWithServer(op: Op): Promise<void> {
    const key = keyOf(op.table, op.id);
    const [row] = await withTimeout(this.remote.load(op.table, [op.id]), SYNC_TIMING.readTimeoutMs);
    if (this.disposed) return;
    const label = this.labelOf(op.table, op.doc);
    this.log(`${op.kind} ${op.table}/${op.id}@${op.rev} wrote nothing; server has ${row ? `rev ${row.rev}` : "no such row"}`);

    if (!row) {
      if (op.kind === "delete") {
        this.shadow.delete(key);
        return;
      }
      this.applyRemote([{ table: op.table, rows: [], gone: [op.id] }]);
      // Thêm trùng id mà không thấy dòng đó: nó thuộc về người khác — không lưu được bản ghi này.
      this.host.notify(
        op.kind === "insert"
          ? `Không lưu được ${label}: máy chủ đã có một bản ghi khác trùng mã nội bộ.`
          : `${capitalize(label)} đã bị xóa ở nơi khác.`,
        "error",
      );
      return;
    }

    if (op.kind === "delete") {
      // Dòng vẫn còn nghĩa là tài khoản này không được xóa nó: đưa lại lên màn hình.
      this.applyRemote([{ table: op.table, rows: [row], gone: [] }]);
      this.host.notify(`Không xóa được ${label}: tài khoản của bạn không có quyền xóa.`, "error");
      return;
    }

    if (this.sameAsSent(op, row.data)) {
      // Lần gửi trước đã tới nơi. Mã đơn là do máy chủ quyết định: nếu khác mã trên máy (vd đơn gửi lên chưa có mã) thì lấy mã đó.
      let doc = op.doc;
      const serverCode = op.table === "orders" && isObject(row.data) ? row.data.code : undefined;
      if (typeof serverCode === "string" && serverCode !== (op.doc as Order).code) {
        doc = this.adoptOrderCode(op.doc as Order, serverCode);
      }
      this.shadow.set(key, { rev: row.rev, doc });
      return;
    }
    const denied = op.kind === "update" && row.rev === op.rev;
    this.applyRemote([{ table: op.table, rows: [row], gone: [] }]);
    this.host.notify(
      denied
        ? `Tài khoản của bạn không được sửa ${label}; thay đổi vừa rồi đã được hoàn lại.`
        : `${capitalize(label)} vừa được sửa ở nơi khác. Đã tải bản mới nhất; thay đổi vừa rồi của bạn ở đó chưa được lưu.`,
      "error",
    );
  }

  /**
   * Nội dung máy chủ đang giữ có đúng là cái lệnh này đã gửi không. Mã đơn không tính vào phép so, vì do máy chủ quyết
   * định: cấp khi đơn gửi lên chưa có mã (hoặc do một sale gửi), và giữ nguyên mã cũ khi sửa đơn.
   */
  private sameAsSent(op: Op, serverData: unknown): boolean {
    if (op.table === "orders" && isObject(op.payload) && isObject(serverData)) {
      return sameJson({ ...op.payload, code: serverData.code }, serverData);
    }
    return sameJson(op.payload, serverData);
  }

  /** Máy chủ từ chối hẳn một lệnh (không có quyền, dữ liệu không hợp lệ): trả dữ liệu trên máy về như máy chủ đang giữ. */
  private revert(op: Op, error: RemoteError): void {
    const label = this.labelOf(op.table, op.doc);
    const known = this.shadow.get(keyOf(op.table, op.id));
    this.log(`${op.kind} ${op.table}/${op.id} refused (${error.kind}): ${error.message}`);
    this.host.apply((db) => {
      if (op.table === "app_state") {
        if (!known) return db;
        return op.id === "stock"
          ? { ...db, stock: known.doc as Stock }
          : { ...db, settings: { ...db.settings, lowStockThreshold: known.doc as number } };
      }
      const field = op.table === "programs" ? "programs" : "orders";
      const list = db[field] as Array<{ id: string }>;
      let next: Array<{ id: string }>;
      if (op.kind === "insert") next = list.filter((doc) => doc.id !== op.id);
      else if (op.kind === "update") next = known ? list.map((doc) => (doc.id === op.id ? (known.doc as { id: string }) : doc)) : list;
      else next = known && !list.some((doc) => doc.id === op.id) ? [known.doc as { id: string }, ...list] : list;
      return { ...db, [field]: next } as DB;
    });
    const what =
      op.kind === "insert" ? `Không lưu được ${label}` : op.kind === "update" ? `Không lưu được thay đổi ở ${label}` : `Không xóa được ${label}`;
    this.host.notify(`${what}: ${error.message}`, "error");
  }

  private labelOf(table: DocTable, doc: unknown): string {
    if (table === "programs") {
      const name = isObject(doc) && typeof doc.name === "string" ? doc.name.trim() : "";
      return name ? `chương trình «${name}»` : "chương trình";
    }
    if (table === "orders") {
      const code = isObject(doc) && typeof doc.code === "string" ? doc.code.trim() : "";
      return code ? `đơn ${code}` : "đơn hàng";
    }
    return typeof doc === "number" ? "ngưỡng cảnh báo tồn kho" : "tồn kho";
  }

  // ───────────────────────── Tải về ─────────────────────────

  private async pull(initial: boolean): Promise<void> {
    if (this.disposed) return;
    const tables: DocTable[] = ["programs", "orders", "app_state"];
    const changes: TableChange[] = [];
    if (initial) {
      const loaded = await withTimeout(Promise.all(tables.map((table) => this.remote.load(table, null))), SYNC_TIMING.readTimeoutMs);
      tables.forEach((table, i) => changes.push({ table, rows: loaded[i], gone: [] }));
    } else {
      const stale = await this.staleTables(tables);
      this.log(`pull: ${stale.length === 0 ? "nothing new" : `checking ${stale.join(", ")}`}`);
      const heads = await withTimeout(Promise.all(stale.map((table) => this.remote.heads(table))), SYNC_TIMING.readTimeoutMs);
      for (let i = 0; i < stale.length; i++) {
        const table = stale[i];
        const prefix = `${table}/`;
        const present = new Set<string>();
        const changed: string[] = [];
        for (const head of heads[i]) {
          present.add(head.id);
          if (this.shadow.get(prefix + head.id)?.rev !== head.rev) changed.push(head.id);
        }
        const gone: string[] = [];
        for (const key of this.shadow.keys()) {
          if (key.startsWith(prefix) && !present.has(key.slice(prefix.length))) gone.push(key.slice(prefix.length));
        }
        const rows = changed.length > 0 ? await withTimeout(this.remote.load(table, changed), SYNC_TIMING.readTimeoutMs) : [];
        if (rows.length + gone.length > 0) this.log(`pull ${table}: loaded ${rows.map((row) => `${row.id}@${row.rev}`).join(", ") || "-"}; gone ${gone.join(", ") || "-"}`);
        changes.push({ table, rows, gone });
      }
    }
    if (this.disposed) return;
    this.lastPullAt = Date.now();
    this.reportDiscarded(this.applyRemote(changes));
    this.localChanged();
  }

  /** Các bảng mà máy chủ đang có thứ khác với bản máy này giữ. So bằng dấu vân tay; không so được thì coi như bảng nào cũng cần xem. */
  private async staleTables(tables: DocTable[]): Promise<DocTable[]> {
    const server = await withTimeout(this.remote.fingerprints(), SYNC_TIMING.readTimeoutMs);
    if (!server) return tables;
    const local = await Promise.all(tables.map((table) => fingerprintOf(this.knownHeads(table))));
    return tables.filter((table, i) => local[i] === null || local[i] !== server[table]);
  }

  private knownHeads(table: DocTable): RemoteHead[] {
    const prefix = `${table}/`;
    const heads: RemoteHead[] = [];
    for (const [key, known] of this.shadow) {
      if (key.startsWith(prefix)) heads.push({ id: key.slice(prefix.length), rev: known.rev });
    }
    return heads;
  }

  private onRemoteEvent(event: RemoteEvent): void {
    if (this.disposed) return;
    if (event.table === "profiles") {
      this.host.onProfileEvent?.(event.id);
      return;
    }
    this.log(`event ${event.table}/${event.id} ${event.rev === null ? "deleted" : `rev ${event.rev}`}`);
    this.pendingEvents.set(keyOf(event.table, event.id), event);
    if (this.eventTimer) return;
    this.eventTimer = setTimeout(() => {
      this.eventTimer = null;
      void this.enqueue(() => this.drainEvents()).catch(() => {
        // Không tải được (mất mạng): lần hỏi định kỳ sau sẽ bù.
      });
    }, SYNC_TIMING.eventDelayMs);
  }

  /** Tải về đúng các dòng mà tín hiệu Realtime báo là đã đổi (bỏ qua tín hiệu dội lại từ chính các lần gửi của máy này). */
  private async drainEvents(): Promise<void> {
    if (this.disposed || !this.started) return;
    const events = [...this.pendingEvents.values()];
    this.pendingEvents.clear();
    const wanted = new Map<DocTable, string[]>();
    for (const event of events) {
      const table = event.table as DocTable;
      const known = this.shadow.get(keyOf(table, event.id));
      const news = event.rev === null ? known !== undefined : !known || known.rev < event.rev;
      if (news) wanted.set(table, [...(wanted.get(table) ?? []), event.id]);
    }
    const changes: TableChange[] = [];
    for (const [table, ids] of wanted) {
      const rows = await withTimeout(this.remote.load(table, ids), SYNC_TIMING.readTimeoutMs);
      this.log(`events ${table}: asked ${ids.join(", ")}; got ${rows.map((row) => `${row.id}@${row.rev}`).join(", ") || "-"}`);
      const found = new Set(rows.map((row) => row.id));
      // Không tải được dòng nào cho một id mình đang giữ: dòng đó đã bị xóa (hoặc không còn được thấy).
      const gone = ids.filter((id) => !found.has(id) && this.shadow.has(keyOf(table, id)));
      changes.push({ table, rows, gone });
    }
    if (this.disposed || changes.length === 0) return;
    this.reportDiscarded(this.applyRemote(changes));
    this.localChanged();
  }

  private reportDiscarded(labels: string[]): void {
    if (labels.length === 0) return;
    const list = labels.length <= 3 ? labels.join(", ") : `${labels.slice(0, 3).join(", ")} và ${labels.length - 3} bản ghi khác`;
    this.host.notify(
      `${capitalize(list)} vừa được sửa hoặc xóa ở nơi khác. Đã tải bản mới nhất; thay đổi chưa kịp lưu của bạn ở đó đã bị bỏ.`,
      "error",
    );
  }

  /**
   * Đưa các dòng vừa tải về vào dữ liệu trên máy và ghi nhận chúng là «bản máy chủ giữ».
   * Trả về tên các bản ghi mà thay đổi chưa lưu trên máy bị bản máy chủ thay thế.
   */
  private applyRemote(changes: TableChange[]): string[] {
    const discarded: string[] = [];
    this.host.apply((db) => {
      let next = db;
      for (const change of changes) {
        if (change.rows.length === 0 && change.gone.length === 0) continue;
        if (change.table === "programs") {
          next = { ...next, programs: this.mergeList("programs", next.programs, change, this.host.normalize.program, discarded) };
        } else if (change.table === "orders") {
          next = { ...next, orders: this.mergeList("orders", next.orders, change, this.host.normalize.order, discarded) };
        } else {
          next = this.mergeState(next, change, discarded);
        }
      }
      return next;
    });
    return discarded;
  }

  private mergeList<T extends { id: string }>(
    table: ListTable,
    list: T[],
    change: TableChange,
    normalize: (raw: unknown) => T,
    discarded: string[],
  ): T[] {
    // Bản máy chủ giữ TRƯỚC lần tải này — để biết bản trên máy có thay đổi chưa lưu hay không.
    const before = new Map<string, Shadow | undefined>();
    const incoming = new Map<string, T>();
    for (const row of change.rows) {
      const key = keyOf(table, row.id);
      before.set(row.id, this.shadow.get(key));
      const doc = { ...normalize(row.data), id: row.id };
      incoming.set(row.id, doc);
      this.shadow.set(key, { rev: row.rev, doc });
    }
    const gone = new Set<string>();
    for (const id of change.gone) {
      if (incoming.has(id)) continue;
      const key = keyOf(table, id);
      before.set(id, this.shadow.get(key));
      this.shadow.delete(key);
      gone.add(id);
    }
    const placed = new Set<string>();
    const out: T[] = [];
    for (const local of list) {
      const replacement = incoming.get(local.id);
      if (!replacement && !gone.has(local.id)) {
        out.push(local);
        continue;
      }
      // Bản trên máy khác bản máy chủ giữ trước đó nghĩa là có thay đổi chưa lưu — thay đổi ấy bị bản mới thay thế.
      // (Bản ghi máy chủ chưa từng biết: chỉ tính là mất nếu nội dung thật sự khác bản vừa tải về.)
      const known = before.get(local.id);
      const hadUnsaved = known ? known.doc !== local : !replacement || !sameJson(local, replacement);
      if (hadUnsaved) discarded.push(this.labelOf(table, local));
      if (replacement) {
        out.push(replacement);
        placed.add(local.id);
      }
    }
    // Bản ghi mới (chưa có trên máy) đứng trước, mới tạo nhất lên đầu.
    const fresh = [...incoming.values()].filter((doc) => !placed.has(doc.id));
    fresh.sort((a, b) => createdAt(b).localeCompare(createdAt(a)));
    return fresh.length > 0 ? [...fresh, ...out] : out;
  }

  private mergeState(db: DB, change: TableChange, discarded: string[]): DB {
    let next = db;
    for (const row of change.rows) {
      if (row.id === "stock") {
        const known = this.shadow.get(STOCK_KEY);
        if (known && known.doc !== next.stock) discarded.push("tồn kho");
        const stock = this.host.normalize.stock(row.data);
        this.shadow.set(STOCK_KEY, { rev: row.rev, doc: stock });
        next = { ...next, stock };
      } else if (row.id === "settings") {
        const known = this.shadow.get(SETTINGS_KEY);
        if (known && known.doc !== next.settings.lowStockThreshold) discarded.push("ngưỡng cảnh báo tồn kho");
        const threshold = this.host.normalize.threshold(row.data);
        this.shadow.set(SETTINGS_KEY, { rev: row.rev, doc: threshold });
        if (threshold !== next.settings.lowStockThreshold) next = { ...next, settings: { ...next.settings, lowStockThreshold: threshold } };
      }
    }
    return next;
  }
}

function createdAt(doc: unknown): string {
  return isObject(doc) && typeof doc.createdAt === "string" ? doc.createdAt : "";
}
