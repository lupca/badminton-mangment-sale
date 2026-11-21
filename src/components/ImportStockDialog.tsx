// Hộp thoại cập nhật tồn kho từ file Excel của phần mềm kho: chỉ cần cột mã hàng và cột số lượng tồn.
import { useId, useMemo, useState } from "react";
import {
  columnOptions,
  convertStockRows,
  defaultSheetIndex,
  detectLayout,
  type ColumnMapping,
  type ColumnRole,
  type SheetData,
  type SkipReason,
  type StockConvertResult,
} from "../lib/excel";
import { formatQty } from "../lib/format";
import { Badge, Button, Field, Modal, Notice, Select, cx, numCls, tableCls, tableWrapCls, tdCls, thCls } from "../ui";
import { Choice, SheetSourceBox, SkippedRows, useSheetSource } from "./SheetSourceBox";

export interface ImportStockDialogProps {
  open: boolean;
  onClose: () => void;
  /** Mã hàng → tên, của các sản phẩm đang có trong danh mục của các chương trình. */
  products: Map<string, string>;
  /** Số mã đang có số liệu tồn kho: > 0 thì hộp thoại hỏi "cập nhật theo mã" hay "thay toàn bộ". */
  existingCount: number;
  /**
   * Người dùng bấm "Cập nhật". `entries` = mã hàng (đã chuẩn hóa) → số lượng tồn.
   * mode "merge" = chỉ cập nhật các mã có trong file; "replace" = bỏ hết số liệu cũ. Hộp thoại tự đóng sau đó.
   */
  onImport: (entries: Record<string, number>, mode: "merge" | "replace") => void;
}

const ROLES: Array<{ role: ColumnRole; label: string }> = [
  { role: "sku", label: "Mã hàng (bắt buộc)" },
  { role: "stock", label: "Tồn kho (bắt buộc)" },
  { role: "name", label: "Tên hàng" },
];

const SKIP_REASON: Record<SkipReason, string> = {
  no_sku: "không có mã hàng",
  no_price: "không có giá",
  no_stock: "ô tồn kho trống hoặc không phải số",
  duplicate: "trùng mã với dòng phía trên",
  total: "dòng tổng cộng",
};

const PREVIEW_ROWS = 50;

interface Loaded {
  sheets: SheetData[];
  sheetIndex: number;
  headerRow: number | null;
  mapping: ColumnMapping;
}

function openSheet(sheets: SheetData[], sheetIndex: number): Loaded {
  const { headerRow, mapping } = detectLayout(sheets[sheetIndex].rows, "stock");
  return { sheets, sheetIndex, headerRow, mapping };
}

export default function ImportStockDialog(props: ImportStockDialogProps) {
  // Chỉ dựng phần thân khi mở: mỗi lần mở là một hộp thoại mới, không còn dữ liệu của lần trước.
  return props.open ? <StockDialog {...props} /> : null;
}

