// Vai trò và quyền trên màn hình. Các màn hình hỏi quyền qua `canManage(settings.role)`; `settings.role` đến từ:
//   • tài khoản đang đăng nhập, khi chạy với máy chủ (máy chủ còn tự kiểm tra lại mọi thao tác ghi);
//   • thiết lập của từng máy, khi chạy không có máy chủ.
import type { Role } from "../types";

export const ROLE_LABEL: Record<Role, string> = { manager: "Quản lý", sale: "Sale" };

/** Mô tả ngắn quyền của từng vai trò. */
export const ROLE_HINT: Record<Role, string> = {
  manager: "Tạo và sửa chương trình khuyến mãi, cập nhật tồn kho, quản trị dữ liệu, và tạo đơn.",
  sale: "Xem chương trình, sản phẩm và tồn kho; tạo và chốt đơn. Không tạo hay sửa chương trình.",
};

/** Vai trò này có được tạo / sửa chương trình, cập nhật tồn kho và quản trị dữ liệu không. Tạo đơn thì vai trò nào cũng được. */
export function canManage(role: Role): boolean {
  return role === "manager";
}
