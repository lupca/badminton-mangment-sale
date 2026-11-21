// Tests for the API client (`createApiClient`) against a fake `fetch` and an in-memory key store.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  NETWORK_MESSAGE,
  SESSION_STORAGE_KEY,
  createApiClient,
  errorMessage,
  failureOf,
  type ApiErrorCode,
  type TokenStorage,
} from "./api";

const SERVER_TROUBLE = "Máy chủ đang gặp sự cố. Hãy thử lại sau ít phút.";

function memoryStorage(initial: Record<string, string> = {}): TokenStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (status: number, body = "<!doctype html><html><body>Something went wrong</body></html>") =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

type Sent = { url: string; init: RequestInit };

/** A client whose `fetch` answers with whatever `answer` returns, and remembers what was sent. */
function client(answer: (sent: Sent) => Response | Promise<Response>, stored: string | null = null) {
  const storage = memoryStorage(stored === null ? {} : { [SESSION_STORAGE_KEY]: stored });
  const sent: Sent[] = [];
  const fetchFake = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: String(url), init: init ?? {} };
    sent.push(request);
    return answer(request);
  });
  const api = createApiClient({ url: "/api", fetch: fetchFake as unknown as typeof fetch, storage });
  return { api, sent, storage, fetchFake };
}

/** What a failing call threw. */
async function failure(work: Promise<unknown>): Promise<ApiError> {
  try {
    await work;
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(ApiError);
    return thrown as ApiError;
  }
  throw new Error("the call was expected to fail");
}

const headersOf = (sent: Sent) => sent.init.headers as Record<string, string>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a call", () => {
  it("is one POST to the API address: JSON body { op, args }, no caching, with a time limit", async () => {
    const { api, sent } = client(() => json(200, { result: { ok: 1 } }));
    await api.call("sync.heads", { table: "orders" });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api");
    expect(sent[0].init.method).toBe("POST");
    expect(sent[0].init.cache).toBe("no-store");
    expect(sent[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(headersOf(sent[0])["content-type"]).toBe("application/json");
    expect(JSON.parse(String(sent[0].init.body))).toEqual({ op: "sync.heads", args: { table: "orders" } });
  });

  it("sends empty args when none are given", async () => {
    const { api, sent } = client(() => json(200, { result: true }));
    await api.call("me");
    expect(JSON.parse(String(sent[0].init.body))).toEqual({ op: "me", args: {} });
  });

  it("carries the session key as a Bearer token — only when there is one", async () => {
    const signedOut = client(() => json(200, { result: true }));
    await signedOut.api.call("auth.signIn", { email: "a@b.vn", password: "x" });
    expect(headersOf(signedOut.sent[0])).not.toHaveProperty("authorization");

    const signedIn = client(() => json(200, { result: true }), "key-1");
    await signedIn.api.call("me");
    expect(headersOf(signedIn.sent[0]).authorization).toBe("Bearer key-1");
  });

  it("reads the key at the moment the call is made, so a sign-out right after still tells the server which session to end", async () => {
    const { api, sent } = client(() => json(200, { result: true }), "key-1");
    const pending = api.call("auth.signOut");
    api.setToken(null);
    await pending;
    expect(headersOf(sent[0]).authorization).toBe("Bearer key-1");
  });

  it("returns the `result` of the answer, whatever its type", async () => {
    for (const result of [{ id: "x", rev: 2 }, [1, 2], "text", 0, false, null]) {
      const { api } = client(() => json(200, { result }));
      expect(await api.call("anything")).toEqual(result);
    }
  });
});

