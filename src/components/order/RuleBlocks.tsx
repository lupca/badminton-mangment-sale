// Kết quả của từng quy tắc khuyến mãi trên đơn: mức đạt được, quà được chọn, giảm giá, quà tự động.
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type {
  BuyXGetYResult,
  BuyXGetYRule,
  CalcGift,
  DiscountResult,
  ID,
  OrderGift,
  ProductGroup,
  Rule,
  RuleResult,
  TierGiftResult,
  TierGiftRule,
} from "../../types";
import { formatNumber, formatVND } from "../../lib/format";
import { PRICE_BASIS_LABEL, describeRule, describeTier } from "../../lib/programOps";
import { Badge, Card, cx } from "../../ui";
import { GiftPicker } from "./GiftPicker";
import { buildGiftRows } from "./orderOps";
import type { PricedItem } from "./orderOps";
import type { OrderStockView } from "./stockView";

export type SetGiftQty = (ruleId: ID, groupId: ID, item: PricedItem, qty: number) => void;

interface GiftContext {
  /** Mọi danh mục của chương trình (để tìm danh mục quà). */
  groups: ProductGroup[];
  /** order.gifts */
  chosenGifts: OrderGift[];
  /** Tồn kho hiện cạnh từng quà trong bảng chọn quà; null = không hiện. */
  stockView: OrderStockView | null;
  disabled: boolean;
  onGiftQty: SetGiftQty;
}

export function RuleBlock({
  rule,
  result,
  autoGifts,
  ...context
}: { rule: Rule; result: RuleResult; /** calc.gifts */ autoGifts: CalcGift[] } & GiftContext) {
  let body: ReactNode = null;
  if (result.type === "tier_gift" && rule.type === "tier_gift") {
    body = <TierGiftBlock rule={rule} result={result} {...context} />;
  } else if (result.type === "discount") {
    body = <DiscountBlock result={result} />;
  } else if (result.type === "buy_x_get_y" && rule.type === "buy_x_get_y") {
    body = <BuyXGetYBlock rule={rule} result={result} autoGifts={autoGifts} {...context} />;
  }
  // Với quy tắc theo doanh số, các dòng sau dòng đầu là bậc thang mức — đã hiện ngay bên dưới.
  const description = describeRule(rule, context.groups).slice(0, rule.type === "tier_gift" ? 1 : undefined);
  return (
    <Card title={result.ruleName} bodyClassName="space-y-3">
      <p className="text-xs text-gray-500">{description.join(" ")}</p>
      {body}
    </Card>
  );
}

