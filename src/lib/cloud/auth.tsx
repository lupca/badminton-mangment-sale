// Đăng nhập và hồ sơ tài khoản (chỉ dùng khi ứng dụng chạy với máy chủ — xem config.ts).
//
// Phần xử lý nằm trong `createAuthController` (không dính tới React, để kiểm thử được bằng một máy chủ giả);
// `AuthProvider` chỉ nối bộ điều khiển đó vào cây giao diện.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { authErrorMessage, describeAuthError, isSessionKind, isTemporaryKind, unwrap, type AuthErrorInfo } from "./authErrors";
import { getSupabase } from "./client";

/** Vai trò của tài khoản trên máy chủ. `pending` = mới đăng ký, chờ quản lý duyệt; `locked` = đã bị khóa. */
export type AccountRole = "pending" | "sale" | "manager" | "locked";

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: AccountRole;
  /** ISO */
  createdAt: string;
}

export interface AuthState {
  /**
   * "loading"   đang đọc phiên đăng nhập hoặc hồ sơ (nếu `error` khác null thì lần đọc vừa rồi thất bại — gọi `refreshProfile` để thử lại);
   * "signedOut" chưa đăng nhập;
   * "signedIn"  đã đăng nhập và đã có `profile`.
   */
  status: "loading" | "signedOut" | "signedIn";
  profile: Profile | null;
  /** Thông báo lỗi tiếng Việt của lần đọc hồ sơ gần nhất; null = không có lỗi. */
  error: string | null;
  /** Các hàm dưới đây ném Error với thông báo tiếng Việt khi thất bại. */
  signIn(email: string, password: string): Promise<void>;
  /** "confirmEmail" = project đang bật xác nhận email: tài khoản đã tạo nhưng phải bấm liên kết trong email rồi mới đăng nhập được. */
  signUp(input: { email: string; password: string; fullName: string; phone: string }): Promise<"signedIn" | "confirmEmail">;
  signOut(): Promise<void>;
  /** Đọc lại hồ sơ từ máy chủ (vai trò có thể vừa được quản lý đổi). Không ném lỗi: thất bại thì trả về hồ sơ đang có. */
  refreshProfile(): Promise<Profile | null>;
  updateProfile(patch: { fullName?: string; phone?: string }): Promise<Profile>;
  changePassword(newPassword: string): Promise<void>;
}

// ───────────────────────── Hồ sơ ─────────────────────────

const ACCOUNT_ROLES: readonly AccountRole[] = ["pending", "sale", "manager", "locked"];

/** Các cột của bảng `profiles` mà ứng dụng dùng. */
export const PROFILE_COLUMNS = "id, email, full_name, phone, role, created_at";

/**
 * Một dòng của bảng `profiles` → `Profile`. Trả về null nếu không phải một hồ sơ
 * (máy chủ trả về dòng toàn null khi tài khoản đã bị xóa mà phiên đăng nhập cũ vẫn còn hạn).
 */
export function profileFromRow(row: unknown): Profile | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    id: r.id,
    email: str(r.email),
    fullName: str(r.full_name),
    phone: str(r.phone),
    // Vai trò lạ (máy chủ mới hơn ứng dụng) thì coi như chưa được duyệt: không mở quyền gì.
    role: ACCOUNT_ROLES.includes(r.role as AccountRole) ? (r.role as AccountRole) : "pending",
    createdAt: str(r.created_at),
  };
}

function sameProfile(a: Profile, b: Profile): boolean {
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.fullName === b.fullName &&
    a.phone === b.phone &&
    a.role === b.role &&
    a.createdAt === b.createdAt
  );
}

// ───────────────────────── Tiện ích dùng chung cho phần tài khoản ─────────────────────────

/** Thời gian chờ tối đa cho một lần hỏi máy chủ; quá thì coi như mất mạng để người dùng còn bấm thử lại được. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Tín hiệu tự hủy yêu cầu sau `ms` mili giây. */
export function timeoutSignal(ms: number = REQUEST_TIMEOUT_MS): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

const tabHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Gọi `callback` khi tab này được mở lại, cửa sổ lấy lại tiêu điểm hoặc máy có mạng trở lại.
 * Các sự kiện đó thường đến dồn (mở lại tab = `visibilitychange` + `focus`) nên các lần cách nhau dưới `minGapMs` được gộp làm một.
 * Trả về hàm hủy.
 */
export function onForeground(callback: () => void, minGapMs = 1000): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let last = -Infinity;
  const fire = () => {
    if (tabHidden()) return;
    const now = Date.now();
    if (now - last < minGapMs) return;
    last = now;
    callback();
  };
  window.addEventListener("focus", fire);
  window.addEventListener("online", fire);
  document.addEventListener("visibilitychange", fire);
  return () => {
    window.removeEventListener("focus", fire);
    window.removeEventListener("online", fire);
    document.removeEventListener("visibilitychange", fire);
  };
}

/** Như `onForeground`, và thêm: cứ `intervalMs` gọi một lần trong lúc tab đang hiện. Trả về hàm hủy. */
export function watchForeground(callback: () => void, intervalMs: number): () => void {
  const stopListening = onForeground(callback);
  const timer = setInterval(() => {
    if (!tabHidden()) callback();
  }, intervalMs);
  return () => {
    stopListening();
    clearInterval(timer);
  };
}

/** Trong một component: gọi `callback` khi tab được mở lại và cứ `intervalMs` một lần (xem `watchForeground`). */
export function useAutoRefresh(callback: () => void, intervalMs: number, enabled = true): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    if (!enabled) return;
    return watchForeground(() => latest.current(), intervalMs);
  }, [enabled, intervalMs]);
}

// ───────────────────────── Bộ điều khiển ─────────────────────────

type Snapshot = Pick<AuthState, "status" | "profile" | "error">;
type Actions = Omit<AuthState, keyof Snapshot>;

const LOADING: Snapshot = { status: "loading", profile: null, error: null };
const SIGNED_OUT: Snapshot = { status: "signedOut", profile: null, error: null };

/** Mở lại tab / lấy lại tiêu điểm thì đọc lại hồ sơ, nhưng không dày hơn mức này. */
const FOCUS_THROTTLE_MS = 5_000;
/**
 * Người dùng để nguyên tab mà làm việc thì không có sự kiện «mở lại tab» nào, nên còn đọc lại hồ sơ định kỳ:
 * tài khoản vừa bị khóa hay đổi vai trò sẽ thấy thay đổi sau tối đa chừng này thời gian.
 */
const PERIODIC_REFRESH_MS = 60_000;

const NOT_SIGNED_IN = "Bạn chưa đăng nhập.";

type SessionRead = { kind: "ok"; userId: string } | { kind: "signedOut" } | { kind: "failed"; message: string };
type ProfileRead = { kind: "ok"; profile: Profile } | { kind: "invalidSession" } | { kind: "failed"; message: string };

export interface AuthController {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  /** Bắt đầu theo dõi phiên đăng nhập và đọc hồ sơ. Trả về hàm dừng. */
  start(): () => void;
  actions: Actions;
}

