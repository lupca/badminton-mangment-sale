// Cột "Kết quả": tổng tiền, các thông báo của engine và kết quả từng quy tắc.
import type { ReactNode } from "react";
import type { CalcIssue, CalcResult, Order, ProductGroup, Rule } from "../../types";
import { formatNumber, formatVND } from "../../lib/format";
import { Button, Card, Notice, cx } from "../../ui";
import { RuleBlock } from "./RuleBlocks";
import type { SetGiftQty } from "./RuleBlocks";

export function ResultPanel({
  order,
  groups,
  rules,
  calc,
  disabled,
  action,
  onGiftQty,
  onRemoveOrphanGifts,
}: {
  order: Order;
  /** Mọi danh mục của chương trình. */
  groups: ProductGroup[];
  /** Các quy tắc đang áp cho đơn, cùng thứ tự với calc.rules. */
  rules: Rule[];
  calc: CalcResult;
  disabled: boolean;
  /** Nút hành động đặt ngay dưới tổng tiền (chốt đơn). */
  action?: ReactNode;
  onGiftQty: SetGiftQty;
  onRemoveOrphanGifts: () => void;
}) {
  const orphanGifts = calc.orphanGiftIndexes.map((index) => order.gifts[index]).filter(Boolean);
  const issuesOf = (level: CalcIssue["level"]) => calc.issues.filter((issue) => issue.level === level);

  return (
    <>
      <Card title="Kết quả" className="lg:shrink-0">
        <Totals calc={calc} />
        {action}
      </Card>

      <div className="mt-4 space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {calc.issues.length > 0 ? (
          <div className="space-y-2">
            <IssueList issues={issuesOf("error")} />
            {orphanGifts.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="danger" size="sm" disabled={disabled} onClick={onRemoveOrphanGifts}>
                  Xóa quà không hợp lệ
                </Button>
                <span className="text-xs text-gray-600">
                  {orphanGifts.map((gift) => `${gift.sku} × ${formatNumber(gift.qty)}`).join(", ")}
                </span>
              </div>
            ) : null}
            <IssueList issues={issuesOf("warning")} />
            <IssueList issues={issuesOf("info")} />
          </div>
        ) : null}

        {calc.rules.map((result, i) => {
          const rule = rules[i]?.id === result.ruleId ? rules[i] : rules.find((r) => r.id === result.ruleId);
          return rule ? (
            <RuleBlock
              key={result.ruleId}
              rule={rule}
              result={result}
              groups={groups}
              chosenGifts={order.gifts}
              autoGifts={calc.gifts}
              disabled={disabled}
              onGiftQty={onGiftQty}
            />
          ) : null;
        })}
      </div>
    </>
  );
}

function IssueList({ issues }: { issues: CalcIssue[] }) {
  return (
    <>
      {issues.map((issue, i) => (
        <Notice key={i} tone={issue.level}>
          {issue.message}
        </Notice>
      ))}
    </>
  );
}

function Totals({ calc }: { calc: CalcResult }) {
  return (
    <dl className="space-y-1.5 text-sm">
      <TotalRow label="Số lượng" value={formatNumber(calc.totalQty)} />
      <TotalRow label="Tổng giá lẻ" value={formatVND(calc.totalRetail)} />
      <TotalRow label="Tổng giá sỉ" value={formatVND(calc.totalWholesale)} />
      {calc.discountAmount > 0 ? (
        <TotalRow label="Giảm giá" value={`−${formatVND(calc.discountAmount)}`} valueClassName="text-green-700" />
      ) : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2">
        <dt className="font-semibold text-gray-900">Thanh toán</dt>
        <dd className="text-2xl font-bold tabular-nums text-gray-900">{formatVND(calc.totalAmount)}</dd>
      </div>
      <TotalRow
        label="Quà tặng"
        value={
          calc.giftQty === 0
            ? "Chưa có"
            : `${formatNumber(calc.giftQty)} sản phẩm${calc.giftValue > 0 ? `, trị giá ${formatVND(calc.giftValue)}` : ""}`
        }
        valueClassName={calc.giftQty === 0 ? "text-gray-500" : undefined}
      />
    </dl>
  );
}

function TotalRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-600">{label}</dt>
      <dd className={cx("text-right font-medium tabular-nums", valueClassName)}>{value}</dd>
    </div>
  );
}
