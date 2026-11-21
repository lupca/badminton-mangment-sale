/** Tình trạng lưu dữ liệu lên máy chủ (khi ứng dụng chạy với máy chủ). */
export interface SyncStatus {
  /** idle: mọi thay đổi đã được lưu; saving: đang gửi; retrying: gửi chưa được (mất mạng…), hệ thống sẽ tự thử lại. */
  state: "idle" | "saving" | "retrying";
  /** Số bản ghi (chương trình, đơn hàng, tồn kho…) còn thay đổi chưa lưu được lên máy chủ. */
  pending: number;
}

export const SYNC_IDLE: SyncStatus = { state: "idle", pending: 0 };
