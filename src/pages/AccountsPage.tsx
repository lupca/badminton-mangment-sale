// Màn hình «Tài khoản» của người quản lý: duyệt tài khoản mới đăng ký, đổi vai trò, khóa / mở khóa, đặt lại mật khẩu.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ResetPasswordDialog from "../components/account/ResetPasswordDialog";
import { ACCOUNT_ROLE_LABEL, ACCOUNT_ROLE_TONE } from "../components/account/roleLabels";
import { listProfiles, notifyAccountsChanged, onAccountsChangedOnServer, setAccountRole } from "../lib/cloud/accounts";
import { useAutoRefresh, useOptionalAuth, type AccountRole, type Profile } from "../lib/cloud/auth";
import { authErrorMessage } from "../lib/cloud/authErrors";
import { formatDate, formatDateTime } from "../lib/format";
import { Link } from "../lib/router";
import { Badge, Button, EmptyState, Notice, PageHeader, cx, tableCls, tableWrapCls, tdCls, thCls, toast } from "../ui";

/** Danh sách tự tải lại sau mỗi khoảng này (và mỗi khi tab được mở lại, hoặc máy chủ báo có thay đổi), để tài khoản mới đăng ký tự hiện ra. */
const RELOAD_MS = 30_000;

// ───────────────────────── Thao tác trên một tài khoản ─────────────────────────

interface RoleAction {
  key: string;
  label: string;
  variant?: "primary" | "danger";
  /** Vai trò sẽ đặt cho tài khoản. */
  role: "sale" | "manager" | "locked";
  /** Câu hỏi xác nhận trước khi làm; không có thì làm luôn. */
  confirm?: (account: Profile) => string;
  /** Thông báo khi làm xong. */
  done: (account: Profile) => string;
}

const nameOf = (account: Profile) => account.fullName.trim() || account.email;
/** «Trần Thị Lan» */
const quoted = (account: Profile) => `«${nameOf(account)}»`;
/** «Trần Thị Lan» (lan@example.com) — dùng trong câu hỏi xác nhận, để chắc chắn không nhầm người. */
const quotedWithEmail = (account: Profile) =>
  account.fullName.trim() ? `${quoted(account)} (${account.email})` : quoted(account);

const MANAGER_POWERS =
  "Quản lý có mọi quyền: tạo và sửa chương trình, cập nhật tồn kho, xem mọi đơn hàng, duyệt và khóa tài khoản.";

const makeManager = (label: string, verb: string): RoleAction => ({
  key: "manager",
  label,
  role: "manager",
  confirm: (account) => `${verb} ${quotedWithEmail(account)} làm Quản lý?\n\n${MANAGER_POWERS}`,
  done: (account) => `${quoted(account)} giờ là Quản lý`,
});

const LOCK: RoleAction = {
  key: "lock",
  label: "Khóa",
  variant: "danger",
  role: "locked",
  confirm: (account) =>
    `Khóa tài khoản ${quotedWithEmail(account)}?\n\n` +
    "Người này sẽ không vào được hệ thống cho tới khi được mở khóa. Các đơn hàng họ đã tạo vẫn được giữ.",
  done: (account) => `Đã khóa tài khoản ${quoted(account)}`,
};

/** Các nút đổi vai trò theo trạng thái hiện tại của tài khoản. */
const ROLE_ACTIONS: Record<AccountRole, RoleAction[]> = {
  pending: [
    {
      key: "sale",
      label: "Duyệt làm Sale",
      variant: "primary",
      role: "sale",
      done: (account) => `Đã duyệt ${quoted(account)} làm Sale`,
    },
    makeManager("Duyệt làm Quản lý", "Duyệt"),
    {
      key: "reject",
      label: "Từ chối",
      variant: "danger",
      role: "locked",
      confirm: (account) =>
        `Từ chối tài khoản ${quotedWithEmail(account)}?\n\n` +
        "Tài khoản sẽ bị khóa và không vào được hệ thống. Sau này vẫn mở khóa lại được.",
      done: (account) => `Đã từ chối tài khoản ${quoted(account)}`,
    },
  ],
  sale: [makeManager("Chuyển thành Quản lý", "Chuyển"), LOCK],
  manager: [
    {
      key: "sale",
      label: "Chuyển thành Sale",
      role: "sale",
      done: (account) => `${quoted(account)} giờ là Sale`,
    },
    LOCK,
  ],
  locked: [
    {
      key: "unlock",
      label: "Mở khóa",
      role: "sale",
      done: (account) => `Đã mở khóa ${quoted(account)} (vai trò Sale)`,
    },
  ],
};

/** Tài khoản chưa được duyệt thì chưa có gì để đặt lại. */
const CAN_RESET_PASSWORD: Record<AccountRole, boolean> = { pending: false, sale: true, manager: true, locked: true };

/** Tài khoản chờ duyệt đứng trước, rồi xếp theo họ tên. */
function sortAccounts(accounts: Profile[]): Profile[] {
  return [...accounts].sort(
    (a, b) =>
      Number(a.role !== "pending") - Number(b.role !== "pending") ||
      nameOf(a).localeCompare(nameOf(b), "vi", { sensitivity: "base" }) ||
      a.email.localeCompare(b.email) ||
      a.id.localeCompare(b.id),
  );
}

