// Form của quy tắc «Mua X tặng Y».
import type { BuyXGetYRule, ProductGroup } from "../../types";
import { Input, MoneyInput, QtyInput } from "../../ui";
import {
  Choice,
  GroupChecklist,
  GroupSelect,
  Sentence,
  Slot,
  legendCls,
} from "./fields";

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
    onChange({
      ...rule,
      giftMode,
      giftGroupId: giftMode === "group" ? rule.giftGroupId : null,
    });

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
        <Choice
          name={modeName}
          checked={rule.giftMode === "same"}
          onSelect={() => setMode("same")}
        >
          Chính sản phẩm đó (vd mua 1 tặng 1)
        </Choice>

        <Choice
          name={modeName}
          checked={rule.giftMode === "group"}
          onSelect={() => setMode("group")}
        >
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

        <Choice
          name={modeName}
          checked={rule.giftMode === "text"}
          onSelect={() => setMode("text")}
        >
          Món quà khác, ghi bằng chữ
        </Choice>
        {rule.giftMode === "text" ? (
          <div className="ml-6 grid max-w-lg gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500">
                Tên món quà
              </span>
              <Input
                aria-label="Tên món quà"
                value={rule.giftText}
                onChange={(e) =>
                  onChange({ ...rule, giftText: e.target.value })
                }
                placeholder="vd Cước N65"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500">
                Giá trị 1 món (đ)
              </span>
              <MoneyInput
                aria-label="Giá trị 1 món quà (đ)"
                title="Để tính vào tổng giá trị quà; để trống nếu không cần"
                placeholder="Không bắt buộc"
                value={rule.giftTextValue ?? 0}
                onChange={(value) => {
                  const { giftTextValue: _old, ...rest } = rule;
                  onChange(
                    value > 0 ? { ...rest, giftTextValue: value } : rest,
                  );
                }}
              />
            </label>
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
