// Tests for the sign-in state machine (`createAuthController`) against a fake API client:
// one browser's stored session key plus a scripted server. The last group runs the same flows through the real
// client (`createApiClient`) with a fake `fetch`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NETWORK_MESSAGE, SESSION_STORAGE_KEY, createApiClient, type ApiClient, type CallOptions } from "./api";
import { createAuthController, onForeground, parseProfile, watchForeground, type AuthController, type Profile } from "./auth";

const LAN: Profile = {
  id: "user-1",
  email: "lan@example.com",
  fullName: "Trần Thị Lan",
  phone: "0903 555 777",
  role: "sale",
  createdAt: "2026-11-21T01:02:03.123456+00:00",
};
const HUNG: Profile = {
  id: "user-2",
  email: "hung@example.com",
  fullName: "Nguyễn Văn Hùng",
  phone: "0912 000 111",
  role: "manager",
  createdAt: "2026-11-20T08:00:00+00:00",
};
const BAD_ANSWER = "Máy chủ trả lời không đúng dạng. Hãy thử lại.";
const EXPIRED = "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
const BUSY = "Máy chủ dữ liệu đang bận hoặc không kết nối được. Hãy thử lại sau ít phút.";

const refused = () => new ApiError("unauthorized", EXPIRED, 401);
const offline = () => new ApiError("network", NETWORK_MESSAGE, 0);
const busy = () => new ApiError("unavailable", BUSY, 503);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Args = Record<string, unknown>;
interface Call {
  op: string;
  args: Args;
  /** The session key the request carried. */
  token: string | null;
  timeoutMs?: number;
}

/**
 * A stand-in for the API client. Like the real one it reads the session key when the call is made, tells the token
 * listeners about every change of the key (whoever made it), and tells the «unauthorized» listeners only when the
 * refused key is still the current one.
 */
function fakeApi(storedToken: string | null = null) {
  let token = storedToken;
  const tokenListeners = new Set<(token: string | null) => void>();
  const unauthorizedListeners = new Set<() => void>();
  /** The server's sessions: which account each key belongs to. */
  const sessions = new Map<string, Profile>();
  const calls: Call[] = [];
  let keys = 0;

  const accountOf = (sent: string | null): Profile => {
    const account = sent === null ? undefined : sessions.get(sent);
    if (!account) throw refused();
    return account;
  };

  const server = {
    sessions,
    calls,
    me: vi.fn(async (sent: string | null): Promise<unknown> => ({ ...accountOf(sent) })),
    signIn: vi.fn(async (_args: Args): Promise<unknown> => {
      const key = `key-${++keys}`;
      sessions.set(key, LAN);
      return { token: key, profile: { ...LAN } };
    }),
    signUp: vi.fn(async (args: Args): Promise<unknown> => {
      const key = `key-${++keys}`;
      const account: Profile = { ...LAN, id: "user-9", email: String(args.email), fullName: String(args.fullName), phone: String(args.phone), role: "pending" };
      sessions.set(key, account);
      return { token: key, profile: { ...account } };
    }),
    signOut: vi.fn(async (sent: string | null): Promise<unknown> => {
      if (sent !== null) sessions.delete(sent);
      return true;
    }),
    update: vi.fn(async (args: Args, sent: string | null): Promise<unknown> => {
      const next = { ...accountOf(sent), ...(args as Partial<Profile>) };
      sessions.set(sent as string, next);
      return { ...next };
    }),
    password: vi.fn(async (_args: Args, sent: string | null): Promise<unknown> => {
      accountOf(sent);
      return true;
    }),
    /** Any other command (what the sync engine sends). */
    other: vi.fn(async (_op: string, _args: Args, sent: string | null): Promise<unknown> => {
      accountOf(sent);
      return null;
    }),
    /** Another tab of the same browser stored a different key (or removed it). */
    otherTab(next: string | null) {
      api.setToken(next);
    },
    /** The stored key changes without any listener being told (it happened while nobody was listening). */
    silently(next: string | null) {
      token = next;
    },
    count: (op: string) => calls.filter((call) => call.op === op).length,
    last: (op: string) => calls.filter((call) => call.op === op).at(-1),
    listeners: () => ({ token: tokenListeners.size, unauthorized: unauthorizedListeners.size }),
  };

  const answer = (op: string, args: Args, sent: string | null): Promise<unknown> => {
    switch (op) {
      case "me":
        return server.me(sent);
      case "auth.signIn":
        return server.signIn(args);
      case "auth.signUp":
        return server.signUp(args);
      case "auth.signOut":
        return server.signOut(sent);
      case "me.update":
        return server.update(args, sent);
      case "me.password":
        return server.password(args, sent);
      default:
        return server.other(op, args, sent);
    }
  };

  const api: ApiClient = {
    async call<T = unknown>(op: string, args: Args = {}, options: CallOptions = {}): Promise<T> {
      const sent = token;
      calls.push({ op, args, token: sent, timeoutMs: options.timeoutMs });
      try {
        return (await answer(op, args, sent)) as T;
      } catch (error) {
        if (error instanceof ApiError && error.code === "unauthorized" && sent !== null && sent === token) {
          [...unauthorizedListeners].forEach((listener) => listener());
        }
        throw error;
      }
    },
    getToken: () => token,
    setToken(next) {
      if (next === token) return;
      token = next;
      [...tokenListeners].forEach((listener) => listener(next));
    },
    onTokenChange(listener) {
      tokenListeners.add(listener);
      return () => {
        tokenListeners.delete(listener);
      };
    },
    onUnauthorized(listener) {
      unauthorizedListeners.add(listener);
      return () => {
        unauthorizedListeners.delete(listener);
      };
    },
  };
  return { api, server };
}

type Fake = ReturnType<typeof fakeApi>;

/** Lets everything that is already due happen: timers of 0 ms and the promise chains behind them. */
async function settle() {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
}

const state = (controller: AuthController) => controller.getSnapshot();
const describeState = (controller: AuthController) => {
  const s = state(controller);
  return [s.status, s.profile ? `${s.profile.id}/${s.profile.role}` : "-", s.error ?? "-"].join(" ");
};

/** A controller that has started, with a record of every state it announced. */
async function started(options: { token?: string | null; account?: Profile | null; setup?: (fake: Fake) => void } = {}) {
  const token = options.token === undefined ? null : options.token;
  const fake = fakeApi(token);
  if (token !== null && options.account !== null) fake.server.sessions.set(token, options.account ?? LAN);
  options.setup?.(fake);
  const controller = createAuthController(fake.api);
  const seen: string[] = [];
  controller.subscribe(() => seen.push(describeState(controller)));
  const stop = controller.start();
  await settle();
  return { ...fake, controller, seen, stop, auth: controller.actions };
}

