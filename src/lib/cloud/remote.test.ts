import { describe, expect, it } from "vitest";
import { ApiError, type ApiClient } from "./api";
import { RemoteError, compareAsUtf8, fingerprintOf, httpRemote, toRemoteError, type PollInfo } from "./remote";

describe("toRemoteError", () => {
  it("no answer, server trouble, overload and an expired session are worth retrying", () => {
    expect(toRemoteError(new ApiError("network", "Không kết nối được máy chủ.", 0)).kind).toBe("network");
    expect(toRemoteError(new ApiError("unavailable", "Máy chủ dữ liệu đang bận.", 503)).kind).toBe("network");
    expect(toRemoteError(new ApiError("server", "Có lỗi trên máy chủ.", 500)).kind).toBe("network");
    expect(toRemoteError(new ApiError("rate_limited", "Thử quá nhiều lần.", 429)).kind).toBe("network");
    expect(toRemoteError(new ApiError("not_installed", "Database chưa được cài đặt.", 503)).kind).toBe("network");
    // Phiên đăng nhập hết hạn là việc của phần đăng nhập — không coi là «không có quyền», không bỏ thay đổi trên máy.
    expect(toRemoteError(new ApiError("unauthorized", "Phiên đăng nhập đã hết hạn.", 401)).kind).toBe("network");
    // Lỗi chưa lường trong chính trình duyệt cũng không được làm mất thay đổi.
    expect(toRemoteError(new TypeError("boom")).kind).toBe("network");
  });

  it("a missing permission is a denial and keeps the server's explanation", () => {
    const denied = toRemoteError(new ApiError("forbidden", "Chỉ người quản lý mới sửa được chương trình.", 403));
    expect(denied.kind).toBe("denied");
    expect(denied.message).toBe("Chỉ người quản lý mới sửa được chương trình.");
  });

  it("a duplicate id is a conflict", () => {
    expect(toRemoteError(new ApiError("conflict", "Bản ghi này đã có trên máy chủ.", 409)).kind).toBe("conflict");
  });

  it("a deliberate refusal keeps the server's own explanation", () => {
    const guard = toRemoteError(new ApiError("rejected", "Không xóa được: còn 3 đơn hàng thuộc chương trình này.", 422));
    expect(guard.kind).toBe("rejected");
    expect(guard.message).toBe("Không xóa được: còn 3 đơn hàng thuộc chương trình này.");
    expect(toRemoteError(new ApiError("bad_request", "Mã bản ghi không hợp lệ.", 400)).kind).toBe("rejected");
    expect(toRemoteError(new ApiError("too_large", "Dữ liệu gửi lên quá lớn.", 413)).kind).toBe("rejected");
    expect(toRemoteError(new ApiError("not_found", "Không tìm thấy.", 404)).kind).toBe("rejected");
    expect(toRemoteError(new ApiError("rejected", "", 422)).message).toBe("Máy chủ từ chối yêu cầu (mã 422).");
  });

  it("passes an error that is already classified straight through", () => {
    const original = new RemoteError("conflict", "x");
    expect(toRemoteError(original)).toBe(original);
  });
});