describe("a refusal from the API layer", () => {
  const CASES: Array<[number, ApiErrorCode, string]> = [
    [400, "bad_request", "Lệnh không hợp lệ."],
    [400, "invalid_credentials", "Email hoặc mật khẩu không đúng."],
    [401, "unauthorized", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại."],
    [403, "forbidden", "Chỉ người quản lý mới đổi được vai trò."],
    [404, "not_found", "Không tìm thấy tài khoản."],
    [409, "conflict", "Email này đã được đăng ký. Hãy đăng nhập; nếu quên mật khẩu, nhờ người quản lý đặt lại."],
    [413, "too_large", "Dữ liệu gửi lên quá lớn (tối đa khoảng 4 MB mỗi bản ghi)."],
    [422, "rejected", "Không xóa được: còn 3 đơn hàng thuộc chương trình này."],
    [429, "rate_limited", "Bạn thử quá nhiều lần. Hãy chờ 15 phút rồi thử lại."],
    [500, "server", "Có lỗi trên máy chủ. Hãy thử lại."],
    [503, "unavailable", "Máy chủ dữ liệu đang bận hoặc không kết nối được. Hãy thử lại sau ít phút."],
    [503, "not_configured", "Máy chủ chưa được cấu hình database (thiếu DATABASE_URL)."],
    [503, "not_installed", "Database chưa được cài đặt cho ứng dụng (chưa chạy npm run db:setup)."],
  ];

  it("becomes an ApiError with the server's code, status and Vietnamese message", async () => {
    for (const [status, code, message] of CASES) {
      const { api } = client(() => json(status, { error: { code, message } }));
      const error = await failure(api.call("anything"));
      expect([error.code, error.status, error.message]).toEqual([code, status, message]);
      expect(error.name).toBe("ApiError");
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("a known code without a message still gets a sentence to show", async () => {
    const { api } = client(() => json(500, { error: { code: "server", message: "  " } }));
    expect((await failure(api.call("anything"))).message).toBe(SERVER_TROUBLE);
  });

  it("knows which failures are worth retrying", () => {
    const temporary: ApiErrorCode[] = ["network", "server", "unavailable", "rate_limited", "not_configured", "not_installed"];
    const final: ApiErrorCode[] = ["bad_request", "invalid_credentials", "unauthorized", "forbidden", "not_found", "conflict", "too_large", "rejected"];
    for (const code of temporary) expect(new ApiError(code, "x", 0).temporary, code).toBe(true);
    for (const code of final) expect(new ApiError(code, "x", 0).temporary, code).toBe(false);
  });
});

describe("an answer that did not come from the API layer", () => {
  it("an error page is classified by its status", async () => {
    const expected: Array<[number, ApiErrorCode]> = [
      [413, "too_large"],
      [429, "rate_limited"],
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "unavailable"],
      [500, "unavailable"],
      [502, "unavailable"],
      [504, "unavailable"],
    ];
    for (const [status, code] of expected) {
      const { api } = client(() => html(status));
      const error = await failure(api.call("anything"));
      expect([error.status, error.code], String(status)).toEqual([status, code]);
      // Always a sentence in Vietnamese, never the page's own text.
      expect(error.message).not.toMatch(/html|Something/i);
      expect(error.message.length).toBeGreaterThan(10);
    }
  });

  it("JSON with an unknown error code, or with no error at all, falls back to the status too", async () => {
    // Mã lỗi chưa biết từ chính lớp API (máy chủ mới hơn trình duyệt): 4xx là lời từ chối — giữ lời của máy chủ, không thử lại mãi;
    // 5xx vẫn là trục trặc.
    const unknownCode = client(() => json(418, { error: { code: "teapot", message: "Tôi là ấm trà." } }));
    expect(await failure(unknownCode.api.call("x"))).toMatchObject({ code: "rejected", message: "Tôi là ấm trà.", temporary: false });
    const unknownTrouble = client(() => json(520, { error: { code: "teapot", message: "Tôi là ấm trà." } }));
    expect(await failure(unknownTrouble.api.call("x"))).toMatchObject({ code: "unavailable", temporary: true });
    const unknownSilent = client(() => json(418, { error: { code: "teapot" } }));
    expect((await failure(unknownSilent.api.call("x"))).code).toBe("unavailable");
    const bare = client(() => json(403, { message: "Forbidden" }));
    expect((await failure(bare.api.call("x"))).code).toBe("forbidden");
  });

  it("a 200 that is not the API's JSON (the site's own page served in its place) counts as «could not reach the server»", async () => {
    const page = client(() => html(200, "<!doctype html><html><body><div id=root></div></body></html>"));
    const error = await failure(page.api.call("me"));
    expect([error.code, error.status, error.message]).toEqual(["network", 0, NETWORK_MESSAGE]);
  });

  it("a 200 with JSON but no `result` is not mistaken for a success", async () => {
    const { api } = client(() => json(200, { ok: true }));
    const error = await failure(api.call("me"));
    expect(error.code).toBe("unavailable");
    expect(error.temporary).toBe(true);
  });

  it("failureOf: the pure mapping behind all of the above", () => {
    expect(failureOf(422, { error: { code: "rejected", message: "Lý do." } })).toMatchObject({ code: "rejected", status: 422, message: "Lý do." });
    expect(failureOf(500, null)).toMatchObject({ code: "unavailable", message: SERVER_TROUBLE });
    expect(failureOf(401, "<html>")).toMatchObject({ code: "unauthorized" });
    expect(failureOf(403, { error: "nope" })).toMatchObject({ code: "forbidden" });
    expect(failureOf(413, undefined)).toMatchObject({ code: "too_large" });
    expect(failureOf(429, [])).toMatchObject({ code: "rate_limited" });
  });
});

describe("no answer at all", () => {
  it("fetch rejecting (offline, DNS, connection reset) → network", async () => {
    const { api } = client(() => {
      throw new TypeError("Failed to fetch");
    });
    const error = await failure(api.call("me"));
    expect([error.code, error.status, error.message, error.temporary]).toEqual(["network", 0, NETWORK_MESSAGE, true]);
  });

  it("no answer within the time limit → network", async () => {
    const { api, sent } = client(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    const error = await failure(api.call("me", {}, { timeoutMs: 30 }));
    expect(error.code).toBe("network");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(sent[0].init.signal?.aborted).toBe(true);
  });

  it("the connection dropping in the middle of the answer → network", async () => {
    const broken = { ok: true, status: 200, json: () => Promise.reject(new TypeError("terminated")) } as unknown as Response;
    const { api } = client(() => broken);
    expect((await failure(api.call("me"))).code).toBe("network");
  });
});

describe("the session key", () => {
  it("starts from what the browser has stored; blank counts as none", () => {
    expect(client(() => json(200, {}), "key-1").api.getToken()).toBe("key-1");
    expect(client(() => json(200, {})).api.getToken()).toBeNull();
    expect(client(() => json(200, {}), "   ").api.getToken()).toBeNull();
  });

  it("setToken stores it (or removes it) and tells the listeners once per real change", () => {
    const { api, storage } = client(() => json(200, {}));
    const seen: Array<string | null> = [];
    const stop = api.onTokenChange((token) => seen.push(token));

    api.setToken("key-1");
    expect(storage.values.get(SESSION_STORAGE_KEY)).toBe("key-1");
    expect(api.getToken()).toBe("key-1");
    api.setToken("key-1"); // nothing new
    api.setToken("key-2");
    api.setToken(null);
    expect(storage.values.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(api.getToken()).toBeNull();
    expect(seen).toEqual(["key-1", "key-2", null]);

    stop();
    api.setToken("key-3");
    expect(seen).toHaveLength(3);
  });

  it("a second client on the same store (a reload of the page) picks the key up", () => {
    const first = client(() => json(200, {}));
    first.api.setToken("key-1");
    const second = createApiClient({ url: "/api", fetch: first.fetchFake as unknown as typeof fetch, storage: first.storage });
    expect(second.getToken()).toBe("key-1");
  });

  it("without any storage the key lives in memory only", async () => {
    const sent: RequestInit[] = [];
    const api = createApiClient({
      url: "/api",
      storage: null,
      fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        sent.push(init ?? {});
        return json(200, { result: true });
      }) as typeof fetch,
    });
    expect(api.getToken()).toBeNull();
    api.setToken("key-1");
    await api.call("me");
    expect((sent[0].headers as Record<string, string>).authorization).toBe("Bearer key-1");
  });

  it("a store that refuses to write (full, blocked) does not break signing in", () => {
    const storage: TokenStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("SecurityError");
      },
    };
    const api = createApiClient({ url: "/api", storage, fetch: (async () => json(200, { result: true })) as typeof fetch });
    api.setToken("key-1");
    expect(api.getToken()).toBe("key-1");
    api.setToken(null);
    expect(api.getToken()).toBeNull();
  });

  it("another tab of the same browser signing in / out is noticed through the browser's storage event", () => {
    const local = memoryStorage({ [SESSION_STORAGE_KEY]: "key-1" });
    const win = new EventTarget();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("window", win);
    const api = createApiClient({ url: "/api", fetch: (async () => json(200, { result: true })) as typeof fetch });
    const seen: Array<string | null> = [];
    api.onTokenChange((token) => seen.push(token));
    const storageEvent = (key: string | null, storageArea: unknown = local) => Object.assign(new Event("storage"), { key, storageArea });

    local.values.delete(SESSION_STORAGE_KEY); // the other tab signed out
    win.dispatchEvent(storageEvent(SESSION_STORAGE_KEY));
    expect(api.getToken()).toBeNull();

    local.values.set(SESSION_STORAGE_KEY, "key-2"); // …and someone signed in there
    win.dispatchEvent(storageEvent(SESSION_STORAGE_KEY));
    expect(api.getToken()).toBe("key-2");

    local.values.set("something.else", "x"); // other keys, other stores: not ours
    win.dispatchEvent(storageEvent("something.else"));
    local.values.set(SESSION_STORAGE_KEY, "key-3");
    win.dispatchEvent(storageEvent(SESSION_STORAGE_KEY, {}));
    expect(api.getToken()).toBe("key-2");

    local.values.clear(); // «clear site data»: the event has no key
    win.dispatchEvent(storageEvent(null));
    expect(api.getToken()).toBeNull();
    expect(seen).toEqual([null, "key-2", null]);
  });
});

describe("the server no longer accepts the session key", () => {
  it("tells the listeners when the refused key is the one still in use", async () => {
    const { api } = client(() => json(401, { error: { code: "unauthorized", message: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại." } }), "key-1");
    const refused = vi.fn();
    const stop = api.onUnauthorized(refused);
    expect((await failure(api.call("sync.poll"))).code).toBe("unauthorized");
    expect(refused).toHaveBeenCalledTimes(1);
    // The client does not sign out by itself: that decision belongs to the sign-in layer.
    expect(api.getToken()).toBe("key-1");

    stop();
    await failure(api.call("sync.poll"));
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("also for a 401 that is only an error page", async () => {
    const { api } = client(() => html(401), "key-1");
    const refused = vi.fn();
    api.onUnauthorized(refused);
    await failure(api.call("me"));
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when nobody was signed in, or the key was replaced while the request was under way", async () => {
    const refusal = () => json(401, { error: { code: "unauthorized", message: "Bạn chưa đăng nhập." } });

    const signedOut = client(refusal);
    const quiet = vi.fn();
    signedOut.api.onUnauthorized(quiet);
    await failure(signedOut.api.call("me"));
    expect(quiet).not.toHaveBeenCalled();

    let release: (response: Response) => void = () => {};
    const slow = client(() => new Promise<Response>((resolve) => (release = resolve)), "key-old");
    const refused = vi.fn();
    slow.api.onUnauthorized(refused);
    const pending = failure(slow.api.call("me"));
    slow.api.setToken("key-new"); // signed in again meanwhile
    release(refusal());
    expect((await pending).code).toBe("unauthorized");
    expect(refused).not.toHaveBeenCalled();

    let releaseSignOut: (response: Response) => void = () => {};
    const leaving = client(() => new Promise<Response>((resolve) => (releaseSignOut = resolve)), "key-1");
    const refusedLeaving = vi.fn();
    leaving.api.onUnauthorized(refusedLeaving);
    const signOut = failure(leaving.api.call("auth.signOut"));
    leaving.api.setToken(null); // signed out locally without waiting
    releaseSignOut(refusal());
    await signOut;
    expect(refusedLeaving).not.toHaveBeenCalled();
  });

  it("other refusals never count as a lost session", async () => {
    const { api } = client(() => json(403, { error: { code: "forbidden", message: "Chỉ người quản lý mới xem được danh sách tài khoản." } }), "key-1");
    const refused = vi.fn();
    api.onUnauthorized(refused);
    await failure(api.call("accounts.list"));
    expect(refused).not.toHaveBeenCalled();
  });
});

describe("errorMessage", () => {
  it("uses the message an error already carries, and a fallback otherwise", () => {
    expect(errorMessage(new ApiError("rejected", "Lý do của máy chủ.", 422))).toBe("Lý do của máy chủ.");
    expect(errorMessage(new Error("Không tìm thấy tài khoản."))).toBe("Không tìm thấy tài khoản.");
    expect(errorMessage(new Error("   "))).toBe("Có lỗi xảy ra. Hãy thử lại.");
    expect(errorMessage("chuỗi")).toBe("Có lỗi xảy ra. Hãy thử lại.");
    expect(errorMessage(null)).toBe("Có lỗi xảy ra. Hãy thử lại.");
    expect(errorMessage(undefined, "Không lưu được.")).toBe("Không lưu được.");
  });
});
