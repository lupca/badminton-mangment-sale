// Form của quy tắc «Giảm giá theo số lượng».
import type { DiscountRule, PriceBasis, ProductGroup } from "../../types";
import { formatVND } from "../../lib/format";
import { PRICE_BASIS_LABEL } from "../../lib/programOps";
import { QtyInput, Select } from "../../ui";
import { GroupChecklist, OptionalQtyInput, PercentInput, Sentence, Slot, hintCls } from "./fields";

const EXAMPLE_PRICE = 1_000_000;

export default function DiscountRuleForm({
  rule,
  groups,
  onChange,
}: {
  rule: DiscountRule;
  groups: ProductGroup[];
  onChange: (rule: DiscountRule) => void;
}) {
  const basis = PRICE_BASIS_LABEL[rule.discountBasis];
  const validPercent = rule.discountPercent > 0 && rule.discountPercent <= 100;
  const requireIgnored = rule.requireGroupIds.length > 0 && !(rule.requireMinQty > 0);

  return (
    <div className="space-y-4">
      <div>
        <Sentence>
          <span>Giảm</span>
          <Slot>
            <PercentInput
              aria-label="Phần trăm giảm"
              value={rule.discountPercent}
              onChange={(discountPercent) => onChange({ ...rule, discountPercent })}
            />
          </Slot>
          <span>% trên</span>
          <Slot width="w-28">
            <Select
              aria-label="Giảm trên giá lẻ hay giá sỉ"
              value={rule.discountBasis}
              onChange={(e) => onChange({ ...rule, discountBasis: e.target.value as PriceBasis })}
            >
              <option value="retail">{PRICE_BASIS_LABEL.retail}</option>
              <option value="wholesale">{PRICE_BASIS_LABEL.wholesale}</option>
            </Select>
          </Slot>
          <span>cho danh mục:</span>
        </Sentence>
        <GroupChecklist
          label="Danh mục được giảm giá"
          className="mt-2"
          groups={groups}
          selected={rule.targetGroupIds}
          onChange={(targetGroupIds) => onChange({ ...rule, targetGroupIds })}
        />
        {validPercent ? (
          <p className={hintCls}>
            Ví dụ: sản phẩm có {basis} {formatVND(EXAMPLE_PRICE)} thì đơn giá sau giảm là{" "}
            {formatVND(Math.round(EXAMPLE_PRICE * (1 - rule.discountPercent / 100)))}.
            {rule.discountBasis === "retail"
              ? " Nếu giá sỉ của sản phẩm còn thấp hơn mức này thì đơn vẫn tính theo giá sỉ."
              : ""}
          </p>
        ) : null}
      </div>

      <div>
        <Sentence>
          <span>Điều kiện: tổng số lượng mua ở các danh mục trên từ</span>
          <Slot width="w-32">
            <OptionalQtyInput
              aria-label="Số lượng mua tối thiểu"
              value={rule.minQty}
              onChange={(minQty) => onChange({ ...rule, minQty })}
            />
          </Slot>
          <span>đến</span>
          <Slot width="w-32">
            <OptionalQtyInput
              aria-label="Số lượng mua tối đa"
              value={rule.maxQty}
              onChange={(maxQty) => onChange({ ...rule, maxQty })}
            />
          </Slot>
          <span>sản phẩm.</span>
        </Sentence>
        <p className={hintCls}>
          Để trống ô nào thì không giới hạn phía đó. Để trống cả hai = mua bao nhiêu cũng được giảm.
        </p>
      </div>

      <div>
        <Sentence>
          <span>Phải mua kèm ít nhất</span>
          <Slot>
            <QtyInput
              aria-label="Số lượng phải mua kèm"
              value={rule.requireMinQty}
              onChange={(requireMinQty) => onChange({ ...rule, requireMinQty })}
            />
          </Slot>
          <span>sản phẩm thuộc:</span>
        </Sentence>
        <GroupChecklist
          label="Danh mục phải mua kèm"
          className="mt-2"
          groups={groups}
          selected={rule.requireGroupIds}
          onChange={(requireGroupIds) => onChange({ ...rule, requireGroupIds })}
        />
        <p className={hintCls}>Không tích danh mục nào = không yêu cầu mua kèm.</p>
        {requireIgnored ? (
          <p className="mt-1.5 text-xs text-amber-800">
            Chưa nhập số lượng phải mua kèm nên điều kiện mua kèm chưa có hiệu lực.
          </p>
        ) : null}
      </div>
    </div>
  );
}
