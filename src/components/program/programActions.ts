// Đường dẫn và các thao tác trên một chương trình, dùng ở cả trang danh sách lẫn trang sửa.
import type { ID, Program } from "../../types";
import { navigate } from "../../lib/router";
import { useStore } from "../../lib/store";
import { toast } from "../../ui";

/** Đường dẫn tới trang sửa chương trình, kèm tab nếu cần: "/programs/abc?tab=rules". */
export function programPath(id: ID, tab?: string): string {
  return `/programs/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ""}`;
}

/** Tên để hiện ra màn hình; chương trình đang để trống tên thì hiện chữ thay thế. */
export function programTitle(program: Program): string {
  return program.name.trim() || "(Chưa đặt tên)";
}

/** Ba thao tác trên một chương trình: tạo đơn, nhân bản, xóa. */
export function useProgramActions() {
  const { createOrder, duplicateProgram, deleteProgram, orderCountOf } = useStore();
  return {
    /** Tạo một đơn nháp thuộc chương trình rồi mở đơn đó. */
    createOrderFor(program: Program): void {
      const order = createOrder(program.id);
      navigate(`/orders/${encodeURIComponent(order.id)}`);
    },

    duplicate(program: Program): Program | null {
      const copy = duplicateProgram(program.id);
      if (copy) toast(`Đã nhân bản thành «${copy.name}».`);
      return copy;
    },

    /** Xóa chương trình (hỏi lại trước). Trả về true nếu đã xóa. */
    remove(program: Program): boolean {
      const orderCount = orderCountOf(program.id);
      const refuse = () => {
        toast(
          `Không xóa được: còn ${orderCount} đơn hàng thuộc chương trình này. Hãy xóa các đơn đó trước.`,
          "error",
        );
        return false;
      };
      // Còn đơn hàng thì chắc chắn không xóa được — báo luôn, khỏi hỏi lại.
      if (orderCount > 0) return refuse();
      const question =
        `Xóa chương trình «${programTitle(program)}»?\n\n` +
        "Toàn bộ danh mục sản phẩm và quy tắc khuyến mãi của chương trình sẽ bị xóa, không khôi phục được.";
      if (!window.confirm(question)) return false;
      if (!deleteProgram(program.id)) return refuse();
      toast("Đã xóa chương trình.");
      return true;
    },
  };
}
