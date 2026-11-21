// Hai màn hình cho tài khoản đã đăng nhập nhưng chưa dùng được hệ thống: đang chờ duyệt, và đã bị khóa.
// Cả hai tự hỏi lại máy chủ định kỳ; khi vai trò đổi, cổng vào ứng dụng (CloudGate) tự chuyển màn hình.
import { useState } from "react";
import { errorMessage } from "../../lib/cloud/api";
import { useAuth, useAutoRefresh } from "../../lib/cloud/auth";
import { Button, CenteredScreen, Notice, toast } from "../../ui";

/** Tài khoản chờ duyệt: người dùng đang ngồi chờ nên hỏi lại khá dày (mỗi lần hỏi là một lần chạy tính tiền của lớp API). */
const PENDING_CHECK_MS = 15_000;
/** Tài khoản bị khóa: hiếm khi được mở lại ngay nên hỏi thưa hơn. */
const LOCKED_CHECK_MS = 30_000;

function SignedInAs() {
  const { profile } = useAuth();
  if (!profile) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
      <p className="text-xs text-gray-500">Đang đăng nhập bằng tài khoản</p>
      {profile.fullName ? <p className="wrap-anywhere font-medium text-gray-900">{profile.fullName}</p> : null}
      <p className="wrap-anywhere text-gray-700">{profile.email}</p>
    </div>
  );
}

/** Tự kiểm tra lại định kỳ, kèm hai nút «Kiểm tra lại» và «Đăng xuất». */
function CheckAndSignOut({ intervalMs, unchangedText }: { intervalMs: number; unchangedText: string }) {
  const auth = useAuth();
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  /** Giờ của lần bấm «Kiểm tra lại» gần nhất mà vai trò vẫn chưa đổi. */
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useAutoRefresh(() => void auth.refreshProfile(), intervalMs);

  const check = async () => {
    setChecking(true);
    // Vai trò đã đổi thì màn hình này được thay ngay, các dòng dưới không còn tác dụng.
    await auth.refreshProfile();
    setCheckedAt(new Date().toLocaleTimeString("vi-VN"));
    setChecking(false);
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await auth.signOut();
    } catch (error) {
      toast(errorMessage(error), "error");
      setSigningOut(false);
    }
  };

  return (
    <>
      {auth.error ? (
        <Notice tone="warning" className="mt-3">
          Chưa kiểm tra được: {auth.error}
        </Notice>
      ) : checkedAt ? (
        <p role="status" className="mt-3 text-sm text-gray-700">
          {unchangedText} (kiểm tra lúc {checkedAt}).
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={check} disabled={checking || signingOut}>
          {checking ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </Button>
        <Button onClick={signOut} disabled={signingOut}>
          {signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
        </Button>
      </div>
    </>
  );
}

export function PendingScreen() {
  return (
    <CenteredScreen title="Tài khoản đang chờ duyệt">
      <SignedInAs />
      <p className="mt-3 text-sm text-gray-700">
        Tài khoản của bạn đã được tạo, nhưng người quản lý phải duyệt thì bạn mới dùng được hệ thống. Hãy nhắn người
        quản lý vào mục «Tài khoản» để duyệt.
      </p>
      <p className="mt-2 text-sm text-gray-500">
        Màn hình này tự kiểm tra lại khoảng 15 giây một lần và tự vào ứng dụng khi tài khoản được duyệt — bạn không
        cần tải lại trang.
      </p>
      <CheckAndSignOut intervalMs={PENDING_CHECK_MS} unchangedText="Tài khoản vẫn đang chờ duyệt" />
    </CenteredScreen>
  );
}

export function LockedScreen() {
  return (
    <CenteredScreen title="Tài khoản đã bị khóa">
      <SignedInAs />
      <p className="mt-3 text-sm text-gray-700">
        Tài khoản này đã bị khóa (hoặc không được duyệt) nên không dùng được hệ thống. Nếu cần dùng lại, hãy liên hệ
        người quản lý để được mở khóa.
      </p>
      <CheckAndSignOut intervalMs={LOCKED_CHECK_MS} unchangedText="Tài khoản vẫn đang bị khóa" />
    </CenteredScreen>
  );
}
