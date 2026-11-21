// Đăng nhập và hồ sơ tài khoản (chỉ dùng khi ứng dụng chạy với máy chủ — xem config.ts).
//
// Phiên đăng nhập là một «khóa phiên» do máy chủ cấp lúc đăng nhập / đăng ký. Lớp gọi API (api.ts) giữ khóa đó trong trình
// duyệt và gửi kèm mỗi yêu cầu; các tab của cùng trình duyệt dùng chung một khóa.
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
import { ApiError, errorMessage, type ApiClient } from "./api";
import { getApi } from "./client";

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
   * "loading"   đang đọc hồ sơ của phiên đăng nhập (nếu `error` khác null thì lần đọc vừa rồi thất bại — gọi `refreshProfile` để thử lại);
   * "signedOut" chưa đăng nhập;
   * "signedIn"  đã đăng nhập và đã có `profile`.
   */
  status: "loading" | "signedOut" | "signedIn";
  profile: Profile | null;
  /** Thông báo lỗi tiếng Việt của lần đọc hồ sơ gần nhất; null = không có lỗi. */
  error: string | null;
  /** Các hàm dưới đây ném Error với thông báo tiếng Việt khi thất bại (trừ khi ghi khác). */
  signIn(email: string, password: string): Promise<void>;
  /** Đăng ký xong là được đăng nhập luôn (tài khoản mới ở trạng thái chờ duyệt; riêng tài khoản đầu tiên là quản lý). */
  signUp(input: { email: string; password: string; fullName: string; phone: string }): Promise<void>;
  /** Chỉ đăng xuất trên trình duyệt này. Không ném lỗi và không chờ máy chủ: đang mất mạng vẫn đăng xuất được. */
  signOut(): Promise<void>;
  /** Đọc lại hồ sơ từ máy chủ (vai trò có thể vừa được quản lý đổi). Không ném lỗi: thất bại thì trả về hồ sơ đang có. */
  refreshProfile(): Promise<Profile | null>;
  updateProfile(patch: { fullName?: string; phone?: string }): Promise<Profile>;
  changePassword(newPassword: string): Promise<void>;
  /**
   * Hồ sơ của tài khoản đang đăng nhập vừa nhận được theo một đường khác — lần hỏi định kỳ của bộ đồng bộ (`sync.poll`).
   * `askedAt` = `Date.now()` lúc yêu cầu đó được gửi đi. Bỏ qua nếu không phải hồ sơ của tài khoản đang hiện, hoặc nếu
   * yêu cầu đó được gửi trước yêu cầu đã mang về hồ sơ đang hiện (bản cũ hơn).
   */
  observeProfile(raw: unknown, askedAt: number): void;
}

// ───────────────────────── Hồ sơ ─────────────────────────

const ACCOUNT_ROLES: readonly AccountRole[] = ["pending", "sale", "manager", "locked"];

/** Hồ sơ do lớp API trả về ({ id, email, fullName, phone, role, createdAt }) → `Profile`. Trả về null nếu không phải một hồ sơ. */
export function parseProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    id: r.id,
    email: str(r.email),
    fullName: str(r.fullName),
    phone: str(r.phone),
    // Vai trò lạ (máy chủ mới hơn ứng dụng) thì coi như chưa được duyệt: không mở quyền gì.
    role: ACCOUNT_ROLES.includes(r.role as AccountRole) ? (r.role as AccountRole) : "pending",
    createdAt: str(r.createdAt),
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

/** Thời gian chờ tối đa cho một lần hỏi máy chủ; quá thì coi như mất mạng để người dùng còn bấm thử lại được. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Lời báo «tôi đăng xuất» gửi máy chủ chỉ là báo cho biết: không ai chờ nó, và nó tự bỏ sau chừng này. */
const SIGN_OUT_TIMEOUT_MS = 3_000;
/** Mở lại tab / lấy lại tiêu điểm thì đọc lại hồ sơ, nhưng không dày hơn mức này. */
const FOCUS_THROTTLE_MS = 5_000;
/**
 * Đang ở trong ứng dụng mà quay lại tab: bộ đồng bộ cũng hỏi máy chủ đúng lúc đó và báo hồ sơ qua `observeProfile`.
 * Chờ nó một nhịp; chỉ khi không thấy gì (bộ đồng bộ chưa chạy) thì phần này mới tự hỏi.
 */
