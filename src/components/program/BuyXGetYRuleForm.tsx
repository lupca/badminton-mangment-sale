// Form của quy tắc «Mua X tặng Y».
import type { BuyXGetYRule, ProductGroup } from "../../types";
import { Input, QtyInput } from "../../ui";
import { Choice, GroupChecklist, GroupSelect, Sentence, Slot, legendCls } from "./fields";

export default function BuyXGetYRuleForm({
  rule,
  groups,
  onChange,
}: {
  rule: BuyXGetYRule;
  groups: ProductGroup[];
  onChange: (rule: BuyXGetYRule) => void;
}) {
  const modeName = `${rule.id}-gift-mode`;
  // Rời kiểu «chọn trong danh mục quà» thì bỏ luôn danh mục quà, để quy tắc không còn tham chiếu thừa tới danh mục đó.
  const setMode = (giftMode: BuyXGetYRule["giftMode"]) =>
    onChange({ ...rule, giftMode, giftGroupId: giftMode === "group" ? rule.giftGroupId : null });

  return (
    <div className="space-y-4">
      <div>
        <Sentence>
          <span>Cứ mua</span>
          <Slot>
            <QtyInput
              aria-label="Số lượng mua"
              value={rule.buyQty}
              onChange={(buyQty) => onChange({ ...rule, buyQty })}
            />
          </Slot>
          <span>sản phẩm thuộc:</span>
        </Sentence>
        <GroupChecklist
          label="Danh mục áp dụng"
          className="mt-2"
          groups={groups}
          selected={rule.sourceGroupIds}
          onChange={(sourceGroupIds) => onChange({ ...rule, sourceGroupIds })}
        />
      </div>

      <Sentence>
        <span>được tặng</span>
        <Slot>
          <QtyInput
            aria-label="Số lượng tặng"
            value={rule.getQty}
            onChange={(getQty) => onChange({ ...rule, getQty })}
          />
        </Slot>
        <span>quà.</span>
      </Sentence>

      <fieldset>
        <legend className={legendCls}>Quà tặng là</legend>
        <Choice name={modeName} checked={rule.giftMode === "same"} onSelect={() => setMode("same")}>
          Chính sản phẩm đó (vd mua 1 tặng 1)
        </Choice>

        <Choice name={modeName} checked={rule.giftMode === "group"} onSelect={() => setMode("group")}>
          Chọn trong danh mục quà
        </Choice>
        {rule.giftMode === "group" ? (
          <div className="mb-1 ml-6 max-w-sm">
            <GroupSelect
              aria-label="Danh mục quà"
              groups={groups}
              value={rule.giftGroupId}
              onChange={(giftGroupId) => onChange({ ...rule, giftGroupId })}
            />
          </div>
        ) : null}

        <Choice name={modeName} checked={rule.giftMode === "text"} onSelect={() => setMode("text")}>
          Món quà khác, ghi bằng chữ
        </Choice>
        {rule.giftMode === "text" ? (
          <div className="ml-6 max-w-sm">
            <Input
              aria-label="Tên món quà"
              value={rule.giftText}
              onChange={(e) => onChange({ ...rule, giftText: e.target.value })}
              placeholder="vd Cước N65"
            />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
