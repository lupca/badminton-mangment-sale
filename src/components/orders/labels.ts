// Chữ hiển thị dùng chung cho danh sách đơn, bảng tổng hợp và các file Excel xuất ra.
import type { Order } from "../../types";

export const ORDER_STATUS_LABEL: Record<Order["status"], string> = { draft: "Nháp", confirmed: "Đã chốt" };
/** Đơn chưa ghi tên đại lý. */
export const NO_DEALER_NAME = "(chưa ghi tên)";
/** Đơn mà chương trình của nó không còn trong dữ liệu. */
export const NO_PROGRAM_NAME = "(chương trình đã xóa)";