export function createAuthController(client: SupabaseClient): AuthController {
  let snapshot: Snapshot = LOADING;
  const listeners = new Set<() => void>();
  /** Tài khoản của phiên đăng nhập trên trình duyệt này, theo lần biết gần nhất (null = chưa biết hoặc chưa đăng nhập). */
  let userId: string | null = null;
  /** Lần đọc hồ sơ đang chạy — các lời gọi trùng lúc dùng chung một lần đọc. */
  let inflight: Promise<Profile | null> | null = null;
  /** Tăng mỗi khi tình hình đổi (đăng xuất, đổi tài khoản, vừa lưu hồ sơ): lần đọc bắt đầu trước đó bị bỏ kết quả. */
  let generation = 0;
  let lastLoadAt = -Infinity;

  const set = (next: Snapshot) => {
    // Không có gì đổi thì giữ nguyên đối tượng cũ: không component nào phải vẽ lại.
    if (next.status === snapshot.status && next.profile === snapshot.profile && next.error === snapshot.error) return;
    snapshot = next;
    [...listeners].forEach((listener) => listener());
  };

  const toSignedOut = () => {
    generation += 1;
    inflight = null;
    userId = null;
    set(SIGNED_OUT);
  };

  const showProfile = (profile: Profile) => {
    const current = snapshot.profile;
    set({ status: "signedIn", profile: current && sameProfile(current, profile) ? current : profile, error: null });
  };

  /** Lần đọc vừa rồi thất bại: đang dùng ứng dụng thì cứ dùng tiếp với hồ sơ đang có; chưa vào được thì báo lỗi để thử lại. */
  const fail = (message: string) => {
    set(snapshot.status === "signedIn" ? { ...snapshot, error: message } : { status: "loading", profile: null, error: message });
  };

  const readSession = async (): Promise<SessionRead> => {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) {
        // Mất mạng lúc cần làm mới phiên: phiên vẫn còn trong trình duyệt, chỉ là chưa dùng được.
        // Lỗi khác: máy chủ đã từ chối phiên này và thư viện đã gỡ nó.
        const info = describeAuthError(error);
        return isTemporaryKind(info.kind) ? { kind: "failed", message: info.message } : { kind: "signedOut" };
      }
      const id = data.session?.user?.id;
      return id ? { kind: "ok", userId: id } : { kind: "signedOut" };
    } catch (thrown) {
      return { kind: "failed", message: authErrorMessage(thrown) };
    }
  };

  const callEnsureProfile = async (): Promise<{ profile: Profile | null; problem: AuthErrorInfo | null }> => {
    const { data, error, status } = await client.rpc("ensure_profile").abortSignal(timeoutSignal());
    if (error) return { profile: null, problem: describeAuthError(error, status) };
    return { profile: profileFromRow(data), problem: null };
  };

  const readProfile = async (): Promise<ProfileRead> => {
    try {
      let result = await callEnsureProfile();
      // Hai dấu hiệu phiên đăng nhập có vấn đề: máy chủ dữ liệu không nhận JWT (hết hạn theo đồng hồ của máy chủ,
      // sai chữ ký…), hoặc trả về hồ sơ trống (tài khoản đã bị xóa nhưng JWT cũ chưa hết hạn).
      const sessionInDoubt = result.problem ? isSessionKind(result.problem.kind) : result.profile === null;
      if (sessionInDoubt) {
        // Hỏi máy chủ đăng nhập bằng cách xin JWT mới. Được: phiên vẫn còn, chỉ JWT cũ có vấn đề → đọc lại hồ sơ.
        // Bị từ chối: phiên thật sự không còn.
        const { error } = await client.auth.refreshSession();
        if (error) {
          const info = describeAuthError(error);
          return isSessionKind(info.kind) ? { kind: "invalidSession" } : { kind: "failed", message: info.message };
        }
        result = await callEnsureProfile();
        if (result.problem && isSessionKind(result.problem.kind)) {
          return { kind: "failed", message: "Máy chủ dữ liệu chưa nhận phiên đăng nhập này. Hãy thử lại sau ít phút." };
        }
      }
      if (result.problem) return { kind: "failed", message: result.problem.message };
      if (!result.profile) return { kind: "failed", message: "Không đọc được hồ sơ tài khoản. Hãy thử lại." };
      return { kind: "ok", profile: result.profile };
    } catch (thrown) {
      return { kind: "failed", message: authErrorMessage(thrown) };
    }
  };

  /** Gỡ phiên đăng nhập khỏi trình duyệt này (máy chủ đã không còn nhận nó). */
  const dropLocalSession = async () => {
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      // Ứng dụng đã về màn hình đăng nhập; dọn bộ nhớ không được cũng không sao.
    }
  };

  /** Đọc phiên đăng nhập rồi hồ sơ, và cập nhật trạng thái theo kết quả. Không bao giờ ném lỗi. */
  const load = (): Promise<Profile | null> => {
    if (inflight) return inflight;
    generation += 1;
    const mine = generation;
    const superseded = () => mine !== generation;
    lastLoadAt = Date.now();
    // Đang đứng ở màn hình báo lỗi mà thử lại: bỏ dòng lỗi để người dùng thấy là đang thử.
    if (snapshot.status === "loading" && snapshot.error !== null) set(LOADING);

    const run = (async (): Promise<Profile | null> => {
      const session = await readSession();
      if (superseded()) return snapshot.profile;
      if (session.kind === "signedOut") {
        toSignedOut();
        return null;
      }
      if (session.kind === "failed") {
        inflight = null;
        fail(session.message);
        return snapshot.profile;
      }
      if (session.userId !== userId) {
        userId = session.userId;
        // Tài khoản khác với hồ sơ đang hiện: không để hồ sơ của người trước lẫn sang người sau.
        if (snapshot.profile && snapshot.profile.id !== userId) set(LOADING);
      }

      const read = await readProfile();
      if (superseded()) return snapshot.profile;
      if (read.kind === "invalidSession") {
        toSignedOut();
        void dropLocalSession();
        return null;
      }
      inflight = null;
      if (read.kind === "failed") fail(read.message);
      else showProfile(read.profile);
      return snapshot.profile;
    })();
    inflight = run;
    return run;
  };

  /** Thư viện báo trình duyệt này đang có phiên đăng nhập `session` (vừa đăng nhập, làm mới token, đăng nhập ở tab khác…). */
  const adopt = (session: Session) => {
    const id = session.user?.id;
    if (!id) return;
    if (id !== userId) {
      // Vừa đăng nhập, hoặc đổi sang tài khoản khác: bỏ hồ sơ cũ rồi đọc hồ sơ của tài khoản này.
      generation += 1;
      inflight = null;
      userId = id;
      set(LOADING);
      void load();
    } else if (snapshot.status !== "signedIn" && !inflight) {
      // Vẫn tài khoản đó nhưng lần đọc hồ sơ trước chưa thành: nhân dịp này thử lại.
      void load();
    }
    // Còn lại: vẫn tài khoản đó và hồ sơ đã có — không phải làm gì (sự kiện này đến rất thường xuyên).
  };

  /** Vừa đăng nhập / đăng ký xong ở tab này: chuyển sang đọc hồ sơ ngay, và chờ tới khi đọc xong. */
  const enter = async (session: Session) => {
    adopt(session);
    await inflight;
  };

  const onAuthEvent = (event: AuthChangeEvent, session: Session | null) => {
    if (event === "SIGNED_OUT") {
      // Kể cả khi đăng xuất ở tab khác của cùng trình duyệt.
      toSignedOut();
    } else if (session?.user?.id) {
      // INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED…
      adopt(session);
    } else {
      // Sự kiện không kèm phiên: lúc mở trang khi chưa đăng nhập, hoặc khi thư viện chưa làm mới được phiên vì mất mạng.
      // `load` tự phân biệt hai trường hợp đó.
      void load();
    }
  };

  const actions: Actions = {
    async signIn(email, password) {
      const { data } = await unwrap(client.auth.signInWithPassword({ email: email.trim(), password }));
      if (data.session) await enter(data.session);
    },

    async signUp(input) {
      const { data } = await unwrap(
        client.auth.signUp({
          email: input.email.trim(),
          password: input.password,
          // Máy chủ chép hai giá trị này vào hồ sơ khi tạo tài khoản.
          options: { data: { full_name: input.fullName.trim(), phone: input.phone.trim() } },
        }),
      );
      if (data.session) {
        await enter(data.session);
        return "signedIn";
      }
      if (!data.user) throw new Error(authErrorMessage(null));
      // Project bật xác nhận email. Với email đã đăng ký, máy chủ không báo lỗi (để không lộ email nào đã có tài khoản)
      // mà trả về một tài khoản không có `identities` — và cũng không gửi email nào.
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error(authErrorMessage({ code: "user_already_exists" }));
      }
      return "confirmEmail";
    },

    async signOut() {
      try {
        // "local": chỉ đăng xuất trên trình duyệt này, không đụng tới điện thoại / máy khác của cùng tài khoản.
        // Phiên trên máy này được gỡ trước khi báo cho máy chủ, nên đang mất mạng vẫn đăng xuất được.
        await client.auth.signOut({ scope: "local" });
      } catch (thrown) {
        throw new Error(`Không đăng xuất được. ${authErrorMessage(thrown)}`);
      }
      toSignedOut();
    },

    refreshProfile: () => load(),

    async updateProfile(patch) {
      const current = snapshot.profile;
      if (!current) throw new Error(NOT_SIGNED_IN);
      const values: { full_name?: string; phone?: string } = {};
      if (patch.fullName !== undefined) values.full_name = patch.fullName.trim();
      if (patch.phone !== undefined) values.phone = patch.phone.trim();
      if (Object.keys(values).length === 0) return current;

      const { data } = await unwrap(
        client.from("profiles").update(values).eq("id", current.id).select(PROFILE_COLUMNS).maybeSingle(),
      );
      const saved = profileFromRow(data);
      if (!saved) {
        // Không còn dòng hồ sơ nào để sửa: tài khoản đã bị xóa, hoặc phiên đăng nhập không còn — đọc lại để biết.
        void load();
        throw new Error("Không lưu được: không tìm thấy hồ sơ của tài khoản này. Hãy tải lại trang.");
      }
      // Trong lúc chờ, trình duyệt này có thể đã đăng xuất hoặc đổi sang tài khoản khác (ở tab khác).
      if (snapshot.profile?.id !== saved.id) return saved;
      // Một lần đọc hồ sơ đang dở có thể mang về bản cũ hơn bản vừa lưu: bỏ kết quả của nó.
      generation += 1;
      inflight = null;
      showProfile(saved);
      return snapshot.profile ?? saved;
    },

    async changePassword(newPassword) {
      await unwrap(client.auth.updateUser({ password: newPassword }));
    },
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      let stopped = false;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Thư viện đang giữ hàng đợi sự kiện trong lúc gọi hàm này: không gọi lại Supabase ở đây, hoãn sang nhịp sau.
        setTimeout(() => {
          if (!stopped) onAuthEvent(event, session);
        }, 0);
      });
      void load();
      const stopWatching = watchForeground(() => {
        if (snapshot.status === "signedOut") return;
        if (Date.now() - lastLoadAt < FOCUS_THROTTLE_MS) return;
        void load();
      }, PERIODIC_REFRESH_MS);
      return () => {
        stopped = true;
        data.subscription.unsubscribe();
        stopWatching();
      };
    },
    actions,
  };
}

// ───────────────────────── React ─────────────────────────

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => createAuthController(getSupabase()));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => controller.start(), [controller]);
  // Giá trị chỉ đổi khi trạng thái thật sự đổi: đọc lại hồ sơ mà không có gì mới thì không ai phải vẽ lại.
  const value = useMemo<AuthState>(() => ({ ...snapshot, ...controller.actions }), [snapshot, controller]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth phải được dùng bên trong <AuthProvider>.");
  return auth;
}

/** Như `useAuth`, nhưng trả về null khi ứng dụng chạy không có máy chủ (không có <AuthProvider>). */
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}