/** Signed in as Lan with the key "key-lan". */
const signedIn = (setup?: (fake: Fake) => void) => started({ token: "key-lan", setup });

/** Minimal `window` / `document` so the controller can listen for focus and visibility changes. */
function fakeBrowser() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  return { win, doc };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T08:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseProfile", () => {
  it("reads the profile the API sends, ignoring fields it does not know", () => {
    expect(parseProfile({ ...LAN, updatedAt: "2026-11-21T02:00:00+00:00", passwordHash: "never sent, but would be dropped" })).toEqual(LAN);
  });

  it("returns null for anything that is not a profile", () => {
    for (const value of [null, undefined, "user-1", 7, true, [], {}, { id: "" }, { id: 12 }, { email: "lan@example.com" }]) {
      expect(parseProfile(value)).toBeNull();
    }
  });

  it("treats an unknown role as not approved, and missing texts as empty", () => {
    expect(parseProfile({ id: "x", role: "owner" })).toEqual({ id: "x", email: "", fullName: "", phone: "", role: "pending", createdAt: "" });
    expect(parseProfile({ id: "x", role: "manager", fullName: 5, phone: null })?.role).toBe("manager");
    expect(parseProfile({ id: "x", role: "manager", fullName: 5, phone: null })?.fullName).toBe("");
  });

  it("does not read the snake_case names of the old database rows", () => {
    expect(parseProfile({ id: "x", role: "sale", full_name: "Lan", created_at: "2026" })).toMatchObject({ fullName: "", createdAt: "" });
  });
});

describe("opening the app", () => {
  it("is loading before anything is known", () => {
    const { api } = fakeApi("key-lan");
    expect(createAuthController(api).getSnapshot()).toEqual({ status: "loading", profile: null, error: null });
  });

  it("no stored key → signedOut, without asking the server anything", async () => {
    const { controller, server, seen } = await started();
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    expect(server.calls).toEqual([]);
    expect(seen).toEqual(["signedOut - -"]);
  });

  it("a stored key → one `me` request carrying that key, then signedIn with the profile", async () => {
    const { controller, server, seen } = await signedIn();
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    expect(server.calls).toEqual([{ op: "me", args: {}, token: "key-lan", timeoutMs: 15_000 }]);
    expect(seen).toEqual(["signedIn user-1/sale -"]);
  });

  it("a stored key the server no longer accepts → removed from the browser, signedOut", async () => {
    const { controller, server, api, seen } = await started({ token: "key-gone", account: null });
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    expect(api.getToken()).toBeNull();
    expect(server.count("me")).toBe(1);
    expect(seen).toEqual(["signedOut - -"]);
  });

  it("pending and locked accounts are signed in too — the gate decides what they see", async () => {
    const pending = await started({ token: "key-p", account: { ...LAN, role: "pending" } });
    expect(state(pending.controller)).toMatchObject({ status: "signedIn", profile: { role: "pending" } });
    const locked = await started({ token: "key-l", account: { ...LAN, role: "locked" } });
    expect(state(locked.controller)).toMatchObject({ status: "signedIn", profile: { role: "locked" } });
  });
});

describe("the profile cannot be read", () => {
  it("offline → still loading, with a message, and the key is kept; refreshProfile() then recovers into signedIn", async () => {
    const { controller, server, api, seen, auth } = await signedIn(({ server }) => server.me.mockRejectedValueOnce(offline()));
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: NETWORK_MESSAGE });
    expect(api.getToken()).toBe("key-lan");

    const result = auth.refreshProfile();
    // While retrying, the error line is gone so the person can see something is happening.
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: null });
    expect(await result).toEqual(LAN);
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    expect(seen).toEqual([`loading - ${NETWORK_MESSAGE}`, "loading - -", "signedIn user-1/sale -"]);
    expect(server.count("me")).toBe(2);
  });

  it("the server being in trouble (5xx, database down) is treated the same way, with the server's own words", async () => {
    const { controller, api } = await signedIn(({ server }) => server.me.mockRejectedValueOnce(busy()));
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: BUSY });
    expect(api.getToken()).toBe("key-lan");
  });

  it("an answer that is not a profile → an error to retry, not a sign-out", async () => {
    const { controller, api, auth } = await signedIn(({ server }) => server.me.mockResolvedValueOnce({ ok: true }));
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: BAD_ANSWER });
    expect(api.getToken()).toBe("key-lan");
    await auth.refreshProfile();
    expect(state(controller).status).toBe("signedIn");
  });

  it("refreshProfile() never throws, whatever the client throws", async () => {
    const { controller, server, auth } = await signedIn();
    server.me.mockRejectedValueOnce("boom");
    await expect(auth.refreshProfile()).resolves.toEqual(LAN);
    expect(state(controller).error).toBe("Có lỗi xảy ra. Hãy thử lại.");
    server.me.mockRejectedValueOnce(undefined);
    await expect(auth.refreshProfile()).resolves.toEqual(LAN);
    server.me.mockRejectedValueOnce(new ApiError("forbidden", "Lời của máy chủ.", 403));
    await expect(auth.refreshProfile()).resolves.toEqual(LAN);
    expect(state(controller)).toMatchObject({ status: "signedIn", error: "Lời của máy chủ." });
  });

  it("refreshProfile() when signed out resolves to null without a request", async () => {
    const { server, auth } = await started();
    await expect(auth.refreshProfile()).resolves.toBeNull();
    expect(server.calls).toEqual([]);
  });
});

