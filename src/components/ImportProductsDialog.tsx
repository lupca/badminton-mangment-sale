// Hộp thoại nhập sản phẩm vào một danh mục: chọn file Excel / CSV hoặc dán vùng dữ liệu copy từ Excel,
// kiểm tra cột + giá trên bảng xem trước rồi bấm nhập.
import { useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import {
  columnOptions,
  convertRows,
  defaultSheetIndex,
  detectLayout,
  detectPriceUnit,
  readWorkbook,
  rowsFromText,
  type ColumnMapping,
  type ColumnRole,
  type ConvertResult,
  type PriceUnit,
  type SheetData,
  type SkipReason,
} from "../lib/excel";
import { formatVND, parseDecimal } from "../lib/format";
import type { ProductItem } from "../types";
import { Button, Field, Input, Modal, Notice, Select, Textarea, cx, numCls, tableCls, tableWrapCls, tdCls, thCls } from "../ui";

export interface ImportProductsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Tên danh mục đang nhập vào (hiện trên tiêu đề hộp thoại). */
  targetName?: string;
  /** Số sản phẩm danh mục đang có: > 0 thì hộp thoại hỏi "thêm/cập nhật" hay "thay thế toàn bộ". */
  existingCount: number;
  /**
   * Người dùng bấm "Nhập". `items` đã chuẩn hóa (mã viết hoa, giá là số nguyên VND, không trùng mã).
   * mode "append" = thêm/cập nhật theo mã hàng (dùng mergeItems); "replace" = thay toàn bộ danh mục.
   * Hộp thoại tự đóng sau khi gọi onImport.
   */
  onImport: (items: ProductItem[], mode: "append" | "replace") => void;
}

const ROLES: Array<{ role: ColumnRole; label: string }> = [
  { role: "sku", label: "Mã hàng (bắt buộc)" },
  { role: "name", label: "Tên hàng" },
  { role: "retail", label: "Giá lẻ" },
  { role: "wholesale", label: "Giá sỉ" },
  { role: "unit", label: "ĐVT" },
  { role: "note", label: "Ghi chú" },
];

const UNITS: Array<{ unit: PriceUnit; label: string }> = [
  { unit: "thousand", label: "Nghìn đồng" },
  { unit: "dong", label: "Đồng" },
];

const SKIP_REASON: Record<SkipReason, string> = {
  no_sku: "không có mã hàng",
  no_price: "không có giá",
  duplicate: "trùng mã với dòng phía trên",
  total: "dòng tổng cộng",
};

const PREVIEW_ROWS = 50;
const SKIPPED_ROWS_SHOWN = 100;

/** Dữ liệu đang xem: các sheet đã đọc và thiết lập của sheet đang chọn. */
interface Loaded {
  sheets: SheetData[];
  sheetIndex: number;
  headerRow: number | null;
  mapping: ColumnMapping;
  priceUnit: PriceUnit;
  /** Người dùng đã tự chọn đơn vị giá: từ đó không tự đoán lại khi đổi cột nữa. */
  unitChosen: boolean;
  /** Ô "Chiết khấu sỉ (%)", giữ nguyên chữ người dùng gõ. */
  discount: string;
}

/** Nhận diện cột và đơn vị giá của một sheet; file không có cột giá sỉ thì gợi ý chiết khấu 30%. */
function openSheet(sheets: SheetData[], sheetIndex: number): Loaded {
  const layout = detectLayout(sheets[sheetIndex].rows);
  return { sheets, sheetIndex, ...layout, unitChosen: false, discount: layout.mapping.wholesale == null ? "30" : "" };
}

/** "30", "12,5", "30%" → số; để trống → null (không chiết khấu); gõ sai → NaN. */
function parseDiscount(text: string): number | null {
  const value = text.trim().replace(/\s*%$/, "");
  if (value === "") return null;
  return /^\d+([.,]\d+)?$/.test(value) ? parseDecimal(value) : NaN;
}

export default function ImportProductsDialog(props: ImportProductsDialogProps) {
  // Chỉ dựng phần thân khi mở: mỗi lần mở là một hộp thoại mới, không còn dữ liệu của lần trước.
  return props.open ? <ImportDialog {...props} /> : null;
}

