// Form của quy tắc «Đạt doanh số → tặng hàng».
import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { GiftTier, ID, ProductGroup, TierGiftRule } from "../../types";
import { formatVND } from "../../lib/format";
import { newTier } from "../../lib/programOps";
import { Button, Field, MoneyInput, Select, cx, tableCls, tableWrapCls, tdCls, thCls } from "../../ui";
import TierSkuDialog from "./TierSkuDialog";
import {
  Choice,
  GroupChecklist,
  GroupSelect,
  OptionalQtyInput,
  PercentInput,
  Slot,
  hintCls,
  legendCls,
} from "./fields";

const COLUMNS = {
  min: "Doanh số từ (đ)",
  limit: "Hạn mức quà",
  maxQty: "Số quà tối đa",
  skus: "Mã quà được chọn",
};

// Màn hình hẹp không đủ chỗ cho cả bảng mức, nên ở đó mỗi mức (dòng) xếp thành một khối, các ô nối nhau như chữ
// và từng ô tự hiện tên cột của mình.
const stackedRowCls = "max-lg:block max-lg:border-b max-lg:border-gray-100 max-lg:px-3 max-lg:pt-3 max-lg:pb-1";
const stackedCellCls = "max-lg:inline-block max-lg:border-0 max-lg:p-0 max-lg:pr-3 max-lg:pb-2 max-lg:align-bottom";

function TierCell({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <td className={cx(tdCls, stackedCellCls)}>
      {label ? <span className="mb-1 block text-xs font-medium text-gray-600 lg:hidden">{label}</span> : null}
      {children}
    </td>
  );
}

function TierRow({
  tier,
  giftGroup,
  autoFocus,
  onChange,
  onPickSkus,
  onRemove,
}: {
  tier: GiftTier;
  giftGroup: ProductGroup | null;
  autoFocus: boolean;
  onChange: (patch: Partial<GiftTier>) => void;
  onPickSkus: () => void;
  onRemove: () => void;
}) {
  const skuLabel = tier.allowedSkus ? `${tier.allowedSkus.length} mã` : "Tất cả";
  return (
    <tr className={stackedRowCls}>
      <TierCell label={COLUMNS.min}>
        <Slot width="w-36">
          <MoneyInput
            aria-label={COLUMNS.min}
            autoFocus={autoFocus}
            value={tier.min}
            onChange={(min) => onChange({ min })}
          />
        </Slot>
      </TierCell>
      <TierCell label={COLUMNS.limit}>
        <span className="flex gap-2">
          <Slot width="w-40">
            <Select
              aria-label="Kiểu hạn mức quà"
              value={tier.limitType}
              // Con số cũ không còn nghĩa khi đổi giữa «số tiền» và «%», nên xóa để nhập lại.
              onChange={(e) => onChange({ limitType: e.target.value as GiftTier["limitType"], limitValue: 0 })}
            >
              <option value="amount">Số tiền (đ)</option>
              <option value="percent">% doanh số</option>
            </Select>
          </Slot>
          <Slot width="w-28">
            {tier.limitType === "amount" ? (
              <MoneyInput
                aria-label="Hạn mức quà (đ)"
                value={tier.limitValue}
                onChange={(limitValue) => onChange({ limitValue })}
              />
            ) : (
              <PercentInput
                aria-label="Hạn mức quà (% doanh số)"
                value={tier.limitValue}
                onChange={(limitValue) => onChange({ limitValue })}
              />
            )}
          </Slot>
        </span>
      </TierCell>
      <TierCell label={COLUMNS.maxQty}>
        <Slot width="w-32">
          <OptionalQtyInput
            aria-label={COLUMNS.maxQty}
            value={tier.maxQty}
            onChange={(maxQty) => onChange({ maxQty })}
          />
        </Slot>
      </TierCell>
      <TierCell label={COLUMNS.skus}>
        <Button
          onClick={onPickSkus}
          disabled={!giftGroup}
          title={giftGroup ? undefined : "Hãy chọn danh mục quà trước"}
          aria-label={`${COLUMNS.skus}: ${skuLabel}`}
        >
          {skuLabel}
        </Button>
      </TierCell>
      <TierCell>
        <Button variant="danger" onClick={onRemove}>
          Xóa mức
        </Button>
      </TierCell>
    </tr>
  );
}

