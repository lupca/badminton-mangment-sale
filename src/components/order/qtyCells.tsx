// Ô số lượng trong các bảng nhập liệu và việc di chuyển giữa chúng bằng bàn phím.
import type { ComponentProps, KeyboardEvent } from "react";
import { QtyInput, cx } from "../../ui";

const CELL_SELECTOR = "input[data-qty-cell]:not(:disabled)";

/**
 * Ô số lượng của một dòng trong bảng. Rộng cố định bằng min/max-width để cột không co lại trong bảng;
 * lề cuộn chừa chỗ cho thanh tìm dính phía trên và thanh tổng tiền phía dưới.
 */
export function QtyCell({ className, ...rest }: ComponentProps<typeof QtyInput>) {
  return (
    <QtyInput
      data-qty-cell=""
      enterKeyHint="next"
      className={cx("max-w-16 min-w-16 scroll-mt-24 scroll-mb-32", className)}
      {...rest}
    />
  );
}

function focusCell(cell: HTMLInputElement): void {
  cell.focus({ preventScroll: true });
  cell.scrollIntoView({ block: "nearest" });
}

/** Đưa con trỏ vào ô số lượng đầu tiên trong `container`. */
export function focusFirstQtyCell(container: HTMLElement | null): void {
  const cell = container?.querySelector<HTMLInputElement>(CELL_SELECTOR);
  if (cell) focusCell(cell);
}

/**
 * Gắn vào onKeyDown của phần tử bọc bảng: Enter / ↓ sang ô số lượng của dòng dưới, ↑ lên dòng trên.
 * Trả về "top" / "bottom" khi đang ở dòng đầu / cuối (không còn ô để chuyển tới), null nếu phím không liên quan.
 */
export function moveQtyFocus(event: KeyboardEvent<HTMLElement>): "moved" | "top" | "bottom" | null {
  const { key, target } = event;
  if (key !== "Enter" && key !== "ArrowDown" && key !== "ArrowUp") return null;
  if (event.nativeEvent.isComposing || !(target instanceof HTMLInputElement) || !target.matches(CELL_SELECTOR)) return null;
  event.preventDefault();
  const cells = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>(CELL_SELECTOR));
  const next = cells[cells.indexOf(target) + (key === "ArrowUp" ? -1 : 1)];
  if (!next) return key === "ArrowUp" ? "top" : "bottom";
  focusCell(next);
  return "moved";
}
