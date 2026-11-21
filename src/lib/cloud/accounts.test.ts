// Tests for the account administration calls and for the «the account list changed» signal.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient, type CallOptions } from "./api";
import {
  forgetAccountsStamp,
  listProfiles,
  notifyAccountsChanged,
  observeAccounts,
  onAccountsChangedOnServer,
  onPendingAccountCount,
  setAccountPassword,
  setAccountRole,
} from "./accounts";
import type { Profile } from "./auth";

const LAN: Profile = {
  id: "user-1",
  email: "lan@example.com",
  fullName: "Trần Thị Lan",
  phone: "0903 555 777",
  role: "sale",
  createdAt: "2026-11-21T01:02:03.123456+00:00",
};
const MOI: Profile = { ...LAN, id: "user-2", email: "moi@example.com", fullName: "Lê Văn Mới", role: "pending" };

/** An API client that answers every command with `answer` and remembers what it was asked. */
function apiAnswering(answer: (op: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ op: string; args: Record<string, unknown>; timeoutMs?: number }> = [];
  const api: ApiClient = {
    async call<T = unknown>(op: string, args: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
      calls.push({ op, args, timeoutMs: options.timeoutMs });
      return answer(op, args) as T;
    },
    getToken: () => "key-manager",
    setToken: () => {},
    onTokenChange: () => () => {},
    onUnauthorized: () => () => {},
  };
  return { api, calls };
}

afterEach(() => {
  forgetAccountsStamp();
});

describe("listProfiles", () => {
  it("asks for the list once and returns the profiles in the server's order", async () => {
    const { api, calls } = apiAnswering(() => [{ ...LAN }, { ...MOI }]);
    expect(await listProfiles(api)).toEqual([LAN, MOI]);
    expect(calls).toEqual([{ op: "accounts.list", args: {}, timeoutMs: 15_000 }]);
  });

  it("drops entries that are not profiles; an answer that is not a list is an empty list", async () => {
    expect(await listProfiles(apiAnswering(() => [{ ...LAN }, null, { id: "" }, "x", { ...MOI, role: "owner" }]).api)).toEqual([
      LAN,
      { ...MOI, role: "pending" },
    ]);
    expect(await listProfiles(apiAnswering(() => null).api)).toEqual([]);
    expect(await listProfiles(apiAnswering(() => ({ rows: [] })).api)).toEqual([]);
  });

  it("a refusal comes back as the server's own sentence", async () => {
    const { api } = apiAnswering(() => {
      throw new ApiError("forbidden", "Chỉ người quản lý mới xem được danh sách tài khoản.", 403);
    });
    await expect(listProfiles(api)).rejects.toThrow("Chỉ người quản lý mới xem được danh sách tài khoản.");
  });
});

