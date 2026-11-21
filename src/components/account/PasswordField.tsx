// Ô nhập mật khẩu: nhãn, ô nhập, nút «Hiện» / «Ẩn», và dòng báo lỗi hoặc gợi ý bên dưới.
// Trình bày giống `Field` + `Input` của ui.tsx; nút hiện / ẩn nằm ngoài nhãn để nhãn chỉ gắn với ô nhập.
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Button, Input } from "../../ui";

export default function PasswordField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  autoComplete,
  show,
  onShowChange,
  ...rest
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Câu báo lỗi của ô này; có lỗi thì hiện thay cho gợi ý. */
  error?: string | null;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  /**
   * Mặc định mỗi ô tự giữ trạng thái hiện / ẩn và có nút riêng. Khi hai ô dùng chung một nút (mật khẩu mới + nhập lại):
   * truyền `show` cho cả hai, và chỉ truyền `onShowChange` cho ô có nút.
   */
  show?: boolean;
  onShowChange?: (show: boolean) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "autoComplete">) {
  const ownId = useId();
  const inputId = id ?? ownId;
  const noteId = `${inputId}-note`;
  const [ownShow, setOwnShow] = useState(false);
  const visible = show ?? ownShow;
  const hasToggle = show === undefined || onShowChange !== undefined;
  const toggle = () => (onShowChange ?? setOwnShow)(!visible);

  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? noteId : undefined}
          className="min-w-0"
          {...rest}
        />
        {hasToggle ? (
          <Button className="shrink-0" onClick={toggle} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
            {visible ? "Ẩn" : "Hiện"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p id={noteId} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
