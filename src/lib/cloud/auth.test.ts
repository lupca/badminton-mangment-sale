// Tests for the sign-in state machine (`createAuthController`) against a fake Supabase client.
// The fake answers with the same shapes the real library returns (see authErrors.test.ts for where those come from).
import { AuthApiError, AuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthController, onForeground, profileFromRow, type AuthController, type Profile } from "./auth";

const ROW = {
  id: "user-1",
  email: "lan@example.com",
  full_name: "Trần Thị Lan",
  phone: "0903 555 777",
  role: "sale",
  created_at: "2026-11-21T01:02:03.123456+00:00",
  updated_at: "2026-11-21T01:02:03.123456+00:00",
};
const PROFILE: Profile = {
  id: "user-1",
  email: "lan@example.com",
  fullName: "Trần Thị Lan",
  phone: "0903 555 777",
  role: "sale",
  createdAt: "2026-11-21T01:02:03.123456+00:00",
};
const NETWORK = "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.";

type Answer = { data: unknown; error: unknown; status?: number };
const ok = (row: unknown = ROW): Answer => ({ data: row, error: null, status: 200 });
const unreachable = (): Answer => ({
  data: null,
  error: { code: "", message: "TypeError: Failed to fetch", details: "", hint: "" },
  status: 0,
});
const sessionOf = (userId: string) => ({ access_token: `jwt-of-${userId}`, refresh_token: "r", user: { id: userId } });
type FakeSession = ReturnType<typeof sessionOf>;

/** A stand-in for the Supabase client: one browser's stored session plus scripted server answers. */
function fakeSupabase() {
  const listeners = new Set<(event: string, session: FakeSession | null) => void>();
  const server = {
    /** The session stored in this browser (null = signed out). */
    session: null as FakeSession | null,
    getSession: vi.fn(async (): Promise<Answer> => ({ data: { session: server.session }, error: null })),
    ensureProfile: vi.fn(async (): Promise<Answer> => ok()),
    refreshSession: vi.fn(async (): Promise<Answer> => ({ data: { session: server.session }, error: null })),
    signInWithPassword: vi.fn(async (_credentials: { email: string; password: string }): Promise<Answer> => {
      server.session = sessionOf("user-1");
      return { data: { session: server.session, user: server.session.user }, error: null };
    }),
    signUp: vi.fn(async (_input: unknown): Promise<Answer> => {
      server.session = sessionOf("user-1");
      return { data: { session: server.session, user: server.session.user }, error: null };
    }),
    signOut: vi.fn(async (_options: unknown): Promise<{ error: unknown }> => {
      server.session = null;
      return { error: null };
    }),
    updateUser: vi.fn(async (_attributes: unknown): Promise<Answer> => ({ data: { user: {} }, error: null })),
    updateProfile: vi.fn(async (values: Record<string, string>, _id: string): Promise<Answer> => ok({ ...ROW, ...values })),
    /** What the library does when something happens to the session: it calls every subscriber. */
    emit(event: string, session: FakeSession | null) {
      [...listeners].forEach((listener) => listener(event, session));
    },
    subscribers: () => listeners.size,
  };
  const client = {
    auth: {
      getSession: () => server.getSession(),
      onAuthStateChange(callback: (event: string, session: FakeSession | null) => void) {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      },
      signInWithPassword: (credentials: { email: string; password: string }) => server.signInWithPassword(credentials),
      signUp: (input: unknown) => server.signUp(input),
      signOut: (options: unknown) => server.signOut(options),
      refreshSession: () => server.refreshSession(),
      updateUser: (attributes: unknown) => server.updateUser(attributes),
    },
    rpc(name: string) {
      if (name !== "ensure_profile") throw new Error(`unexpected rpc ${name}`);
      const answer = server.ensureProfile();
      return Object.assign(answer, { abortSignal: () => answer });
    },
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        update: (values: Record<string, string>) => ({
          eq: (column: string, id: string) => ({
            select: (_columns: string) => ({
              maybeSingle: () => {
                if (column !== "id") throw new Error(`unexpected filter ${column}`);
                return server.updateProfile(values, id);
              },
            }),
          }),
        }),
      };
    },
  };
  return { server, client: client as unknown as SupabaseClient };
}

/** Lets everything that is already due happen: deferred auth events (setTimeout 0) and the promise chains behind them. */
async function settle() {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
}

