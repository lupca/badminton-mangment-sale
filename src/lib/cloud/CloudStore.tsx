// Kho dữ liệu khi có máy chủ: dữ liệu của cả nhóm nằm trên Supabase, trình duyệt giữ một bản đang mở và đồng bộ liên tục.
// Vai trò và thông tin sale lấy từ tài khoản đang đăng nhập (không còn là thiết lập của từng máy).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DB, Role, Settings } from "../../types";
import { Button, CenteredScreen, Notice, toast } from "../../ui";
import { newId } from "../format";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  StoreContext,
  buildStore,
  normalizeOrder,
  normalizeProgram,
  normalizeSettings,
  normalizeStock,
  type Store,
} from "../store";
import { SYNC_IDLE, type SyncStatus } from "../syncStatus";
import { accountsChangedOnServer } from "./accounts";
import { useAuth, type Profile } from "./auth";
import { getSupabase } from "./client";
import { RemoteError, supabaseRemote } from "./remote";
import { SyncEngine } from "./sync";

/** Vai trò trong ứng dụng của một tài khoản đã được duyệt. */
function appRole(profile: Profile): Role {
  return profile.role === "manager" ? "manager" : "sale";
}

function accountSettings(profile: Profile): Pick<Settings, "role" | "salesperson" | "salespersonPhone"> {
  return { role: appRole(profile), salesperson: profile.fullName, salespersonPhone: profile.phone };
}

