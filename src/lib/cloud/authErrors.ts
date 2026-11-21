// Đổi lỗi của Supabase thành thông báo tiếng Việt ngắn gọn cho người dùng.
//
// Lỗi có thể đến từ ba nơi:
//   • máy chủ đăng nhập (GoTrue): đối tượng có `name`, `status` và thường có `code` (vd "invalid_credentials");
//   • máy chủ dữ liệu (PostgREST): đối tượng { code, message, details, hint }, `code` là "PGRST301"… hoặc mã SQLSTATE
//     của Postgres ("42501"…). Các hàm trên máy chủ của ứng dụng (admin_set_role…) báo lỗi sẵn bằng tiếng Việt;
//   • trình duyệt: không gọi được mạng ("Failed to fetch"…), hết thời gian chờ.
//
// Ưu tiên nhận diện bằng `code`; máy chủ / thư viện cũ không có `code` thì mới dò theo `name`, `status` rồi nội dung.

export type AuthErrorKind =
  /** Sai email hoặc mật khẩu. */
  | "invalidCredentials"
  /** Email đã được đăng ký. */
  | "emailTaken"
  /** Mật khẩu không được nhận: quá ngắn, quá yếu hoặc quá dài. */
  | "weakPassword"
  /** Mật khẩu mới trùng mật khẩu đang dùng. */
  | "samePassword"
  | "invalidEmail"
  | "emailNotConfirmed"
  /** Project đang tắt đăng ký tài khoản mới. */
  | "signupDisabled"
  /** Thử quá nhiều lần trong thời gian ngắn. */
  | "rateLimited"
  /** Không gọi được máy chủ: mất mạng, máy chủ không phản hồi, hết thời gian chờ. */
  | "network"
  /** Máy chủ có trả lời nhưng đang trục trặc (lỗi 5xx, cơ sở dữ liệu quá tải…). */
  | "server"
  /** Phiên đăng nhập không còn dùng được (hết hạn, đã đăng xuất, tài khoản đã bị xóa…). */
  | "sessionExpired"
  /** Tài khoản bị cấm ở tầng đăng nhập. */
  | "banned"
  /** Máy chủ đòi đăng nhập lại trước khi đổi mật khẩu. */
  | "reauthRequired"
  /** Không đủ quyền. */
  | "forbidden"
  /** Project Supabase chưa chạy file SQL khởi tạo. */
  | "notSetUp"
  /** Máy chủ đã báo lỗi bằng tiếng Việt — giữ nguyên lời của máy chủ. */
  | "serverMessage"
  | "unknown";

export interface AuthErrorInfo {
  kind: AuthErrorKind;
  /** Thông báo tiếng Việt để hiện cho người dùng. */
  message: string;
}

const MESSAGE: Record<Exclude<AuthErrorKind, "weakPassword" | "forbidden" | "notSetUp" | "serverMessage" | "unknown">, string> = {
  invalidCredentials: "Email hoặc mật khẩu không đúng.",
  emailTaken: "Email này đã được đăng ký. Hãy đăng nhập; nếu quên mật khẩu, nhờ người quản lý đặt lại.",
  samePassword: "Mật khẩu mới phải khác mật khẩu đang dùng.",
  invalidEmail: "Email không hợp lệ. Hãy kiểm tra lại (ví dụ: ten@gmail.com).",
  emailNotConfirmed: "Email chưa được xác nhận. Hãy mở hộp thư, bấm vào liên kết xác nhận rồi đăng nhập lại.",
  signupDisabled: "Hệ thống đang tắt đăng ký tài khoản mới. Hãy liên hệ người quản lý.",
  rateLimited: "Bạn thử quá nhiều lần. Hãy chờ một lát rồi thử lại.",
  network: "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.",
  server: "Máy chủ đang gặp sự cố. Hãy thử lại sau ít phút.",
  sessionExpired: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
  banned: "Tài khoản này đã bị khóa. Hãy liên hệ người quản lý.",
  reauthRequired: "Cần đăng nhập lại trước khi đổi mật khẩu: hãy đăng xuất, đăng nhập rồi thử lại.",
};