const countPending = (accounts: Profile[]) => accounts.filter((account) => account.role === "pending").length;

// ───────────────────────── Bảng ─────────────────────────

/** Thao tác đang chạy: tài khoản nào, nút nào. */
interface Busy {
  id: string;
  key: string;
}

function RowActions({
  account,
  isSelf,
  busy,
  size,
  onRole,
  onResetPassword,
}: {
  account: Profile;
  isSelf: boolean;
  busy: Busy | null;
  size: "sm" | "md";
  onRole: (account: Profile, action: RoleAction) => void;
  onResetPassword: (account: Profile) => void;
}) {
  if (isSelf) {
    // Máy chủ không cho ai tự đổi vai trò của chính mình (để hệ thống không bao giờ hết quản lý).
    return (
      <span className="text-xs text-gray-500">
        Tài khoản của bạn — đổi mật khẩu ở{" "}
        <Link to="/settings" className="whitespace-nowrap text-blue-700 hover:underline">
          mục «Dữ liệu»
        </Link>
        .
      </span>
    );
  }
  return (
    <>
      {ROLE_ACTIONS[account.role].map((action) => (
        <Button
          key={action.key}
          size={size}
          variant={action.variant}
          disabled={busy !== null}
          onClick={() => onRole(account, action)}
        >
          {busy?.id === account.id && busy.key === action.key ? "Đang lưu…" : action.label}
        </Button>
      ))}
      {CAN_RESET_PASSWORD[account.role] ? (
        <Button size={size} disabled={busy !== null} onClick={() => onResetPassword(account)}>
          Đặt lại mật khẩu
        </Button>
      ) : null}
    </>
  );
}

// Bảng đủ sáu cột chỉ vừa màn hình rộng. Màn hình hẹp hơn (điện thoại, máy tính bảng cầm dọc) chỉ còn cột họ tên,
// nội dung các cột khác và các nút ghi gọn bên dưới — không lúc nào phải kéo ngang mới thấy nút.
const FROM_LG = "max-lg:hidden";

function AccountRow({
  account,
  isSelf,
  ...actions
}: {
  account: Profile;
  isSelf: boolean;
  busy: Busy | null;
  onRole: (account: Profile, action: RoleAction) => void;
  onResetPassword: (account: Profile) => void;
}) {
  const name = account.fullName.trim();
  const phone = account.phone.trim();
  const registered = formatDate(account.createdAt);
  const badge = <Badge tone={ACCOUNT_ROLE_TONE[account.role]}>{ACCOUNT_ROLE_LABEL[account.role]}</Badge>;

  return (
    <tr className="hover:bg-gray-50">
      <td className={cx(tdCls, "lg:min-w-40")}>
        {/* Màn hình hẹp: nhãn vai trò nằm cùng hàng với họ tên, sát lề phải. */}
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 wrap-anywhere">
            <span className="font-medium text-gray-900">
              {name || <span className="font-normal text-gray-400">(chưa có họ tên)</span>}
            </span>
            {isSelf ? <span className="text-gray-500"> (bạn)</span> : null}
          </p>
          <span className="shrink-0 lg:hidden">{badge}</span>
        </div>
        <div className="mt-1 space-y-1.5 text-gray-600 lg:hidden">
          <p className="wrap-anywhere">{account.email}</p>
          <p>{[phone, registered ? `Đăng ký ${registered}` : ""].filter(Boolean).join(" · ")}</p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <RowActions account={account} isSelf={isSelf} size="md" {...actions} />
          </div>
        </div>
      </td>
      <td className={cx(tdCls, FROM_LG, "wrap-anywhere")}>{account.email}</td>
      <td className={cx(tdCls, FROM_LG, "whitespace-nowrap")}>{phone || "—"}</td>
      <td className={cx(tdCls, FROM_LG)}>{badge}</td>
      <td className={cx(tdCls, FROM_LG, "whitespace-nowrap")} title={formatDateTime(account.createdAt)}>
        {registered}
      </td>
      <td className={cx(tdCls, FROM_LG)}>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <RowActions account={account} isSelf={isSelf} size="sm" {...actions} />
        </div>
      </td>
    </tr>
  );
}

// ───────────────────────── Trang ─────────────────────────

