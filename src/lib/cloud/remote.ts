// Đọc / ghi dữ liệu trên máy chủ. Ba bảng tài liệu: `programs`, `orders` (mỗi dòng một tài liệu JSON) và `app_state`
// (hai dòng dùng chung: tồn kho, thiết lập). Mỗi dòng có `rev` tăng 1 sau mỗi lần ghi — xem supabase/migrations.
// Bộ đồng bộ (sync.ts) chỉ biết giao diện `Remote` dưới đây, nên kiểm thử được bằng một máy chủ giả.
import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Một dòng vừa thay đổi trên máy chủ (tín hiệu Realtime). `rev` null = dòng đã bị xóa. */
export interface RemoteEvent {
  table: DocTable | "profiles";
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
   * kênh đứt, chưa sẵn sàng, hoặc máy chủ không phát được. Trả về hàm hủy đăng ký.
   */
  subscribe(onEvent: (event: RemoteEvent) => void, onLive: (live: boolean) => void): () => void;
}

/**
 * Dấu vân tay của một tập dòng, tính giống hệt hàm `sync_fingerprint()` trên máy chủ.
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

// ───────────────────────── Supabase ─────────────────────────

const ID_COLUMN: Record<DocTable | "profiles", string> = { programs: "id", orders: "id", app_state: "key", profiles: "id" };
const PAGE_SIZE = 1000;
const ID_CHUNK = 100;

interface ApiError {
  message?: string;
  code?: string;
}

/** Phân loại lỗi của Supabase (PostgREST) theo cách bộ đồng bộ cần xử lý. */
export function toRemoteError(error: ApiError | null | undefined, status: number): RemoteError {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").trim();
  // Không có phản hồi (mất mạng), máy chủ lỗi, quá tải, hoặc phiên đăng nhập vừa hết hạn / vừa mất (401 — phần đăng nhập
  // sẽ tự xử lý): để nguyên thay đổi, thử lại sau.
  // (Thử lại mãi một lệnh mà cơ sở dữ liệu đã cố ý từ chối thì vô ích — loại đó xét ở dưới, kể cả khi đi kèm mã 5xx.)
  if (!status || status === 401 || status === 408 || status === 429 || (status >= 500 && !isDeliberateRefusal(code))) {
    return new RemoteError("network", "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  }
  if (code === "42501" || status === 403) {
    return new RemoteError("denied", "Tài khoản của bạn không có quyền làm việc này.");
  }
  if (code === "23505") return new RemoteError("conflict", "Bản ghi này đã có trên máy chủ.");
  return new RemoteError("rejected", message || `Máy chủ từ chối yêu cầu (mã ${status}).`);
}

/** Lời từ chối có chủ ý của cơ sở dữ liệu (không phải trục trặc tạm thời), dù PostgREST có gửi kèm mã HTTP 5xx. */
function isDeliberateRefusal(code: string): boolean {
  // 42501: không có quyền. 23xxx: vi phạm ràng buộc. P0xxx: lỗi do các hàm của ứng dụng tự báo (raise exception).
  return code === "42501" || /^(23|P0)[0-9A-Z]{3}$/.test(code);
}

export function supabaseRemote(sb: SupabaseClient): Remote {
  /** Đọc hết các trang của một câu truy vấn (máy chủ giới hạn số dòng mỗi lần trả về). */
  async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: ApiError | null; status: number; count: number | null }>): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      const { data, error, status, count } = await page(rows.length, rows.length + PAGE_SIZE - 1);
      if (error) throw toRemoteError(error, status);
      const batch = (data as T[] | null) ?? [];
      rows.push(...batch);
      if (batch.length === 0 || (count != null && rows.length >= count)) return rows;
    }
  }

  // Máy chủ chưa có hàm sync_fingerprint (bản lược đồ cũ): thôi không hỏi nữa, dùng danh sách id + rev.
  let fingerprintsSupported = true;

  return {
    async fingerprints() {
      if (!fingerprintsSupported) return null;
      const { data, error, status } = await sb.rpc("sync_fingerprint");
      if (error) {
        if (error.code === "PGRST202" || status === 404) {
          fingerprintsSupported = false;
          return null;
        }
        throw toRemoteError(error, status);
      }
      const value = data as Partial<Record<DocTable, unknown>> | null;
      const ok = value && typeof value.programs === "string" && typeof value.orders === "string" && typeof value.app_state === "string";
      return ok ? (value as Record<DocTable, string>) : null;
    },

    async heads(table) {
      const col = ID_COLUMN[table];
      const rows = await readAll<Record<string, unknown>>((from, to) =>
        sb.from(table).select(`${col}, rev`, { count: "exact" }).order(col).range(from, to),
      );
      return rows.map((row) => ({ id: String(row[col]), rev: Number(row.rev) }));
    },

    async load(table, ids) {
      const col = ID_COLUMN[table];
      const columns = `${col}, rev, data`;
      const toRow = (row: Record<string, unknown>): RemoteRow => ({ id: String(row[col]), rev: Number(row.rev), data: row.data });
      if (ids === null) {
        const rows = await readAll<Record<string, unknown>>((from, to) =>
          sb.from(table).select(columns, { count: "exact" }).order(col).range(from, to),
        );
        return rows.map(toRow);
      }
      const out: RemoteRow[] = [];
      for (let at = 0; at < ids.length; at += ID_CHUNK) {
        const { data, error, status } = await sb.from(table).select(columns).in(col, ids.slice(at, at + ID_CHUNK));
        if (error) throw toRemoteError(error, status);
        out.push(...((data as unknown as Record<string, unknown>[] | null) ?? []).map(toRow));
      }
      return out;
    },

    async insert(table, id, data) {
      const { data: rows, error, status } = await sb
        .from(table)
        .insert({ id, data })
        .select(table === "orders" ? "id, rev, code" : "id, rev");
      if (error) throw toRemoteError(error, status);
      const row = (rows as unknown as Array<{ id: string; rev: number; code?: string }> | null)?.[0];
      // Thêm được mà không đọc lại được dòng vừa thêm: tài khoản không có quyền xem nó.
      if (!row) throw new RemoteError("denied", "Tài khoản của bạn không có quyền làm việc này.");
      return { id: row.id, rev: Number(row.rev), code: row.code };
    },

    async update(table, id, rev, data) {
      const col = ID_COLUMN[table];
      const { data: rows, error, status } = await sb.from(table).update({ data }).eq(col, id).eq("rev", rev).select(`${col}, rev`);
      if (error) throw toRemoteError(error, status);
      const row = (rows as unknown as Record<string, unknown>[] | null)?.[0];
      return row ? { id: String(row[col]), rev: Number(row.rev) } : null;
    },

    async remove(table, id) {
      const { data: rows, error, status } = await sb.from(table).delete().eq("id", id).select("id");
      if (error) throw toRemoteError(error, status);
      return ((rows as unknown[] | null) ?? []).length > 0;
    },

    subscribe(onEvent, onLive) {
      // Tên kênh riêng cho mỗi lần đăng ký: hủy rồi đăng ký lại ngay (React StrictMode) không đụng kênh đang đóng.
      const channel = sb.channel(`kmdb-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
      for (const table of ["programs", "orders", "app_state", "profiles"] as const) {
        channel.on(
          "postgres_changes" as never,
          { event: "*", schema: "public", table } as never,
          (payload: { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
            const col = ID_COLUMN[table];
            const deleted = payload.eventType === "DELETE";
            const id = (deleted ? payload.old : payload.new)?.[col];
            if (typeof id !== "string" || id === "") return;
            const rev = deleted ? null : Number(payload.new?.rev);
            onEvent({ table, id, rev: rev != null && Number.isFinite(rev) ? rev : deleted ? null : 0 });
          },
        );
      }
      // Kênh nối được («SUBSCRIBED») chưa có nghĩa là máy chủ đã phát thay đổi của database: nó báo riêng bằng một tin
      // «system» khi thật sự bắt đầu phát (đo được: lúc dịch vụ vừa khởi động, tin này tới sau hơn một giây, và mọi thay
      // đổi xảy ra trước nó đều không được phát), hoặc khi không phát được (vd bảng chưa được bật Realtime).
      // Chỉ coi kênh là thông khi đã có cả hai; chưa thông thì bộ đồng bộ tự hỏi máy chủ dày hơn.
      let joined = false;
      let streaming = false;
      channel.on("system" as never, {} as never, (payload: { extension?: string; status?: string }) => {
        if (payload?.extension !== "postgres_changes") return;
        streaming = payload.status === "ok";
        onLive(joined && streaming);
      });
      channel.subscribe((status) => {
        joined = status === "SUBSCRIBED";
        // Kênh đứt rồi nối lại thì máy chủ sẽ báo «đang phát» lại từ đầu.
        if (!joined) streaming = false;
        onLive(joined && streaming);
      });
      return () => {
        void sb.removeChannel(channel);
      };
    },
  };
}
