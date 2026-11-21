// Màn hình đăng nhập / đăng ký (khi ứng dụng chạy với máy chủ và chưa có ai đăng nhập trên trình duyệt này).
// Hệ thống không gửi email: quên mật khẩu thì nhờ người quản lý đặt lại ở mục «Tài khoản».
import { useId, useState, type FormEvent, type ReactNode } from "react";
import PasswordField from "../components/account/PasswordField";
import {
  FULL_NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PHONE_MAX,
  emailProblem,
  fullNameProblem,
  newPasswordProblem,
  phoneProblem,
} from "../components/account/validation";
import { errorMessage } from "../lib/cloud/api";
import { useAuth } from "../lib/cloud/auth";
import { Button, CenteredScreen, Field, Input, Notice, Tabs } from "../ui";

type Mode = "signIn" | "signUp";

const MODE_TABS: Array<{ key: Mode; label: string }> = [
  { key: "signIn", label: "Đăng nhập" },
  { key: "signUp", label: "Đăng ký" },
];

/** Lỗi của từng ô, theo tên ô. Ô không có lỗi thì không có mặt. */
type Problems<K extends string> = Partial<Record<K, string>>;

/** Dòng dưới một ô nhập: câu báo lỗi (đỏ) nếu có, không thì gợi ý. */
function note(problem: string | undefined, hint?: ReactNode): ReactNode {
  return problem ? <span className="text-red-700">{problem}</span> : hint;
}

/** Đưa con trỏ vào ô đầu tiên có lỗi (thứ tự `order` là thứ tự các ô trên màn hình). */
function focusFirstProblem<K extends string>(problems: Problems<K>, order: K[], idOf: (field: K) => string): void {
  const first = order.find((field) => problems[field]);
  if (first) document.getElementById(idOf(first))?.focus();
}

function SignInForm({ email, onEmailChange }: { email: string; onEmailChange: (email: string) => void }) {
  const auth = useAuth();
  const formId = useId();
  const idOf = (field: "email" | "password") => `${formId}-${field}`;
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<Problems<"email" | "password">>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found: Problems<"email" | "password"> = {};
    const emailError = emailProblem(email);
    if (emailError) found.email = emailError;
    if (!password) found.password = "Hãy nhập mật khẩu.";
    setProblems(found);
    setError(null);
    if (Object.keys(found).length > 0) {
      focusFirstProblem(found, ["email", "password"], idOf);
      return;
    }
    setBusy(true);
    try {
      // Đăng nhập xong thì cổng vào ứng dụng tự thay màn hình này.
      await auth.signIn(email, password);
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <Field label="Email" hint={note(problems.email)}>
        <Input
          id={idOf("email")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          aria-invalid={problems.email ? true : undefined}
        />
      </Field>
      <PasswordField
        id={idOf("password")}
        name="password"
        label="Mật khẩu"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={problems.password}
      />
      {error ? (
        <div role="alert">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Đang đăng nhập…" : "Đăng nhập"}
      </Button>
      <p className="text-sm text-gray-500">Quên mật khẩu? Nhờ người quản lý đặt lại giúp.</p>
    </form>
  );
}

type SignUpField = "fullName" | "phone" | "email" | "password";
const SIGN_UP_ORDER: SignUpField[] = ["fullName", "phone", "email", "password"];

function SignUpForm({ email, onEmailChange }: { email: string; onEmailChange: (email: string) => void }) {
  const auth = useAuth();
  const formId = useId();
  const idOf = (field: SignUpField) => `${formId}-${field}`;
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<Problems<SignUpField>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found: Problems<SignUpField> = {};
    const checks: Array<[SignUpField, string | null]> = [
      ["fullName", fullNameProblem(fullName)],
      ["phone", phoneProblem(phone)],
      ["email", emailProblem(email)],
      ["password", newPasswordProblem(password)],
    ];
    for (const [field, problem] of checks) {
      if (problem) found[field] = problem;
    }
    setProblems(found);
    setError(null);
    if (Object.keys(found).length > 0) {
      focusFirstProblem(found, SIGN_UP_ORDER, idOf);
      return;
    }
    setBusy(true);
    try {
      // Đăng ký xong (và được đăng nhập luôn) thì cổng vào ứng dụng tự thay màn hình này.
      await auth.signUp({ email, password, fullName, phone });
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <p className="text-sm text-gray-600">
        Sau khi đăng ký, tài khoản phải được người quản lý duyệt rồi mới dùng được. Riêng tài khoản đầu tiên của hệ
        thống tự động là quản lý.
      </p>
      <Field label="Họ tên" hint={note(problems.fullName)}>
        <Input
          id={idOf("fullName")}
          name="name"
          autoComplete="name"
          maxLength={FULL_NAME_MAX}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          aria-invalid={problems.fullName ? true : undefined}
        />
      </Field>
      <Field label="Số điện thoại" hint={note(problems.phone)}>
        <Input
          id={idOf("phone")}
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
      <Field label="Email" hint={note(problems.email, "Dùng để đăng nhập.")}>
        <Input
          id={idOf("email")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          aria-invalid={problems.email ? true : undefined}
        />
      </Field>
      <PasswordField
        id={idOf("password")}
        name="new-password"
        label="Mật khẩu"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        value={password}
        onChange={setPassword}
        error={problems.password}
        hint={`Ít nhất ${PASSWORD_MIN} ký tự.`}
      />
      {error ? (
        <div role="alert">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Đang đăng ký…" : "Đăng ký"}
      </Button>
    </form>
  );
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("signIn");
  // Email dùng chung cho hai tab: gõ ở tab này rồi chuyển sang tab kia không phải gõ lại.
  const [email, setEmail] = useState("");

  return (
    <CenteredScreen>
      <h1 className="sr-only">{mode === "signIn" ? "Đăng nhập" : "Đăng ký tài khoản"}</h1>
      <Tabs<Mode> tabs={MODE_TABS} value={mode} onChange={setMode} className="mb-4" />
      {mode === "signIn" ? (
        <SignInForm email={email} onEmailChange={setEmail} />
      ) : (
        <SignUpForm email={email} onEmailChange={setEmail} />
      )}
    </CenteredScreen>
  );
}
