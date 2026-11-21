import { describe, expect, it } from "vitest";
import { compareAsUtf8, fingerprintOf, toRemoteError } from "./remote";

describe("toRemoteError", () => {
  it("no answer, server trouble, overload and an expired session are worth retrying", () => {
    expect(toRemoteError({ message: "TypeError: Failed to fetch" }, 0).kind).toBe("network");
    expect(toRemoteError({ code: "PGRST002", message: "Could not query the database for the schema cache" }, 503).kind).toBe("network");
    expect(toRemoteError({ code: "57014", message: "canceling statement due to statement timeout" }, 500).kind).toBe("network");
    expect(toRemoteError({ code: "PGRST301", message: "JWT expired" }, 401).kind).toBe("network");
    expect(toRemoteError({ message: "Too Many Requests" }, 429).kind).toBe("network");
    expect(toRemoteError(null, 502).kind).toBe("network");
    // Không còn phiên đăng nhập: PostgREST trả 401 kèm 42501. Việc của phần đăng nhập — không coi là «không có quyền».
    expect(toRemoteError({ code: "42501", message: "permission denied for table orders" }, 401).kind).toBe("network");
  });

  it("a missing permission is a denial, whichever status carries it", () => {
    expect(toRemoteError({ code: "42501", message: "new row violates row-level security policy" }, 403).kind).toBe("denied");
    expect(toRemoteError({ code: "42501", message: "Chỉ người quản lý mới đổi được vai trò." }, 500).kind).toBe("denied");
    expect(toRemoteError({ message: "Forbidden" }, 403).kind).toBe("denied");
  });

  it("a duplicate id is a conflict", () => {
    expect(toRemoteError({ code: "23505", message: 'duplicate key value violates unique constraint "orders_pkey"' }, 409).kind).toBe("conflict");
  });

  it("a deliberate refusal keeps the database's own explanation, even when it comes with a 5xx status", () => {
    const guard = toRemoteError({ code: "23503", message: "Không xóa được: còn 3 đơn hàng thuộc chương trình này." }, 409);
    expect(guard.kind).toBe("rejected");
    expect(guard.message).toBe("Không xóa được: còn 3 đơn hàng thuộc chương trình này.");
    const raised = toRemoteError({ code: "P0002", message: "Không tìm thấy tài khoản." }, 500);
    expect(raised.kind).toBe("rejected");
    expect(raised.message).toBe("Không tìm thấy tài khoản.");
    expect(toRemoteError({ code: "23514", message: "violates check constraint" }, 400).kind).toBe("rejected");
    expect(toRemoteError({}, 400).message).toBe("Máy chủ từ chối yêu cầu (mã 400).");
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