const FORBIDDEN_MESSAGE = "Bạn không có quyền làm việc này.";
const UNKNOWN_MESSAGE = "Có lỗi xảy ra. Hãy thử lại.";
/** Độ dài mật khẩu tối thiểu mặc định của Supabase, dùng khi máy chủ không nói rõ con số. */
const DEFAULT_PASSWORD_MIN = 6;

// ───────────────────────── Bảng mã lỗi ─────────────────────────

/** Mã lỗi của máy chủ đăng nhập (GoTrue) — viết thường. */
const AUTH_CODE_KIND: Record<string, AuthErrorKind> = {
  invalid_credentials: "invalidCredentials",
  user_already_exists: "emailTaken",
  email_exists: "emailTaken",
  weak_password: "weakPassword",
  same_password: "samePassword",
  email_address_invalid: "invalidEmail",
  // Để trống cả email lẫn số điện thoại thì máy chủ coi là đăng nhập ẩn danh.
  anonymous_provider_disabled: "invalidEmail",
  email_not_confirmed: "emailNotConfirmed",
  provider_email_needs_verification: "emailNotConfirmed",
  signup_disabled: "signupDisabled",
  email_provider_disabled: "signupDisabled",
  over_request_rate_limit: "rateLimited",
  over_email_send_rate_limit: "rateLimited",
  over_sms_send_rate_limit: "rateLimited",
  session_not_found: "sessionExpired",
  session_expired: "sessionExpired",
  refresh_token_not_found: "sessionExpired",
  refresh_token_already_used: "sessionExpired",
  bad_jwt: "sessionExpired",
  invalid_jwt: "sessionExpired",
  no_authorization: "sessionExpired",
  user_not_found: "sessionExpired",
  user_banned: "banned",
  reauthentication_needed: "reauthRequired",
  request_timeout: "server",
  hook_timeout: "server",
  hook_timeout_after_retry: "server",
  unexpected_failure: "server",
};

/** Mã lỗi của máy chủ dữ liệu: PostgREST ("PGRST…") và SQLSTATE của Postgres — viết hoa. */
const DATA_CODE_KIND: Record<string, AuthErrorKind> = {
  // JWT thiếu, sai hoặc hết hạn.
  PGRST300: "sessionExpired",
  PGRST301: "sessionExpired",
  PGRST302: "sessionExpired",
  PGRST303: "sessionExpired",
  // ensure_profile() báo «Chưa đăng nhập.» bằng mã này.
  "28000": "sessionExpired",
  // PostgREST không nối được cơ sở dữ liệu / hết thời gian chờ kết nối.
  PGRST000: "server",
  PGRST001: "server",
  PGRST002: "server",
  PGRST003: "server",
  // Chưa có hàm / bảng: project chưa chạy file SQL khởi tạo.
  PGRST202: "notSetUp",
  PGRST205: "notSetUp",
  "42883": "notSetUp",
  "42P01": "notSetUp",
  "42501": "forbidden",
};

/** Nhóm SQLSTATE (hai ký tự đầu) nghĩa là cơ sở dữ liệu đang trục trặc chứ không phải người dùng làm sai. */
const SERVER_SQLSTATE_CLASS = new Set(["08", "53", "57", "58", "XX"]);

// ───────────────────────── Dò theo nội dung (khi không có mã) ─────────────────────────

const NETWORK_TEXT =
  /failed to fetch|fetch failed|networkerror|network request failed|network error|load failed|err_network|err_internet|aborterror|timeouterror|timed out|was aborted|aborted a request|signal is aborted/i;

const TEXT_KIND: Array<[RegExp, AuthErrorKind]> = [
  [/invalid login credentials|invalid email or password/i, "invalidCredentials"],
  [/already registered|already been registered|user already exists/i, "emailTaken"],
  [/different from the old password/i, "samePassword"],
  [/password should|password is too short|password cannot be longer|weak password|password is known to be weak/i, "weakPassword"],
  [/unable to validate email address|invalid email|email address .* is invalid|anonymous sign-ins are disabled/i, "invalidEmail"],
  [/email not confirmed/i, "emailNotConfirmed"],
  [/signups? (are )?(not allowed|disabled)|signup is disabled/i, "signupDisabled"],
  [/rate limit|too many requests|you can only request this after/i, "rateLimited"],
  [NETWORK_TEXT, "network"],
  [/bad gateway|service unavailable|gateway time-?out|upstream|internal server error/i, "server"],
  [/jwt|auth session missing|session .*does not exist|refresh token/i, "sessionExpired"],
];