describe("setAccountRole", () => {
  it("sends the account and the new role, and returns the updated profile", async () => {
    const { api, calls } = apiAnswering((_op, args) => ({ ...MOI, role: args.role }));
    expect(await setAccountRole("user-2", "sale", api)).toEqual({ ...MOI, role: "sale" });
    expect(calls).toEqual([{ op: "accounts.setRole", args: { id: "user-2", role: "sale" }, timeoutMs: 15_000 }]);
  });

  it("refusals (own account, not a manager any more, account gone) keep the server's words", async () => {
    for (const [code, status, message] of [
      ["forbidden", 403, "Không tự đổi vai trò của chính mình. Hãy nhờ một quản lý khác."],
      ["forbidden", 403, "Chỉ người quản lý mới đổi được vai trò."],
      ["not_found", 404, "Không tìm thấy tài khoản."],
    ] as const) {
      const { api } = apiAnswering(() => {
        throw new ApiError(code, message, status);
      });
      await expect(setAccountRole("user-2", "locked", api)).rejects.toThrow(message);
    }
  });

  it("an answer that is not a profile is an error, not a silent success", async () => {
    await expect(setAccountRole("user-2", "sale", apiAnswering(() => null).api)).rejects.toThrow("Không tìm thấy tài khoản.");
  });

  it("does not guess the pending count: the page that made the change reports its own list", async () => {
    const heard = vi.fn();
    const stop = onPendingAccountCount(heard);
    await setAccountRole("user-2", "sale", apiAnswering(() => ({ ...MOI, role: "sale" })).api);
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});

describe("setAccountPassword", () => {
  it("sends the new password under the name the server expects", async () => {
    const { api, calls } = apiAnswering(() => true);
    await expect(setAccountPassword("user-1", "matkhaumoi2", api)).resolves.toBeUndefined();
    expect(calls).toEqual([{ op: "accounts.setPassword", args: { id: "user-1", newPassword: "matkhaumoi2" }, timeoutMs: 15_000 }]);
  });

  it("a refusal keeps the server's words", async () => {
    const { api } = apiAnswering(() => {
      throw new ApiError("rejected", "Mật khẩu phải có ít nhất 6 ký tự.", 422);
    });
    await expect(setAccountPassword("user-1", "123", api)).rejects.toThrow("Mật khẩu phải có ít nhất 6 ký tự.");
  });
});

describe("the pending-accounts count", () => {
  it("notifyAccountsChanged passes a whole, non-negative number to every listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onPendingAccountCount(first);
    const stopSecond = onPendingAccountCount(second);
    notifyAccountsChanged(3);
    notifyAccountsChanged(0);
    notifyAccountsChanged(2.9);
    notifyAccountsChanged(-4);
    expect(first.mock.calls).toEqual([[3], [0], [2], [0]]);
    expect(second.mock.calls).toEqual([[3], [0], [2], [0]]);
    notifyAccountsChanged(Number.NaN);
    notifyAccountsChanged(Number.POSITIVE_INFINITY);
    expect(first).toHaveBeenCalledTimes(4);

    stopFirst();
    notifyAccountsChanged(1);
    expect(first).toHaveBeenCalledTimes(4);
    expect(second).toHaveBeenCalledTimes(5);
    stopSecond();
  });

  it("observeAccounts delivers the count of every poll", () => {
    const heard = vi.fn();
    const stop = onPendingAccountCount(heard);
    observeAccounts({ pending: 2, stamp: "a" });
    observeAccounts({ pending: 2, stamp: "a" });
    observeAccounts({ pending: 0, stamp: "b" });
    expect(heard.mock.calls).toEqual([[2], [2], [0]]);
    stop();
  });
});

describe("observeAccounts: has the account list changed?", () => {
  it("the first observation only sets the baseline; a different stamp later means «changed»", () => {
    const changed = vi.fn();
    const stop = onAccountsChangedOnServer(changed);
    observeAccounts({ pending: 0, stamp: "a" });
    expect(changed).not.toHaveBeenCalled();
    observeAccounts({ pending: 0, stamp: "a" });
    observeAccounts({ pending: 0, stamp: "a" });
    expect(changed).not.toHaveBeenCalled();
    observeAccounts({ pending: 1, stamp: "b" }); // someone signed up
    expect(changed).toHaveBeenCalledTimes(1);
    observeAccounts({ pending: 1, stamp: "b" });
    expect(changed).toHaveBeenCalledTimes(1);
    observeAccounts({ pending: 1, stamp: "c" }); // a profile was edited: same count, list changed all the same
    expect(changed).toHaveBeenCalledTimes(2);
    observeAccounts({ pending: 1, stamp: "a" }); // any difference counts, even back to an earlier value
    expect(changed).toHaveBeenCalledTimes(3);
    stop();
  });

  it("answers for accounts that are not managers (null) and malformed ones are ignored and do not disturb the baseline", () => {
    const changed = vi.fn();
    const heard = vi.fn();
    const stopChanged = onAccountsChangedOnServer(changed);
    const stopCount = onPendingAccountCount(heard);
    observeAccounts({ pending: 1, stamp: "a" });
    for (const info of [null, undefined, {}, { pending: 1 }, { stamp: "z" }, { pending: "1", stamp: "z" }, { pending: 1, stamp: 5 }, "z"]) {
      observeAccounts(info as never);
    }
    expect(changed).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
    observeAccounts({ pending: 1, stamp: "a" }); // still the baseline
    expect(changed).not.toHaveBeenCalled();
    observeAccounts({ pending: 1, stamp: "b" });
    expect(changed).toHaveBeenCalledTimes(1);
    stopChanged();
    stopCount();
  });

  it("every listener is told, until it unsubscribes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onAccountsChangedOnServer(first);
    const stopSecond = onAccountsChangedOnServer(second);
    observeAccounts({ pending: 0, stamp: "a" });
    observeAccounts({ pending: 0, stamp: "b" });
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
    stopFirst();
    observeAccounts({ pending: 0, stamp: "c" });
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 2]);
    stopSecond();
  });

  it("after forgetAccountsStamp (the manager left the app) the next observation is a first one again", () => {
    const changed = vi.fn();
    const stop = onAccountsChangedOnServer(changed);
    observeAccounts({ pending: 0, stamp: "a" });
    forgetAccountsStamp();
    observeAccounts({ pending: 3, stamp: "b" }); // another manager signs in on this browser: nothing «changed» for them
    expect(changed).not.toHaveBeenCalled();
    observeAccounts({ pending: 3, stamp: "c" });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
});
