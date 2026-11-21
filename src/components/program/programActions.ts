// Đường dẫn và các thao tác trên một chương trình, dùng ở cả trang danh sách lẫn trang sửa.
import { useRef, useState } from "react";
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

/**
 * Ba thao tác trên một chương trình: tạo đơn, nhân bản, xóa. Tạo đơn thì vai trò nào cũng được; nhân bản và xóa là
 * việc của người quản lý — màn hình chỉ vẽ hai nút đó khi `canManage(settings.role)`.
 */
export function useProgramActions() {
  const { createOrder, duplicateProgram, deleteProgram, orderCountOf } = useStore();
  // Có máy chủ thì tạo đơn mất một nhịp (chờ máy chủ cấp mã): chặn bấm hai lần và cho nút biết để hiện «Đang tạo…».
  const creating = useRef(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  return {
    /** Đang tạo đơn (chờ máy chủ). */
    creatingOrder,

    /** Tạo một đơn nháp thuộc chương trình rồi mở đơn đó. */
    async createOrderFor(program: Program): Promise<void> {
      if (creating.current) return;
      creating.current = true;
      setCreatingOrder(true);
      try {
        const order = await createOrder(program.id);
        navigate(`/orders/${encodeURIComponent(order.id)}`);
      } catch (error) {
        toast(`Không tạo được đơn: ${error instanceof Error ? error.message : "có lỗi, hãy thử lại."}`, "error");
      } finally {
        creating.current = false;
        setCreatingOrder(false);
      }
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
