// Gọi lớp API của ứng dụng (server/app.js). Chỉ có một địa chỉ; mỗi yêu cầu là một lệnh { op, args } gửi bằng POST,
// kèm khóa phiên đăng nhập. Khóa phiên nằm trong localStorage của trình duyệt, nên các tab của cùng trình duyệt dùng chung.
//
// Mọi thất bại đều thành `ApiError` với lời báo tiếng Việt: lời của máy chủ nếu máy chủ có trả lời, lời soạn ở đây nếu không.

/** Mã lỗi của lớp API (xem phần «Mã lỗi» ở đầu server/app.js), thêm "network" = không nhận được câu trả lời nào. */
export type ApiErrorCode =
  | "network"
  | "bad_request"
  | "invalid_credentials"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "rejected"
  | "rate_limited"
  | "server"
  | "unavailable"
  | "not_configured"
  | "not_installed";

const KNOWN_CODES: readonly ApiErrorCode[] = [
  "bad_request",
  "invalid_credentials",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "too_large",
  "rejected",
  "rate_limited",
  "server",
  "unavailable",
  "not_configured",
  "not_installed",
];

/** Trục trặc không phải do người dùng làm sai: mất mạng, máy chủ bận… Thử lại sau là được. */
const TEMPORARY: readonly ApiErrorCode[] = ["network", "server", "unavailable", "rate_limited", "not_configured", "not_installed"];

export const NETWORK_MESSAGE = "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.";
const SERVER_MESSAGE = "Máy chủ đang gặp sự cố. Hãy thử lại sau ít phút.";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    /** Mã HTTP của câu trả lời; 0 = không có câu trả lời. */
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Trục trặc tạm thời (mất mạng, máy chủ bận, thử quá nhiều lần): thử lại sau là được. */
  get temporary(): boolean {
    return TEMPORARY.includes(this.code);
  }
}

/** Lời báo tiếng Việt cho một lỗi bất kỳ (lỗi của lớp API đã mang sẵn lời báo). */
export function errorMessage(error: unknown, fallback = "Có lỗi xảy ra. Hãy thử lại."): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return fallback;
}

export interface CallOptions {
  /** Quá bấy lâu chưa có câu trả lời thì coi như mất mạng. Mặc định 30 giây. */
  timeoutMs?: number;
}

export interface ApiClient {
  /** Gửi một lệnh và trả về kết quả của nó. Thất bại thì ném `ApiError`. */
  call<T = unknown>(op: string, args?: Record<string, unknown>, options?: CallOptions): Promise<T>;
  /** Khóa phiên đăng nhập đang lưu trên trình duyệt này; null = chưa đăng nhập. */
  getToken(): string | null;
  /** Lưu khóa phiên mới (vừa đăng nhập) hoặc gỡ nó (null: đăng xuất). Các tab khác của trình duyệt cũng được báo. */
  setToken(token: string | null): void;
  /** Gọi `listener` mỗi khi khóa phiên đổi — kể cả do một tab khác đăng nhập / đăng xuất. Trả về hàm hủy. */
  onTokenChange(listener: (token: string | null) => void): () => void;
  /** Gọi `listener` khi máy chủ không còn nhận khóa phiên đang dùng (phiên hết hạn, bị quản lý đặt lại mật khẩu…). Trả về hàm hủy. */
  onUnauthorized(listener: () => void): () => void;
}

/** Phần của `Storage` mà lớp này dùng. */
export type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ApiClientOptions {
  /** Địa chỉ của lớp API, vd "/api". */
  url: string;
  /** Mặc định: `fetch` của môi trường. */
  fetch?: typeof fetch;
  /** Nơi giữ khóa phiên. Mặc định: localStorage của trình duyệt; null = chỉ giữ trong bộ nhớ. */
  storage?: TokenStorage | null;
  storageKey?: string;
}

export const SESSION_STORAGE_KEY = "kmdb.session";
const DEFAULT_TIMEOUT_MS = 30_000;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function browserStorage(): TokenStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư nghiêm ngặt): chỉ giữ khóa phiên trong bộ nhớ của tab này.
    return null;
  }
}