describe("re-reading the profile while signed in", () => {
  it("nothing changed → the very same profile object, and nobody is notified", async () => {
    const { controller, seen, auth } = await signedIn();
    const before = state(controller);
    const result = await auth.refreshProfile();
    expect(result).toBe(before.profile);
    expect(state(controller)).toBe(before);
    expect(seen).toHaveLength(1);
  });

  it("a manager changed the role → a new profile object, announced once", async () => {
    const { controller, server, seen, auth } = await signedIn();
    const before = state(controller).profile;
    server.sessions.set("key-lan", { ...LAN, role: "manager" });
    const result = await auth.refreshProfile();
    expect(result).toEqual({ ...LAN, role: "manager" });
    expect(result).not.toBe(before);
    expect(seen).toEqual(["signedIn user-1/sale -", "signedIn user-1/manager -"]);
  });

  it("a failed re-read keeps the person in the app with the profile they had; the next good one clears the error", async () => {
    const { controller, server, api, seen, auth } = await signedIn();
    const profile = state(controller).profile;
    server.me.mockRejectedValueOnce(offline());
    expect(await auth.refreshProfile()).toBe(profile);
    expect(state(controller)).toEqual({ status: "signedIn", profile, error: NETWORK_MESSAGE });
    expect(api.getToken()).toBe("key-lan");
    await auth.refreshProfile();
    expect(state(controller)).toEqual({ status: "signedIn", profile, error: null });
    expect(state(controller).profile).toBe(profile);
    expect(seen).toEqual(["signedIn user-1/sale -", `signedIn user-1/sale ${NETWORK_MESSAGE}`, "signedIn user-1/sale -"]);
  });

  it("calls made at the same moment share one request", async () => {
    const { server, auth } = await signedIn();
    const [a, b, c] = await Promise.all([auth.refreshProfile(), auth.refreshProfile(), auth.refreshProfile()]);
    expect(server.count("me")).toBe(2);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("a call made while a read is waiting for the server joins that read", async () => {
    const { server, auth } = await signedIn();
    const waiting = deferred<unknown>();
    server.me.mockImplementationOnce(() => waiting.promise);
    const first = auth.refreshProfile();
    await settle();
    const second = auth.refreshProfile();
    expect(server.count("me")).toBe(2);
    waiting.resolve({ ...LAN, role: "manager" });
    expect((await first)?.role).toBe("manager");
    expect(await second).toBe(await first);
    expect(server.count("me")).toBe(2);
  });
});

describe("the server stops accepting the session", () => {
  it("a re-read that is refused → signed out, and the key is removed from the browser", async () => {
    const { controller, server, api, seen, auth } = await signedIn();
    server.sessions.delete("key-lan"); // a manager reset the password, or the session expired
    await expect(auth.refreshProfile()).resolves.toBeNull();
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    expect(api.getToken()).toBeNull();
    expect(seen).toEqual(["signedIn user-1/sale -", "signedOut - -"]);
    expect(server.count("me")).toBe(2); // the refusal did not start a second, pointless check
  });

  it("some other request is refused (the sync engine's) → the controller checks with `me`, and signs out when that is refused too", async () => {
    const { controller, server, api } = await signedIn();
    await vi.advanceTimersByTimeAsync(10_000);
    server.sessions.delete("key-lan");
    await expect(api.call("sync.poll")).rejects.toMatchObject({ code: "unauthorized" });
    await settle();
    expect(server.count("me")).toBe(2);
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    expect(api.getToken()).toBeNull();
  });

  it("…but a check that merely fails (no network, server busy) does not sign anyone out", async () => {
    const { controller, server, api } = await signedIn();
    const profile = state(controller).profile;
    await vi.advanceTimersByTimeAsync(10_000);
    server.other.mockRejectedValueOnce(refused());
    server.me.mockRejectedValueOnce(offline());
    await expect(api.call("sync.poll")).rejects.toMatchObject({ code: "unauthorized" });
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile, error: NETWORK_MESSAGE });
    expect(api.getToken()).toBe("key-lan");
  });

  it("…and a check the server answers normally keeps the session (the refusal was a fluke)", async () => {
    const { controller, server, api, seen } = await signedIn();
    await vi.advanceTimersByTimeAsync(10_000);
    server.other.mockRejectedValueOnce(refused());
    await expect(api.call("sync.poll")).rejects.toMatchObject({ code: "unauthorized" });
    await settle();
    expect(server.count("me")).toBe(2);
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    expect(seen).toHaveLength(1);
  });

  it("a burst of refusals causes one check; later ones are checked at most every 5 seconds", async () => {
    const { server, api } = await signedIn();
    await vi.advanceTimersByTimeAsync(10_000);
    server.other.mockRejectedValue(refused()); // every command is refused, yet `me` keeps answering
    await Promise.allSettled([api.call("sync.update"), api.call("sync.update"), api.call("sync.insert"), api.call("sync.poll")]);
    await settle();
    expect(server.count("me")).toBe(2);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.allSettled([api.call("sync.update"), api.call("sync.update")]);
    await settle();
    expect(server.count("me")).toBe(2); // too soon: put off, not dropped
    await vi.advanceTimersByTimeAsync(3_999);
    expect(server.count("me")).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(server.count("me")).toBe(3);
  });

  it("a refusal while a read is already under way adds no request", async () => {
    const { server, api, auth } = await signedIn();
    await vi.advanceTimersByTimeAsync(10_000);
    const waiting = deferred<unknown>();
    server.me.mockImplementationOnce(() => waiting.promise);
    const read = auth.refreshProfile();
    server.other.mockRejectedValueOnce(refused());
    await expect(api.call("sync.poll")).rejects.toMatchObject({ code: "unauthorized" });
    await settle();
    expect(server.count("me")).toBe(2);
    waiting.resolve({ ...LAN });
    await read;
    expect(server.count("me")).toBe(2);
  });

  it("refusals are ignored once signed out, and after stop()", async () => {
    const signedOutOne = await started();
    await expect(signedOutOne.api.call("sync.poll")).rejects.toMatchObject({ code: "unauthorized" });
    await settle();
    expect(signedOutOne.server.count("me")).toBe(0);

    const stoppedOne = await signedIn();
    await vi.advanceTimersByTimeAsync(10_000);
    stoppedOne.stop();
    stoppedOne.server.other.mockRejectedValueOnce(refused());
    await expect(stoppedOne.api.call("sync.poll")).rejects.toMatchObject({ code: "unauthorized" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stoppedOne.server.count("me")).toBe(1);
  });
});

describe("another tab of the same browser", () => {
  it("signs out → this tab is signed out too, without a request", async () => {
    const { controller, server, seen } = await signedIn();
    server.otherTab(null);
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    await settle();
    expect(server.count("me")).toBe(1);
    expect(seen).toEqual(["signedIn user-1/sale -", "signedOut - -"]);
  });

  it("signs in → this tab reads that session's profile and is signed in", async () => {
    const { controller, server, seen } = await started();
    server.sessions.set("key-other-tab", LAN);
    server.otherTab("key-other-tab");
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: null });
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    expect(server.last("me")?.token).toBe("key-other-tab");
    expect(seen).toEqual(["signedOut - -", "loading - -", "signedIn user-1/sale -"]);
  });

  it("switches to another account → the previous profile is dropped first, then the new one appears", async () => {
    const { controller, server, seen } = await signedIn();
    server.sessions.set("key-hung", HUNG);
    server.otherTab("key-hung");
    // At once, before any answer: Lan's profile must not be shown under Hùng's key.
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: null });
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile: HUNG, error: null });
    expect(seen).toEqual(["signedIn user-1/sale -", "loading - -", "signedIn user-2/manager -"]);
  });

  it("the same account signing in again there (a new key) is handled the same, careful way", async () => {
    const { controller, server, seen } = await signedIn();
    server.sessions.set("key-lan-2", LAN);
    server.otherTab("key-lan-2");
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    expect(seen).toEqual(["signedIn user-1/sale -", "loading - -", "signedIn user-1/sale -"]);
  });

  it("a read that was under way for the previous session is thrown away", async () => {
    const { controller, server, auth } = await signedIn();
    const slow = deferred<unknown>();
    server.me.mockImplementationOnce(() => slow.promise);
    void auth.refreshProfile(); // still Lan's session
    await settle();

    server.sessions.set("key-hung", HUNG);
    server.otherTab("key-hung");
    await settle();
    expect(state(controller).profile).toEqual(HUNG);

    slow.resolve({ ...LAN, role: "manager" }); // the old read answers late
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile: HUNG, error: null });
  });

  it("…and so is one that is refused late: it must not sign the new session out", async () => {
    const { controller, server, api, auth } = await signedIn();
    const slow = deferred<unknown>();
    server.me.mockImplementationOnce(() => slow.promise);
    void auth.refreshProfile();
    await settle();
    server.sessions.set("key-hung", HUNG);
    server.otherTab("key-hung");
    await settle();
    slow.reject(refused());
    await settle();
    expect(state(controller).profile).toEqual(HUNG);
    expect(api.getToken()).toBe("key-hung");
  });

  it("after stop() nothing is followed; the next start() catches up with what happened meanwhile", async () => {
    const { controller, server, stop } = await signedIn();
    stop();
    expect(server.listeners()).toEqual({ token: 0, unauthorized: 0 });
    server.sessions.set("key-hung", HUNG);
    server.otherTab("key-hung");
    await settle();
    expect(state(controller).profile).toEqual(LAN); // not followed while stopped

    const stopAgain = controller.start();
    // Caught up before any answer: the old profile is gone.
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: null });
    await settle();
    expect(state(controller).profile).toEqual(HUNG);
    stopAgain();
  });

  it("a key that changed without any announcement is caught by the next read, and by the answer of a read under way", async () => {
    const idle = await signedIn();
    idle.server.sessions.set("key-hung", HUNG);
    idle.server.silently("key-hung");
    const result = idle.auth.refreshProfile();
    // Before any answer: Lan's profile is not shown under the new key.
    expect(state(idle.controller)).toEqual({ status: "loading", profile: null, error: null });
    expect(await result).toEqual(HUNG);

    const waiting = await signedIn();
    const slow = deferred<unknown>();
    waiting.server.me.mockImplementationOnce(() => slow.promise);
    const read = waiting.auth.refreshProfile(); // asked with Lan's key…
    await settle();
    waiting.server.sessions.set("key-hung", HUNG);
    waiting.server.silently("key-hung");
    slow.resolve({ ...LAN, role: "manager" }); // …answered after the key changed
    expect(await read).toEqual(HUNG);
    expect(waiting.seen).toEqual(["signedIn user-1/sale -", "loading - -", "signedIn user-2/manager -"]);
  });

  it("start → stop → start (React StrictMode) ends with one subscription each, one request, and a working controller", async () => {
    const { api, server } = fakeApi("key-lan");
    server.sessions.set("key-lan", LAN);
    const controller = createAuthController(api);
    controller.start()();
    const stop = controller.start();
    await settle();
    expect(server.listeners()).toEqual({ token: 1, unauthorized: 1 });
    expect(server.count("me")).toBe(1);
    expect(state(controller).profile).toEqual(LAN);
    server.otherTab(null);
    expect(state(controller).status).toBe("signedOut");
    stop();
    expect(server.listeners()).toEqual({ token: 0, unauthorized: 0 });
  });
});