export default function TierGiftRuleForm({
  rule,
  groups,
  onChange,
}: {
  rule: TierGiftRule;
  groups: ProductGroup[];
  onChange: (rule: TierGiftRule) => void;
}) {
  const [skuTierId, setSkuTierId] = useState<ID | null>(null); // mức đang mở hộp chọn mã quà
  const [newTierId, setNewTierId] = useState<ID | null>(null); // mức vừa thêm — đưa con trỏ vào dòng đó
  const giftGroup = groups.find((group) => group.id === rule.giftGroupId) ?? null;
  const skuTier = rule.tiers.find((tier) => tier.id === skuTierId);

  const changeTier = (id: ID, patch: Partial<GiftTier>) =>
    onChange({ ...rule, tiers: rule.tiers.map((tier) => (tier.id === id ? { ...tier, ...patch } : tier)) });

  const addTier = () => {
    // Mức mới dùng cùng kiểu hạn mức (số tiền / %) với mức ngay trước nó.
    const tier: GiftTier = { ...newTier(), limitType: rule.tiers.at(-1)?.limitType ?? "amount" };
    onChange({ ...rule, tiers: [...rule.tiers, tier] });
    setNewTierId(tier.id);
  };

  const removeTier = (tier: GiftTier) => {
    const blank = !tier.min && !tier.limitValue && tier.maxQty == null && !tier.allowedSkus;
    if (!blank && !window.confirm(`Xóa mức doanh số từ ${formatVND(tier.min)}?`)) return;
    onChange({ ...rule, tiers: rule.tiers.filter((t) => t.id !== tier.id) });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className={legendCls}>Doanh số tính từ danh mục</p>
          <GroupChecklist
            label="Doanh số tính từ danh mục"
            groups={groups}
            selected={rule.sourceGroupIds}
            onChange={(sourceGroupIds) => onChange({ ...rule, sourceGroupIds })}
          />
          <p className={hintCls}>
            Doanh số = thành tiền (sau giảm giá, nếu có) của các sản phẩm thuộc danh mục được tích.
          </p>
        </div>

        <Field label="Quà chọn trong danh mục" hint="Khi lên đơn, sale chọn quà trong danh mục này.">
          <GroupSelect
            groups={groups}
            value={rule.giftGroupId}
            onChange={(giftGroupId) => onChange({ ...rule, giftGroupId })}
          />
        </Field>

        <fieldset>
          <legend className={legendCls}>Giá trị quà tính theo</legend>
          <Choice
            name={`${rule.id}-gift-basis`}
            checked={rule.giftPriceBasis === "retail"}
            onSelect={() => onChange({ ...rule, giftPriceBasis: "retail" })}
          >
            Giá lẻ
          </Choice>
          <Choice
            name={`${rule.id}-gift-basis`}
            checked={rule.giftPriceBasis === "wholesale"}
            onSelect={() => onChange({ ...rule, giftPriceBasis: "wholesale" })}
          >
            Giá sỉ
          </Choice>
          <p className={hintCls}>Giá trị các món quà được cộng theo giá này rồi so với hạn mức quà.</p>
        </fieldset>
      </div>

      <div>
        <p className={legendCls}>Các mức doanh số</p>
        {rule.tiers.length > 0 ? (
          <div className={tableWrapCls}>
            <table className={cx(tableCls, "max-lg:block")}>
              <thead className="max-lg:hidden">
                <tr>
                  <th className={thCls}>{COLUMNS.min}</th>
                  <th className={thCls}>{COLUMNS.limit}</th>
                  <th className={thCls}>{COLUMNS.maxQty}</th>
                  <th className={thCls}>{COLUMNS.skus}</th>
                  <th className={thCls} aria-label="Xóa mức" />
                </tr>
              </thead>
              <tbody className="max-lg:block">
                {rule.tiers.map((tier) => (
                  <TierRow
                    key={tier.id}
                    tier={tier}
                    giftGroup={giftGroup}
                    autoFocus={tier.id === newTierId}
                    onChange={(patch) => changeTier(tier.id, patch)}
                    onPickSkus={() => setSkuTierId(tier.id)}
                    onRemove={() => removeTier(tier)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <Button className="mt-2" onClick={addTier}>
          <Plus className="h-4 w-4" /> Thêm mức
        </Button>
        <p className={hintCls}>
          Đơn đạt mức nào (mức cao nhất mà doanh số chạm tới) thì tổng giá trị quà được chọn không vượt hạn mức của mức
          đó. «Số quà tối đa» để trống = không giới hạn số lượng. «Mã quà được chọn» là «Tất cả» = chọn được mọi mã
          trong danh mục quà.
        </p>
      </div>

      {skuTier && giftGroup ? (
        <TierSkuDialog
          tier={skuTier}
          giftGroup={giftGroup}
          priceBasis={rule.giftPriceBasis}
          onChange={(allowedSkus) => changeTier(skuTier.id, { allowedSkus })}
          onClose={() => setSkuTierId(null)}
        />
      ) : null}
    </div>
  );
}
