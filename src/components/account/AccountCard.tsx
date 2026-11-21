// Khung «Tài khoản» trên trang «Dữ liệu»: ai đang đăng nhập, sửa họ tên / điện thoại, đổi mật khẩu, đăng xuất.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useOptionalAuth, type AuthState, type Profile } from "../../lib/cloud/auth";
import { authErrorMessage } from "../../lib/cloud/authErrors";
import { Button, Card, Field, Input, Notice, toast } from "../../ui";
import PasswordField from "./PasswordField";
import { ACCOUNT_ROLE_HINT, ACCOUNT_ROLE_LABEL } from "./roleLabels";
import { FULL_NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, PHONE_MAX, fullNameProblem, newPasswordProblem, phoneProblem } from "./validation";

/** Dòng dưới một ô nhập: câu báo lỗi (đỏ) nếu có. */
function problemNote(problem: string | null): ReactNode {
  return problem ? <span className="text-red-700">{problem}</span> : undefined;
}

/** Họ tên và số điện thoại — sửa rồi bấm «Lưu». */
function ContactForm({ auth, profile }: { auth: AuthState; profile: Profile }) {
  const formId = useId();
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone);
  const [problems, setProblems] = useState<{ fullName: string | null; phone: string | null }>({ fullName: null, phone: null });
  const [saving, setSaving] = useState(false);

  // Hồ sơ vừa đổi từ phía máy chủ (vd sửa trên điện thoại): ô nào người dùng chưa đụng tới thì hiện giá trị mới.
  const shown = useRef({ fullName: profile.fullName, phone: profile.phone });
  useEffect(() => {
    const before = shown.current;
    shown.current = { fullName: profile.fullName, phone: profile.phone };
    setFullName((current) => (current === before.fullName ? profile.fullName : current));
    setPhone((current) => (current === before.phone ? profile.phone : current));
  }, [profile.fullName, profile.phone]);

  const changed = fullName.trim() !== profile.fullName || phone.trim() !== profile.phone;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !changed) return;
    const found = { fullName: fullNameProblem(fullName), phone: phoneProblem(phone) };
    setProblems(found);
    if (found.fullName || found.phone) {
      document.getElementById(`${formId}-${found.fullName ? "name" : "phone"}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const saved = await auth.updateProfile({ fullName, phone });
      setFullName(saved.fullName);
      setPhone(saved.phone);
      toast("Đã lưu họ tên và số điện thoại");
    } catch (error) {
      toast(authErrorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="mt-4 border-t border-gray-200 pt-4">
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Field label="Họ tên" hint={problemNote(problems.fullName)}>
          <Input
            id={`${formId}-name`}
            name="name"
            autoComplete="name"
            maxLength={FULL_NAME_MAX}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            aria-invalid={problems.fullName ? true : undefined}
          />
        </Field>
        <Field label="Số điện thoại" hint={problemNote(problems.phone)}>
          <Input
            id={`${formId}-phone`}
            name="tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={PHONE_MAX}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={problems.phone ? true : undefined}
          />
        </Field>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Họ tên và số điện thoại này được ghi vào mỗi đơn mới bạn tạo (tên và điện thoại sale trên đơn in / gửi đại lý).
      </p>
      <Button type="submit" variant="primary" className="mt-3" disabled={saving || !changed}>
        {saving ? "Đang lưu…" : "Lưu"}
      </Button>
    </form>
  );
}

function PasswordForm({ auth, email }: { auth: AuthState; email: string }) {
  const formId = useId();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [problems, setProblems] = useState<{ password: string | null; repeat: string | null }>({ password: null, repeat: null });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const passwordError = newPasswordProblem(password);
    const found = {
      password: passwordError,
      repeat: !passwordError && repeat !== password ? "Hai lần nhập mật khẩu không giống nhau." : null,
    };
    setProblems(found);
    setError(null);
    if (found.password || found.repeat) {
      document.getElementById(`${formId}-${found.password ? "new" : "repeat"}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await auth.changePassword(password);
      setPassword("");
      setRepeat("");
      setShow(false);
      toast("Đã đổi mật khẩu");
    } catch (thrown) {
      setError(authErrorMessage(thrown));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-4 border-t border-gray-200 pt-4">
      <h3 className="text-sm font-semibold text-gray-900">Đổi mật khẩu</h3>
      {/* Để trình quản lý mật khẩu của trình duyệt biết mật khẩu mới thuộc về tài khoản nào. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="mt-2 grid max-w-xl gap-3 sm:grid-cols-2">
        <PasswordField
          id={`${formId}-new`}
          name="new-password"
          label="Mật khẩu mới"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          value={password}
          onChange={setPassword}
          show={show}
          onShowChange={setShow}
          error={problems.password}
          hint={`Ít nhất ${PASSWORD_MIN} ký tự.`}
        />
        <PasswordField
          id={`${formId}-repeat`}
          name="repeat-password"
          label="Nhập lại mật khẩu mới"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          value={repeat}
          onChange={setRepeat}
          show={show}
          error={problems.repeat}
        />
      </div>
      {error ? (
        <div role="alert" className="mt-3 max-w-xl">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <Button type="submit" className="mt-3" disabled={saving}>
        {saving ? "Đang đổi…" : "Đổi mật khẩu"}
      </Button>
    </form>
  );
}

export default function AccountCard({
  beforeSignOut,
}: {
  /** Gọi trước khi đăng xuất; trả về false thì không đăng xuất nữa (vd còn thay đổi chưa lưu và người dùng chọn ở lại). */
  beforeSignOut?: () => Promise<boolean>;
}) {
  const auth = useOptionalAuth();
  const [signingOut, setSigningOut] = useState(false);
  const profile = auth?.profile;
  if (!auth || !profile) return null;

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (beforeSignOut && !(await beforeSignOut())) {
        setSigningOut(false);
        return;
      }
      // Đăng xuất xong thì cả ứng dụng nhường chỗ cho màn hình đăng nhập.
      await auth.signOut();
    } catch (error) {
      toast(authErrorMessage(error), "error");
      setSigningOut(false);
    }
  };

  return (
    <Card title="Tài khoản">
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-gray-500">Email đăng nhập</dt>
        <dd className="wrap-anywhere text-gray-900">{profile.email}</dd>
        <dt className="text-gray-500 max-sm:mt-1.5">Vai trò</dt>
        <dd className="text-gray-700">
          <span className="font-medium text-gray-900">{ACCOUNT_ROLE_LABEL[profile.role]}</span> —{" "}
          {ACCOUNT_ROLE_HINT[profile.role]}
        </dd>
      </dl>

      {/* Đổi tài khoản (đăng nhập người khác ở tab khác) thì dựng lại các ô nhập theo tài khoản mới. */}
      <ContactForm key={profile.id} auth={auth} profile={profile} />
      <PasswordForm key={`${profile.id}-password`} auth={auth} email={profile.email} />

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-200 pt-4">
        <Button onClick={signOut} disabled={signingOut}>
          {signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
        </Button>
        <span className="text-xs text-gray-500">Chỉ đăng xuất trên thiết bị này.</span>
      </div>
    </Card>
  );
}
