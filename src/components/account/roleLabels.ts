// Tên gọi, màu nhãn và mô tả của bốn trạng thái tài khoản trên máy chủ.
import type { AccountRole } from "../../lib/cloud/auth";
import { ROLE_HINT, ROLE_LABEL } from "../../lib/roles";

export const ACCOUNT_ROLE_LABEL: Record<AccountRole, string> = {
  pending: "Chờ duyệt",
  sale: ROLE_LABEL.sale,
  manager: ROLE_LABEL.manager,
  locked: "Đã khóa",
};

/** Màu của nhãn (`Badge`) cho từng trạng thái. */
export const ACCOUNT_ROLE_TONE: Record<AccountRole, "amber" | "gray" | "blue" | "red"> = {
  pending: "amber",
  sale: "gray",
  manager: "blue",
  locked: "red",
};

/** Một dòng: tài khoản ở trạng thái này làm được gì. */
export const ACCOUNT_ROLE_HINT: Record<AccountRole, string> = {
  pending: "Chưa dùng được hệ thống cho tới khi người quản lý duyệt.",
  sale: ROLE_HINT.sale,
  manager: ROLE_HINT.manager,
  locked: "Không dùng được hệ thống cho tới khi người quản lý mở khóa.",
};
