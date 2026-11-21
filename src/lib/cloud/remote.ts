// Đọc / ghi dữ liệu trên máy chủ. Ba bảng tài liệu: `programs`, `orders` (mỗi dòng một tài liệu JSON) và `app_state`
// (hai dòng dùng chung: tồn kho, thiết lập). Mỗi dòng có `rev` tăng 1 sau mỗi lần ghi — xem server/schema.sql.
// Bộ đồng bộ (sync.ts) chỉ biết giao diện `Remote` dưới đây, nên kiểm thử được bằng một máy chủ giả.
import { ApiError, NETWORK_MESSAGE, type ApiClient } from "./api";

export type DocTable = "programs" | "orders" | "app_state";
/** Bảng mà trình duyệt được thêm / xóa dòng (hai dòng của `app_state` có sẵn, chỉ sửa). */
export type ListTable = "programs" | "orders";

export interface RemoteHead {
  id: string;
  rev: number;
}

export interface RemoteRow extends RemoteHead {
  data: unknown;
}

/** Một dòng vừa thay đổi trên máy chủ (tín hiệu tức thời, nếu đường nối tới máy chủ có phát). `rev` null = dòng đã bị xóa. */
export interface RemoteEvent {
  table: DocTable;
  id: string;
  rev: number | null;
}

/**
 * Lý do một lệnh gọi máy chủ thất bại:
 *  network   không tới được máy chủ hoặc máy chủ đang lỗi — thử lại sau là được;
 *  denied    tài khoản không có quyền làm việc này;
 *  conflict  dòng đã tồn tại (thêm trùng id);
 *  rejected  máy chủ từ chối dữ liệu (vd xóa chương trình còn đơn hàng) — `message` là lời giải thích của máy chủ.
 */
export type RemoteFailure = "network" | "denied" | "conflict" | "rejected";

export class RemoteError extends Error {
  constructor(
    readonly kind: RemoteFailure,
    message: string,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

export interface Remote {
  /**
   * «Dấu vân tay» của những gì tài khoản này được thấy ở từng bảng: SHA-256 (hex) của chuỗi "id:rev,id:rev,…" xếp theo id
   * (xem `fingerprintOf`). Một lệnh gọi nhỏ, để biết có gì mới mà không phải tải danh sách. null = máy chủ không hỗ trợ.
   */
  fingerprints(): Promise<Record<DocTable, string> | null>;
  /** id + rev của mọi dòng tài khoản này được thấy. */
  heads(table: DocTable): Promise<RemoteHead[]>;
  /** Tài liệu của các dòng có id trong `ids`; `null` = mọi dòng được thấy. */
  load(table: DocTable, ids: string[] | null): Promise<RemoteRow[]>;
  /** Thêm một dòng. Với đơn hàng, `code` là mã đơn máy chủ đã ghi (máy chủ tự cấp nếu tài liệu gửi lên chưa có mã). */
  insert(table: ListTable, id: string, data: unknown): Promise<RemoteHead & { code?: string }>;
  /**
   * Sửa một dòng, chỉ khi `rev` trên máy chủ còn đúng bằng `rev` trình duyệt đang biết.
   * Trả về null nếu không sửa được dòng nào: người khác vừa sửa (rev đã khác), dòng không còn, hoặc không có quyền.
   */
  update(table: DocTable, id: string, rev: number, data: unknown): Promise<RemoteHead | null>;
  /** Xóa một dòng. false = không xóa được dòng nào (đã bị xóa từ trước, hoặc không có quyền). */
  remove(table: ListTable, id: string): Promise<boolean>;
  /**
   * Nhận tín hiệu mỗi khi một dòng thay đổi trên máy chủ. `onLive(true)` khi máy chủ bắt đầu phát thay đổi (có thể gọi
   * nhiều lần — mỗi lần là một lần «vừa thông», những gì xảy ra trước đó có thể đã không được phát); `onLive(false)` khi
   * kênh đứt, chưa sẵn sàng, hoặc đường nối này không phát được (khi đó bộ đồng bộ tự hỏi máy chủ định kỳ). Trả về hàm hủy.
   */
  subscribe(onEvent: (event: RemoteEvent) => void, onLive: (live: boolean) => void): () => void;
}

/**
 * Dấu vân tay của một tập dòng, tính giống hệt hàm `km.fingerprints()` trên máy chủ.
 * null = trình duyệt không tính được SHA-256 (trang không chạy trên https) — khi đó phải so bằng danh sách id + rev.
 */
export async function fingerprintOf(heads: RemoteHead[]): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const text = [...heads]
    .sort((a, b) => compareAsUtf8(a.id, b.id))
    .map((head) => `${head.id}:${head.rev}`)
    .join(",");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * So hai chuỗi theo thứ tự byte UTF-8 — thứ tự mà máy chủ dùng (`collate "C"`). Chuỗi của JavaScript là UTF-16, hai thứ tự
 * chỉ khác nhau ở một chỗ: ký tự ngoài mặt phẳng cơ bản (vd emoji) đứng SAU các ký tự U+E000–U+FFFF trong UTF-8,
 * nhưng đứng TRƯỚC trong UTF-16.
 */
export function compareAsUtf8(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xd800 && y >= 0xd800) {
      // Đổi chỗ hai dải: nửa ký tự (D800–DFFF) lên trên, E000–FFFF xuống dưới.
      x = x >= 0xe000 ? x - 0x800 : x + 0x2000;
      y = y >= 0xe000 ? y - 0x800 : y + 0x2000;
    }
    return x - y;
  }
  return a.length - b.length;
}

// ───────────────────────── Qua lớp API của ứng dụng ─────────────────────────