function ImportDialog({ onClose, targetName, existingCount, onImport }: ImportProductsDialogProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [vatFrom10To8, setVatFrom10To8] = useState(false);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const fileInput = useRef<HTMLInputElement>(null);
  /** Số thứ tự lần nạp dữ liệu gần nhất: file đọc xong trễ của một lần nạp cũ sẽ bị bỏ. */
  const latestLoad = useRef(0);
  const radioName = useId();

  const rows = loaded?.sheets[loaded.sheetIndex].rows;
  const headerRow = loaded?.headerRow ?? null;
  const mapping = loaded?.mapping;
  const priceUnit = loaded?.priceUnit;
  const discount = parseDiscount(loaded?.discount ?? "");
  const discountValid = discount == null || (discount >= 0 && discount < 100);

  const columns = useMemo(() => (rows ? columnOptions(rows, headerRow) : []), [rows, headerRow]);
  const result = useMemo(
    () =>
      rows && mapping && priceUnit
        ? convertRows(rows, {
            headerRow,
            mapping,
            priceUnit,
            vatFrom10To8,
            wholesaleDiscountPercent: discountValid ? discount : null,
          })
        : null,
    [rows, headerRow, mapping, priceUnit, vatFrom10To8, discount, discountValid],
  );
  const count = result?.items.length ?? 0;
  const sourceStatus = reading
    ? "Đang đọc file…"
    : fileName
      ? `Đang dùng file ${fileName}`
      : "hoặc kéo thả file .xlsx, .xls, .csv vào đây";

  let problem = "";
  if (mapping && mapping.sku == null) {
    problem = "Chưa tìm thấy cột mã hàng. Hãy chọn cột chứa mã hàng ở ô «Mã hàng» bên dưới.";
  } else if (mapping && mapping.retail == null && mapping.wholesale == null) {
    problem = "Chưa tìm thấy cột giá. Hãy chọn cột ở ô «Giá lẻ» hoặc «Giá sỉ» bên dưới.";
  } else if (result && count === 0) {
    problem =
      "Không đọc được sản phẩm nào. Mỗi dòng cần có mã hàng và giá là số — hãy kiểm tra lại các cột đã chọn bên dưới.";
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    const load = ++latestLoad.current;
    setLoaded(null);
    setFileName("");
    setText("");
    setError("");
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setReading(false);
      setError("Chỉ nhận file Excel (.xlsx, .xls) hoặc file .csv.");
      return;
    }
    setReading(true);
    try {
      const sheets = await readWorkbook(file);
      if (load !== latestLoad.current) return;
      setFileName(file.name);
      setLoaded(openSheet(sheets, defaultSheetIndex(sheets)));
    } catch (cause) {
      if (load !== latestLoad.current) return;
      setError(cause instanceof Error ? cause.message : "Không đọc được file này.");
    } finally {
      if (load === latestLoad.current) setReading(false);
    }
  }

  function changeText(value: string) {
    latestLoad.current++;
    setReading(false);
    setFileName("");
    setError("");
    setText(value);
    const pasted = rowsFromText(value);
    setLoaded(pasted.length > 0 ? openSheet([{ name: "", rows: pasted }], 0) : null);
  }

  function changeColumn(role: ColumnRole, value: string) {
    if (!loaded || !rows) return;
    const next = { ...loaded.mapping, [role]: value === "" ? null : Number(value) };
    // Đổi cột giá thì đoán lại đơn vị theo cột mới — trừ khi người dùng đã tự chọn đơn vị.
    const redetect = (role === "retail" || role === "wholesale") && !loaded.unitChosen;
    setLoaded({
      ...loaded,
      mapping: next,
      priceUnit: redetect ? detectPriceUnit(rows, loaded.headerRow, next) : loaded.priceUnit,
    });
  }

  // Thả file ở bất cứ đâu trong thân hộp thoại đều nhận; kéo chữ (không phải file) thì để trình duyệt tự xử lý.
  const carriesFile = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  function onDragOver(event: DragEvent) {
    if (!carriesFile(event)) return;
    event.preventDefault();
    setDragging(true);
  }
  function onDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  }
  function onDrop(event: DragEvent) {
    if (!carriesFile(event)) return;
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files[0]);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Nhập sản phẩm${targetName ? ` vào «${targetName}»` : ""}`}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button
            variant="primary"
            disabled={count === 0 || !discountValid}
            onClick={() => {
              if (!result) return;
              onImport(result.items, mode);
              onClose();
            }}
          >
            Nhập {count} sản phẩm
          </Button>
        </>
      }
    >
      <div className="space-y-4" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div className={cx("rounded-md border border-dashed p-3", dragging ? "border-blue-500 bg-blue-50" : "border-gray-300")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" /> Chọn file Excel
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = ""; // để chọn lại đúng file đó vẫn được đọc lại
              }}
            />
            <span className="min-w-0 break-words text-sm text-gray-600">{sourceStatus}</span>
          </div>
          <Field className="mt-3" label="Hoặc dán vùng dữ liệu đã copy từ Excel vào đây">
            <Textarea
              rows={3}
              wrap="off"
              spellCheck={false}
              placeholder="Bấm vào đây rồi dán (Ctrl+V)"
              value={text}
              onChange={(e) => changeText(e.target.value)}
            />
          </Field>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}
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
                    <Select value={mapping[role] ?? ""} onChange={(e) => changeColumn(role, e.target.value)}>
                      <option value="">{role === "sku" ? "(chưa chọn)" : "(không có)"}</option>
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

            <section className="grid gap-x-6 gap-y-3 md:grid-cols-3">
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-gray-700">Đơn vị giá trong file</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {UNITS.map(({ unit, label }) => (
                    <Choice
                      key={unit}
                      type="radio"
                      name={`${radioName}-unit`}
                      checked={priceUnit === unit}
                      onChange={() => setLoaded({ ...loaded, priceUnit: unit, unitChosen: true })}
                    >
                      {label}
                    </Choice>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">Nghìn đồng: số 1420 trong file là 1.420.000 đ.</p>
              </fieldset>
              <div className="md:pt-6">
                <Choice type="checkbox" checked={vatFrom10To8} onChange={() => setVatFrom10To8(!vatFrom10To8)}>
                  Quy đổi giá lẻ từ VAT 10% sang VAT 8% <span className="whitespace-nowrap">(÷ 1,1 × 1,08)</span>
                </Choice>
              </div>
              <Field
                label="Chiết khấu sỉ (%)"
                hint={
                  discountValid ? (
                    "Dùng cho dòng không có giá sỉ: giá sỉ = giá lẻ × (100 − CK)%"
                  ) : (
                    <span className="text-red-700">Chiết khấu phải từ 0 đến dưới 100.</span>
                  )
                }
              >
                <Input
                  inputMode="decimal"
                  className="max-w-28"
                  value={loaded.discount}
                  onChange={(e) => setLoaded({ ...loaded, discount: e.target.value })}
                />
              </Field>
            </section>

            {result && count > 0 ? <Preview result={result} /> : null}

            {existingCount > 0 ? (
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-gray-700">Danh mục đang có {existingCount} sản phẩm</legend>
                <div className="space-y-1.5">
                  <Choice
                    type="radio"
                    name={`${radioName}-mode`}
                    checked={mode === "append"}
                    onChange={() => setMode("append")}
                  >
                    Thêm vào / cập nhật theo mã hàng
                  </Choice>
                  <Choice
                    type="radio"
                    name={`${radioName}-mode`}
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  >
                    Thay thế toàn bộ {existingCount} sản phẩm đang có
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

/** Một lựa chọn dạng radio / ô tích kèm nhãn. */
function Choice({
  type,
  name,
  checked,
  onChange,
  children,
}: {
  type: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
      <input type={type} name={name} checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
      <span>{children}</span>
    </label>
  );
}

function Preview({ result }: { result: ConvertResult }) {
  const { items, skipped, duplicateCount } = result;
  // Đường kẻ dưới vẽ bằng bóng đổ để nó đi theo dòng tiêu đề khi cuộn (viền của bảng gộp viền thì không).
  const th = cx(thCls, "sticky top-0 shadow-[inset_0_-1px_0_#e5e7eb] max-sm:px-2");
  const td = cx(tdCls, "max-sm:px-2");
  return (
    <section>
      <p className="text-sm font-semibold text-gray-900">
        Đọc được {items.length} sản phẩm, bỏ qua {skipped.length} dòng
        {duplicateCount > 0 ? ` (${duplicateCount} mã trùng)` : ""}
      </p>
      {skipped.length > 0 ? (
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer text-blue-700">Xem các dòng bị bỏ qua</summary>
          <ul
            className={cx(
              "mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-gray-200 bg-gray-50",
              "px-3 py-2 text-xs text-gray-700",
            )}
          >
            {skipped.slice(0, SKIPPED_ROWS_SHOWN).map((row) => (
              <li key={row.row}>
                Dòng {row.row} ({SKIP_REASON[row.reason]}): {row.text}
              </li>
            ))}
            {skipped.length > SKIPPED_ROWS_SHOWN ? <li>… và {skipped.length - SKIPPED_ROWS_SHOWN} dòng khác</li> : null}
          </ul>
        </details>
      ) : null}
      <div className={cx(tableWrapCls, "mt-2 max-h-72 overflow-y-auto")}>
        <table className={tableCls}>
          <thead>
            <tr>
              <th className={cx(th, "max-sm:whitespace-normal")}>
                Mã hàng<span className="sm:hidden"> / Tên hàng</span>
              </th>
              <th className={cx(th, "max-sm:hidden")}>Tên hàng</th>
              <th className={cx(th, numCls)}>Giá lẻ</th>
              <th className={cx(th, numCls)}>Giá sỉ</th>
              <th className={cx(th, "max-sm:hidden")}>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, PREVIEW_ROWS).map((item) => (
              <tr key={item.sku}>
                <td className={td}>
                  <div className="whitespace-nowrap font-medium">{item.sku}</div>
                  {/* Màn hình hẹp: tên và ghi chú nằm dưới mã hàng để hai cột giá luôn nằm trong màn hình. */}
                  <div className="text-gray-600 sm:hidden">{item.name}</div>
                  <div className="text-xs text-gray-500 sm:hidden">{item.note}</div>
                </td>
                <td className={cx(td, "min-w-48 max-sm:hidden")}>{item.name}</td>
                <td className={cx(td, numCls)}>{formatVND(item.retailPrice)}</td>
                <td className={cx(td, numCls)}>{formatVND(item.wholesalePrice)}</td>
                <td className={cx(td, "text-gray-600 max-sm:hidden")}>{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > PREVIEW_ROWS ? (
        <p className="mt-1 text-xs text-gray-500">Bảng chỉ hiện {PREVIEW_ROWS} sản phẩm đầu tiên.</p>
      ) : null}
    </section>
  );
}
