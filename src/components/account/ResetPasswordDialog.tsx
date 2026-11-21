// Hộp thoại của người quản lý: đặt mật khẩu mới cho một tài khoản.
// Hệ thống không gửi email khôi phục mật khẩu, nên ai quên mật khẩu thì nhờ quản lý đặt lại ở đây rồi báo lại cho họ.
import { useId, useState, type FormEvent } from "react";
import { setAccountPassword } from "../../lib/cloud/accounts";
import { errorMessage } from "../../lib/cloud/api";
import type { Profile } from "../../lib/cloud/auth";
import { copyText } from "../../lib/format";
import { Button, Field, Input, Modal, Notice, toast } from "../../ui";
import { PASSWORD_MAX, PASSWORD_MIN, newPasswordProblem } from "./validation";

export default function ResetPasswordDialog({ account, onClose }: { account: Profile; onClose: () => void }) {
  const formId = useId();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Mật khẩu vừa đặt xong (null = chưa đặt). */
  const [done, setDone] = useState<string | null>(null);
  const name = account.fullName.trim() || account.email;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const found = newPasswordProblem(password);
    setProblem(found);
    setError(null);
    if (found) {
      document.getElementById(`${formId}-password`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await setAccountPassword(account.id, password);
      setDone(password);
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (done === null) return;
    if (await copyText(done)) toast("Đã chép mật khẩu");
    else toast("Không chép được. Hãy bôi đen mật khẩu rồi chép tay.", "error");
  };

  // Đang gửi lên máy chủ thì không cho đóng: đóng lúc này sẽ không biết mật khẩu đã được đặt hay chưa.
  const close = () => {
    if (!saving) onClose();
  };

  return (
    <Modal
      open
      onClose={close}
      title="Đặt lại mật khẩu"
      footer={
        done === null ? (
          <>
            <Button onClick={close} disabled={saving}>
              Hủy
            </Button>
            <Button type="submit" form={formId} variant="primary" disabled={saving}>
              {saving ? "Đang đặt…" : "Đặt mật khẩu"}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={copy}>Chép mật khẩu</Button>
            <Button variant="primary" onClick={onClose}>
              Xong
            </Button>
          </>
        )
      }
    >
      {done === null ? (
        <form id={formId} onSubmit={submit} noValidate>
          <p className="text-sm text-gray-700">
            Đặt mật khẩu mới cho <strong>{name}</strong>
            {name !== account.email ? <span className="wrap-anywhere"> ({account.email})</span> : null}. Mật khẩu cũ sẽ
            không dùng được nữa.
          </p>
          <Field
            className="mt-3"
            label="Mật khẩu mới"
            hint={
              problem ? (
                <span className="text-red-700">{problem}</span>
              ) : (
                `Ít nhất ${PASSWORD_MIN} ký tự. Ô này hiện rõ chữ để bạn đọc lại cho người đó.`
              )
            }
          >
            <Input
              id={`${formId}-password`}
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              maxLength={PASSWORD_MAX}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={problem ? true : undefined}
            />
          </Field>
          {error ? (
            <div role="alert" className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
        </form>
      ) : (
        <>
          <Notice tone="success">
            Đã đặt mật khẩu mới cho <strong>{name}</strong>.
          </Notice>
          <p className="mt-3 text-sm text-gray-700">Hãy báo mật khẩu mới này cho người đó:</p>
          <p className="mt-1 select-all wrap-anywhere rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-base text-gray-900">
            {done}
          </p>
          <p className="mt-3 text-sm text-gray-500">
            Người đó đăng nhập bằng email <span className="wrap-anywhere">{account.email}</span> và mật khẩu trên, rồi nên tự
            đổi mật khẩu ở mục «Cài đặt».
          </p>
        </>
      )}
    </Modal>
  );
}