describe("signIn", () => {
  it("stores the new key and shows the profile that came with it — no extra request; the email is trimmed, the password is not", async () => {
    const { controller, server, api, seen, auth } = await started();
    await auth.signIn("  lan@example.com ", " mật khẩu ");
    expect(server.calls).toEqual([
      { op: "auth.signIn", args: { email: "lan@example.com", password: " mật khẩu " }, token: null, timeoutMs: 15_000 },
    ]);
    expect(api.getToken()).toBe("key-1");
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    await settle();
    expect(server.count("me")).toBe(0);
    expect(seen).toEqual(["signedOut - -", "signedIn user-1/sale -"]);
  });

  it("wrong email or password → the server's sentence, still signed out, nothing stored", async () => {
    const { controller, server, api, auth } = await started();
    server.signIn.mockRejectedValueOnce(new ApiError("invalid_credentials", "Email hoặc mật khẩu không đúng.", 400));
    await expect(auth.signIn("lan@example.com", "sai")).rejects.toThrow("Email hoặc mật khẩu không đúng.");
    expect(state(controller).status).toBe("signedOut");
    expect(api.getToken()).toBeNull();
  });

  it("too many attempts, no network, server busy → the matching sentence", async () => {
    const { server, auth, controller } = await started();
    server.signIn.mockRejectedValueOnce(new ApiError("rate_limited", "Bạn thử quá nhiều lần. Hãy chờ 15 phút rồi thử lại.", 429));
    await expect(auth.signIn("lan@example.com", "x")).rejects.toThrow("Bạn thử quá nhiều lần. Hãy chờ 15 phút rồi thử lại.");
    server.signIn.mockRejectedValueOnce(offline());
    await expect(auth.signIn("lan@example.com", "x")).rejects.toThrow(NETWORK_MESSAGE);
    server.signIn.mockRejectedValueOnce(busy());
    await expect(auth.signIn("lan@example.com", "x")).rejects.toThrow(BUSY);
    expect(state(controller).status).toBe("signedOut");
  });

  it("an answer without a key or without a profile is an error, and nothing is stored", async () => {
    const { controller, server, api, auth } = await started();
    for (const answer of [null, {}, { token: "key-x" }, { profile: LAN }, { token: "", profile: LAN }, { token: "key-x", profile: { id: "" } }]) {
      server.signIn.mockResolvedValueOnce(answer);
      await expect(auth.signIn("lan@example.com", "x")).rejects.toThrow(BAD_ANSWER);
    }
    expect(api.getToken()).toBeNull();
    expect(state(controller).status).toBe("signedOut");
  });

  it("the other tabs are told (the key changes) but this controller does not react to its own change", async () => {
    const { server, api, auth } = await started();
    const heard: Array<string | null> = [];
    api.onTokenChange((token) => heard.push(token));
    await auth.signIn("lan@example.com", "matkhau1");
    await settle();
    expect(heard).toEqual(["key-1"]);
    expect(server.count("me")).toBe(0);
  });

  it("signing in as someone else while a profile is still shown never mixes the two", async () => {
    const { controller, server, seen, auth } = await signedIn();
    server.signIn.mockImplementationOnce(async () => {
      server.sessions.set("key-hung", HUNG);
      return { token: "key-hung", profile: { ...HUNG } };
    });
    await auth.signIn("hung@example.com", "matkhau1");
    expect(state(controller)).toEqual({ status: "signedIn", profile: HUNG, error: null });
    expect(seen).toEqual(["signedIn user-1/sale -", "loading - -", "signedIn user-2/manager -"]);
  });
});

