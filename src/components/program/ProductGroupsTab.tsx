// Tab «Danh mục sản phẩm»: mỗi danh mục một khung, cuối trang là nút thêm danh mục.
import { useState } from "react";
import { Plus } from "lucide-react";
import type { ID, Program } from "../../types";
import { newGroup, ruleGroupIds } from "../../lib/programOps";
import { useStore } from "../../lib/store";
import { Button, EmptyState } from "../../ui";
import ProductGroupCard from "./ProductGroupCard";
import type { UpdateProgram } from "./programEdits";

export default function ProductGroupsTab({ program, update }: { program: Program; update: UpdateProgram }) {
  const { orders } = useStore();
  const [newGroupId, setNewGroupId] = useState<ID | null>(null);

  const addGroup = () => {
    const group = newGroup("Danh mục mới");
    update((p) => ({ ...p, groups: [...p.groups, group] }));
    setNewGroupId(group.id);
  };

  const rulesUsing = (groupId: ID) => program.rules.filter((rule) => ruleGroupIds(rule).includes(groupId)).length;
  const ordersUsing = (groupId: ID) =>
    orders.filter(
      (order) =>
        order.programId === program.id && [...order.lines, ...order.gifts].some((row) => row.groupId === groupId),
    ).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Mỗi danh mục là một bảng giá riêng, vd «Danh mục áp dụng» và «Danh mục hàng tặng». Quy tắc khuyến mãi sẽ chọn
        danh mục nào được tính doanh số, danh mục nào là quà.
      </p>

      {program.groups.length === 0 ? (
        <EmptyState
          title="Chương trình chưa có danh mục nào"
          hint="Bấm «Thêm danh mục», đặt tên rồi nhập sản phẩm từ Excel."
        />
      ) : null}

      {program.groups.map((group) => (
        <ProductGroupCard
          key={group.id}
          group={group}
          programName={program.name}
          ruleCount={rulesUsing(group.id)}
          orderCount={ordersUsing(group.id)}
          isNew={group.id === newGroupId}
          update={update}
        />
      ))}

      <Button onClick={addGroup}>
        <Plus className="h-4 w-4" /> Thêm danh mục
      </Button>
    </div>
  );
}