/** A controller that has started, with a record of every state it went through. */
async function started(setup: (server: ReturnType<typeof fakeSupabase>["server"]) => void = () => {}) {
  const { server, client } = fakeSupabase();
  setup(server);
  const controller = createAuthController(client);
  const seen: string[] = [];
  const describeState = () => {
    const s = controller.getSnapshot();
    return [s.status, s.profile ? `${s.profile.id}/${s.profile.role}` : "-", s.error ?? "-"].join(" ");
  };
  controller.subscribe(() => seen.push(describeState()));
  const stop = controller.start();
  await settle();
  return { server, controller, seen, stop };
}

const signedInAs = (userId = "user-1") => (server: ReturnType<typeof fakeSupabase>["server"]) => {
  server.session = sessionOf(userId);
};
const state = (controller: AuthController) => controller.getSnapshot();

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("profileFromRow", () => {
  it("maps a profiles row to camelCase", () => {
    expect(profileFromRow(ROW)).toEqual(PROFILE);
  });

  it("returns null for the all-null row the server sends once the account is deleted", () => {
    expect(profileFromRow({ id: null, email: null, full_name: null, phone: null, role: null, created_at: null })).toBeNull();
    expect(profileFromRow(null)).toBeNull();
    expect(profileFromRow(undefined)).toBeNull();
    expect(profileFromRow("user-1")).toBeNull();
    expect(profileFromRow({ id: "" })).toBeNull();
  });

  it("treats an unknown role as not approved, and missing texts as empty", () => {
    expect(profileFromRow({ id: "x", role: "owner" })).toEqual({ id: "x", email: "", fullName: "", phone: "", role: "pending", createdAt: "" });
    for (const role of ["pending", "sale", "manager", "locked"]) expect(profileFromRow({ id: "x", role })?.role).toBe(role);
  });
});

describe("opening the app", () => {
  it("is loading before anything is known", () => {
    const { client } = fakeSupabase();
    expect(createAuthController(client).getSnapshot()).toEqual({ status: "loading", profile: null, error: null });
  });

  it("nobody signed in → signedOut, without asking for a profile", async () => {
    const { server, controller } = await started();
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    expect(server.ensureProfile).not.toHaveBeenCalled();
  });

  it("a stored session → the profile is read with ensure_profile and mapped", async () => {
    const { server, controller, seen } = await started(signedInAs());
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["signedIn user-1/sale -"]);
  });

  it("the library's INITIAL_SESSION event does not trigger a second read", async () => {
    const { server, controller } = await started(signedInAs());
    server.emit("INITIAL_SESSION", server.session);
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);
    expect(state(controller).status).toBe("signedIn");
  });

  it("INITIAL_SESSION without a session, when really signed out, stays signedOut", async () => {
    const { server, controller } = await started();
    server.emit("INITIAL_SESSION", null);
    await settle();
    expect(state(controller).status).toBe("signedOut");
  });
});

describe("the profile cannot be read", () => {
  it("server unreachable → still loading, with a message; refreshProfile() then recovers into signedIn", async () => {
    const { server, controller, seen } = await started((s) => {
      signedInAs()(s);
      s.ensureProfile.mockResolvedValue(unreachable());
    });
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: NETWORK });

    // Retry while it is still down: the message goes away during the attempt, then comes back.
    seen.length = 0;
    expect(await controller.actions.refreshProfile()).toBeNull();
    expect(seen).toEqual(["loading - -", `loading - ${NETWORK}`]);

    server.ensureProfile.mockResolvedValue(ok());
    expect(await controller.actions.refreshProfile()).toEqual(PROFILE);
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
    expect(server.signOut).not.toHaveBeenCalled();
  });

  it("a server error (5xx) is treated the same way", async () => {
    const { controller } = await started((s) => {
      signedInAs()(s);
      s.ensureProfile.mockResolvedValue({ data: null, error: { message: "upstream connect error" }, status: 503 });
    });
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: "Máy chủ đang gặp sự cố. Hãy thử lại sau ít phút." });
  });

  it("the session itself cannot be refreshed for lack of network → loading with a message, not signed out", async () => {
    const { server, controller } = await started((s) => {
      signedInAs()(s);
      s.getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    });
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: NETWORK });
    // The library says «no session» in its first event in that situation; that must not sign the person out.
    server.emit("INITIAL_SESSION", null);
    await settle();
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: NETWORK });
    expect(server.signOut).not.toHaveBeenCalled();

    // Network back: the library refreshes the token and announces it.
    server.getSession.mockImplementation(async () => ({ data: { session: server.session }, error: null }));
    server.emit("TOKEN_REFRESHED", server.session);
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
  });

  it("a session the auth server has already thrown away → signedOut", async () => {
    const { controller } = await started((s) => {
      signedInAs()(s);
      s.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found"),
      });
    });
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
  });

  it("refreshProfile() never throws, even when the library does", async () => {
    const { server, controller } = await started(signedInAs());
    server.getSession.mockRejectedValue(new Error("storage is broken"));
    await expect(controller.actions.refreshProfile()).resolves.toEqual(PROFILE);
    server.getSession.mockImplementation(async () => ({ data: { session: server.session }, error: null }));
    server.ensureProfile.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(controller.actions.refreshProfile()).resolves.toEqual(PROFILE);
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: NETWORK });
  });
});

