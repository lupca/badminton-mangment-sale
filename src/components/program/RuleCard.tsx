// Một quy tắc khuyến mãi: tên, form theo kiểu quy tắc, phần tóm tắt và các lỗi cấu hình.
import { Trash2 } from "lucide-react";
import type { ProductGroup, Rule } from "../../types";
import { RULE_TYPE_LABEL, describeRule, validateRule } from "../../lib/programOps";
import { Badge, Button, Card, Field, Notice, toast } from "../../ui";
import BuyXGetYRuleForm from "./BuyXGetYRuleForm";
import DiscountRuleForm from "./DiscountRuleForm";
import TierGiftRuleForm from "./TierGiftRuleForm";
import { NameInput, legendCls } from "./fields";
import { replaceRule, type UpdateProgram } from "./programEdits";

export default function RuleCard({
  rule,
  index,
  groups,
  isNew,
  update,
}: {
  rule: Rule;
  index: number;
  groups: ProductGroup[];
  /** Quy tắc vừa được thêm: đưa con trỏ vào ô tên. */
  isNew: boolean;
  update: UpdateProgram;
}) {
  const change = (next: Rule) => update((p) => replaceRule(p, next));
  const remove = () => {
    if (!window.confirm(`Xóa quy tắc «${rule.name}»? Không khôi phục được.`)) return;
    update((p) => ({ ...p, rules: p.rules.filter((r) => r.id !== rule.id) }));
    toast("Đã xóa quy tắc.");
  };

  const [headline, ...details] = describeRule(rule, groups);
  const problems = validateRule(rule, groups);

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          Quy tắc {index + 1} <Badge tone="blue">{RULE_TYPE_LABEL[rule.type]}</Badge>
          {problems.length > 0 ? <Badge tone="amber">Chưa hoàn chỉnh</Badge> : null}
        </span>
      }
      actions={
        <Button size="sm" variant="danger" onClick={remove}>
          <Trash2 className="h-3.5 w-3.5" /> Xóa quy tắc
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Tên quy tắc" hint="Tên này hiện trên đơn hàng." className="sm:max-w-md">
          <NameInput value={rule.name} onChange={(name) => change({ ...rule, name })} selectOnMount={isNew} />
        </Field>

        {rule.type === "tier_gift" ? (
          <TierGiftRuleForm rule={rule} groups={groups} onChange={change} />
        ) : rule.type === "discount" ? (
          <DiscountRuleForm rule={rule} groups={groups} onChange={change} />
        ) : (
          <BuyXGetYRuleForm rule={rule} groups={groups} onChange={change} />
        )}

        <div>
          <p className={legendCls}>Tóm tắt</p>
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
            <p>{headline}</p>
            {details.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {details.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        {problems.length > 0 ? (
          <Notice tone="warning">
            <p className="font-medium">Quy tắc chưa hoàn chỉnh, cần sửa:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}
