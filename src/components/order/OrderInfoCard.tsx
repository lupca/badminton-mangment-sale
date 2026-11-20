import { useId } from "react";
import type { Order } from "../../types";
import { Button, Card, Field, Input, Textarea } from "../../ui";

export type OrderInfo = Pick<Order, "customerName" | "customerPhone" | "salesperson" | "salespersonPhone" | "note">;

// Khung đổi dạng theo bề rộng của chính nó (container query), vì nó hẹp cả trên điện thoại lẫn khi đứng cạnh cột kết quả:
//  • hẹp (điện thoại): đại lý và điện thoại đại lý mỗi ô một dòng, tên sale + điện thoại sale chung một dòng;
//  • từ @lg: hai dòng thẳng cột — đại lý | điện thoại đại lý, rồi sale | điện thoại sale;
//  • từ 45rem: cả bốn ô trên một dòng.
// Ghi chú luôn nằm riêng một dòng ở dưới cùng.
export function OrderInfoCard({
  order,
  customerNames,
  disabled,
  onChange,
  onSaveSaleProfile,
}: {
  order: Order;
  /** Tên đại lý ở các đơn khác, để gợi ý khi gõ. */
  customerNames: string[];
  disabled: boolean;
  onChange: (patch: Partial<OrderInfo>) => void;
  /** Có thì hiện nút lưu tên + điện thoại sale đang ghi trên đơn để tự điền vào các đơn sau. */
  onSaveSaleProfile?: () => void;
}) {
  const listId = useId();
  return (
    <Card title="Thông tin đơn" bodyClassName="@container">
      <div className="grid gap-3 @lg:grid-cols-[3fr_2fr] @[45rem]:grid-cols-[3fr_2fr_2fr_2fr]">
        <Field label="Đại lý">
          <Input
            list={listId}
            autoComplete="off"
            value={order.customerName}
            onChange={(e) => onChange({ customerName: e.target.value })}
            disabled={disabled}
          />
        </Field>
        <Field label="Điện thoại đại lý">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={order.customerPhone}
            onChange={(e) => onChange({ customerPhone: e.target.value })}
            disabled={disabled}
          />
        </Field>
        {/* Tên và điện thoại sale đi liền nhau; các cột bên trong trùng với cột của lưới ngoài nên vẫn thẳng hàng. */}
        <div className="grid grid-cols-2 gap-3 @lg:col-span-2 @lg:grid-cols-[3fr_2fr] @[45rem]:grid-cols-2">
          <Field label="Sale">
            <Input
              autoComplete="off"
              value={order.salesperson}
              onChange={(e) => onChange({ salesperson: e.target.value })}
              disabled={disabled}
            />
          </Field>
          <Field label="Điện thoại sale">
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={order.salespersonPhone}
              onChange={(e) => onChange({ salespersonPhone: e.target.value })}
              disabled={disabled}
            />
          </Field>
          {onSaveSaleProfile ? (
            <div className="col-span-2 -mt-1">
              <Button size="sm" onClick={onSaveSaleProfile}>
                Dùng tên này cho các đơn sau
              </Button>
            </div>
          ) : null}
        </div>
        <Field label="Ghi chú" className="@lg:col-span-2 @[45rem]:col-span-4">
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
