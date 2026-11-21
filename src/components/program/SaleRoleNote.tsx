// Câu nhắc ngắn cho người đang ở vai trò không được sửa chương trình (sale): vai trò này làm được gì, việc tạo / sửa
// chương trình là của ai, và đổi vai trò ở đâu. Chỉ là chữ — nơi dùng tự bọc trong thẻ <p> với cỡ chữ của mình.
import { ROLE_LABEL } from "../../lib/roles";
import { Link } from "../../lib/router";
import { useStore } from "../../lib/store";

export default function SaleRoleNote() {
  const { settings, mode } = useStore();
  // Có máy chủ thì vai trò gắn với tài khoản và do người quản lý đặt — không có chỗ nào để tự đổi.
  if (mode === "cloud") {
    return (
      <>
        Tài khoản của bạn có vai trò {ROLE_LABEL[settings.role]}: xem chương trình và tạo đơn. Tạo, sửa chương trình là
        việc của người quản lý.
      </>
    );
  }
  return (
    <>
      Máy này đang dùng vai trò {ROLE_LABEL[settings.role]}: xem chương trình và tạo đơn. Tạo, sửa chương trình là việc
      của người quản lý; đổi vai trò ở{" "}
      <Link to="/settings" className="whitespace-nowrap text-blue-700 hover:underline">
        mục «Dữ liệu»
      </Link>
      .
    </>
  );
}
