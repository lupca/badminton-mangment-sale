// Quản trị tài khoản (chỉ người quản lý gọi được — máy chủ kiểm tra lại quyền).
import { useEffect, useState } from "react";
import type { ApiClient } from "./api";
import { parseProfile, type Profile } from "./auth";
import { getApi } from "./client";

/** Thời gian chờ tối đa cho một lần hỏi máy chủ; quá thì báo lỗi ngay, màn hình tự có nút «Thử lại». */
const REQUEST_TIMEOUT_MS = 15_000;

/** Mọi tài khoản của hệ thống, theo thứ tự đăng ký. Ném Error (tiếng Việt) khi thất bại. */
export async function listProfiles(api: ApiClient = getApi()): Promise<Profile[]> {
  const rows = await api.call("accounts.list", {}, { timeoutMs: REQUEST_TIMEOUT_MS });
  return (Array.isArray(rows) ? rows : []).map(parseProfile).filter((profile): profile is Profile => profile !== null);
}

/** Duyệt / đổi vai trò / khóa một tài khoản khác. Ném Error (tiếng Việt) khi thất bại. */
export async function setAccountRole(id: string, role: "sale" | "manager" | "locked", api: ApiClient = getApi()): Promise<Profile> {
  const profile = parseProfile(await api.call("accounts.setRole", { id, role }, { timeoutMs: REQUEST_TIMEOUT_MS }));
  if (!profile) throw new Error("Không tìm thấy tài khoản.");
  return profile;
}

/** Đặt mật khẩu mới cho một tài khoản khác (người đó bị đăng xuất ở mọi nơi). Ném Error (tiếng Việt) khi thất bại. */
export async function setAccountPassword(id: string, password: string, api: ApiClient = getApi()): Promise<void> {
  await api.call("accounts.setPassword", { id, newPassword: password }, { timeoutMs: REQUEST_TIMEOUT_MS });
}

// ───────────────────────── Tín hiệu «danh sách tài khoản vừa đổi» ─────────────────────────

/** Phần `accounts` trong kết quả của lệnh `sync.poll` (chỉ quản lý mới có). */
export interface AccountsInfo {
  /** Số tài khoản đang chờ duyệt. */
  pending: number;
  /** Một «dấu» đổi mỗi khi danh sách tài khoản có gì thay đổi (có người đăng ký, đổi vai trò, sửa hồ sơ…). */
  stamp: string;
}

type CountListener = (pendingCount: number) => void;
const countListeners = new Set<CountListener>();
const changeListeners = new Set<() => void>();
/** Dấu của lần quan sát gần nhất; null = chưa quan sát lần nào. */
let lastStamp: string | null = null;

/** Báo cho chấm nhắc trên thanh điều hướng số tài khoản đang chờ duyệt mà nơi gọi vừa biết. */
export function notifyAccountsChanged(pendingCount: number): void {
  if (!Number.isFinite(pendingCount)) return;
  const count = Math.max(0, Math.trunc(pendingCount));
  [...countListeners].forEach((listener) => listener(count));
}

/** Đăng ký nghe con số đó (xem `notifyAccountsChanged`, `observeAccounts`). Trả về hàm hủy đăng ký. */
export function onPendingAccountCount(listener: (pendingCount: number) => void): () => void {
  countListeners.add(listener);
  return () => {
    countListeners.delete(listener);
  };
}

/**
 * Bộ đồng bộ gọi sau mỗi lần hỏi định kỳ (`sync.poll`), với phần `accounts` của kết quả. Chấm nhắc lấy luôn con số trong đó;
 * dấu khác với lần quan sát trước nghĩa là danh sách tài khoản vừa đổi (có người mới đăng ký, một quản lý khác vừa duyệt /
 * khóa ai đó…) → báo cho màn hình «Tài khoản» đang mở tải lại. `null` (tài khoản không phải quản lý) thì bỏ qua.
 */
export function observeAccounts(info: AccountsInfo | null | undefined): void {
  if (!info || typeof info !== "object" || typeof info.stamp !== "string" || typeof info.pending !== "number") return;
  notifyAccountsChanged(info.pending);
  const changed = lastStamp !== null && lastStamp !== info.stamp;
  lastStamp = info.stamp;
  if (changed) [...changeListeners].forEach((listener) => listener());
}

/** Đăng ký nghe «danh sách tài khoản vừa đổi trên máy chủ» (xem `observeAccounts`). Trả về hàm hủy đăng ký. */
export function onAccountsChangedOnServer(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** Quên dấu đã quan sát (khi tài khoản quản lý rời ứng dụng): lần quan sát kế tiếp là lần đầu, không báo «vừa đổi». */
export function forgetAccountsStamp(): void {
  lastStamp = null;
}

// ───────────────────────── Chấm nhắc «có tài khoản chờ duyệt» ─────────────────────────

/**
 * Số tài khoản đang chờ duyệt, để hiện chấm nhắc trên mục «Tài khoản». `enabled` = false thì luôn là 0 và không hỏi máy chủ.
 * Chỉ tự hỏi máy chủ MỘT lần lúc bật; sau đó con số đi theo các lần hỏi định kỳ của bộ đồng bộ (`observeAccounts`) và theo
 * danh sách đang hiện ở màn hình «Tài khoản» (`notifyAccountsChanged`).
 */
export function usePendingAccountCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    /** Đã có con số từ nơi khác rồi thì câu trả lời (cũ hơn) của lần hỏi lúc bật không được ghi đè lên. */
    let told = false;
    const stopListening = onPendingAccountCount((pendingCount) => {
      told = true;
      setCount(pendingCount);
    });
    getApi()
      .call("sync.poll", {}, { timeoutMs: REQUEST_TIMEOUT_MS })
      .then(
        (result) => {
          if (!alive || told) return;
          const info = result && typeof result === "object" ? (result as { accounts?: AccountsInfo | null }).accounts : null;
          observeAccounts(info);
        },
        () => {
          // Chấm nhắc chỉ là gợi ý: không hỏi được thì chờ lần hỏi định kỳ của bộ đồng bộ.
        },
      );
    return () => {
      alive = false;
      stopListening();
      forgetAccountsStamp();
      setCount(0);
    };
  }, [enabled]);

  return enabled ? count : 0;
}
