// Tests for the error → Vietnamese message mapping.
// The fixtures are the real shapes produced by @supabase/supabase-js 2.119 against a local Supabase stack
// (GoTrue errors are built with the library's own classes; PostgREST errors are the plain objects it returns).
import {
  AuthApiError,
  AuthInvalidCredentialsError,
  AuthInvalidTokenResponseError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { authErrorMessage, describeAuthError, isSessionKind, isTemporaryKind, unwrap, type AuthErrorKind } from "./authErrors";

const INVALID_CREDENTIALS = "Email hoặc mật khẩu không đúng.";
const EMAIL_TAKEN = "Email này đã được đăng ký. Hãy đăng nhập; nếu quên mật khẩu, nhờ người quản lý đặt lại.";
const INVALID_EMAIL = "Email không hợp lệ. Hãy kiểm tra lại (ví dụ: ten@gmail.com).";
const NOT_CONFIRMED = "Email chưa được xác nhận. Hãy mở hộp thư, bấm vào liên kết xác nhận rồi đăng nhập lại.";
const SIGNUP_DISABLED = "Hệ thống đang tắt đăng ký tài khoản mới. Hãy liên hệ người quản lý.";
const RATE_LIMITED = "Bạn thử quá nhiều lần. Hãy chờ một lát rồi thử lại.";
const NETWORK = "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.";
const SERVER = "Máy chủ đang gặp sự cố. Hãy thử lại sau ít phút.";
const SESSION_EXPIRED = "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";

/** A PostgREST error as postgrest-js hands it over (a plain object, not an Error). */
const pg = (code: string, message: string, details: string | null = null, hint: string | null = null) => ({
  code,
  message,
  details,
  hint,
});

describe("sign-in and sign-up errors of the auth server (by code)", () => {
  it("wrong password and unknown email give the same message", () => {
    const error = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
    expect(describeAuthError(error)).toEqual({ kind: "invalidCredentials", message: INVALID_CREDENTIALS });
  });

  it("email already registered", () => {
    expect(describeAuthError(new AuthApiError("User already registered", 422, "user_already_exists"))).toEqual({
      kind: "emailTaken",
      message: EMAIL_TAKEN,
    });
    expect(describeAuthError(new AuthApiError("A user with this email address has already been registered", 422, "email_exists")).kind).toBe(
      "emailTaken",
    );
  });

  it("password too short: the minimum length comes from the server's message", () => {
    const six = new AuthWeakPasswordError("Password should be at least 6 characters.", 422, ["length"]);
    expect(describeAuthError(six)).toEqual({ kind: "weakPassword", message: "Mật khẩu phải có ít nhất 6 ký tự." });
    const eight = new AuthWeakPasswordError("Password should be at least 8 characters.", 422, ["length"]);
    expect(authErrorMessage(eight)).toBe("Mật khẩu phải có ít nhất 8 ký tự.");
  });

  it("password too short without a number in the message falls back to 6", () => {
    expect(authErrorMessage(new AuthWeakPasswordError("Weak password", 422, ["length"]))).toBe("Mật khẩu phải có ít nhất 6 ký tự.");
  });

  it("password rejected for other reasons", () => {
    const pwned = new AuthWeakPasswordError("Password is known to be weak and easy to guess, please choose a different one.", 422, ["pwned"]);
    expect(describeAuthError(pwned)).toEqual({
      kind: "weakPassword",
      message: "Mật khẩu này quá phổ biến, dễ bị đoán. Hãy chọn mật khẩu khác.",
    });
    const characters = new AuthWeakPasswordError(
      "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.",
      422,
      ["characters"],
    );
    expect(authErrorMessage(characters)).toBe(
      "Mật khẩu chưa đủ mạnh: cần có đủ các loại ký tự mà hệ thống yêu cầu (chữ thường, chữ hoa, chữ số, ký hiệu).",
    );
    expect(authErrorMessage(new AuthApiError("Signup requires a valid password", 400, "validation_failed"))).toBe(
      "Mật khẩu quá yếu. Hãy chọn mật khẩu dài hơn và khó đoán hơn.",
    );
  });

  it("password too long", () => {
    const error = new AuthApiError("Password cannot be longer than 72 characters", 400, "validation_failed");
    expect(describeAuthError(error)).toEqual({ kind: "weakPassword", message: "Mật khẩu dài tối đa 72 ký tự." });
  });

  it("new password equal to the current one", () => {
    const error = new AuthApiError("New password should be different from the old password.", 422, "same_password");
    expect(describeAuthError(error)).toEqual({ kind: "samePassword", message: "Mật khẩu mới phải khác mật khẩu đang dùng." });
  });

  it("invalid email", () => {
    const format = new AuthApiError("Unable to validate email address: invalid format", 400, "validation_failed");
    expect(describeAuthError(format)).toEqual({ kind: "invalidEmail", message: INVALID_EMAIL });
    expect(describeAuthError(new AuthApiError('Email address "a@b" is invalid', 400, "email_address_invalid")).kind).toBe("invalidEmail");
    // Empty email: the server treats the request as an anonymous sign-in.
    expect(describeAuthError(new AuthApiError("Anonymous sign-ins are disabled", 422, "anonymous_provider_disabled")).kind).toBe("invalidEmail");
  });

  it("email not confirmed", () => {
    expect(describeAuthError(new AuthApiError("Email not confirmed", 400, "email_not_confirmed"))).toEqual({
      kind: "emailNotConfirmed",
      message: NOT_CONFIRMED,
    });
  });

  it("sign-ups disabled", () => {
    expect(describeAuthError(new AuthApiError("Signups not allowed for this instance", 422, "signup_disabled"))).toEqual({
      kind: "signupDisabled",
      message: SIGNUP_DISABLED,
    });
    expect(describeAuthError(new AuthApiError("Email signups are disabled", 422, "email_provider_disabled")).kind).toBe("signupDisabled");
  });

  it("too many attempts", () => {
    expect(describeAuthError(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"))).toEqual({
      kind: "rateLimited",
      message: RATE_LIMITED,
    });
    expect(describeAuthError(new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit")).kind).toBe("rateLimited");
    // No code at all (an API gateway in front of the server): the HTTP status decides.
    expect(describeAuthError(new AuthApiError("slow down", 429, undefined)).kind).toBe("rateLimited");
  });

  it("banned at the auth level", () => {
    expect(describeAuthError(new AuthApiError("User is banned", 400, "user_banned"))).toEqual({
      kind: "banned",
      message: "Tài khoản này đã bị khóa. Hãy liên hệ người quản lý.",
    });
  });

  it("the server wants a fresh sign-in before a password change", () => {
    const error = new AuthApiError("Password update requires reauthentication", 400, "reauthentication_needed");
    expect(describeAuthError(error)).toEqual({
      kind: "reauthRequired",
      message: "Cần đăng nhập lại trước khi đổi mật khẩu: hãy đăng xuất, đăng nhập rồi thử lại.",
    });
  });
});

describe("the code alone decides — whatever the wording of the message", () => {
  // Messages change between server versions (and some are localised); codes do not.
  const byCode: Array<[string, number, AuthErrorKind]> = [
    ["invalid_credentials", 400, "invalidCredentials"],
    ["user_already_exists", 422, "emailTaken"],
    ["email_exists", 422, "emailTaken"],
    ["weak_password", 422, "weakPassword"],
    ["same_password", 422, "samePassword"],
    ["email_address_invalid", 400, "invalidEmail"],
    ["anonymous_provider_disabled", 422, "invalidEmail"],
    ["email_not_confirmed", 400, "emailNotConfirmed"],
    ["provider_email_needs_verification", 400, "emailNotConfirmed"],
    ["signup_disabled", 422, "signupDisabled"],
    ["email_provider_disabled", 422, "signupDisabled"],
    ["over_request_rate_limit", 400, "rateLimited"],
    ["over_email_send_rate_limit", 400, "rateLimited"],
    ["over_sms_send_rate_limit", 400, "rateLimited"],
    ["session_not_found", 400, "sessionExpired"],
    ["session_expired", 400, "sessionExpired"],
    ["refresh_token_not_found", 400, "sessionExpired"],
    ["refresh_token_already_used", 400, "sessionExpired"],
    ["bad_jwt", 400, "sessionExpired"],
    ["invalid_jwt", 400, "sessionExpired"],
    ["no_authorization", 400, "sessionExpired"],
    ["user_not_found", 400, "sessionExpired"],
    ["user_banned", 400, "banned"],
    ["reauthentication_needed", 400, "reauthRequired"],
    ["request_timeout", 400, "server"],
    ["hook_timeout", 400, "server"],
    ["hook_timeout_after_retry", 400, "server"],
    ["unexpected_failure", 400, "server"],
  ];
  it.each(byCode)("auth server: %s", (code, status, kind) => {
    expect(describeAuthError(new AuthApiError("some new wording", status, code)).kind).toBe(kind);
  });

  const byDataCode: Array<[string, AuthErrorKind]> = [
    ["PGRST300", "sessionExpired"],
    ["PGRST301", "sessionExpired"],
    ["PGRST302", "sessionExpired"],
    ["PGRST303", "sessionExpired"],
    ["28000", "sessionExpired"],
    ["PGRST000", "server"],
    ["PGRST001", "server"],
    ["PGRST002", "server"],
    ["PGRST003", "server"],
    ["PGRST202", "notSetUp"],
    ["PGRST205", "notSetUp"],
    ["42883", "notSetUp"],
    ["42P01", "notSetUp"],
    ["42501", "forbidden"],
    ["08006", "server"],
    ["53300", "server"],
    ["57014", "server"],
    ["58030", "server"],
    ["XX000", "server"],
  ];
  it.each(byDataCode)("data server: %s", (code, kind) => {
    expect(describeAuthError(pg(code, "some new wording")).kind).toBe(kind);
  });

  it("other SQLSTATE classes are not mistaken for server trouble", () => {
    for (const code of ["22P02", "23505", "P0001", "42601"]) expect(describeAuthError(pg(code, "some new wording")).kind).toBe("unknown");
  });

  it("validation_failed is told apart by what the message is about", () => {
    expect(describeAuthError(new AuthApiError("email: must be a valid address", 400, "validation_failed")).kind).toBe("invalidEmail");
    expect(describeAuthError(new AuthApiError("password: required", 400, "validation_failed")).kind).toBe("weakPassword");
    expect(describeAuthError(new AuthApiError("captcha: required", 400, "validation_failed")).kind).toBe("unknown");
  });

  it("a weak password with wording nobody planned for still gets a sentence", () => {
    expect(describeAuthError(new AuthWeakPasswordError("some new wording", 422, []))).toEqual({
      kind: "weakPassword",
      message: "Mật khẩu quá yếu. Hãy chọn mật khẩu dài hơn và khó đoán hơn.",
    });
  });

  it("the library's error classes are recognised by name when they carry no code", () => {
    expect(describeAuthError({ name: "AuthSessionMissingError", message: "some new wording", status: 400 }).kind).toBe("sessionExpired");
    expect(describeAuthError({ name: "AuthRetryableFetchError", message: "some new wording", status: 0 }).kind).toBe("network");
    expect(describeAuthError({ name: "AbortError", message: "some new wording" }).kind).toBe("network");
    expect(describeAuthError({ name: "TimeoutError", message: "some new wording" }).kind).toBe("network");
  });

  it("no HTTP answer at all (status 0) is a network failure, however the browser words it", () => {
    const error = pg("", "TypeError: Der Netzwerkzugriff ist fehlgeschlagen", "", "");
    expect(describeAuthError(error, 0)).toEqual({ kind: "network", message: NETWORK });
    expect(describeAuthError(error).kind).toBe("unknown");
  });
});

describe("session no longer valid", () => {
  it.each([
    ["user deleted", new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found")],
    ["refresh token gone", new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found")],
    ["refresh token reused", new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used")],
    ["session expired", new AuthApiError("Session expired", 400, "session_expired")],
    ["bad JWT", new AuthApiError("invalid JWT: unable to parse or verify signature", 403, "bad_jwt")],
    ["no session in this browser", new AuthSessionMissingError()],
    ["PostgREST: JWT rejected", pg("PGRST301", "JWT cryptographic operation failed")],
    ["PostgREST: JWT expired", pg("PGRST303", "JWT expired")],
    ["ensure_profile() without a user", pg("28000", "Chưa đăng nhập.")],
  ])("%s", (_name, error) => {
    const info = describeAuthError(error);
    expect(info).toEqual({ kind: "sessionExpired", message: SESSION_EXPIRED });
    expect(isSessionKind(info.kind)).toBe(true);
    expect(isTemporaryKind(info.kind)).toBe(false);
  });

  it("a 401 without any code is a session problem too", () => {
    expect(describeAuthError({ message: "Unauthorized" }, 401).kind).toBe("sessionExpired");
  });
});

describe("network and server trouble", () => {
  it.each([
    ["auth: Chrome offline", new AuthRetryableFetchError("Failed to fetch", 0)],
    ["auth: Node", new AuthRetryableFetchError("fetch failed", 0)],
    ["data: Chrome offline", pg("", "TypeError: Failed to fetch", "TypeError: Failed to fetch\n    at …", "")],
    ["data: Firefox offline", pg("", "TypeError: NetworkError when attempting to fetch resource.", "", "")],
    ["data: Safari offline", pg("", "TypeError: Load failed", "", "")],
    ["data: request timed out", pg("", "TimeoutError: signal timed out", "", "")],
    ["data: request aborted", pg("", "AbortError: signal is aborted without reason", "", "Request was aborted (timeout or manual cancellation)")],
    ["a thrown TypeError", new TypeError("Failed to fetch")],
    ["a captive portal answering with a web page", { message: "<!DOCTYPE html><html><head><title>Wifi</title></head></html>" }],
  ])("no connection — %s", (_name, error) => {
    const info = describeAuthError(error);
    expect(info).toEqual({ kind: "network", message: NETWORK });
    expect(isTemporaryKind(info.kind)).toBe(true);
    expect(isSessionKind(info.kind)).toBe(false);
  });

  it.each([
    ["auth: gateway error", new AuthRetryableFetchError("Bad Gateway", 502)],
    ["auth: unexpected failure", new AuthApiError("Unexpected failure, please check server logs", 500, "unexpected_failure")],
    ["auth: request timeout", new AuthApiError("Processing this request timed out", 504, "request_timeout")],
    ["auth: unreadable answer", new AuthUnknownError("Unexpected token '<'", new SyntaxError("Unexpected token '<'"))],
    ["auth: token answer without a session", new AuthInvalidTokenResponseError()],
    ["data: database unreachable", pg("PGRST000", "Database connection error. Retrying the connection.")],
    ["data: schema cache not ready", pg("PGRST002", "Could not query the database for the schema cache. Retrying.")],
    ["data: statement timeout", pg("57014", "canceling statement due to statement timeout")],
    ["data: too many connections", pg("53300", "sorry, too many clients already")],
    ["data: gateway answer without a code", { message: "An invalid response was received from the upstream server" }],
  ])("server trouble — %s", (_name, error) => {
    const info = describeAuthError(error);
    expect(info).toEqual({ kind: "server", message: SERVER });
    expect(isTemporaryKind(info.kind)).toBe(true);
  });

  it("the HTTP status passed by the caller decides when the error itself says nothing", () => {
    expect(describeAuthError({ message: "" }, 503)).toEqual({ kind: "server", message: SERVER });
    expect(describeAuthError({ message: "" }, 429).kind).toBe("rateLimited");
  });
});

describe("errors of the app's own server functions", () => {
  it("Vietnamese messages raised by the RPCs are shown as they are", () => {
    expect(describeAuthError(pg("42501", "Chỉ người quản lý mới đổi được vai trò."))).toEqual({
      kind: "forbidden",
      message: "Chỉ người quản lý mới đổi được vai trò.",
    });
    expect(describeAuthError(pg("42501", "Không tự đổi vai trò của chính mình. Hãy nhờ một quản lý khác.")).message).toBe(
      "Không tự đổi vai trò của chính mình. Hãy nhờ một quản lý khác.",
    );
    expect(describeAuthError(pg("22023", "Mật khẩu phải có ít nhất 6 ký tự."))).toEqual({
      kind: "serverMessage",
      message: "Mật khẩu phải có ít nhất 6 ký tự.",
    });
    expect(describeAuthError(pg("P0002", "Không tìm thấy tài khoản.")).message).toBe("Không tìm thấy tài khoản.");
    // PostgREST answers this code with HTTP 500, yet it is a deliberate refusal, not server trouble.
    expect(describeAuthError(pg("P0002", "Không tìm thấy tài khoản."), 500)).toEqual({
      kind: "serverMessage",
      message: "Không tìm thấy tài khoản.",
    });
    expect(describeAuthError(pg("P0001", "internal assertion failed"), 500).kind).toBe("server");
    expect(describeAuthError(pg("23503", "Không xóa được: còn 3 đơn hàng thuộc chương trình này.")).message).toBe(
      "Không xóa được: còn 3 đơn hàng thuộc chương trình này.",
    );
  });

  it("a permission error in English gets a Vietnamese sentence", () => {
    const error = pg(
      "42501",
      "permission denied for table profiles",
      null,
      "Grant the required privileges to the current role with: GRANT UPDATE ON public.profiles TO authenticated;",
    );
    expect(describeAuthError(error)).toEqual({ kind: "forbidden", message: "Bạn không có quyền làm việc này." });
    expect(describeAuthError({ message: "Forbidden" }, 403).kind).toBe("forbidden");
  });

  it("a project that has not run the setup SQL is called out, with the original detail", () => {
    const error = pg("PGRST202", "Could not find the function public.ensure_profile without parameters in the schema cache");
    const info = describeAuthError(error);
    expect(info.kind).toBe("notSetUp");
    expect(info.message).toBe(
      "Máy chủ chưa được cài đặt xong (chưa chạy file SQL khởi tạo). Chi tiết: Could not find the function public.ensure_profile without parameters in the schema cache",
    );
    expect(describeAuthError(pg("42P01", 'relation "public.profiles" does not exist')).kind).toBe("notSetUp");
  });
});

describe("servers and libraries that send no code (matching on the message)", () => {
  const cases: Array<[string, AuthErrorKind]> = [
    ["Invalid login credentials", "invalidCredentials"],
    ["User already registered", "emailTaken"],
    ["Password should be at least 6 characters", "weakPassword"],
    ["New password should be different from the old password.", "samePassword"],
    ["Unable to validate email address: invalid format", "invalidEmail"],
    ["Email not confirmed", "emailNotConfirmed"],
    ["Signups not allowed for this instance", "signupDisabled"],
    ["For security purposes, you can only request this after 42 seconds.", "rateLimited"],
    ["Email rate limit exceeded", "rateLimited"],
    ["Failed to fetch", "network"],
    ["JWT expired", "sessionExpired"],
    ["Auth session missing!", "sessionExpired"],
    ["Invalid Refresh Token: Refresh Token Not Found", "sessionExpired"],
  ];
  it.each(cases)("%s → %s", (message, kind) => {
    expect(describeAuthError(new AuthApiError(message, 400, undefined)).kind).toBe(kind);
    // The raw body of an old auth server: { error_code?, msg | error_description }.
    expect(describeAuthError({ msg: message }).kind).toBe(kind);
    expect(describeAuthError({ error_description: message }).kind).toBe(kind);
    expect(describeAuthError(message).kind).toBe(kind);
  });

  it("the legacy `error_code` field is read like `code`", () => {
    expect(describeAuthError({ error_code: "invalid_credentials", msg: "whatever" }).kind).toBe("invalidCredentials");
  });

  it("the library's own «missing credentials» error", () => {
    const error = new AuthInvalidCredentialsError("You must provide either an email or phone number and a password");
    expect(describeAuthError(error)).toEqual({ kind: "invalidCredentials", message: INVALID_CREDENTIALS });
  });

  it("the code wins over the message", () => {
    // A message that looks like a network failure, with a code saying otherwise.
    expect(describeAuthError(new AuthApiError("Failed to fetch", 400, "invalid_credentials")).kind).toBe("invalidCredentials");
  });
});

describe("which kinds are worth retrying, and which end the session", () => {
  const all: AuthErrorKind[] = [
    "invalidCredentials", "emailTaken", "weakPassword", "samePassword", "invalidEmail", "emailNotConfirmed", "signupDisabled",
    "rateLimited", "network", "server", "sessionExpired", "banned", "reauthRequired", "forbidden", "notSetUp", "serverMessage", "unknown",
  ];
  it("temporary: network, server, rateLimited — nothing else", () => {
    expect(all.filter(isTemporaryKind)).toEqual(["rateLimited", "network", "server"]);
  });
  it("session over: sessionExpired, banned — nothing else", () => {
    expect(all.filter(isSessionKind)).toEqual(["sessionExpired", "banned"]);
  });
});

describe("unwrap", () => {
  it("hands back the result when there is no error", async () => {
    const result = { data: { id: 1 }, error: null, status: 200 };
    await expect(unwrap(Promise.resolve(result))).resolves.toBe(result);
  });

  it("turns a returned error into an Error with the Vietnamese message", async () => {
    const refused = { data: null, error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials") };
    await expect(unwrap(Promise.resolve(refused))).rejects.toThrow(INVALID_CREDENTIALS);
    await expect(unwrap(Promise.resolve(refused))).rejects.toBeInstanceOf(Error);
    const rpc = { data: null, error: pg("42501", "Chỉ người quản lý mới đổi được vai trò."), status: 403 };
    await expect(unwrap(Promise.resolve(rpc))).rejects.toThrow("Chỉ người quản lý mới đổi được vai trò.");
  });

  it("uses the HTTP status of a data-server answer when the error itself says nothing", async () => {
    await expect(unwrap(Promise.resolve({ data: null, error: { message: "" }, status: 503 }))).rejects.toThrow(SERVER);
    await expect(unwrap(Promise.resolve({ data: null, error: pg("", "TypeError: ???", "", ""), status: 0 }))).rejects.toThrow(NETWORK);
  });

  it("turns a thrown error into an Error with the Vietnamese message too", async () => {
    await expect(unwrap(Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow(NETWORK);
    // A builder that is only «thenable», like the query builders of the data client.
    const thenable = { then: (_ok: unknown, fail: (e: unknown) => void) => fail(new Error("boom")) } as unknown as PromiseLike<{ error: unknown }>;
    await expect(unwrap(thenable)).rejects.toThrow("Có lỗi xảy ra: boom");
  });
});

describe("fallback", () => {
  it("an unknown error keeps the original message", () => {
    expect(describeAuthError(new AuthApiError("Something nobody planned for", 418, "teapot"))).toEqual({
      kind: "unknown",
      message: "Có lỗi xảy ra: Something nobody planned for",
    });
    expect(authErrorMessage(pg("22P02", 'invalid input syntax for type uuid: "khong-phai-uuid"'))).toBe(
      'Có lỗi xảy ra: invalid input syntax for type uuid: "khong-phai-uuid"',
    );
    expect(authErrorMessage(new Error("boom"))).toBe("Có lỗi xảy ra: boom");
  });

  it("a long or multi-line original message is cut to one short line", () => {
    const message = authErrorMessage({ message: `line one\n   line two ${"x".repeat(400)}` });
    expect(message.startsWith("Có lỗi xảy ra: line one line two xxx")).toBe(true);
    expect(message.endsWith("…")).toBe(true);
    expect(message.length).toBeLessThanOrEqual("Có lỗi xảy ra: ".length + 201);
  });

  it("nothing usable at all still gives a sentence", () => {
    for (const value of [null, undefined, 42, {}, { message: "" }, ""]) {
      expect(describeAuthError(value)).toEqual({ kind: "unknown", message: "Có lỗi xảy ra. Hãy thử lại." });
    }
  });

  it("an Error that already carries a Vietnamese message passes through unchanged", () => {
    expect(authErrorMessage(new Error(INVALID_CREDENTIALS))).toBe(INVALID_CREDENTIALS);
    expect(authErrorMessage(new Error("Không tìm thấy tài khoản."))).toBe("Không tìm thấy tài khoản.");
  });
});