/** Một lớp API giả: trả lời từng lệnh bằng hàm cho sẵn và ghi lại các lệnh đã nhận. */
function fakeApi(answer: (op: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
  const api: ApiClient = {
    async call<T>(op: string, args: Record<string, unknown> = {}) {
      calls.push({ op, args });
      return answer(op, args) as T;
    },
    getToken: () => "token",
    setToken() {},
    onTokenChange: () => () => {},
    onUnauthorized: () => () => {},
  };
  return { api, calls };
}

describe("httpRemote", () => {
  it("reads every page of a table, following the server's cursor", async () => {
    const pages: Record<string, unknown> = {
      "": { rows: [{ id: "a", rev: 1, data: { n: 1 } }, { id: "b", rev: 2, data: { n: 2 } }], next: "b" },
      b: { rows: [{ id: "c", rev: 3, data: { n: 3 } }], next: "c" },
      c: { rows: [], next: null },
    };
    const { api, calls } = fakeApi((_op, args) => pages[(args.after as string | undefined) ?? ""]);
    const rows = await httpRemote(api).load("orders", null);
    expect(rows).toEqual([
      { id: "a", rev: 1, data: { n: 1 } },
      { id: "b", rev: 2, data: { n: 2 } },
      { id: "c", rev: 3, data: { n: 3 } },
    ]);
    expect(calls.map((call) => call.args)).toEqual([{ table: "orders" }, { table: "orders", after: "b" }, { table: "orders", after: "c" }]);
  });

  it("asks for documents by id in chunks, and pages inside a chunk when the server cuts it short", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `o-${String(i).padStart(3, "0")}`);
    const { api, calls } = fakeApi((_op, args) => {
      const wanted = (args.ids as string[]).filter((id) => args.after === undefined || id > (args.after as string));
      const batch = wanted.slice(0, 150);
      return { rows: batch.map((id) => ({ id, rev: 1, data: {} })), next: wanted.length > batch.length ? batch[batch.length - 1] : null };
    });
    const rows = await httpRemote(api).load("orders", ids);
    expect(rows.map((row) => row.id)).toEqual(ids);
    // 450 id → 3 nhóm (200, 200, 50); hai nhóm đầu mỗi nhóm cần 2 trang.
    expect(calls.map((call) => (call.args.ids as string[]).length)).toEqual([200, 200, 200, 200, 50]);
  });

  it("stops instead of looping when the server's cursor does not move", async () => {
    const { api, calls } = fakeApi(() => ({ rows: [{ id: "a", rev: 1, data: {} }], next: "a" }));
    const rows = await httpRemote(api).load("programs", null);
    expect(calls).toHaveLength(2);
    expect(rows).toHaveLength(2);
  });

  it("skips rows that are not rows", async () => {
    const { api } = fakeApi(() => ({ rows: [null, { id: "", rev: 1 }, { id: "x", rev: "nope" }, { id: "ok", rev: "4", data: 1 }], next: null }));
    expect(await httpRemote(api).load("orders", null)).toEqual([{ id: "ok", rev: 4, data: 1 }]);
  });

  it("the poll returns the fingerprints and hands the rest (profile, accounts) to the hook", async () => {
    const seen: PollInfo[] = [];
    const prints = { programs: "p", orders: "o", app_state: "s" };
    const { api } = fakeApi(() => ({ me: { id: "u1", role: "manager" }, fingerprints: prints, accounts: { pending: 2, stamp: "abc" } }));
    const before = Date.now();
    expect(await httpRemote(api, { onPoll: (info) => seen.push(info) }).fingerprints()).toEqual(prints);
    expect(seen).toHaveLength(1);
    expect(seen[0].me).toEqual({ id: "u1", role: "manager" });
    expect(seen[0].accounts).toEqual({ pending: 2, stamp: "abc" });
    expect(seen[0].askedAt).toBeGreaterThanOrEqual(before);
    expect(seen[0].askedAt).toBeLessThanOrEqual(Date.now());
  });

  it("an account that is no longer approved gets a denial — after the hook has seen the new profile", async () => {
    const seen: PollInfo[] = [];
    const { api } = fakeApi(() => ({ me: { id: "u1", role: "locked" }, fingerprints: null, accounts: null }));
    await expect(httpRemote(api, { onPoll: (info) => seen.push(info) }).fingerprints()).rejects.toMatchObject({ kind: "denied" });
    expect(seen.map((info) => info.me)).toEqual([{ id: "u1", role: "locked" }]);
    expect(seen[0].accounts).toBeNull();
  });

  it("maps writes: insert returns the server's code, a stale update is null, remove is a boolean", async () => {
    const { api, calls } = fakeApi((op) => {
      if (op === "sync.insert") return { id: "o1", rev: 1, code: "DH261121-001" };
      if (op === "sync.update") return null;
      return true;
    });
    const remote = httpRemote(api);
    expect(await remote.insert("orders", "o1", { id: "o1" })).toEqual({ id: "o1", rev: 1, code: "DH261121-001" });
    expect(await remote.update("orders", "o1", 3, { id: "o1" })).toBeNull();
    expect(await remote.remove("orders", "o1")).toBe(true);
    expect(calls).toEqual([
      { op: "sync.insert", args: { table: "orders", id: "o1", data: { id: "o1" } } },
      { op: "sync.update", args: { table: "orders", id: "o1", rev: 3, data: { id: "o1" } } },
      { op: "sync.remove", args: { table: "orders", id: "o1" } },
    ]);
  });

  it("turns API failures into the sync engine's own error kinds", async () => {
    const { api } = fakeApi(() => {
      throw new ApiError("forbidden", "Chỉ người quản lý mới tạo được chương trình.", 403);
    });
    await expect(httpRemote(api).insert("programs", "p1", {})).rejects.toMatchObject({
      name: "RemoteError",
      kind: "denied",
      message: "Chỉ người quản lý mới tạo được chương trình.",
    });
  });

  it("has no live channel: reports «not live» once so the engine polls", () => {
    const { api } = fakeApi(() => null);
    const live: boolean[] = [];
    const stop = httpRemote(api).subscribe(
      () => {},
      (value) => live.push(value),
    );
    expect(live).toEqual([false]);
    stop();
  });
});