function emptyDB(profile: Profile): DB {
  return {
    version: 1,
    programs: [],
    orders: [],
    stock: { bySku: {}, updatedAt: null },
    settings: { ...accountSettings(profile), lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD },
  };
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/**
 * Nhật ký đồng bộ để tìm lỗi: bật bằng cách gõ `localStorage.setItem("kmdb.debug", "1")` ở Console rồi tải lại trang;
 * xem bằng `__kmSyncLog`. Bình thường không ghi gì.
 */
function syncLogger(): ((message: string) => void) | undefined {
  try {
    if (localStorage.getItem("kmdb.debug") !== "1") return undefined;
  } catch {
    return undefined;
  }
  const lines: string[] = [];
  (window as unknown as { __kmSyncLog?: string[] }).__kmSyncLog = lines;
  return (message) => {
    lines.push(`${new Date().toISOString().slice(11, 23)} ${message}`);
    if (lines.length > 2000) lines.splice(0, 500);
  };
}

/** Chỉ dùng bên trong cổng đăng nhập, khi tài khoản đã được duyệt (sale hoặc quản lý). */
export function CloudStoreProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const profile = auth.profile as Profile;
  const authRef = useRef(auth);
  authRef.current = auth;

  const [db, setDbState] = useState<DB>(() => emptyDB(profile));
  const dbRef = useRef(db);
  const [sync, setSync] = useState<SyncStatus>(SYNC_IDLE);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const engineRef = useRef<SyncEngine | null>(null);

  // Thay đổi do người dùng làm: cập nhật ngay trên máy rồi báo bộ đồng bộ gửi lên.
  const commit = useCallback((next: DB) => {
    dbRef.current = next;
    setDbState(next);
    engineRef.current?.localChanged();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const engine = new SyncEngine(supabaseRemote(getSupabase()), {
      get: () => dbRef.current,
      // Thay đổi đến từ máy chủ: không tính là việc cần gửi lên.
      apply(fn) {
        const next = fn(dbRef.current);
        if (next === dbRef.current) return;
        dbRef.current = next;
        setDbState(next);
      },
      onStatus: setSync,
      notify: (message, tone) => toast(message, tone),
      debug: syncLogger(),
      onProfileEvent(id) {
        // Quản lý vừa đổi vai trò / khóa tài khoản này: đọc lại hồ sơ ngay để màn hình đổi theo.
        if (id === authRef.current.profile?.id) void authRef.current.refreshProfile();
        // Hồ sơ của người khác đổi (chỉ quản lý nhận được): vd có người mới đăng ký đang chờ duyệt.
        else accountsChangedOnServer();
      },
      normalize: {
        program: normalizeProgram,
        order: normalizeOrder,
        stock: normalizeStock,
        threshold: (raw) => normalizeSettings(raw).lowStockThreshold,
      },
    });
    engineRef.current = engine;
    setPhase("loading");
    engine.start().then(
      () => {
        if (!cancelled) setPhase("ready");
      },
      (error) => {
        if (cancelled) return;
        setLoadError(messageOf(error, "Không tải được dữ liệu từ máy chủ."));
        setPhase("error");
      },
    );

    const onVisibility = () => {
      // Rời tab (trên điện thoại: chuyển sang ứng dụng khác) thì gửi ngay cái đang chờ; quay lại thì hỏi máy chủ có gì mới.
      if (document.visibilityState === "hidden") void engine.flushNow();
      else engine.wake();
    };
    const onWake = () => engine.wake();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [attempt]);

  // Hồ sơ tài khoản đổi (quản lý đổi vai trò, người dùng sửa tên / điện thoại) → thiết lập của kho đổi theo.
  const role = appRole(profile);
  useEffect(() => {
    const cur = dbRef.current;
    const account = accountSettings(profile);
    const same =
      cur.settings.role === account.role &&
      cur.settings.salesperson === account.salesperson &&
      cur.settings.salespersonPhone === account.salespersonPhone;
    if (same) return;
    const next = { ...cur, settings: { ...cur.settings, ...account } };
    dbRef.current = next;
    setDbState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, profile.fullName, profile.phone]);

  // Vai trò đổi thì phạm vi được thấy cũng đổi (quản lý thấy đơn của mọi sale): tải lại từ máy chủ.
  const firstRole = useRef(role);
  useEffect(() => {
    if (firstRole.current === role) return;
    firstRole.current = role;
    engineRef.current?.requestPull();
  }, [role]);

  // Còn thay đổi chưa lưu lên máy chủ thì hỏi lại trước khi đóng / tải lại trang.
  const unsaved = sync.state !== "idle";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const store = useMemo<Store>(
    () =>
      buildStore(db, dbRef, commit, {
        mode: "cloud",
        saveOk: true,
        sync,
        // Mã đơn do máy chủ cấp, để mọi sale dùng chung một dãy số.
        newOrderCode: () => "",
        async addOrder(order) {
          const engine = engineRef.current;
          if (!engine) throw new Error("Chưa kết nối được máy chủ.");
          try {
            return await engine.createOrder(order);
          } catch (error) {
            // Trùng mã nội bộ với một đơn khác (rất hiếm): thử lại một lần với mã nội bộ mới.
            if (error instanceof RemoteError && error.kind === "conflict") {
              return engine.createOrder({ ...order, id: newId("o") });
            }
            throw error;
          }
        },
        updateSettings(patch) {
          if (patch.lowStockThreshold !== undefined && patch.lowStockThreshold !== dbRef.current.settings.lowStockThreshold) {
            const cur = dbRef.current;
            commit({ ...cur, settings: { ...cur.settings, lowStockThreshold: patch.lowStockThreshold } });
          }
          if (patch.salesperson !== undefined || patch.salespersonPhone !== undefined) {
            authRef.current
              .updateProfile({ fullName: patch.salesperson, phone: patch.salespersonPhone })
              .catch((error) => toast(messageOf(error, "Không lưu được thông tin tài khoản."), "error"));
          }
        },
        flushNow: () => engineRef.current?.flushNow() ?? Promise.resolve(true),
      }),
    [db, sync, commit],
  );

  if (phase !== "ready") {
    return (
      <CenteredScreen>
        {phase === "loading" ? (
          <p className="text-sm text-gray-500">Đang tải dữ liệu…</p>
        ) : (
          <>
            <Notice tone="error">{loadError}</Notice>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
                Thử lại
              </Button>
              <Button onClick={() => void auth.signOut().catch(() => undefined)}>Đăng xuất</Button>
            </div>
          </>
        )}
      </CenteredScreen>
    );
  }
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
