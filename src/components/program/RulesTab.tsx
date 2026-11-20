// Tab «Quy tắc khuyến mãi»: mỗi quy tắc một khung, cuối trang là ba lựa chọn để thêm quy tắc.
import { useState } from "react";
import { Plus } from "lucide-react";
import type { ID, Program, RuleType } from "../../types";
import { RULE_TYPE_HINT, RULE_TYPE_LABEL, newRule } from "../../lib/programOps";
import { Notice } from "../../ui";
import RuleCard from "./RuleCard";
import type { UpdateProgram } from "./programEdits";

const RULE_TYPES = Object.keys(RULE_TYPE_LABEL) as RuleType[];
const addChoiceCls =
  "flex cursor-pointer flex-col rounded-lg border border-gray-300 bg-white p-3 text-left " +
  "hover:border-blue-500 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

export default function RulesTab({
  program,
  orderCount,
  update,
}: {
  program: Program;
  orderCount: number;
  update: UpdateProgram;
}) {
  const [newRuleId, setNewRuleId] = useState<ID | null>(null);

  const addRule = (type: RuleType) => {
    const rule = newRule(type, program);
    update((p) => ({ ...p, rules: [...p.rules, rule] }));
    setNewRuleId(rule.id);
  };

  return (
    <div className="space-y-4">
      {orderCount > 0 ? (
        <Notice tone="warning">
          Chương trình đã có {orderCount} đơn hàng. Sửa quy tắc sẽ thay đổi cách tính của các đơn nháp; đơn đã chốt giữ
          nguyên quy tắc lúc chốt.
        </Notice>
      ) : null}

      {program.groups.length === 0 ? (
        <Notice tone="warning">
          Chương trình chưa có danh mục sản phẩm nào. Hãy tạo danh mục ở tab «Danh mục sản phẩm» trước, vì quy tắc nào
          cũng phải chọn danh mục áp dụng.
        </Notice>
      ) : null}

      {program.rules.length === 0 ? (
        <p className="text-sm text-gray-600">
          Chương trình chưa có quy tắc nào, nên đơn hàng mới chỉ được tính theo giá sỉ. Chọn một kiểu quy tắc bên dưới
          để bắt đầu.
        </p>
      ) : null}

      {program.rules.map((rule, index) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          index={index}
          groups={program.groups}
          isNew={rule.id === newRuleId}
          update={update}
        />
      ))}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Thêm quy tắc</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {RULE_TYPES.map((type) => (
            <button key={type} type="button" onClick={() => addRule(type)} className={addChoiceCls}>
              <span className="flex items-center gap-1.5 text-sm font-medium text-blue-700">
                <Plus className="h-4 w-4 shrink-0" /> {RULE_TYPE_LABEL[type]}
              </span>
              <span className="mt-1 block text-sm text-gray-600">{RULE_TYPE_HINT[type]}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
