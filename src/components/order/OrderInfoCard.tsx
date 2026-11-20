import { useId } from "react";
import type { Order } from "../../types";
import { Card, Field, Input, Textarea } from "../../ui";

export type OrderInfo = Pick<Order, "customerName" | "customerPhone" | "salesperson" | "note">;

export function OrderInfoCard({
  order,
  customerNames,
  disabled,
  onChange,
}: {
  order: Order;
  /** Tên đại lý ở các đơn khác, để gợi ý khi gõ. */
  customerNames: string[];
  disabled: boolean;
  onChange: (patch: Partial<OrderInfo>) => void;
}) {
  const listId = useId();
  return (
    <Card title="Thông tin đơn">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr] xl:grid-cols-[3fr_2fr_2fr_3fr]">
        <Field label="Đại lý" className="col-span-2 sm:col-span-1">
          <Input
            list={listId}
            autoComplete="off"
            value={order.customerName}
            onChange={(e) => onChange({ customerName: e.target.value })}
            disabled={disabled}
          />
        </Field>
        <Field label="Số điện thoại">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={order.customerPhone}
            onChange={(e) => onChange({ customerPhone: e.target.value })}
            disabled={disabled}
          />
        </Field>
        <Field label="Sale">
          <Input
            autoComplete="off"
            value={order.salesperson}
            onChange={(e) => onChange({ salesperson: e.target.value })}
            disabled={disabled}
          />
        </Field>
        <Field label="Ghi chú" className="col-span-2 sm:col-span-3 xl:col-span-1">
          {/* Một dòng cho gọn; trình duyệt hỗ trợ field-sizing sẽ tự cao thêm khi ghi chú dài. */}
          <Textarea
            rows={1}
            className="[field-sizing:content]"
            value={order.note}
            onChange={(e) => onChange({ note: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>
      <datalist id={listId}>
        {customerNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </Card>
  );
}