describe("signUp", () => {
  const INPUT = { email: " moi@example.com ", password: "matkhau1", fullName: "  Lê Văn Mới ", phone: " 0988 111 222 " };

  it("sends the trimmed fields (the password untouched) and is signed in at once — as a pending account", async () => {
    const { controller, server, api, auth } = await started();
    await expect(auth.signUp(INPUT)).resolves.toBeUndefined();
    expect(server.calls).toEqual([
      {
        op: "auth.signUp",
        args: { email: "moi@example.com", password: "matkhau1", fullName: "Lê Văn Mới", phone: "0988 111 222" },
        token: null,
        timeoutMs: 15_000,
      },
    ]);
    expect(api.getToken()).toBe("key-1");
    expect(state(controller)).toMatchObject({ status: "signedIn", profile: { id: "user-9", role: "pending", fullName: "Lê Văn Mới" } });
    await settle();
    expect(server.count("me")).toBe(0);
  });

  it("an email that is already registered, a password the server refuses → the server's sentence", async () => {
    const { controller, server, api, auth } = await started();
    const taken = "Email này đã được đăng ký. Hãy đăng nhập; nếu quên mật khẩu, nhờ người quản lý đặt lại.";
    server.signUp.mockRejectedValueOnce(new ApiError("conflict", taken, 409));
    await expect(auth.signUp(INPUT)).rejects.toThrow(taken);
    server.signUp.mockRejectedValueOnce(new ApiError("rejected", "Mật khẩu phải có ít nhất 6 ký tự.", 422));
    await expect(auth.signUp({ ...INPUT, password: "123" })).rejects.toThrow("Mật khẩu phải có ít nhất 6 ký tự.");
    expect(state(controller).status).toBe("signedOut");
    expect(api.getToken()).toBeNull();
  });
});

describe("signOut", () => {
  it("removes the key from this browser at once and tells the server which session to end", async () => {
    const { controller, server, api, seen, auth } = await signedIn();
    await auth.signOut();
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    expect(api.getToken()).toBeNull();
    expect(server.last("auth.signOut")).toEqual({ op: "auth.signOut", args: {}, token: "key-lan", timeoutMs: 3_000 });
    await settle();
    expect(server.sessions.has("key-lan")).toBe(false);
    expect(seen).toEqual(["signedIn user-1/sale -", "signedOut - -"]);
  });

  it("works with no network", async () => {
    const { controller, server, api, auth } = await signedIn();
    server.signOut.mockRejectedValueOnce(offline());
    await expect(auth.signOut()).resolves.toBeUndefined();
    await settle();
    expect(state(controller).status).toBe("signedOut");
    expect(api.getToken()).toBeNull();
  });

  it("does not wait for a server that never answers", async () => {
    const { controller, server, api, auth } = await signedIn();
    server.signOut.mockImplementationOnce(() => new Promise(() => {}));
    let done = false;
    void auth.signOut().then(() => (done = true));
    await settle();
    expect(done).toBe(true);
    expect(state(controller).status).toBe("signedOut");
    expect(api.getToken()).toBeNull();
    expect(server.last("auth.signOut")?.timeoutMs).toBe(3_000);
  });

  it("a server that refuses the sign-out request (the session was gone already) changes nothing", async () => {
    const { controller, server, auth } = await signedIn();
    server.sessions.delete("key-lan");
    server.signOut.mockRejectedValueOnce(refused());
    await auth.signOut();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state(controller).status).toBe("signedOut");
    expect(server.count("me")).toBe(1);
  });

  it("when nobody is signed in there is nothing to tell the server", async () => {
    const { server, auth, controller } = await started();
    await auth.signOut();
    expect(server.calls).toEqual([]);
    expect(state(controller).status).toBe("signedOut");
  });

  it("a read still under way cannot bring the profile back afterwards", async () => {
    const { controller, server, auth } = await signedIn();
    const slow = deferred<unknown>();
    server.me.mockImplementationOnce(() => slow.promise);
    const read = auth.refreshProfile();
    await settle();
    await auth.signOut();
    slow.resolve({ ...LAN });
    await read;
    await settle();
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
  });

  it("signing in again afterwards starts clean", async () => {
    const { controller, server, api, auth } = await signedIn();
    await auth.signOut();
    await auth.signIn("lan@example.com", "matkhau1");
    expect(api.getToken()).toBe("key-1");
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    await auth.refreshProfile();
    expect(server.last("me")?.token).toBe("key-1");
  });
});

describe("updateProfile", () => {
  it("trims, saves, updates the state and returns the new profile", async () => {
    const { controller, server, seen, auth } = await signedIn();
    const saved = await auth.updateProfile({ fullName: "  Trần Lan  ", phone: " 0911 222 333 " });
    expect(server.last("me.update")).toEqual({
      op: "me.update",
      args: { fullName: "Trần Lan", phone: "0911 222 333" },
      token: "key-lan",
      timeoutMs: 15_000,
    });
    expect(saved).toEqual({ ...LAN, fullName: "Trần Lan", phone: "0911 222 333" });
    expect(state(controller).profile).toBe(saved);
    expect(seen).toHaveLength(2);
  });

  it("sends only the fields it was given; nothing given → no request", async () => {
    const { controller, server, auth } = await signedIn();
    await auth.updateProfile({ phone: "0911 222 333" });
    expect(server.last("me.update")?.args).toEqual({ phone: "0911 222 333" });
    const before = state(controller).profile;
    expect(await auth.updateProfile({})).toBe(before);
    expect(server.count("me.update")).toBe(1);
  });

  it("failure → the server's sentence, and the profile is left as it was", async () => {
    const { controller, server, auth } = await signedIn();
    const before = state(controller);
    server.update.mockRejectedValueOnce(offline());
    await expect(auth.updateProfile({ fullName: "Tên Mới" })).rejects.toThrow(NETWORK_MESSAGE);
    server.update.mockResolvedValueOnce(null);
    await expect(auth.updateProfile({ fullName: "Tên Mới" })).rejects.toThrow(BAD_ANSWER);
    expect(state(controller)).toBe(before);
  });

  it("not signed in → an Error, no request", async () => {
    const { server, auth } = await started();
    await expect(auth.updateProfile({ fullName: "Tên Mới" })).rejects.toThrow("Bạn chưa đăng nhập.");
    expect(server.calls).toEqual([]);
  });

  it("the session being gone → the error, and the controller finds out and signs out", async () => {
    const { controller, server, api, auth } = await signedIn();
    await vi.advanceTimersByTimeAsync(10_000);
    server.sessions.delete("key-lan");
    await expect(auth.updateProfile({ fullName: "Tên Mới" })).rejects.toThrow(EXPIRED);
    await settle();
    expect(state(controller).status).toBe("signedOut");
    expect(api.getToken()).toBeNull();
  });

  it("an older read that answers after the save cannot put the old name back", async () => {
    const { controller, server, auth } = await signedIn();
    const slow = deferred<unknown>();
    server.me.mockImplementationOnce(() => slow.promise);
    const read = auth.refreshProfile(); // asks before the save…
    await settle();
    await auth.updateProfile({ fullName: "Tên Mới" });
    slow.resolve({ ...LAN }); // …and answers after it, with the old name
    await read;
    await settle();
    expect(state(controller).profile?.fullName).toBe("Tên Mới");
    // The next read is a fresh request, not the abandoned one.
    await auth.refreshProfile();
    expect(server.count("me")).toBe(3);
    expect(state(controller).profile?.fullName).toBe("Tên Mới");
  });

  it("signed out (or switched account) while the save was under way → the saved profile is returned but not shown", async () => {
    const { controller, server, auth } = await signedIn();
    const slow = deferred<unknown>();
    server.update.mockImplementationOnce(() => slow.promise);
    const saving = auth.updateProfile({ fullName: "Tên Mới" });
    await settle();
    await auth.signOut();
    slow.resolve({ ...LAN, fullName: "Tên Mới" });
    expect((await saving).fullName).toBe("Tên Mới");
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });

    const other = await signedIn();
    const slowAgain = deferred<unknown>();
    other.server.update.mockImplementationOnce(() => slowAgain.promise);
    const savingAgain = other.auth.updateProfile({ fullName: "Tên Mới" });
    await settle();
    other.server.sessions.set("key-hung", HUNG);
    other.server.otherTab("key-hung");
    await settle();
    slowAgain.resolve({ ...LAN, fullName: "Tên Mới" });
    await savingAgain;
    expect(state(other.controller).profile).toEqual(HUNG);
  });
});