/** Có chữ cái riêng của tiếng Việt → thông báo đã là tiếng Việt (do máy chủ của ứng dụng viết). */
const VIETNAMESE_TEXT = /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i;

// ───────────────────────── Đọc đối tượng lỗi ─────────────────────────

interface ErrorFields {
  name: string;
  code: string;
  status: number | null;
  message: string;
  /** Lý do mật khẩu bị chê yếu (AuthWeakPasswordError): "length" | "characters" | "pwned". */
  reasons: string[];
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function readFields(error: unknown, httpStatus?: number): ErrorFields {
  const fields: ErrorFields = { name: "", code: "", status: httpStatus ?? null, message: "", reasons: [] };
  if (typeof error === "string") {
    fields.message = error;
    return fields;
  }
  if (!error || typeof error !== "object") return fields;
  const e = error as Record<string, unknown>;
  fields.name = text(e.name);
  // `error_code`, `msg`, `error_description`: dạng thô của máy chủ đăng nhập đời cũ.
  fields.code = text(e.code) || text(e.error_code);
  fields.message = text(e.message) || text(e.msg) || text(e.error_description);
  if (typeof e.status === "number" && Number.isFinite(e.status)) fields.status = e.status;
  if (Array.isArray(e.reasons)) fields.reasons = e.reasons.filter((r): r is string => typeof r === "string");
  return fields;
}

function kindOf(f: ErrorFields): AuthErrorKind {
  // 1. Theo mã lỗi.
  const authKind = AUTH_CODE_KIND[f.code.toLowerCase()];
  if (authKind) return authKind;
  const dataKind = DATA_CODE_KIND[f.code.toUpperCase()];
  if (dataKind) return dataKind;
  if (f.code === "validation_failed") {
    if (/password/i.test(f.message)) return "weakPassword";
    if (/email/i.test(f.message)) return "invalidEmail";
  }
  if (/^[0-9A-Z]{5}$/.test(f.code) && SERVER_SQLSTATE_CLASS.has(f.code.slice(0, 2))) return "server";
  // Các hàm trên máy chủ của ứng dụng tự báo lỗi bằng mã nhóm P0 và lời tiếng Việt (vd P0002 «Không tìm thấy tài khoản.»).
  // PostgREST gửi một số mã đó kèm HTTP 500, nhưng đây là lời từ chối có chủ ý chứ không phải máy chủ trục trặc.
  if (/^P0[0-9A-Z]{3}$/.test(f.code) && VIETNAMESE_TEXT.test(f.message)) return "serverMessage";

  // 2. Theo loại lỗi của thư viện.
  switch (f.name) {
    case "AuthSessionMissingError":
      return "sessionExpired";
    case "AuthInvalidCredentialsError":
      return "invalidCredentials";
    case "AuthRetryableFetchError":
      // status 0 = chưa hề có phản hồi; còn lại là máy chủ trả lỗi 5xx.
      return f.status && f.status >= 500 ? "server" : "network";
    case "AuthInvalidTokenResponseError":
    case "AuthUnknownError":
      // Máy chủ (hoặc một trạm trung gian như wifi công cộng) trả về thứ không đọc được.
      return "server";
    case "AbortError":
    case "TimeoutError":
      return "network";
  }

  // 3. Theo mã HTTP (0 = không hề có phản hồi nào).
  if (f.status === 0) return "network";
  if (f.status === 429) return "rateLimited";
  if (f.status !== null && f.status >= 500) return "server";
  // Phản hồi là một trang HTML thay vì dữ liệu: thường là trang chặn của wifi công cộng / proxy.
  if (/^\s*<(!doctype|html)/i.test(f.message)) return "network";

  // 4. Máy chủ của ứng dụng đã nói bằng tiếng Việt thì giữ nguyên lời đó, không dò chữ tiếng Anh nữa.
  if (VIETNAMESE_TEXT.test(f.message)) return "serverMessage";

  // 5. Theo nội dung (máy chủ / thư viện đời cũ không gửi mã).
  for (const [pattern, kind] of TEXT_KIND) {
    if (pattern.test(f.message)) return kind;
  }
  if (f.status === 401) return "sessionExpired";
  if (f.status === 403) return "forbidden";
  return "unknown";
}

function weakPasswordMessage(f: ErrorFields): string {
  if (/longer than|too long/i.test(f.message)) {
    const max = f.message.match(/(\d+)\s*characters/i)?.[1] ?? "72";
    return `Mật khẩu dài tối đa ${max} ký tự.`;
  }
  const min = f.message.match(/at least (\d+) characters/i)?.[1];
  if (min || f.reasons.includes("length")) return `Mật khẩu phải có ít nhất ${min ?? DEFAULT_PASSWORD_MIN} ký tự.`;
  if (f.reasons.includes("pwned") || /known to be weak|easy to guess/i.test(f.message)) {
    return "Mật khẩu này quá phổ biến, dễ bị đoán. Hãy chọn mật khẩu khác.";
  }
  if (f.reasons.includes("characters") || /at least one character of each/i.test(f.message)) {
    return "Mật khẩu chưa đủ mạnh: cần có đủ các loại ký tự mà hệ thống yêu cầu (chữ thường, chữ hoa, chữ số, ký hiệu).";
  }
  return "Mật khẩu quá yếu. Hãy chọn mật khẩu dài hơn và khó đoán hơn.";
}

/** Gọn lại lời gốc của máy chủ để ghép vào thông báo (một dòng, không quá dài). */
function shorten(message: string, max = 200): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * Nhận diện một lỗi và soạn thông báo tiếng Việt.
 * @param httpStatus mã HTTP của phản hồi, nếu nơi gọi biết (lỗi của PostgREST không tự mang theo mã này).
 */
export function describeAuthError(error: unknown, httpStatus?: number): AuthErrorInfo {
  const f = readFields(error, httpStatus);
  const kind = kindOf(f);
  const original = shorten(f.message);
  switch (kind) {
    case "weakPassword":
      return { kind, message: weakPasswordMessage(f) };
    case "forbidden":
      return { kind, message: VIETNAMESE_TEXT.test(original) ? original : FORBIDDEN_MESSAGE };
    case "notSetUp":
      return {
        kind,
        message: `Máy chủ chưa được cài đặt xong (chưa chạy file SQL khởi tạo).${original ? ` Chi tiết: ${original}` : ""}`,
      };
    case "serverMessage":
      return { kind, message: original };
    case "unknown":
      return { kind, message: original ? `Có lỗi xảy ra: ${original}` : UNKNOWN_MESSAGE };
    default:
      return { kind, message: MESSAGE[kind] };
  }
}

/** Thông báo tiếng Việt cho một lỗi bất kỳ. */
export function authErrorMessage(error: unknown, httpStatus?: number): string {
  return describeAuthError(error, httpStatus).message;
}

/**
 * Chờ một lời gọi Supabase và trả về kết quả của nó; thất bại kiểu nào (trả về `error` hay ném lỗi)
 * cũng thành một Error mang thông báo tiếng Việt.
 */
export async function unwrap<T extends { error: unknown }>(request: PromiseLike<T>): Promise<T> {
  let result: T;
  try {
    result = await request;
  } catch (thrown) {
    throw new Error(authErrorMessage(thrown));
  }
  if (result.error) {
    // Kết quả của PostgREST có kèm mã HTTP; của máy chủ đăng nhập thì mã nằm ngay trong `error`.
    const status = (result as { status?: unknown }).status;
    throw new Error(authErrorMessage(result.error, typeof status === "number" ? status : undefined));
  }
  return result;
}

/** Lỗi tạm thời (mạng, máy chủ trục trặc, thử quá nhiều lần): phiên đăng nhập vẫn còn, thử lại sau là được. */
export function isTemporaryKind(kind: AuthErrorKind): boolean {
  return kind === "network" || kind === "server" || kind === "rateLimited";
}

/** Lỗi cho biết phiên đăng nhập trên máy này không còn dùng được nữa. */
export function isSessionKind(kind: AuthErrorKind): boolean {
  return kind === "sessionExpired" || kind === "banned";
}
