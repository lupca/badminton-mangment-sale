// Kiểm tra những gì người dùng gõ vào các ô của phần tài khoản, trước khi gửi lên máy chủ.
// Mỗi hàm trả về câu báo lỗi tiếng Việt, hoặc null nếu giá trị dùng được.

/** Hai giới hạn của máy chủ (server/app.js). */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 200;
/** Hai giới hạn dưới đây khớp với độ dài máy chủ giữ lại khi lưu hồ sơ. */
export const FULL_NAME_MAX = 120;
export const PHONE_MAX = 40;

export function emailProblem(email: string): string | null {
  const value = email.trim();
  if (!value) return "Hãy nhập email.";
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Email không hợp lệ (ví dụ: ten@gmail.com).";
  return null;
}

export function fullNameProblem(name: string): string | null {
  return name.trim() ? null : "Hãy nhập họ tên.";
}

export function phoneProblem(phone: string): string | null {
  const value = phone.trim();
  if (!value) return "Hãy nhập số điện thoại.";
  const digits = value.replace(/\D/g, "").length;
  if (!/^[0-9+().\-\s]+$/.test(value) || digits < 8 || digits > 15) {
    return "Số điện thoại không hợp lệ (ví dụ: 0903 555 777).";
  }
  return null;
}

/** Mật khẩu mới (khi đăng ký, đổi mật khẩu, đặt lại mật khẩu). */
export function newPasswordProblem(password: string): string | null {
  if (!password) return "Hãy nhập mật khẩu.";
  if (password.length < PASSWORD_MIN) return `Mật khẩu phải có ít nhất ${PASSWORD_MIN} ký tự.`;
  if (password.length > PASSWORD_MAX) return `Mật khẩu dài tối đa ${PASSWORD_MAX} ký tự.`;
  // Dấu cách ở đầu / cuối không nhìn thấy được, rất dễ gõ nhầm rồi không đăng nhập lại được.
  if (password !== password.trim()) return "Mật khẩu không được bắt đầu hoặc kết thúc bằng dấu cách.";
  return null;
}