describe("changePassword", () => {
  it("sends the new password for the signed-in account and keeps the session", async () => {
    const { controller, server, api, auth } = await signedIn();
    await expect(auth.changePassword("matkhaumoi1")).resolves.toBeUndefined();
    expect(server.last("me.password")).toEqual({ op: "me.password", args: { newPassword: "matkhaumoi1" }, token: "key-lan", timeoutMs: 15_000 });
    expect(api.getToken()).toBe("key-lan");
    expect(state(controller).status).toBe("signedIn");
  });

  it("server refusals come back in the server's words", async () => {
    const { server, auth } = await signedIn();
    server.password.mockRejectedValueOnce(new ApiError("rejected", "Mật khẩu phải có ít nhất 6 ký tự.", 422));
    await expect(auth.changePassword("123")).rejects.toThrow("Mật khẩu phải có ít nhất 6 ký tự.");
    server.password.mockRejectedValueOnce(offline());
    await expect(auth.changePassword("matkhaumoi1")).rejects.toThrow(NETWORK_MESSAGE);
  });
});

describe("observeProfile (the profile seen by the sync engine's regular question)", () => {
  it("the same profile → the same object, nobody notified", async () => {
    const { controller, seen, auth } = await signedIn();
    const before = state(controller);
    await vi.advanceTimersByTimeAsync(15_000);
    auth.observeProfile({ ...LAN }, Date.now());
    expect(state(controller)).toBe(before);
    expect(seen).toHaveLength(1);
  });

  it("a changed role (or name) is shown at once, announced once, without a request", async () => {
    const { controller, server, seen, auth } = await signedIn();
    await vi.advanceTimersByTimeAsync(15_000);
    auth.observeProfile({ ...LAN, role: "locked" }, Date.now());
    expect(state(controller)).toEqual({ status: "signedIn", profile: { ...LAN, role: "locked" }, error: null });
    expect(seen).toEqual(["signedIn user-1/sale -", "signedIn user-1/locked -"]);
    expect(server.count("me")).toBe(1);
  });

  it("clears the error left by a failed re-read", async () => {
    const { controller, server, auth } = await signedIn();
    server.me.mockRejectedValueOnce(offline());
    await auth.refreshProfile();
    expect(state(controller).error).toBe(NETWORK_MESSAGE);
    await vi.advanceTimersByTimeAsync(1_000);
    auth.observeProfile({ ...LAN }, Date.now());
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
  });

  it("ignores what is not a profile, and the profile of any other account", async () => {
    const { controller, seen, auth } = await signedIn();
    const before = state(controller);
    await vi.advanceTimersByTimeAsync(15_000);
    for (const raw of [null, undefined, "x", {}, { id: "" }, { ...HUNG }, { ...LAN, id: "user-3" }]) {
      auth.observeProfile(raw, Date.now());
    }
    expect(state(controller)).toBe(before);
    expect(seen).toHaveLength(1);
  });

  it("does nothing while signed out or while the profile is still loading", async () => {
    const signedOutOne = await started();
    signedOutOne.auth.observeProfile({ ...LAN }, Date.now());
    expect(state(signedOutOne.controller).status).toBe("signedOut");

    const loading = await signedIn(({ server }) => server.me.mockRejectedValueOnce(offline()));
    loading.auth.observeProfile({ ...LAN }, Date.now() + 1_000);
    expect(state(loading.controller)).toEqual({ status: "loading", profile: null, error: NETWORK_MESSAGE });
  });

  it("a question asked before the request that produced the current profile is older news: ignored", async () => {
    const { controller, auth } = await signedIn();
    await vi.advanceTimersByTimeAsync(15_000);
    const pollSentAt = Date.now(); // the engine asks…
    await vi.advanceTimersByTimeAsync(200);
    const savedAt = Date.now();
    await auth.updateProfile({ fullName: "Tên Mới" }); // …the person saves a new name…
    await vi.advanceTimersByTimeAsync(300);
    auth.observeProfile({ ...LAN }, pollSentAt); // …and the engine's answer arrives with the old name
    expect(state(controller).profile?.fullName).toBe("Tên Mới");
    auth.observeProfile({ ...LAN }, savedAt); // sent in the very same millisecond as the save: still not newer
    expect(state(controller).profile?.fullName).toBe("Tên Mới");
    auth.observeProfile({ ...LAN, fullName: "Tên Mới", role: "manager" }, savedAt + 1); // a later question is believed
    expect(state(controller).profile).toEqual({ ...LAN, fullName: "Tên Mới", role: "manager" });
    for (const askedAt of [Number.NaN, undefined as unknown as number]) {
      auth.observeProfile({ ...LAN }, askedAt);
    }
    expect(state(controller).profile?.fullName).toBe("Tên Mới");
  });

  it("an own read that answers late does not overwrite newer news from the engine", async () => {
    const { controller, server, auth } = await signedIn();
    await vi.advanceTimersByTimeAsync(10_000);
    const slow = deferred<unknown>();
    server.me.mockImplementationOnce(() => slow.promise);
    const read = auth.refreshProfile(); // asked now…
    await vi.advanceTimersByTimeAsync(1_000);
    auth.observeProfile({ ...LAN, role: "manager" }, Date.now()); // …the engine asked later and already knows more
    slow.resolve({ ...LAN }); // the own read's answer: the older role
    expect((await read)?.role).toBe("manager");
    expect(state(controller)).toEqual({ status: "signedIn", profile: { ...LAN, role: "manager" }, error: null });
  });

  it("after signing out and in again, answers to the old session's questions are not taken for the new one", async () => {
    const { controller, auth } = await signedIn();
    await vi.advanceTimersByTimeAsync(15_000);
    await auth.signOut();
    auth.observeProfile({ ...LAN, role: "manager" }, Date.now());
    expect(state(controller).status).toBe("signedOut");
    await vi.advanceTimersByTimeAsync(1_000);
    const before = Date.now() - 500;
    await auth.signIn("lan@example.com", "matkhau1");
    auth.observeProfile({ ...LAN, role: "manager" }, before); // asked before this sign-in
    expect(state(controller).profile?.role).toBe("sale");
  });
});

