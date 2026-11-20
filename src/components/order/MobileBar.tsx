// Thanh cố định dưới đáy màn hình điện thoại: luôn thấy số tiền phải thanh toán, tình trạng khuyến mãi và cảnh báo tồn kho.
import type { CalcResult } from "../../types";
import { formatNumber, formatVND } from "../../lib/format";
import { Button, cx } from "../../ui";
import { stockWarningSummary } from "./stockView";
import type { StockWarning } from "./stockView";

type StatusTone = "error" | "warning" | "normal" | "muted";

const TONE_CLS: Record<StatusTone, string> = {
  error: "font-medium text-red-700",
  warning: "text-amber-800",
  normal: "text-gray-700",
  muted: "text-gray-500",
};

/** Tình trạng khuyến mãi của đơn, gói trong một dòng. */
function promoStatus(calc: CalcResult): { tone: StatusTone; text: string } {
  const errors = calc.issues.filter((issue) => issue.level === "error").length;
  if (errors > 0) return { tone: "error", text: `Có ${errors} lỗi cần sửa — xem kết quả` };
  if (calc.totalQty === 0) return { tone: "muted", text: "Chưa nhập hàng" };

  const parts: string[] = [];
  let giftsPending = false;
  for (const result of calc.rules) {
    if (result.type === "tier_gift") {
      if (result.tier) {
        parts.push(`Đạt mức ${formatVND(result.tier.min)}`);
        if (result.nextTier) parts.push(`thiếu ${formatVND(result.amountToNextTier)} lên mức kế tiếp`);
        if (result.giftQty === 0 && result.budget > 0) {
          parts.push("chưa chọn quà");
          giftsPending = true;
        }
      } else if (result.nextTier && result.revenue > 0) {
        parts.push(`Thiếu ${formatVND(result.amountToNextTier)} để đạt mức ${formatVND(result.nextTier.min)}`);
      }
    } else if (result.type === "discount") {
      if (result.eligible && result.savedAmount > 0) parts.push(`Giảm ${formatVND(result.savedAmount)}`);
    } else if (result.entitledQty > 0) {
      parts.push(`Tặng ${formatNumber(result.entitledQty)} quà`);
      if (result.giftMode === "group" && result.remainingQty > 0) {
        parts.push(`còn chọn ${formatNumber(result.remainingQty)} quà`);
        giftsPending = true;
      }
    }
  }
  if (parts.length === 0) return { tone: "muted", text: "Chưa đạt khuyến mãi nào" };
  return { tone: giftsPending ? "warning" : "normal", text: parts.join(" · ") };
}

export function MobileBar({
  calc,
  stockWarnings,
  atResult,
  onToggle,
}: {
  calc: CalcResult;
  /** Các mã mà kho không đủ cho đơn này (rỗng = không có gì để báo). */
  stockWarnings: StockWarning[];
  /** Phần kết quả đang nằm trong màn hình. */
  atResult: boolean;
  onToggle: () => void;
}) {
  const status = promoStatus(calc);
  const stockWarning = stockWarningSummary(stockWarnings);
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-300 bg-white px-4 py-2 lg:hidden print:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-gray-500">Thanh toán</div>
          <div className="text-lg leading-tight font-bold tabular-nums text-gray-900">{formatVND(calc.totalAmount)}</div>
        </div>
        <Button onClick={onToggle}>{atResult ? "Về chọn hàng" : "Xem kết quả"}</Button>
      </div>
      <p className={cx("mt-0.5 line-clamp-2 text-xs", TONE_CLS[status.tone])}>{status.text}</p>
      {/* Thêm đúng một dòng, chi tiết từng mã nằm ở phần kết quả. */}
      {stockWarning ? <p className="mt-0.5 truncate text-xs font-medium text-amber-800">{stockWarning}</p> : null}
    </div>
  );
}