describe("re-reading the profile while signed in", () => {
  it("nothing changed → the very same profile object, and nobody is notified", async () => {
    const { server, controller, seen } = await started(signedInAs());
    const before = state(controller);
    seen.length = 0;
    server.ensureProfile.mockResolvedValue(ok({ ...ROW, updated_at: "2026-11-22T00:00:00+00:00" }));
    const result = await controller.actions.refreshProfile();
    expect(result).toBe(before.profile);
    expect(state(controller)).toBe(before);
    expect(seen).toEqual([]);
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);
  });

  it("a manager changed the role → a new profile object, announced once", async () => {
    const { server, controller, seen } = await started(signedInAs());
    const before = state(controller).profile;
    seen.length = 0;
    server.ensureProfile.mockResolvedValue(ok({ ...ROW, role: "locked" }));
    const result = await controller.actions.refreshProfile();
    expect(result).toEqual({ ...PROFILE, role: "locked" });
    expect(result).not.toBe(before);
    expect(seen).toEqual(["signedIn user-1/locked -"]);
  });

  it.each([
    ["name", { full_name: "Trần Thị Lan Anh" }],
    ["phone", { phone: "0911 222 333" }],
    ["role", { role: "manager" }],
    ["email", { email: "lan.anh@example.com" }],
  ])("a change of %s alone is noticed", async (_field, change) => {
    const { server, controller, seen } = await started(signedInAs());
    const before = state(controller).profile;
    seen.length = 0;
    server.ensureProfile.mockResolvedValue(ok({ ...ROW, ...change }));
    const result = await controller.actions.refreshProfile();
    expect(result).not.toBe(before);
    expect(result).toEqual(profileFromRow({ ...ROW, ...change }));
    expect(seen).toHaveLength(1);
  });

  it("a failed re-read keeps the person in the app with the profile they had; the next good one clears the error", async () => {
    const { server, controller } = await started(signedInAs());
    const before = state(controller).profile;
    server.ensureProfile.mockResolvedValue(unreachable());
    expect(await controller.actions.refreshProfile()).toBe(before);
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: NETWORK });
    expect(state(controller).profile).toBe(before);

    server.ensureProfile.mockResolvedValue(ok());
    await controller.actions.refreshProfile();
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
    expect(state(controller).profile).toBe(before);
  });

  it("calls made at the same moment share one request", async () => {
    const { server, controller } = await started(signedInAs());
    const [a, b, c] = await Promise.all([
      controller.actions.refreshProfile(),
      controller.actions.refreshProfile(),
      controller.actions.refreshProfile(),
    ]);
    expect(server.ensureProfile).toHaveBeenCalledTimes(2); // 1 at start + 1 for the three calls
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("a call made while a read is waiting for the server joins that read", async () => {
    const { server, controller } = await started(signedInAs());
    let answer: (a: Answer) => void = () => {};
    server.ensureProfile.mockImplementationOnce(() => new Promise<Answer>((resolve) => (answer = resolve)));
    const first = controller.actions.refreshProfile();
    await settle(); // the request is out, no answer yet
    const second = controller.actions.refreshProfile();
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(2); // 1 at start + 1 shared
    answer(ok({ ...ROW, role: "manager" }));
    expect((await first)?.role).toBe("manager");
    expect(await second).toBe(await first);
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);
  });
});