describe("keeping the profile fresh", () => {
  it("while the engine keeps reporting the profile, the controller sends no periodic request of its own", async () => {
    fakeBrowser();
    const { server, auth, stop } = await signedIn();
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      auth.observeProfile({ ...LAN }, Date.now());
    }
    expect(server.count("me")).toBe(1); // ten minutes, not one extra request
    // The engine's slowest rhythm — once a minute — is enough too.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      auth.observeProfile({ ...LAN }, Date.now());
    }
    expect(server.count("me")).toBe(1);
    stop();
  });

  it("with nobody else confirming it, the profile is re-read once it is 90 seconds old", async () => {
    fakeBrowser();
    const { controller, server, stop } = await signedIn();
    server.sessions.set("key-lan", { ...LAN, role: "locked" });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(server.count("me")).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(server.count("me")).toBe(2);
    expect(state(controller).profile?.role).toBe("locked");
    await vi.advanceTimersByTimeAsync(90_000);
    await settle();
    expect(server.count("me")).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(server.count("me")).toBe(3);
  });

  it("the engine going quiet is noticed: 90 seconds after its last report the controller asks by itself", async () => {
    fakeBrowser();
    const { server, auth, stop } = await signedIn();
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      auth.observeProfile({ ...LAN }, Date.now());
    }
    await vi.advanceTimersByTimeAsync(89_999);
    expect(server.count("me")).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(server.count("me")).toBe(2);
    stop();
  });

  it("a waiting screen that re-reads on its own schedule (refreshProfile every 15 s) is not doubled by the controller", async () => {
    fakeBrowser();
    const { server, auth, stop } = await started({ token: "key-p", account: { ...LAN, role: "pending" } });
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      await auth.refreshProfile();
    }
    expect(server.count("me")).toBe(21);
    stop();
  });

  it("nothing is asked while the tab is hidden; back in view, the stale profile is re-read at the next check", async () => {
    const { doc } = fakeBrowser();
    const { server, stop } = await signedIn();
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(600_000);
    expect(server.count("me")).toBe(1);
    doc.visibilityState = "visible";
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(server.count("me")).toBe(2);
    stop();
  });

  it("an error screen retries by itself every 30 seconds", async () => {
    fakeBrowser();
    const { controller, server, stop } = await signedIn(({ server }) => server.me.mockRejectedValue(offline()));
    expect(state(controller).error).toBe(NETWORK_MESSAGE);
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(server.count("me")).toBe(2);
    expect(state(controller).error).toBe(NETWORK_MESSAGE);
    server.me.mockImplementation(async () => ({ ...LAN }));
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    stop();
  });

  it("nothing at all while signed out", async () => {
    const { win } = fakeBrowser();
    const { server, stop } = await started();
    await vi.advanceTimersByTimeAsync(300_000);
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toEqual([]);
    stop();
  });
});