const FOREGROUND_GRACE_MS = 1_500;
/**
 * Hồ sơ chưa được máy chủ xác nhận lại quá chừng này thì tự đọc lại (xem theo nhịp `PERIODIC_CHECK_MS`, khi tab đang hiện).
 * Trong ứng dụng, bộ đồng bộ hỏi máy chủ đều đặn (thưa nhất là một phút một lần) và báo hồ sơ qua `observeProfile`,
 * nên khi nó đang chạy thì phần này không gửi thêm yêu cầu định kỳ nào — mỗi yêu cầu là một lần chạy tính tiền của lớp API.
 */
const PROFILE_STALE_MS = 90_000;
const PERIODIC_CHECK_MS = 30_000;
/** Máy chủ từ chối khóa phiên ở một yêu cầu nào đó: hỏi lại hồ sơ để biết chắc, nhưng không dày hơn mức này. */
const RECHECK_GAP_MS = 5_000;

const NOT_SIGNED_IN = "Bạn chưa đăng nhập.";
const BAD_ANSWER = "Máy chủ trả lời không đúng dạng. Hãy thử lại.";

export interface AuthController {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  /** Bắt đầu theo dõi phiên đăng nhập và đọc hồ sơ. Trả về hàm dừng. */
  start(): () => void;
  actions: Actions;
}

