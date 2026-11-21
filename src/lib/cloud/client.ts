// Kết nối tới lớp API — tạo một lần, dùng chung cho đăng nhập và dữ liệu.
import { createApiClient, type ApiClient } from "./api";
import { API_URL, cloudEnabled } from "./config";

let client: ApiClient | null = null;

export function getApi(): ApiClient {
  if (!cloudEnabled) throw new Error("Ứng dụng đang chạy không có máy chủ.");
  client ??= createApiClient({ url: API_URL });
  return client;
}