describe("coming back to the tab", () => {
  it("in the app: waits a moment for the engine's report, and asks by itself only when none came", async () => {
    const { win, doc } = fakeBrowser();
    const { controller, server, auth, stop } = await signedIn();
    await vi.advanceTimersByTimeAsync(20_000);

    // The engine reports within the grace period → no request from the controller.
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus")); // the two events of one «back to the tab»
    await vi.advanceTimersByTimeAsync(400);
    auth.observeProfile({ ...LAN, role: "manager" }, Date.now());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.count("me")).toBe(1);
    expect(state(controller).profile?.role).toBe("manager");

    // No report (the engine is not running) → one request after the grace period.
    await vi.advanceTimersByTimeAsync(20_000);
    server.sessions.set("key-lan", { ...LAN, role: "locked" });
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(server.count("me")).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(server.count("me")).toBe(2);
    expect(state(controller).profile?.role).toBe("locked");
    stop();
  });

  it("at most one such re-read per 5 seconds, and none right after a fresh confirmation", async () => {
    const { win } = fakeBrowser();
    const { server, auth, stop } = await signedIn();
    win.dispatchEvent(new Event("focus")); // right after the first read: too soon
    await vi.advanceTimersByTimeAsync(3_000);
    expect(server.count("me")).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    auth.observeProfile({ ...LAN }, Date.now()); // the engine has just confirmed it
    await vi.advanceTimersByTimeAsync(1_000);
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(server.count("me")).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1_500);
    await settle();
    expect(server.count("me")).toBe(2);
    win.dispatchEvent(new Event("focus")); // again within 5 seconds of that read
    await vi.advanceTimersByTimeAsync(3_000);
    expect(server.count("me")).toBe(2);
    stop();
  });

  it("a screen's own immediate re-read (refreshProfile) makes the controller's delayed one unnecessary", async () => {
    const { win } = fakeBrowser();
    const { server, auth, stop } = await signedIn();
    await vi.advanceTimersByTimeAsync(20_000);
    win.dispatchEvent(new Event("focus"));
    await auth.refreshProfile(); // what a waiting screen does on the same event
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.count("me")).toBe(2);
    stop();
  });

  it("an error screen retries at once when the person comes back (but not within 5 seconds of the last try)", async () => {
    const { win } = fakeBrowser();
    const { controller, server, stop } = await signedIn(({ server }) => server.me.mockRejectedValueOnce(offline()));
    expect(state(controller).error).toBe(NETWORK_MESSAGE);
    await vi.advanceTimersByTimeAsync(2_000);
    win.dispatchEvent(new Event("focus"));
    await settle();
    expect(server.count("me")).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    win.dispatchEvent(new Event("focus"));
    await settle();
    expect(server.count("me")).toBe(2);
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    stop();
  });

  it("does nothing while the tab is hidden, when nobody is signed in, or after stop()", async () => {
    const { win, doc } = fakeBrowser();
    const hidden = await signedIn();
    await vi.advanceTimersByTimeAsync(6_000);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(hidden.server.count("me")).toBe(1);
    doc.visibilityState = "visible";

    win.dispatchEvent(new Event("focus")); // a re-read is now on its way…
    hidden.stop(); // …but the controller is stopped before it is due
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hidden.server.count("me")).toBe(1);

    const nobody = await started();
    await vi.advanceTimersByTimeAsync(6_000);
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(nobody.server.calls).toEqual([]);
    nobody.stop();
  });

  it("onForeground: bursts count once, hidden tabs are skipped, and the returned function stops listening", () => {
    const { win, doc } = fakeBrowser();
    const callback = vi.fn();
    const stop = onForeground(callback);
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(5_000);
    win.dispatchEvent(new Event("focus"));
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("watchForeground: also calls on a timer while the tab is visible, until stopped", () => {
    const { win, doc } = fakeBrowser();
    const callback = vi.fn();
    const stop = watchForeground(callback, 15_000);
    vi.advanceTimersByTime(45_000);
    expect(callback).toHaveBeenCalledTimes(3);
    doc.visibilityState = "hidden";
    vi.advanceTimersByTime(45_000);
    expect(callback).toHaveBeenCalledTimes(3);
    doc.visibilityState = "visible";
    win.dispatchEvent(new Event("focus"));
    expect(callback).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(60_000);
    win.dispatchEvent(new Event("focus"));
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it("works where there is no window at all (server-side, tests): nothing to listen to, nothing breaks", () => {
    const stop = onForeground(() => {
      throw new Error("must not be called");
    });
    expect(() => stop()).not.toThrow();
  });
});

describe("subscribing", () => {
  it("listeners hear every change until they unsubscribe; a listener may unsubscribe itself while being called", async () => {
    const { api, server } = fakeApi("key-lan");
    server.sessions.set("key-lan", LAN);
    const controller = createAuthController(api);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = controller.subscribe(first);
    const stopSecond = controller.subscribe(() => {
      second();
      stopSecond();
    });
    const stop = controller.start();
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    await controller.actions.signOut();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    await controller.actions.signIn("lan@example.com", "matkhau1");
    expect(first).toHaveBeenCalledTimes(2);
    stop();
  });

  it("the actions object is stable, so React contexts built from it do not change needlessly", async () => {
    const { controller } = await signedIn();
    expect(controller.actions).toBe(controller.actions);
    expect(Object.keys(controller.actions).sort()).toEqual(
      ["changePassword", "observeProfile", "refreshProfile", "signIn", "signOut", "signUp", "updateProfile"].sort(),
    );
  });
});

describe("through the real API client", () => {
  /** A tiny server speaking the API's protocol over a fake `fetch`. */
  function realClient(stored: string | null) {
    const sessions = new Map<string, Profile>([["key-lan", LAN]]);
    const requests: Array<{ op: string; args: Args; bearer: string | null }> = [];
    const values = new Map<string, string>(stored === null ? [] : [[SESSION_STORAGE_KEY, stored]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetchFake = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const { op, args } = JSON.parse(String(init?.body)) as { op: string; args: Args };
      const header = (init?.headers as Record<string, string> | undefined)?.authorization ?? "";
      const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
      requests.push({ op, args, bearer });
      const account = bearer === null ? undefined : sessions.get(bearer);
      if (op === "auth.signIn") {
        if (args.password !== "matkhau1") return reply(400, { error: { code: "invalid_credentials", message: "Email hoặc mật khẩu không đúng." } });
        sessions.set("key-new", LAN);
        return reply(200, { result: { token: "key-new", profile: LAN } });
      }
      if (op === "auth.signOut") {
        if (bearer !== null) sessions.delete(bearer);
        return reply(200, { result: true });
      }
      if (!account) return reply(401, { error: { code: "unauthorized", message: EXPIRED } });
      if (op === "me") return reply(200, { result: account });
      return reply(200, { result: null });
    };
    const api = createApiClient({ url: "/api", fetch: fetchFake as typeof fetch, storage });
    const controller = createAuthController(api);
    return { api, controller, requests, sessions, values };
  }

  beforeEach(() => {
    // These go through real `Response` objects, whose body reading does not run on fake timers.
    vi.useRealTimers();
  });

  const until = (check: () => void) => vi.waitFor(check, { timeout: 2_000, interval: 5 });

  it("a stored key → `me` with that key as Bearer → signed in; signing out ends that session and clears the store", async () => {
    const { controller, requests, sessions, values } = realClient("key-lan");
    const stop = controller.start();
    await until(() => expect(state(controller).status).toBe("signedIn"));
    expect(requests).toEqual([{ op: "me", args: {}, bearer: "key-lan" }]);

    await controller.actions.signOut();
    expect(state(controller).status).toBe("signedOut");
    expect(values.has(SESSION_STORAGE_KEY)).toBe(false);
    await until(() => expect(sessions.has("key-lan")).toBe(false));
    expect(requests.at(-1)).toEqual({ op: "auth.signOut", args: {}, bearer: "key-lan" });
    stop();
  });

  it("signing in stores the key; a wrong password leaves everything as it was", async () => {
    const { controller, requests, values } = realClient(null);
    const stop = controller.start();
    expect(state(controller).status).toBe("signedOut");
    await expect(controller.actions.signIn("lan@example.com", "sai")).rejects.toThrow("Email hoặc mật khẩu không đúng.");
    expect(values.has(SESSION_STORAGE_KEY)).toBe(false);
    await controller.actions.signIn("lan@example.com", "matkhau1");
    expect(values.get(SESSION_STORAGE_KEY)).toBe("key-new");
    expect(state(controller)).toEqual({ status: "signedIn", profile: LAN, error: null });
    expect(requests.map((request) => request.op)).toEqual(["auth.signIn", "auth.signIn"]);
    stop();
  });

  it("the session ending on the server is discovered through any refused request: signed out, store cleared", async () => {
    const { api, controller, sessions, values, requests } = realClient("key-lan");
    const stop = controller.start();
    await until(() => expect(state(controller).status).toBe("signedIn"));
    sessions.delete("key-lan");
    // More than 5 seconds must have passed since the last read for an immediate re-check; pretend with the clock.
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10_000);
    await expect(api.call("sync.poll")).rejects.toMatchObject({ code: "unauthorized" });
    await until(() => expect(state(controller).status).toBe("signedOut"));
    expect(values.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(requests.map((request) => request.op)).toEqual(["me", "sync.poll", "me"]);
    vi.restoreAllMocks();
    stop();
  });
});