/** Câu trả lời thất bại → lỗi. `payload` là thân JSON của câu trả lời (null nếu không đọc được). */
export function failureOf(status: number, payload: unknown): ApiError {
  const error = isObject(payload) && isObject(payload.error) ? payload.error : null;
  const code = typeof error?.code === "string" ? (error.code as ApiErrorCode) : null;
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  if (code && KNOWN_CODES.includes(code)) return new ApiError(code, message || SERVER_MESSAGE, status);
  // Lớp API trả một mã lỗi mà bản đang chạy trên trình duyệt chưa biết (máy chủ mới hơn), kèm lời giải thích: với mã 4xx
  // đó là một lời từ chối có chủ ý — giữ lời của máy chủ, không coi là trục trặc để rồi thử lại mãi.
  if (code && message && status >= 400 && status < 500 && ![401, 403, 408, 413, 429].includes(status)) {
    return new ApiError("rejected", message, status);
  }
  // Không phải câu trả lời của lớp API: do nơi chạy nó (hoặc một trạm trung gian như wifi công cộng) trả về.
  if (status === 413) return new ApiError("too_large", "Dữ liệu gửi lên quá lớn (tối đa khoảng 4 MB mỗi bản ghi).", status);
  if (status === 429) return new ApiError("rate_limited", "Bạn thử quá nhiều lần. Hãy chờ một lát rồi thử lại.", status);
  if (status === 401) return new ApiError("unauthorized", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", status);
  if (status === 403) return new ApiError("forbidden", "Bạn không có quyền làm việc này.", status);
  return new ApiError("unavailable", SERVER_MESSAGE, status);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const storageKey = options.storageKey ?? SESSION_STORAGE_KEY;
  const tokenListeners = new Set<(token: string | null) => void>();
  const unauthorizedListeners = new Set<() => void>();

  const readStored = (): string | null => {
    try {
      const value = storage?.getItem(storageKey) ?? null;
      return value && value.trim() !== "" ? value : null;
    } catch {
      return null;
    }
  };

  let token = readStored();

  const adopt = (next: string | null) => {
    if (next === token) return;
    token = next;
    [...tokenListeners].forEach((listener) => listener(next));
  };

  // Một tab khác của cùng trình duyệt vừa đăng nhập / đăng xuất.
  if (typeof window !== "undefined" && storage && typeof localStorage !== "undefined" && storage === localStorage) {
    window.addEventListener("storage", (event) => {
      if (event.storageArea === storage && (event.key === storageKey || event.key === null)) adopt(readStored());
    });
  }

  return {
    async call<T = unknown>(op: string, args: Record<string, unknown> = {}, callOptions: CallOptions = {}): Promise<T> {
      const doFetch = options.fetch ?? fetch;
      const sentWith = token;
      let response: Response;
      let payload: unknown = null;
      try {
        response = await doFetch(options.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(sentWith ? { authorization: `Bearer ${sentWith}` } : {}) },
          body: JSON.stringify({ op, args }),
          cache: "no-store",
          signal: timeoutSignal(callOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch {
        // Mất mạng, máy chủ không phản hồi, hoặc hết thời gian chờ.
        throw new ApiError("network", NETWORK_MESSAGE, 0);
      }
      try {
        payload = await response.json();
      } catch {
        // Thân không phải JSON (trang lỗi của nơi chạy lớp API), hoặc đứt mạng giữa chừng.
        if (response.ok) throw new ApiError("network", NETWORK_MESSAGE, 0);
      }
      if (response.ok && isObject(payload) && "result" in payload) return payload.result as T;
      const error = failureOf(response.status, payload);
      // Máy chủ không nhận khóa phiên vừa gửi — và trình duyệt vẫn đang dùng đúng khóa đó.
      if (error.code === "unauthorized" && sentWith !== null && sentWith === token) {
        [...unauthorizedListeners].forEach((listener) => listener());
      }
      throw error;
    },

    getToken: () => token,

    setToken(next) {
      try {
        if (next === null) storage?.removeItem(storageKey);
        else storage?.setItem(storageKey, next);
      } catch {
        // Không ghi được (hết dung lượng, bị chặn): phiên vẫn dùng được trong tab này cho tới khi tải lại trang.
      }
      adopt(next);
    },

    onTokenChange(listener) {
      tokenListeners.add(listener);
      return () => {
        tokenListeners.delete(listener);
      };
    },

    onUnauthorized(listener) {
      unauthorizedListeners.add(listener);
      return () => {
        unauthorizedListeners.delete(listener);
      };
    },
  };
}