/** Những gì một lần hỏi định kỳ (`sync.poll`) mang về ngoài dấu vân tay dữ liệu. */
export interface PollInfo {
  /** Hồ sơ của tài khoản đang đăng nhập theo máy chủ (vai trò có thể vừa được quản lý đổi). */
  me: unknown;
  /** Chỉ quản lý nhận được: số tài khoản chờ duyệt, và một «dấu» đổi mỗi khi danh sách tài khoản có thay đổi. */
  accounts: { pending: number; stamp: string } | null;
  /** `Date.now()` lúc gửi câu hỏi. */
  askedAt: number;
}

export interface HttpRemoteHooks {
  onPoll?(info: PollInfo): void;
}

/** Mỗi lần hỏi tài liệu theo danh sách id thì hỏi tối đa chừng này id (máy chủ nhận tối đa 500). */
const ID_CHUNK = 200;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Phân loại lỗi của lớp API theo cách bộ đồng bộ cần xử lý. */
export function toRemoteError(error: unknown): RemoteError {
  if (error instanceof RemoteError) return error;
  // Lỗi chưa lường (không phải do máy chủ trả lời): giữ nguyên thay đổi trên máy, thử lại sau.
  if (!(error instanceof ApiError)) return new RemoteError("network", NETWORK_MESSAGE);
  // Mất mạng, máy chủ bận / quá tải, hoặc phiên đăng nhập vừa hết hạn (phần đăng nhập tự xử lý việc đó): cũng thử lại sau.
  if (error.temporary || error.code === "unauthorized") return new RemoteError("network", NETWORK_MESSAGE);
  if (error.code === "forbidden") return new RemoteError("denied", error.message || "Tài khoản của bạn không có quyền làm việc này.");
  if (error.code === "conflict") return new RemoteError("conflict", error.message || "Bản ghi này đã có trên máy chủ.");
  return new RemoteError("rejected", error.message || `Máy chủ từ chối yêu cầu (mã ${error.status}).`);
}

function toHead(value: unknown): RemoteHead | null {
  if (!isObject(value) || typeof value.id !== "string" || value.id === "") return null;
  const rev = Number(value.rev);
  return Number.isFinite(rev) ? { id: value.id, rev } : null;
}

function toAccounts(value: unknown): PollInfo["accounts"] {
  if (!isObject(value) || typeof value.stamp !== "string") return null;
  const pending = Number(value.pending);
  return { pending: Number.isFinite(pending) && pending > 0 ? Math.floor(pending) : 0, stamp: value.stamp };
}

export function httpRemote(api: ApiClient, hooks: HttpRemoteHooks = {}): Remote {
  async function call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    try {
      return await api.call<T>(op, args);
    } catch (error) {
      throw toRemoteError(error);
    }
  }

  /** Đọc hết các trang của một lần hỏi tài liệu (máy chủ chia trang theo số dòng và theo dung lượng). */
  async function loadPages(table: DocTable, ids: string[] | null): Promise<RemoteRow[]> {
    const rows: RemoteRow[] = [];
    let after: string | null = null;
    for (;;) {
      const page: { rows?: unknown; next?: unknown } | null = await call("sync.load", {
        table,
        ...(ids ? { ids } : {}),
        ...(after !== null ? { after } : {}),
      });
      const batch = Array.isArray(page?.rows) ? page.rows : [];
      for (const item of batch) {
        const head = toHead(item);
        if (head) rows.push({ ...head, data: (item as { data?: unknown }).data });
      }
      const next = page?.next;
      // Hết trang — hoặc máy chủ trả lời lạ (trang rỗng, con trỏ không tiến): dừng, không hỏi mãi.
      if (typeof next !== "string" || batch.length === 0 || next === after) return rows;
      after = next;
    }
  }

  return {
    async fingerprints() {
      const askedAt = Date.now();
      const result = await call<{ me?: unknown; fingerprints?: unknown; accounts?: unknown } | null>("sync.poll");
      hooks.onPoll?.({ me: result?.me ?? null, accounts: toAccounts(result?.accounts), askedAt });
      const prints = result?.fingerprints;
      // Máy chủ chỉ gửi dấu vân tay cho tài khoản đã được duyệt.
      if (!isObject(prints)) throw new RemoteError("denied", "Tài khoản của bạn chưa được duyệt hoặc đã bị khóa.");
      const ok = typeof prints.programs === "string" && typeof prints.orders === "string" && typeof prints.app_state === "string";
      return ok ? (prints as Record<DocTable, string>) : null;
    },

    async heads(table) {
      const list = await call<unknown>("sync.heads", { table });
      return (Array.isArray(list) ? list : []).map(toHead).filter((head): head is RemoteHead => head !== null);
    },

    async load(table, ids) {
      if (ids === null) return loadPages(table, null);
      const out: RemoteRow[] = [];
      for (let at = 0; at < ids.length; at += ID_CHUNK) out.push(...(await loadPages(table, ids.slice(at, at + ID_CHUNK))));
      return out;
    },

    async insert(table, id, data) {
      const result = await call<unknown>("sync.insert", { table, id, data });
      const head = toHead(result);
      if (!head) throw new RemoteError("network", NETWORK_MESSAGE);
      const code = isObject(result) && typeof result.code === "string" ? result.code : undefined;
      return { ...head, code };
    },

    async update(table, id, rev, data) {
      return toHead(await call<unknown>("sync.update", { table, id, rev, data }));
    },

    async remove(table, id) {
      return (await call<unknown>("sync.remove", { table, id })) === true;
    },

    subscribe(_onEvent, onLive) {
      // Lớp API không có kênh báo thay đổi tức thời: bộ đồng bộ tự hỏi lại định kỳ (xem SYNC_TIMING trong sync.ts).
      onLive(false);
      return () => {};
    },
  };
}
