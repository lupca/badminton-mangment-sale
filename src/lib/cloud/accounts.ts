// Quản trị tài khoản (chỉ người quản lý gọi được — máy chủ kiểm tra lại quyền).
import { useEffect, useState } from "react";
import { PROFILE_COLUMNS, profileFromRow, timeoutSignal, watchForeground, type Profile } from "./auth";
import { unwrap } from "./authErrors";
import { getSupabase } from "./client";

/** Mọi tài khoản của hệ thống. */
export async function listProfiles(): Promise<Profile[]> {
  const { data } = await unwrap(
    getSupabase()
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .order("created_at", { ascending: true })
      // Không để thư viện âm thầm thử lại nhiều giây khi mất mạng: báo lỗi ngay, màn hình tự có nút «Thử lại».
      .retry(false)
      .abortSignal(timeoutSignal()),
  );
  return (data ?? []).map(profileFromRow).filter((profile): profile is Profile => profile !== null);
}

/** Duyệt / đổi vai trò / khóa một tài khoản khác. Ném Error (tiếng Việt) khi thất bại. */
export async function setAccountRole(id: string, role: "sale" | "manager" | "locked"): Promise<Profile> {
  const { data } = await unwrap(getSupabase().rpc("admin_set_role", { target: id, new_role: role }));
  const profile = profileFromRow(data);
  if (!profile) throw new Error("Không tìm thấy tài khoản.");
  notifyAccountsChanged();
  return profile;
}

/** Đặt mật khẩu mới cho một tài khoản. Ném Error (tiếng Việt) khi thất bại. */
export async function setAccountPassword(id: string, password: string): Promise<void> {
  await unwrap(getSupabase().rpc("admin_set_password", { target: id, new_password: password }));
}

// ───────────────────────── Chấm nhắc «có tài khoản chờ duyệt» ─────────────────────────

/** Chấm nhắc tự hỏi lại máy chủ sau mỗi khoảng này (và mỗi khi tab được mở lại). */
const PENDING_REFRESH_MS = 30_000;

type AccountsListener = (pendingCount: number | null) => void;
const accountsListeners = new Set<AccountsListener>();

/**
 * Báo cho chấm nhắc trên thanh điều hướng rằng danh sách tài khoản vừa đổi.
 * Nơi gọi đã biết số tài khoản đang chờ duyệt thì truyền vào, chấm nhắc khỏi phải hỏi lại máy chủ.
 */
export function notifyAccountsChanged(pendingCount?: number): void {
  [...accountsListeners].forEach((listener) => listener(pendingCount ?? null));
}

// Máy chủ báo (qua Realtime) rằng hồ sơ của một tài khoản khác vừa đổi — vd có người mới đăng ký, hoặc một quản lý
// khác vừa duyệt ai đó. Chỉ quản lý nhận được tín hiệu này (sale chỉ được thấy hồ sơ của chính mình).
const remoteListeners = new Set<() => void>();

/** Bộ đồng bộ gọi khi nhận tín hiệu đó: chấm nhắc và màn hình «Tài khoản» đang mở đọc lại ngay, không chờ nhịp định kỳ. */
export function accountsChangedOnServer(): void {
  [...remoteListeners].forEach((listener) => listener());
  notifyAccountsChanged();
}

/** Đăng ký nghe tín hiệu đó. Trả về hàm hủy đăng ký. */
export function onAccountsChangedOnServer(listener: () => void): () => void {
  remoteListeners.add(listener);
  return () => {
    remoteListeners.delete(listener);
  };
}

async function countPendingProfiles(): Promise<number> {
  const { data } = await unwrap(
    getSupabase().from("profiles").select("id").eq("role", "pending").retry(false).abortSignal(timeoutSignal()),
  );
  return data?.length ?? 0;
}

/** Số tài khoản đang chờ duyệt, để hiện chấm nhắc trên mục «Tài khoản». `enabled` = false thì luôn là 0 và không hỏi máy chủ. */
export function usePendingAccountCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // Chỉ nhận kết quả của lần hỏi mới nhất: câu trả lời đến muộn của lần hỏi cũ không được ghi đè số mới hơn.
    let latest = 0;
    const refresh = () => {
      latest += 1;
      const mine = latest;
      countPendingProfiles().then(
        (pending) => {
          if (alive && mine === latest) setCount(pending);
        },
        () => {
          // Chấm nhắc chỉ là gợi ý: không đọc được thì giữ số đang có, lần sau đọc lại.
        },
      );
    };
    const onAccountsChanged: AccountsListener = (pendingCount) => {
      if (pendingCount === null) {
        refresh();
      } else {
        latest += 1;
        setCount(pendingCount);
      }
    };

    refresh();
    accountsListeners.add(onAccountsChanged);
    const stopWatching = watchForeground(refresh, PENDING_REFRESH_MS);
    return () => {
      alive = false;
      accountsListeners.delete(onAccountsChanged);
      stopWatching();
    };
  }, [enabled]);

  return enabled ? count : 0;
}