function StockDialog({ onClose, products, existingCount, onImport }: ImportStockDialogProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const source = useSheetSource((sheets) =>
    setLoaded(sheets ? openSheet(sheets, defaultSheetIndex(sheets, "stock")) : null),
  );
  const radioName = useId();

  const rows = loaded?.sheets[loaded.sheetIndex].rows;
  const headerRow = loaded?.headerRow ?? null;
  const mapping = loaded?.mapping;

  const columns = useMemo(() => (rows ? columnOptions(rows, headerRow) : []), [rows, headerRow]);
  const result = useMemo(
    () => (rows && mapping ? convertStockRows(rows, { headerRow, mapping }) : null),
    [rows, headerRow, mapping],
  );
  const count = result?.rows.length ?? 0;
  const knownCount = result ? result.rows.filter((row) => products.has(row.sku)).length : 0;

  let problem = "";
  if (mapping && mapping.sku == null) {
    problem = "Chưa tìm thấy cột mã hàng. Hãy chọn cột chứa mã hàng ở ô «Mã hàng» bên dưới.";
  } else if (mapping && mapping.stock == null) {
    problem = "Chưa tìm thấy cột tồn kho. Hãy chọn cột chứa số lượng tồn ở ô «Tồn kho» bên dưới.";
  } else if (result && count === 0) {
    problem =
      "Không đọc được dòng nào. Mỗi dòng cần có mã hàng và số lượng tồn là số — hãy kiểm tra lại các cột đã chọn bên dưới.";
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Cập nhật tồn kho"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button
            variant="primary"
            disabled={count === 0}
            onClick={() => {
              if (!result) return;
              onImport(Object.fromEntries(result.rows.map((row) => [row.sku, row.qty])), mode);
              onClose();
            }}
          >
            {count > 0 ? `Cập nhật tồn kho ${count} mã` : "Cập nhật tồn kho"}
          </Button>
        </>
      }
    >
      <div className="space-y-4" {...source.dropProps}>
        <p className="text-sm text-gray-700">
          Chọn file tồn kho xuất từ phần mềm kho. File chỉ cần có cột mã hàng và cột số lượng tồn; tồn kho được ghi theo
          mã hàng nên dùng chung cho mọi chương trình.
        </p>
        <SheetSourceBox source={source} />

        {source.error ? <Notice tone="error">{source.error}</Notice> : null}
        {problem ? <Notice tone="error">{problem}</Notice> : null}

        {loaded && mapping ? (
          <>
            {loaded.sheets.length > 1 ? (
              <Field label="Sheet" className="max-w-xs">
                <Select
                  value={loaded.sheetIndex}
                  onChange={(e) => setLoaded(openSheet(loaded.sheets, Number(e.target.value)))}
                >
                  {loaded.sheets.map((sheet, i) => (
                    <option key={sheet.name} value={i}>
                      {sheet.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <section>
              <h3 className="text-sm font-semibold text-gray-900">Cột trong file</h3>
              <p className="text-xs text-gray-500">
                Các cột đã được chọn sẵn. Nếu bảng xem trước bên dưới chưa đúng thì chọn lại.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ROLES.map(({ role, label }) => (
                  <Field key={role} label={label}>
                    <Select
                      value={mapping[role] ?? ""}
                      onChange={(e) =>
                        setLoaded({
                          ...loaded,
                          mapping: { ...mapping, [role]: e.target.value === "" ? null : Number(e.target.value) },
                        })
                      }
                    >
                      <option value="">{role === "name" ? "(không có)" : "(chưa chọn)"}</option>
                      {columns.map((column) => (
                        <option key={column.index} value={column.index}>
                          {column.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </section>

            {result && count > 0 ? <Preview result={result} products={products} knownCount={knownCount} /> : null}

            {existingCount > 0 && count > 0 ? (
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-gray-700">
                  Đang có số liệu tồn kho của {existingCount} mã hàng
                </legend>
                <div className="space-y-1.5">
                  <Choice
                    type="radio"
                    name={`${radioName}-mode`}
                    checked={mode === "merge"}
                    onChange={() => setMode("merge")}
                  >
                    Cập nhật các mã có trong file, giữ số liệu của các mã khác
                  </Choice>
                  <Choice
                    type="radio"
                    name={`${radioName}-mode`}
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  >
                    Thay toàn bộ số liệu tồn kho đang có — mã không có trong file sẽ thành «chưa có số liệu»
                  </Choice>
                </div>
              </fieldset>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function Preview({
  result,
  products,
  knownCount,
}: {
  result: StockConvertResult;
  products: Map<string, string>;
  knownCount: number;
}) {
  const { rows, skipped, mergedSkus } = result;
  const unknownCount = rows.length - knownCount;
  // Đường kẻ dưới vẽ bằng bóng đổ để nó đi theo dòng tiêu đề khi cuộn (viền của bảng gộp viền thì không).
  const th = cx(thCls, "sticky top-0 shadow-[inset_0_-1px_0_#e5e7eb] max-sm:px-2");
  const td = cx(tdCls, "max-sm:px-2");
  return (
    <section>
      <p className="text-sm font-semibold text-gray-900">
        Đọc được tồn kho của {rows.length} mã hàng, bỏ qua {skipped.length} dòng
      </p>
      <p className="text-sm text-gray-700">
        {knownCount} mã có trong danh mục của các chương trình
        {unknownCount > 0
          ? `; ${unknownCount} mã chưa thuộc danh mục nào — vẫn được lưu và sẽ hiện khi mã đó được thêm vào danh mục.`
          : "."}
      </p>
      {mergedSkus.length > 0 ? (
        <p className="text-sm text-gray-700">
          {mergedSkus.length} mã nằm ở nhiều dòng trong file nên số lượng được cộng dồn:{" "}
          {mergedSkus.slice(0, 5).join(", ")}
          {mergedSkus.length > 5 ? "…" : ""}
        </p>
      ) : null}
      {knownCount === 0 && products.size > 0 ? (
        <Notice tone="warning" className="mt-2">
          Không mã nào trong file khớp với sản phẩm trong các chương trình. Hãy kiểm tra ô «Mã hàng» đã chọn đúng cột
          chứa mã hàng (vd P-AYPR285-3) chứ không phải cột mã vạch.
        </Notice>
      ) : null}
      <SkippedRows skipped={skipped} reasons={SKIP_REASON} />
      <div className={cx(tableWrapCls, "mt-2 max-h-72 overflow-y-auto")}>
        <table className={tableCls}>
          <thead>
            <tr>
              <th className={cx(th, "max-sm:whitespace-normal")}>
                Mã hàng<span className="sm:hidden"> / Tên hàng</span>
              </th>
              <th className={cx(th, "max-sm:hidden")}>Tên hàng</th>
              <th className={cx(th, numCls)}>Tồn kho</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, PREVIEW_ROWS).map((row) => {
              const known = products.has(row.sku);
              const name = products.get(row.sku) || row.name;
              return (
                <tr key={row.sku}>
                  <td className={td}>
                    <div className="whitespace-nowrap font-medium">{row.sku}</div>
                    {/* Màn hình hẹp: tên nằm dưới mã hàng để cột số luôn nằm trong màn hình. */}
                    <div className="text-gray-600 sm:hidden">{name}</div>
                    {known ? null : (
                      <div className="mt-0.5 sm:hidden">
                        <Badge>Chưa thuộc danh mục nào</Badge>
                      </div>
                    )}
                  </td>
                  <td className={cx(td, "min-w-48 max-sm:hidden")}>
                    {name} {known ? null : <Badge>Chưa thuộc danh mục nào</Badge>}
                  </td>
                  <td className={cx(td, numCls, row.qty <= 0 && "font-medium text-red-700")}>{formatQty(row.qty)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > PREVIEW_ROWS ? (
        <p className="mt-1 text-xs text-gray-500">Bảng chỉ hiện {PREVIEW_ROWS} mã đầu tiên.</p>
      ) : null}
    </section>
  );
}
