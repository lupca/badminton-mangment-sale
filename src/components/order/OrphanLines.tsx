import type { CalcLine } from "../../types";
import { formatNumber } from "../../lib/format";
import { Button, Card, cx, numCls, tableCls, tableWrapCls, tdCls, thCls } from "../../ui";

/** Các dòng của đơn mà mã hàng không còn trong danh mục chọn mua: vẫn được tính tiền, chỉ có thể xóa. */
export function OrphanLines({
  lines,
  disabled,
  onRemove,
}: {
  lines: CalcLine[];
  disabled: boolean;
  onRemove: (line: CalcLine) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <Card title="Hàng không còn trong danh mục">
      <p className="mb-3 text-sm text-gray-600">
        Các dòng dưới đây vẫn được tính vào tổng tiền, nhưng mã hàng không còn trong danh mục bán của chương trình. Hãy
        xóa những dòng không bán nữa.
      </p>
      <div className={tableWrapCls}>
        <table className={tableCls}>
          <thead>
            <tr>
              <th className={thCls}>Mã hàng / Tên hàng</th>
              <th className={cx(thCls, numCls)}>SL</th>
              <th className={cx(thCls, numCls)}>Thành tiền</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.index}>
                <td className={tdCls}>
                  <div className="font-medium">{line.sku}</div>
                  <div className="text-xs text-gray-600">{line.name}</div>
                </td>
                <td className={cx(tdCls, numCls)}>{formatNumber(line.qty)}</td>
                <td className={cx(tdCls, numCls)}>{formatNumber(line.amount)}</td>
                <td className={cx(tdCls, "text-right")}>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={disabled}
                    onClick={() => onRemove(line)}
                    aria-label={`Xóa dòng ${line.sku}`}
                  >
                    Xóa
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