describe("the session is no longer valid", () => {
  it("account deleted (empty profile row, refresh refused) → signed out locally", async () => {
    const { server, controller } = await started(signedInAs());
    server.ensureProfile.mockResolvedValue(ok({ id: null, email: null, full_name: null, phone: null, role: null, created_at: null }));
    server.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found"),
    });
    expect(await controller.actions.refreshProfile()).toBeNull();
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    await settle();
    expect(server.signOut).toHaveBeenCalledTimes(1);
    expect(server.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("JWT refused by the data server and by the auth server → signed out locally", async () => {
    const { server, controller } = await started((s) => {
      signedInAs()(s);
      s.ensureProfile.mockResolvedValue({ data: null, error: { code: "PGRST301", message: "JWT cryptographic operation failed", details: null, hint: null }, status: 401 });
      s.refreshSession.mockResolvedValue({ data: { session: null }, error: new AuthApiError("invalid JWT", 403, "bad_jwt") });
    });
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
    expect(server.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("JWT expired for the data server but the session is fine (device clock is slow) → a new token, no sign-out", async () => {
    const { server, controller } = await started((s) => {
      signedInAs()(s);
      s.ensureProfile
        .mockResolvedValueOnce({ data: null, error: { code: "PGRST303", message: "JWT expired", details: null, hint: null }, status: 401 })
        .mockResolvedValue(ok());
    });
    expect(server.refreshSession).toHaveBeenCalledTimes(1);
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
    expect(server.signOut).not.toHaveBeenCalled();
  });

  it("the session is in doubt but the auth server cannot be reached → keep the session, show the network message", async () => {
    const { server, controller } = await started((s) => {
      signedInAs()(s);
      s.ensureProfile.mockResolvedValue({ data: null, error: { code: "PGRST303", message: "JWT expired", details: null, hint: null }, status: 401 });
      s.refreshSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    });
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: NETWORK });
    expect(server.signOut).not.toHaveBeenCalled();
  });

  it("the data server keeps refusing a session the auth server accepts → an error to retry, not a sign-out loop", async () => {
    const { server, controller } = await started((s) => {
      signedInAs()(s);
      s.ensureProfile.mockResolvedValue({ data: null, error: { code: "PGRST301", message: "JWT cryptographic operation failed", details: null, hint: null }, status: 401 });
    });
    expect(state(controller)).toEqual({
      status: "loading",
      profile: null,
      error: "Máy chủ dữ liệu chưa nhận phiên đăng nhập này. Hãy thử lại sau ít phút.",
    });
    expect(server.signOut).not.toHaveBeenCalled();
  });
});

describe("events from the auth library", () => {
  it("are handled after the library's callback has returned, never inside it", async () => {
    const { server, controller } = await started(signedInAs());
    server.session = null;
    server.emit("SIGNED_OUT", null);
    expect(state(controller).status).toBe("signedIn"); // nothing happened synchronously
    await settle();
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
  });

  it("SIGNED_OUT from another tab signs this tab out", async () => {
    const { server, controller, seen } = await started(signedInAs());
    seen.length = 0;
    server.session = null;
    server.emit("SIGNED_OUT", null);
    await settle();
    expect(seen).toEqual(["signedOut - -"]);
  });

  it("SIGNED_IN from another tab signs this tab in", async () => {
    const { server, controller } = await started();
    server.session = sessionOf("user-1");
    server.emit("SIGNED_IN", server.session);
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
  });

  it("TOKEN_REFRESHED, USER_UPDATED and repeated SIGNED_IN for the same account change nothing and read nothing", async () => {
    const { server, controller, seen } = await started(signedInAs());
    const before = state(controller);
    seen.length = 0;
    for (const event of ["TOKEN_REFRESHED", "USER_UPDATED", "SIGNED_IN", "SIGNED_IN"]) server.emit(event, server.session);
    await settle();
    expect(state(controller)).toBe(before);
    expect(seen).toEqual([]);
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);
  });

  it("another account signs in (other tab) → the previous profile is dropped first, then the new one appears", async () => {
    const { server, controller, seen } = await started(signedInAs());
    seen.length = 0;
    server.session = sessionOf("user-2");
    server.ensureProfile.mockResolvedValue(ok({ ...ROW, id: "user-2", email: "quanly@example.com", role: "manager" }));
    server.emit("SIGNED_IN", server.session);
    await settle();
    expect(seen).toEqual(["loading - -", "signedIn user-2/manager -"]);
    expect(state(controller).profile?.email).toBe("quanly@example.com");
  });

  it("a read that was under way for the previous account is thrown away", async () => {
    const { server, controller } = await started(signedInAs());
    let answerOld: (answer: Answer) => void = () => {};
    server.ensureProfile.mockImplementationOnce(() => new Promise<Answer>((resolve) => (answerOld = resolve)));
    const pending = controller.actions.refreshProfile(); // read for user-1, not answered yet
    await settle();
    server.session = sessionOf("user-2");
    server.ensureProfile.mockResolvedValue(ok({ ...ROW, id: "user-2", role: "manager" }));
    server.emit("SIGNED_IN", server.session);
    await settle();
    expect(state(controller).profile?.id).toBe("user-2");
    answerOld(ok({ ...ROW, role: "locked" })); // the late answer about user-1
    await pending;
    await settle();
    expect(state(controller).profile).toEqual({ ...PROFILE, id: "user-2", role: "manager" });
  });

  it("after stop() events are ignored and the subscription is gone", async () => {
    const { server, controller, stop } = await started(signedInAs());
    expect(server.subscribers()).toBe(1);
    server.emit("SIGNED_OUT", null); // queued, then the provider unmounts before it is handled
    stop();
    await settle();
    expect(server.subscribers()).toBe(0);
    expect(state(controller).status).toBe("signedIn");
  });

  it("start → stop → start (React StrictMode) ends with one subscription and a working controller", async () => {
    const { server, client } = fakeSupabase();
    server.session = sessionOf("user-1");
    const controller = createAuthController(client);
    controller.start()();
    const stop = controller.start();
    await settle();
    expect(server.subscribers()).toBe(1);
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("signIn", () => {
  it("resolves once the profile is there; the email is trimmed, the password is not", async () => {
    const { server, controller, seen } = await started();
    seen.length = 0;
    await controller.actions.signIn("  lan@example.com ", " mật khẩu ");
    expect(server.signInWithPassword).toHaveBeenCalledWith({ email: "lan@example.com", password: " mật khẩu " });
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
    expect(seen).toEqual(["loading - -", "signedIn user-1/sale -"]);
    // The library's own SIGNED_IN event, arriving a moment later, adds nothing.
    server.emit("SIGNED_IN", server.session);
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);
  });

  it("wrong email or password → an Error in Vietnamese, still signed out", async () => {
    const { server, controller } = await started();
    server.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    await expect(controller.actions.signIn("lan@example.com", "sai")).rejects.toThrow("Email hoặc mật khẩu không đúng.");
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
  });

  it("no network → an Error in Vietnamese", async () => {
    const { server, controller } = await started();
    server.signInWithPassword.mockResolvedValue({ data: { session: null, user: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    await expect(controller.actions.signIn("lan@example.com", "matkhau1")).rejects.toThrow(NETWORK);
    server.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(controller.actions.signIn("lan@example.com", "matkhau1")).rejects.toThrow(NETWORK);
  });

  it("signed in but the profile cannot be read → signIn still resolves; the gate shows the retry message", async () => {
    const { server, controller } = await started();
    server.ensureProfile.mockResolvedValue(unreachable());
    await controller.actions.signIn("lan@example.com", "matkhau1");
    expect(state(controller)).toEqual({ status: "loading", profile: null, error: NETWORK });
  });
});

describe("signUp", () => {
  const input = { email: " lan@example.com ", password: "matkhau1", fullName: "  Trần Thị Lan ", phone: " 0903 555 777 " };

  it("sends the name and phone as user metadata (trimmed) and signs in", async () => {
    const { server, controller } = await started();
    server.ensureProfile.mockResolvedValue(ok({ ...ROW, role: "pending" }));
    await expect(controller.actions.signUp(input)).resolves.toBe("signedIn");
    expect(server.signUp).toHaveBeenCalledWith({
      email: "lan@example.com",
      password: "matkhau1",
      options: { data: { full_name: "Trần Thị Lan", phone: "0903 555 777" } },
    });
    expect(state(controller)).toEqual({ status: "signedIn", profile: { ...PROFILE, role: "pending" }, error: null });
  });

  it("returns «confirmEmail» when the user was created without a session", async () => {
    const { server, controller } = await started();
    server.signUp.mockResolvedValue({ data: { session: null, user: { id: "user-9", identities: [{ id: "i" }] } }, error: null });
    await expect(controller.actions.signUp(input)).resolves.toBe("confirmEmail");
    expect(state(controller).status).toBe("signedOut");
  });

  it("an email that is already registered: by error code, and by the user-without-identities answer of confirm-email projects", async () => {
    const { server, controller } = await started();
    const taken = "Email này đã được đăng ký. Hãy đăng nhập; nếu quên mật khẩu, nhờ người quản lý đặt lại.";
    server.signUp.mockResolvedValue({ data: { session: null, user: null }, error: new AuthApiError("User already registered", 422, "user_already_exists") });
    await expect(controller.actions.signUp(input)).rejects.toThrow(taken);
    server.signUp.mockResolvedValue({ data: { session: null, user: { id: "fake", identities: [] } }, error: null });
    await expect(controller.actions.signUp(input)).rejects.toThrow(taken);
  });

  it("a password the server finds too short", async () => {
    const { server, controller } = await started();
    server.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: Object.assign(new AuthApiError("Password should be at least 8 characters.", 422, "weak_password"), { reasons: ["length"] }),
    });
    await expect(controller.actions.signUp(input)).rejects.toThrow("Mật khẩu phải có ít nhất 8 ký tự.");
  });
});

describe("signOut", () => {
  it("signs out of this browser only", async () => {
    const { server, controller } = await started(signedInAs());
    await controller.actions.signOut();
    expect(server.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
  });

  it("the server not answering does not keep the person signed in", async () => {
    const { server, controller } = await started(signedInAs());
    server.signOut.mockImplementation(async () => {
      server.session = null; // the library removes the local session before telling the server
      return { error: new AuthRetryableFetchError("Failed to fetch", 0) };
    });
    await controller.actions.signOut();
    expect(state(controller).status).toBe("signedOut");
  });

  it("a read still under way cannot bring the profile back afterwards", async () => {
    const { server, controller } = await started(signedInAs());
    let answer: (a: Answer) => void = () => {};
    server.ensureProfile.mockImplementationOnce(() => new Promise<Answer>((resolve) => (answer = resolve)));
    const pending = controller.actions.refreshProfile();
    await settle();
    await controller.actions.signOut();
    answer(ok());
    await pending;
    await settle();
    expect(state(controller)).toEqual({ status: "signedOut", profile: null, error: null });
  });
});

describe("updateProfile", () => {
  it("trims, saves, updates the state and returns the new profile", async () => {
    const { server, controller, seen } = await started(signedInAs());
    seen.length = 0;
    const saved = await controller.actions.updateProfile({ fullName: "  Trần Thị Lan Anh ", phone: " 0903 555 888 " });
    expect(server.updateProfile).toHaveBeenCalledWith({ full_name: "Trần Thị Lan Anh", phone: "0903 555 888" }, "user-1");
    expect(saved).toEqual({ ...PROFILE, fullName: "Trần Thị Lan Anh", phone: "0903 555 888" });
    expect(state(controller).profile).toBe(saved);
    expect(seen).toEqual(["signedIn user-1/sale -"]);
  });

  it("writes only the fields it was given", async () => {
    const { server, controller } = await started(signedInAs());
    await controller.actions.updateProfile({ phone: "0911 222 333" });
    expect(server.updateProfile).toHaveBeenCalledWith({ phone: "0911 222 333" }, "user-1");
    const before = state(controller).profile;
    await expect(controller.actions.updateProfile({})).resolves.toBe(before);
    expect(server.updateProfile).toHaveBeenCalledTimes(1);
  });

  it("failure → an Error in Vietnamese and the profile is left as it was", async () => {
    const { server, controller } = await started(signedInAs());
    const before = state(controller);
    server.updateProfile.mockResolvedValue(unreachable());
    await expect(controller.actions.updateProfile({ fullName: "X" })).rejects.toThrow(NETWORK);
    expect(state(controller)).toBe(before);
  });

  it("no row left to update → says so (and re-reads to find out why)", async () => {
    const { server, controller } = await started(signedInAs());
    server.updateProfile.mockResolvedValue({ data: null, error: null, status: 200 });
    await expect(controller.actions.updateProfile({ fullName: "X" })).rejects.toThrow("Không lưu được: không tìm thấy hồ sơ của tài khoản này.");
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);
  });

  it("not signed in → an Error", async () => {
    const { controller } = await started();
    await expect(controller.actions.updateProfile({ fullName: "X" })).rejects.toThrow("Bạn chưa đăng nhập.");
  });

  it("an older read that answers after the save cannot put the old name back", async () => {
    const { server, controller } = await started(signedInAs());
    let answerOld: (a: Answer) => void = () => {};
    server.ensureProfile.mockImplementationOnce(() => new Promise<Answer>((resolve) => (answerOld = resolve)));
    const pending = controller.actions.refreshProfile(); // asked before the save
    await settle();
    await controller.actions.updateProfile({ fullName: "Trần Thị Lan Anh" });
    answerOld(ok()); // …answered after it, with the old name
    await pending;
    await settle();
    expect(state(controller).profile?.fullName).toBe("Trần Thị Lan Anh");
  });
});

describe("changePassword", () => {
  it("updates the password of the signed-in user", async () => {
    const { server, controller } = await started(signedInAs());
    await controller.actions.changePassword("matkhau-moi");
    expect(server.updateUser).toHaveBeenCalledWith({ password: "matkhau-moi" });
  });

  it("server refusals come back in Vietnamese", async () => {
    const { server, controller } = await started(signedInAs());
    server.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("New password should be different from the old password.", 422, "same_password"),
    });
    await expect(controller.actions.changePassword("matkhau1")).rejects.toThrow("Mật khẩu mới phải khác mật khẩu đang dùng.");
  });
});

describe("coming back to the tab", () => {
  /** Minimal `window` / `document` so the controller can listen for focus and visibility changes. */
  function fakeBrowser() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    return { win, doc };
  }

  it("re-reads the profile on focus / visibility / back online — at most once per 5 seconds", async () => {
    const { win, doc } = fakeBrowser();
    const { server, controller } = await started(signedInAs());
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);

    win.dispatchEvent(new Event("focus")); // right after the first read: too soon
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    server.ensureProfile.mockResolvedValue(ok({ ...ROW, role: "manager" }));
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus")); // the two events of one «back to the tab»
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);
    expect(state(controller).profile?.role).toBe("manager");

    await vi.advanceTimersByTimeAsync(2_000);
    win.dispatchEvent(new Event("focus"));
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3_000);
    win.dispatchEvent(new Event("online"));
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(3);
  });

  it("does nothing while the tab is hidden, or when nobody is signed in", async () => {
    const { win, doc } = fakeBrowser();
    const { server, stop } = await started(signedInAs());
    await vi.advanceTimersByTimeAsync(6_000);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);
    stop();

    const signedOut = await started();
    await vi.advanceTimersByTimeAsync(6_000);
    doc.visibilityState = "visible";
    win.dispatchEvent(new Event("focus"));
    await settle();
    expect(signedOut.server.getSession).toHaveBeenCalledTimes(1);
  });

  it("an error screen retries by itself when the person comes back", async () => {
    const { win } = fakeBrowser();
    const { server, controller } = await started((s) => {
      signedInAs()(s);
      s.ensureProfile.mockResolvedValue(unreachable());
    });
    expect(state(controller).error).toBe(NETWORK);
    server.ensureProfile.mockResolvedValue(ok());
    await vi.advanceTimersByTimeAsync(5_000);
    win.dispatchEvent(new Event("focus"));
    await settle();
    expect(state(controller)).toEqual({ status: "signedIn", profile: PROFILE, error: null });
  });

  it("while the tab stays open and visible the profile is re-read about once a minute", async () => {
    fakeBrowser();
    const { server, controller, stop } = await started(signedInAs());
    server.ensureProfile.mockResolvedValue(ok({ ...ROW, role: "locked" }));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);
    expect(state(controller).profile?.role).toBe("locked");
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);
  });

  it("…but not while the tab is hidden", async () => {
    const { doc } = fakeBrowser();
    const { server, stop } = await started(signedInAs());
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(180_000);
    expect(server.ensureProfile).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(server.ensureProfile).toHaveBeenCalledTimes(2);
    stop();
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
});
