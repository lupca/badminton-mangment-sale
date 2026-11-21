// Một danh mục sản phẩm của chương trình: tên, các nút nhập / xuất, bảng sản phẩm.
import { memo, useCallback, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import type { ProductGroup, ProductItem } from "../../types";
import { formatVND, normalizeSku } from "../../lib/format";
import { mergeItems, removeGroup } from "../../lib/programOps";
import { Button, Card, Field, cx, numCls, tableCls, tableWrapCls, tdCls, thCls, toast } from "../../ui";
import ImportProductsDialog from "../ImportProductsDialog";
import ProductItemDialog from "./ProductItemDialog";
import { NameInput } from "./fields";
import { ItemsBrowser, exportGroupExcel, useItemsView } from "./groupItems";
import { replaceItem, updateGroup, type UpdateProgram } from "./programEdits";

/** Bảng sản phẩm chỉ có chữ. Được memo để gõ ở ô khác (vd tên danh mục) không phải vẽ lại hàng trăm dòng. */
const ItemsTable = memo(function ItemsTable({
  items,
  onEdit,
  onDelete,
}: {
  items: ProductItem[];
  onEdit: (item: ProductItem) => void;
  onDelete: (item: ProductItem) => void;
}) {
  return (
    <div className={tableWrapCls}>
      <table className={tableCls}>
        <thead>
          <tr>
            <th className={cx(thCls, "max-sm:hidden")}>Mã hàng</th>
            <th className={thCls}>Tên hàng</th>
            <th className={cx(thCls, numCls, "max-sm:hidden")}>Giá lẻ</th>
            <th className={cx(thCls, numCls, "max-sm:hidden")}>Giá sỉ</th>
            <th className={cx(thCls, "max-sm:hidden")}>Ghi chú</th>
            <th className={thCls} aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {/* key theo vị trí: dòng không có trạng thái riêng, và dữ liệu nhập từ file có thể trùng mã */}
          {items.map((item, index) => (
            <tr key={index} className="hover:bg-gray-50">
              <td className={cx(tdCls, "whitespace-nowrap font-medium max-sm:hidden")}>{item.sku}</td>
              <td className={cx(tdCls, "sm:min-w-48")}>
                {/* Điện thoại: gộp mã, tên, giá vào một ô để không phải kéo ngang mới thấy giá. */}
                <span className="block text-xs font-medium text-gray-900 sm:hidden">{item.sku}</span>
                {item.name}
                <span className="mt-0.5 block text-xs tabular-nums text-gray-600 sm:hidden">
                  Lẻ {formatVND(item.retailPrice)} · Sỉ {formatVND(item.wholesalePrice)}
                </span>
                {item.note ? <span className="block text-xs text-gray-500 sm:hidden">{item.note}</span> : null}
              </td>
              <td className={cx(tdCls, numCls, "max-sm:hidden")}>{formatVND(item.retailPrice)}</td>
              <td className={cx(tdCls, numCls, "max-sm:hidden")}>{formatVND(item.wholesalePrice)}</td>
              <td className={cx(tdCls, "text-gray-600 max-sm:hidden")}>{item.note}</td>
              <td className={tdCls}>
                <div className="flex justify-end gap-1.5 max-sm:flex-col">
                  <Button size="sm" onClick={() => onEdit(item)}>
                    Sửa
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDelete(item)}>
                    Xóa
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

function ProductGroupCard({
  group,
  programName,
  ruleCount,
  orderCount,
  isNew,
  update,
  saveStock,
}: {
  group: ProductGroup;
  programName: string;
  /** Số quy tắc và số đơn hàng đang dùng danh mục này — để cảnh báo khi xóa. */
  ruleCount: number;
  orderCount: number;
  /** Danh mục vừa được thêm: đưa con trỏ vào ô tên. */
  isNew: boolean;
  update: UpdateProgram;
  /** Ghi tồn kho đọc được từ cột «Tồn kho» của file vừa nhập (mã hàng → số lượng). */
  saveStock: (stock: Record<string, number>) => void;
}) {
  const { id, items } = group;
  const view = useItemsView(items);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<ProductItem | "new" | null>(null);

  const importItems = (incoming: ProductItem[], mode: "append" | "replace", stock: Record<string, number>) => {
    update((p) =>
      updateGroup(p, id, (g) => ({ ...g, items: mode === "replace" ? incoming : mergeItems(g.items, incoming) })),
    );
    const stockCount = Object.keys(stock).length;
    if (stockCount > 0) saveStock(stock);
    const stockNote = stockCount > 0 ? ` Đã cập nhật tồn kho của ${stockCount} mã.` : "";
    if (mode === "replace") {
      toast(`Đã thay toàn bộ danh mục bằng ${incoming.length} sản phẩm.${stockNote}`);
    } else {
      const existing = new Set(items.map((item) => normalizeSku(item.sku)));
      const updated = incoming.filter((item) => existing.has(normalizeSku(item.sku))).length;
      toast(
        (updated > 0
          ? `Đã nhập ${incoming.length} sản phẩm: ${incoming.length - updated} mã mới, ${updated} mã cập nhật.`
          : `Đã nhập ${incoming.length} sản phẩm.`) + stockNote,
      );
    }
  };

  const saveItem = (next: ProductItem) => {
    if (editing === "new") {
      update((p) => updateGroup(p, id, (g) => ({ ...g, items: [...g.items, next] })));
      view.setExpanded(true); // sản phẩm mới nằm cuối bảng — mở hết bảng để nhìn thấy
      toast(`Đã thêm sản phẩm ${next.sku}.`);
    } else if (editing) {
      const { sku } = editing;
      update((p) => replaceItem(p, id, sku, next));
      toast(`Đã sửa sản phẩm ${next.sku}.`);
    }
    setEditing(null);
  };

  const deleteItem = useCallback(
    (item: ProductItem) => {
      if (!window.confirm(`Xóa sản phẩm ${item.sku}${item.name ? ` — ${item.name}` : ""} khỏi danh mục?`)) return;
      update((p) => updateGroup(p, id, (g) => ({ ...g, items: g.items.filter((i) => i.sku !== item.sku) })));
      toast(`Đã xóa sản phẩm ${item.sku}.`);
    },
    [update, id],
  );

  const deleteGroup = () => {
    const question = [`Xóa danh mục «${group.name}» cùng ${items.length} sản phẩm? Không khôi phục được.`];
    if (ruleCount > 0) {
      question.push(
        `Có ${ruleCount} quy tắc khuyến mãi đang dùng danh mục này. ` +
          "Các quy tắc đó sẽ bị gỡ danh mục và phải chọn lại.",
      );
    }
    if (orderCount > 0) {
      question.push(
        `Có ${orderCount} đơn hàng đang có sản phẩm thuộc danh mục này. ` +
          "Các dòng hàng đó sẽ không còn được tính khuyến mãi.",
      );
    }
    if (!window.confirm(question.join("\n\n"))) return;
    update((p) => removeGroup(p, id));
    toast(`Đã xóa danh mục «${group.name}».`);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <Field label="Tên danh mục" className="min-w-0 flex-1 basis-64 sm:max-w-md">
          <NameInput
            value={group.name}
            onChange={(name) => update((p) => updateGroup(p, id, (g) => ({ ...g, name })))}
            selectOnMount={isNew}
            placeholder="vd Danh mục hàng tặng"
          />
        </Field>
        <p className="pb-2 text-sm text-gray-600">{items.length} sản phẩm</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => setImporting(true)}>
          <Upload className="h-4 w-4" /> Nhập từ Excel
        </Button>
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Thêm sản phẩm
        </Button>
        <Button onClick={() => exportGroupExcel(programName, group)} disabled={items.length === 0}>
          <Download className="h-4 w-4" /> Xuất Excel
        </Button>
        <Button variant="danger" className="sm:ml-auto" onClick={deleteGroup}>
          <Trash2 className="h-4 w-4" /> Xóa danh mục
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          Danh mục chưa có sản phẩm. Bấm «Nhập từ Excel» để đưa cả bảng giá vào một lần, hoặc «Thêm sản phẩm» để nhập
          từng mã.
        </p>
      ) : (
        <div className="mt-4">
          <ItemsBrowser items={items} view={view}>
            <ItemsTable items={view.visible} onEdit={setEditing} onDelete={deleteItem} />
          </ItemsBrowser>
        </div>
      )}

      <ImportProductsDialog
        open={importing}
        onClose={() => setImporting(false)}
        targetName={group.name}
        existingCount={items.length}
        onImport={importItems}
      />

      {editing ? (
        <ProductItemDialog
          item={editing === "new" ? null : editing}
          groupName={group.name}
          takenSkus={
            new Set(
              items
                .filter((item) => editing === "new" || item.sku !== editing.sku)
                .map((item) => normalizeSku(item.sku)),
            )
          }
          onSave={saveItem}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

export default memo(ProductGroupCard);