function AccountsManager({ me, refreshMe }: { me: Profile; refreshMe: () => void }) {
  /** null = chưa tải được lần nào. */
  const [accounts, setAccounts] = useState<Profile[] | null>(null);
  /** Lỗi của lần tải gần nhất. */
  const [error, setError] = useState<string | null>(null);
  /** Người dùng vừa bấm «Tải lại» / «Thử lại» và đang chờ. */
  const [reloading, setReloading] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [resetFor, setResetFor] = useState<Profile | null>(null);
  // Chỉ nhận kết quả của lần tải mới nhất; một thao tác vừa xong cũng làm các lần tải đang dở hết hiệu lực
  // (chúng có thể mang về dữ liệu cũ hơn kết quả của thao tác).
  const latestLoad = useRef(0);

  const load = useCallback(async (byUser = false) => {
    latestLoad.current += 1;
    const mine = latestLoad.current;
    if (byUser) setReloading(true);
    try {
      const list = await listProfiles();
      if (mine !== latestLoad.current) return;
      setAccounts(list);
      setError(null);
    } catch (thrown) {
      if (mine !== latestLoad.current) return;
      setError(authErrorMessage(thrown));
    } finally {
      if (mine === latestLoad.current) setReloading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      latestLoad.current += 1;
    };
  }, [load]);
  useAutoRefresh(() => void load(), RELOAD_MS);
  // Có người vừa đăng ký, hoặc một quản lý khác vừa duyệt / khóa ai đó: tải lại ngay.
  useEffect(() => onAccountsChangedOnServer(() => void load()), [load]);

  // Chấm nhắc trên mục «Tài khoản» của thanh điều hướng đi theo đúng danh sách đang hiện ở đây.
  const pendingCount = accounts ? countPending(accounts) : null;
  useEffect(() => {
    if (pendingCount !== null) notifyAccountsChanged(pendingCount);
  }, [pendingCount]);

  const sorted = useMemo(() => (accounts ? sortAccounts(accounts) : []), [accounts]);

  const changeRole = async (account: Profile, action: RoleAction) => {
    if (busy) return;
    if (action.confirm && !window.confirm(action.confirm(account))) return;
    setBusy({ id: account.id, key: action.key });
    try {
      const updated = await setAccountRole(account.id, action.role);
      latestLoad.current += 1;
      setReloading(false);
      setAccounts((list) => (list ? list.map((item) => (item.id === updated.id ? updated : item)) : list));
      toast(action.done(updated));
    } catch (thrown) {
      toast(authErrorMessage(thrown), "error");
      // Màn hình có thể đang hiện dữ liệu cũ (tài khoản vừa bị xóa, hoặc chính mình vừa bị đổi vai trò): đọc lại cả hai.
      void load();
      refreshMe();
    } finally {
      setBusy(null);
    }
  };

  const reloadButton = (label: string) => (
    <Button onClick={() => void load(true)} disabled={reloading}>
      {reloading ? "Đang tải…" : label}
    </Button>
  );

  const onlyMe = accounts !== null && accounts.every((account) => account.id === me.id);

  return (
    <>
      <PageHeader
        title="Tài khoản"
        subtitle="Tài khoản mới đăng ký phải được duyệt rồi mới dùng được. Duyệt làm Sale: xem chương trình, tạo đơn của mình. Duyệt làm Quản lý: mọi quyền."
        actions={accounts !== null ? reloadButton("Tải lại") : null}
      />

      {error ? (
        <Notice tone={accounts === null ? "error" : "warning"} className="mb-3">
          <p>
            {accounts === null ? "Không tải được danh sách tài khoản" : "Chưa tải lại được danh sách (đang hiện bản cũ)"}:{" "}
            {error}
          </p>
          <div className="mt-2">{reloadButton("Thử lại")}</div>
        </Notice>
      ) : null}

      {accounts === null ? (
        error ? null : (
          <p className="text-sm text-gray-500">Đang tải…</p>
        )
      ) : (
        <>
          <p className="mb-2 text-sm text-gray-600">
            Có {accounts.length} tài khoản
            {pendingCount ? (
              <>
                , trong đó <strong className="text-amber-800">{pendingCount} đang chờ duyệt</strong>
              </>
            ) : null}
            .
          </p>
          <div className={tableWrapCls}>
            <table className={tableCls}>
              <thead className={FROM_LG}>
                <tr>
                  <th className={thCls}>Họ tên</th>
                  <th className={thCls}>Email</th>
                  <th className={thCls}>Điện thoại</th>
                  <th className={thCls}>Vai trò</th>
                  <th className={thCls}>Ngày đăng ký</th>
                  <th className={thCls} aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    isSelf={account.id === me.id}
                    busy={busy}
                    onRole={changeRole}
                    onResetPassword={setResetFor}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {onlyMe ? (
            <div className="mt-4">
              <EmptyState
                title="Hiện mới chỉ có tài khoản của bạn"
                hint="Hãy gửi địa chỉ trang này cho mọi người và bảo họ bấm «Đăng ký». Tài khoản mới sẽ hiện ở đây, chờ bạn duyệt."
              />
            </div>
          ) : null}
        </>
      )}

      {resetFor ? <ResetPasswordDialog account={resetFor} onClose={() => setResetFor(null)} /> : null}
    </>
  );
}

export default function AccountsPage() {
  const auth = useOptionalAuth();
  const me = auth?.profile;
  if (!auth || !me || me.role !== "manager") {
    return <Notice tone="warning">Chỉ người quản lý mới xem và duyệt được tài khoản.</Notice>;
  }
  return <AccountsManager me={me} refreshMe={() => void auth.refreshProfile()} />;
}