describe("compareAsUtf8", () => {
  const utf8Order = (a: string, b: string) => Math.sign(Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));

  it("agrees with plain comparison for ASCII ids", () => {
    const ids = ["o-b", "o-a", "p1", "O-A", "o-a1", "", "o_a", "o-10", "o-9"];
    expect([...ids].sort(compareAsUtf8)).toEqual([...ids].sort());
  });

  it("puts characters outside the basic plane after U+E000–U+FFFF, as UTF-8 bytes do", () => {
    const emoji = "\u{1F600}";
    expect(emoji < "�").toBe(true); // thứ tự của JavaScript (UTF-16) — ngược với máy chủ
    expect(compareAsUtf8(emoji, "�")).toBeGreaterThan(0);
    expect(compareAsUtf8("", emoji)).toBeLessThan(0);
    expect(compareAsUtf8("a" + emoji, "aＡ")).toBeGreaterThan(0);
    expect(compareAsUtf8(emoji, "\u{1F601}")).toBeLessThan(0);
    expect(compareAsUtf8("đơn", "đơn")).toBe(0);
    expect(compareAsUtf8("đơn", "đơn-2")).toBeLessThan(0);
  });

  it("matches the byte order of UTF-8 on arbitrary strings", () => {
    const alphabet = ["a", "Z", "0", "-", ":", ",", "é", "đ", "ơ", "߿", "ࠀ", "퟿", "", "�", "￿", "\u{10000}", "\u{1F600}", "\u{10FFFF}"];
    let seed = 20261121;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const word = () => Array.from({ length: next() % 5 }, () => alphabet[next() % alphabet.length]).join("");
    for (let i = 0; i < 3000; i++) {
      const a = word();
      const b = word();
      expect(Math.sign(compareAsUtf8(a, b)), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(utf8Order(a, b));
    }
  });
});

describe("fingerprintOf", () => {
  it("is the SHA-256 of nothing for an empty table", async () => {
    expect(await fingerprintOf([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("does not depend on the order the rows are held in, but does on any id or rev", async () => {
    const a = await fingerprintOf([{ id: "o-1", rev: 3 }, { id: "o-2", rev: 1 }]);
    expect(await fingerprintOf([{ id: "o-2", rev: 1 }, { id: "o-1", rev: 3 }])).toBe(a);
    expect(await fingerprintOf([{ id: "o-1", rev: 4 }, { id: "o-2", rev: 1 }])).not.toBe(a);
    expect(await fingerprintOf([{ id: "o-1", rev: 3 }])).not.toBe(a);
    // sha256("o-1:3,o-2:1")
    const { createHash } = await import("node:crypto");
    expect(a).toBe(createHash("sha256").update("o-1:3,o-2:1").digest("hex"));
  });
});