export function createAuthController(api: ApiClient): AuthController {
  let snapshot: Snapshot = LOADING;
  const listeners = new Set<() => void>();
  /**
   * Khóa phiên mà trạng thái hiện tại đang nói về (null = chưa đăng nhập, hoặc chưa đọc lần nào). Bộ điều khiển ghi giá trị
   * mới vào đây TRƯỚC khi tự đổi khóa, nên khóa đổi mà khác giá trị này nghĩa là do nơi khác đổi (một tab khác).
   */
  let known: string | null = null;
  /** Lần đọc hồ sơ đang chạy — các lời gọi trùng lúc dùng chung một lần đọc. */
  let inflight: Promise<Profile | null> | null = null;
  /** Tăng mỗi khi tình hình đổi (đăng xuất, đổi phiên, vừa lưu hồ sơ): lần đọc bắt đầu trước đó bị bỏ kết quả. */
  let generation = 0;
  /** Lúc bắt đầu lần đọc hồ sơ gần nhất của chính bộ điều khiển này. */
  let lastLoadAt = -Infinity;
  /** Lúc gần nhất máy chủ xác nhận hồ sơ của phiên này — bằng đường nào cũng tính (xem `observeProfile`). */
  let lastConfirmedAt = -Infinity;
  /** Lúc gửi yêu cầu đã mang về hồ sơ đang hiện: câu trả lời của một yêu cầu gửi trước lúc đó là bản cũ hơn. */
  let profileAsOf = -Infinity;

  const set = (next: Snapshot) => {
    // Không có gì đổi thì giữ nguyên đối tượng cũ: không component nào phải vẽ lại.
    if (next.status === snapshot.status && next.profile === snapshot.profile && next.error === snapshot.error) return;
    snapshot = next;
    [...listeners].forEach((listener) => listener());
  };

  /** Quên mọi thứ thuộc về phiên đang theo dõi; các lần đọc đang dở bị bỏ kết quả. */
  const forget = () => {
    generation += 1;
    inflight = null;
    lastConfirmedAt = -Infinity;
    profileAsOf = -Infinity;
  };

  const toSignedOut = () => {
    forget();
    known = null;
    set(SIGNED_OUT);
  };

  /** Trình duyệt chuyển sang một phiên khác (có thể của tài khoản khác): bỏ hồ sơ đang hiện trước khi đọc hồ sơ mới. */
  const switchTo = (token: string) => {
    forget();
    known = token;
    set(LOADING);
  };

  /** Gỡ phiên khỏi trình duyệt này (các tab khác cũng được báo) và về màn hình đăng nhập. */
  const leave = () => {
    known = null;
    api.setToken(null);
    toSignedOut();
  };

  /** Máy chủ vừa trả về hồ sơ của phiên này, cho một yêu cầu gửi lúc `askedAt`. */
  const showProfile = (profile: Profile, askedAt: number) => {
    const current = snapshot.profile;
    lastConfirmedAt = Date.now();
    if (current && current.id === profile.id && askedAt < profileAsOf) {
      // Câu trả lời đến muộn của một yêu cầu gửi trước: phiên vẫn dùng được, nhưng hồ sơ đang hiện mới hơn.
      set({ status: "signedIn", profile: current, error: null });
      return;
    }
    profileAsOf = askedAt;
    set({ status: "signedIn", profile: current && sameProfile(current, profile) ? current : profile, error: null });
  };

  /** Lần đọc vừa rồi thất bại: đang dùng ứng dụng thì cứ dùng tiếp với hồ sơ đang có; chưa vào được thì báo lỗi để thử lại. */
  const fail = (message: string) => {
    set(snapshot.status === "signedIn" ? { ...snapshot, error: message } : { status: "loading", profile: null, error: message });
  };

  /** Đọc hồ sơ của phiên đang lưu trên trình duyệt và cập nhật trạng thái theo kết quả. Không bao giờ ném lỗi. */
  const load = (): Promise<Profile | null> => {
    if (inflight) return inflight;
    const sent = api.getToken();
    if (sent === null) {
      toSignedOut();
      return Promise.resolve(null);
    }
    // Khóa phiên đã đổi mà bộ điều khiển chưa được báo: không để hồ sơ của phiên trước lẫn sang phiên này.
    if (sent !== known) switchTo(sent);
    generation += 1;
    const mine = generation;
    const askedAt = Date.now();
    lastLoadAt = askedAt;
    // Đang đứng ở màn hình báo lỗi mà thử lại: bỏ dòng lỗi để người dùng thấy là đang thử.
    if (snapshot.status === "loading" && snapshot.error !== null) set(LOADING);

    const run = (async (): Promise<Profile | null> => {
      let raw: unknown = null;
      let failure: unknown = null;
      try {
        raw = await api.call("me", {}, { timeoutMs: REQUEST_TIMEOUT_MS });
      } catch (thrown) {
        failure = thrown ?? new Error("");
      }
      if (mine !== generation) return snapshot.profile;
      inflight = null;
      // Khóa phiên đổi trong lúc chờ mà không ai báo: câu trả lời này thuộc về phiên cũ — đọc lại theo phiên mới.
      if (api.getToken() !== sent) return load();
      if (failure !== null) {
        if (failure instanceof ApiError && failure.code === "unauthorized") {
          // Máy chủ không còn nhận khóa phiên này (hết hạn, đã bị đặt lại mật khẩu…).
          leave();
          return null;
        }
        fail(errorMessage(failure));
        return snapshot.profile;
      }
      const profile = parseProfile(raw);
      if (!profile) {
        fail(BAD_ANSWER);
        return snapshot.profile;
      }
      showProfile(profile, askedAt);
      return snapshot.profile;
    })();
    inflight = run;
    return run;
  };

  /** Vừa đăng nhập / đăng ký xong ở tab này: máy chủ trả về khóa phiên mới kèm hồ sơ. */
  const enter = (answer: unknown, askedAt: number) => {
    const fields = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
    const token = typeof fields.token === "string" ? fields.token : "";
    const profile = parseProfile(fields.profile);
    if (!token || !profile) throw new Error(BAD_ANSWER);
    forget();
    known = token;
    api.setToken(token);
    // Hồ sơ của người trước (nếu còn) không được dính sang người vừa đăng nhập.
    if (snapshot.profile && snapshot.profile.id !== profile.id) set(LOADING);
    showProfile(profile, askedAt);
  };

  const actions: Actions = {
    async signIn(email, password) {
      const askedAt = Date.now();
      const answer = await api.call("auth.signIn", { email: email.trim(), password }, { timeoutMs: REQUEST_TIMEOUT_MS });
      enter(answer, askedAt);
    },

    async signUp(input) {
      const askedAt = Date.now();
      const answer = await api.call(
        "auth.signUp",
        { email: input.email.trim(), password: input.password, fullName: input.fullName.trim(), phone: input.phone.trim() },
        { timeoutMs: REQUEST_TIMEOUT_MS },
      );
      enter(answer, askedAt);
    },

    async signOut() {
      if (api.getToken() !== null) {
        // Báo máy chủ hủy phiên này. Yêu cầu được gửi đi ngay, kèm khóa phiên đang dùng, nhưng không ai chờ câu trả lời:
        // đang mất mạng vẫn đăng xuất được, và người dùng không phải đợi. (Không báo được thì phiên tự hết hạn trên máy chủ.)
        void api.call("auth.signOut", {}, { timeoutMs: SIGN_OUT_TIMEOUT_MS }).catch(() => undefined);
      }
      leave();
    },

    refreshProfile: () => load(),

    async updateProfile(patch) {
      const current = snapshot.profile;
      if (!current) throw new Error(NOT_SIGNED_IN);
      const values: { fullName?: string; phone?: string } = {};
      if (patch.fullName !== undefined) values.fullName = patch.fullName.trim();
      if (patch.phone !== undefined) values.phone = patch.phone.trim();
      if (Object.keys(values).length === 0) return current;

      const session = known;
      const askedAt = Date.now();
      const saved = parseProfile(await api.call("me.update", values, { timeoutMs: REQUEST_TIMEOUT_MS }));
      if (!saved) throw new Error(BAD_ANSWER);
      // Trong lúc chờ, trình duyệt này có thể đã đăng xuất hoặc đổi sang tài khoản khác (ở tab khác).
      if (known !== session || snapshot.profile?.id !== saved.id) return saved;
      // Một lần đọc hồ sơ đang dở có thể mang về bản cũ hơn bản vừa lưu: bỏ kết quả của nó.
      generation += 1;
      inflight = null;
      showProfile(saved, askedAt);
      return snapshot.profile ?? saved;
    },

    async changePassword(newPassword) {
      await api.call("me.password", { newPassword }, { timeoutMs: REQUEST_TIMEOUT_MS });
    },

    observeProfile(raw, askedAt) {
      const current = snapshot.profile;
      if (snapshot.status !== "signedIn" || !current) return;
      const profile = parseProfile(raw);
      if (!profile || profile.id !== current.id) return;
      // Yêu cầu đó được gửi trước (hoặc cùng lúc với) yêu cầu đã mang về hồ sơ đang hiện — vd một lần hỏi định kỳ gửi đi
      // ngay trước khi người dùng lưu họ tên mới: không để nó đưa tên cũ trở lại.
      if (!(askedAt > profileAsOf)) return;
      showProfile(profile, askedAt);
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
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      let recheckTimer: ReturnType<typeof setTimeout> | null = null;

      // Khóa phiên đổi. Do chính bộ điều khiển đổi (đăng nhập, đăng xuất) thì `known` đã mang giá trị mới: bỏ qua.
      // Còn lại là một tab khác của trình duyệt vừa đăng xuất / đăng nhập — có thể bằng tài khoản khác.
      const offToken = api.onTokenChange((next) => {
        if (stopped || next === known) return;
        if (next === null) {
          toSignedOut();
        } else {
          switchTo(next);
          void load();
        }
      });

      // Một yêu cầu nào đó (vd của bộ đồng bộ) vừa bị máy chủ từ chối khóa phiên: đọc lại hồ sơ để biết chắc.
      // Máy chủ từ chối cả lần đọc này thì `load` tự đăng xuất; còn chỉ là trục trặc tạm thời thì phiên được giữ nguyên.
      const offUnauthorized = api.onUnauthorized(() => {
        if (stopped || snapshot.status === "signedOut" || inflight) return;
        const wait = lastLoadAt + RECHECK_GAP_MS - Date.now();
        if (wait <= 0) {
          void load();
        } else if (!recheckTimer) {
          recheckTimer = setTimeout(() => {
            recheckTimer = null;
            if (!stopped && snapshot.status !== "signedOut") void load();
          }, wait);
        }
      });

      void load();

      const stopForeground = onForeground(() => {
        if (stopped || snapshot.status === "signedOut") return;
        const now = Date.now();
        if (now - lastLoadAt < FOCUS_THROTTLE_MS) return;
        if (snapshot.status !== "signedIn") {
          // Đang ở màn hình «Đang tải…» / báo lỗi: thử lại ngay.
          void load();
          return;
        }
        if (now - lastConfirmedAt < FOCUS_THROTTLE_MS || graceTimer) return;
        graceTimer = setTimeout(() => {
          graceTimer = null;
          if (stopped || snapshot.status !== "signedIn") return;
          const later = Date.now();
          if (later - lastConfirmedAt < FOCUS_THROTTLE_MS || later - lastLoadAt < FOCUS_THROTTLE_MS) return;
          void load();
        }, FOREGROUND_GRACE_MS);
      });

      const timer = setInterval(() => {
        if (stopped || tabHidden() || snapshot.status === "signedOut") return;
        const now = Date.now();
        if (now - lastLoadAt < FOCUS_THROTTLE_MS) return;
        if (snapshot.status === "signedIn" && now - lastConfirmedAt < PROFILE_STALE_MS) return;
        void load();
      }, PERIODIC_CHECK_MS);

      return () => {
        stopped = true;
        offToken();
        offUnauthorized();
        stopForeground();
        clearInterval(timer);
        if (graceTimer) clearTimeout(graceTimer);
        if (recheckTimer) clearTimeout(recheckTimer);
      };
    },
    actions,
  };
}

// ───────────────────────── React ─────────────────────────

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => createAuthController(getApi()));
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
