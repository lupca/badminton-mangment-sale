// Phần chọn nguồn dữ liệu dùng chung cho các hộp thoại nhập từ Excel: chọn file, kéo thả file vào hộp thoại,
// hoặc dán vùng dữ liệu đã copy từ Excel.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { readWorkbook, rowsFromText, type SheetData } from "../lib/excel";
import { Button, Field, Textarea, cx } from "../ui";

export interface SheetSource {
  /** Tên file đang dùng; rỗng nếu chưa chọn file (hoặc đang dùng dữ liệu dán). */
  fileName: string;
  /** Chữ trong ô dán dữ liệu. */
  text: string;
  reading: boolean;
  /** Lỗi khi đọc file (thông báo tiếng Việt); rỗng nếu không có. */
  error: string;
  dragging: boolean;
  loadFile: (file: File | undefined) => void;
  changeText: (value: string) => void;
  /** Gắn vào phần tử bao thân hộp thoại: thả file ở bất cứ đâu trong đó đều nhận. */
  dropProps: {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}

/**
 * Quản lý nguồn dữ liệu của một hộp thoại nhập. `onSheets` được gọi với các sheet vừa đọc được,
 * hoặc null khi dữ liệu cũ không còn dùng nữa (bắt đầu đọc file khác, xóa hết chữ đã dán).
 */
export function useSheetSource(onSheets: (sheets: SheetData[] | null) => void): SheetSource {
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  /** Số thứ tự lần nạp dữ liệu gần nhất: file đọc xong trễ của một lần nạp cũ sẽ bị bỏ. */
  const latestLoad = useRef(0);
  const notify = useRef(onSheets);
  useEffect(() => {
    notify.current = onSheets;
  });

  async function loadFile(file: File | undefined) {
    if (!file) return;
    const load = ++latestLoad.current;
    notify.current(null);
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
      notify.current(sheets);
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
    notify.current(pasted.length > 0 ? [{ name: "", rows: pasted }] : null);
  }

  // Kéo chữ (không phải file) thì để trình duyệt tự xử lý.
  const carriesFile = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return {
    fileName,
    text,
    reading,
    error,
    dragging,
    loadFile: (file) => void loadFile(file),
    changeText,
    dropProps: {
      onDragOver(event) {
        if (!carriesFile(event)) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop(event) {
        if (!carriesFile(event)) return;
        event.preventDefault();
        setDragging(false);
        void loadFile(event.dataTransfer.files[0]);
      },
    },
  };
}

/** Khung «Chọn file Excel» + ô dán dữ liệu. */
export function SheetSourceBox({ source }: { source: SheetSource }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const status = source.reading
    ? "Đang đọc file…"
    : source.fileName
      ? `Đang dùng file ${source.fileName}`
      : "hoặc kéo thả file .xlsx, .xls, .csv vào đây";
  return (
    <div
      className={cx(
        "rounded-md border border-dashed p-3",
        source.dragging ? "border-blue-500 bg-blue-50" : "border-gray-300",
      )}
    >
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
            source.loadFile(e.target.files?.[0]);
            e.target.value = ""; // để chọn lại đúng file đó vẫn được đọc lại
          }}
        />
        <span className="min-w-0 break-words text-sm text-gray-600">{status}</span>
      </div>
      <Field className="mt-3" label="Hoặc dán vùng dữ liệu đã copy từ Excel vào đây">
        <Textarea
          rows={3}
          wrap="off"
          spellCheck={false}
          placeholder="Bấm vào đây rồi dán (Ctrl+V)"
          value={source.text}
          onChange={(e) => source.changeText(e.target.value)}
        />
      </Field>
    </div>
  );
}

/** Một lựa chọn dạng radio / ô tích kèm nhãn. */
export function Choice({
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
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
      />
      <span>{children}</span>
    </label>
  );
}

/** Danh sách các dòng bị bỏ qua, gập lại sẵn. `reasons` = lời giải thích cho từng lý do. */
export function SkippedRows<R extends string>({
  skipped,
  reasons,
}: {
  skipped: Array<{ row: number; reason: R; text: string }>;
  reasons: Record<R, string>;
}) {
  const SHOWN = 100;
  if (skipped.length === 0) return null;
  return (
    <details className="mt-1 text-sm">
      <summary className="cursor-pointer text-blue-700">Xem các dòng bị bỏ qua</summary>
      <ul
        className={cx(
          "mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-gray-200 bg-gray-50",
          "px-3 py-2 text-xs text-gray-700",
        )}
      >
        {skipped.slice(0, SHOWN).map((row) => (
          <li key={row.row}>
            Dòng {row.row} ({reasons[row.reason]}): {row.text}
          </li>
        ))}
        {skipped.length > SHOWN ? <li>… và {skipped.length - SHOWN} dòng khác</li> : null}
      </ul>
    </details>
  );
}