function TierGiftBlock({
  rule,
  result,
  groups,
  chosenGifts,
  stockView,
  disabled,
  onGiftQty,
}: { rule: TierGiftRule; result: TierGiftResult } & GiftContext) {
  const giftGroup = result.tier ? groups.find((g) => g.id === rule.giftGroupId) : undefined;
  const rows = buildGiftRows(rule, giftGroup, result.allowedSkus, chosenGifts);
  const overQty = result.maxQty != null && result.giftQty > result.maxQty;

  return (
    <>
      <p className="text-sm">
        Doanh số tính mức: <strong className="tabular-nums">{formatVND(result.revenue)}</strong>
      </p>

      <ol className="space-y-1">
        {result.tiers.map((tier, i) => {
          const current = i === result.tierIndex;
          const reached = i <= result.tierIndex;
          return (
            <li
              key={tier.id}
              aria-current={current ? "true" : undefined}
              className={cx(
                "flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm",
                current
                  ? "border-blue-300 bg-blue-50 font-medium text-blue-900"
                  : reached
                    ? "border-transparent text-gray-700"
                    : "border-transparent text-gray-500",
              )}
            >
              {reached ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-label="Đã đạt" />
              ) : (
                <span className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                {describeTier(tier, result.tiers[i + 1] ?? null)}
                {current ? (
                  <>
                    {" "}
                    <Badge tone="blue">Mức hiện tại</Badge>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {result.nextTier ? (
        // Đơn đã chốt thì thôi nhắc «còn thiếu bao nhiêu để lên mức».
        disabled ? null : (
          <p className="text-sm text-gray-800">
            Còn thiếu <strong className="tabular-nums">{formatVND(result.amountToNextTier)}</strong> để{" "}
            {result.tier ? "lên mức kế tiếp" : "đạt mức đầu tiên"}.
          </p>
        )
      ) : result.tier ? (
        <p className="text-sm text-gray-800">Đã đạt mức cao nhất.</p>
      ) : null}

      {result.tier ? (
        <div className="sticky top-0 z-10 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <Figure label="Hạn mức quà" value={formatVND(result.budget)} />
            <Figure label="Đã chọn" value={formatVND(result.used)} />
            <Figure
              label="Còn lại"
              value={formatVND(result.remaining)}
              className={result.remaining < 0 ? "text-red-700" : "text-green-700"}
            />
          </dl>
          {result.maxQty != null ? (
            <p className={cx("mt-1 text-xs", overQty ? "font-medium text-red-700" : "text-gray-600")}>
              Số lượng quà: đã chọn {formatNumber(result.giftQty)} / tối đa {formatNumber(result.maxQty)} sản phẩm
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-gray-500">Chưa đạt mức nào nên chưa được chọn quà.</p>
      )}

      {rows.length > 0 ? (
        <GiftPicker
          heading={
            result.tier
              ? `${disabled ? "Quà đã chọn" : "Chọn quà"} (giá trị tính theo ${PRICE_BASIS_LABEL[rule.giftPriceBasis]})`
              : "Quà đã chọn trước đó"
          }
          rows={rows}
          stockView={stockView}
          disabled={disabled}
          onQty={(row, qty) => onGiftQty(rule.id, row.groupId, row, qty)}
        />
      ) : result.tier ? (
        <p className="text-sm text-gray-500">Danh mục quà của quy tắc này chưa có sản phẩm nào để chọn.</p>
      ) : null}
    </>
  );
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={cx("font-semibold tabular-nums whitespace-nowrap", className)}>{value}</dd>
    </div>
  );
}

function DiscountBlock({ result }: { result: DiscountResult }) {
  // Đủ điều kiện mà không dòng nào thực sự được giảm (engine nói rõ trong `reason`) thì không tô xanh như đã giảm.
  if (!result.eligible || result.savedAmount <= 0) return <p className="text-sm text-gray-500">{result.reason}</p>;
  return (
    <p className="rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-sm text-green-800">
      {result.reason}{" "}
      <strong className="whitespace-nowrap tabular-nums">Tiết kiệm {formatVND(result.savedAmount)}.</strong>
    </p>
  );
}

function BuyXGetYBlock({
  rule,
  result,
  autoGifts,
  groups,
  chosenGifts,
  stockView,
  disabled,
  onGiftQty,
}: { rule: BuyXGetYRule; result: BuyXGetYResult; autoGifts: CalcGift[] } & GiftContext) {
  const summary = (
    <p className="text-sm">
      Đã mua <strong className="tabular-nums">{formatNumber(result.sourceQty)}</strong> → được tặng{" "}
      <strong className="tabular-nums">{formatNumber(result.entitledQty)}</strong>
    </p>
  );

  if (result.giftMode !== "group") {
    const gifts = autoGifts.filter((gift) => gift.ruleId === result.ruleId);
    return (
      <>
        {summary}
        {gifts.length > 0 ? (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
            {gifts.map((gift, i) => (
              <li key={`${gift.sku} ${i}`} className="flex items-start justify-between gap-3 px-2 py-1.5">
                <span className="min-w-0">
                  {gift.sku ? <span className="font-medium">{gift.sku} </span> : null}
                  {gift.name}
                </span>
                <strong className="whitespace-nowrap tabular-nums">× {formatNumber(gift.qty)}</strong>
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }

  const giftGroup = result.entitledQty > 0 ? groups.find((g) => g.id === rule.giftGroupId) : undefined;
  const rows = buildGiftRows(rule, giftGroup, null, chosenGifts);
  const over = result.chosenQty > result.entitledQty;
  return (
    <>
      {summary}
      {rows.length > 0 ? (
        <GiftPicker
          heading={
            <span className="flex items-baseline justify-between gap-2">
              {result.entitledQty === 0 ? "Quà đã chọn trước đó" : disabled ? "Quà đã chọn" : "Chọn quà"}
              <span className={cx("tabular-nums", over ? "text-red-700" : "text-gray-700")}>
                Đã chọn {formatNumber(result.chosenQty)} / {formatNumber(result.entitledQty)}
              </span>
            </span>
          }
          rows={rows}
          stockView={stockView}
          disabled={disabled}
          onQty={(row, qty) => onGiftQty(rule.id, row.groupId, row, qty)}
        />
      ) : result.entitledQty > 0 ? (
        <p className="text-sm text-gray-500">Danh mục quà của quy tắc này chưa có sản phẩm nào để chọn.</p>
      ) : null}
    </>
  );
}
