// Hộp thoại "Dán mã + số lượng": nhập nhanh nhiều dòng hàng từ Excel / Zalo.
import { useState } from "react";
import type { OrderLine, ProductGroup } from "../../types";
import { parseSkuQty } from "../../lib/paste";
import { Button, Field, Modal, Notice, Select, Textarea } from "../../ui";
import { matchSkuQty } from "./orderOps";
import type { SkuQtyMatch } from "./orderOps";

interface PasteReport {
  applied: number;
  notFound: string[];
  /** Nơi đã tìm: tên danh mục được chỉ định, hoặc null khi tìm trong mọi danh mục. */
  searchedIn: string | null;
  /** Mã có ở nhiều danh mục và danh mục đã được chọn cho nó. */
  ambiguous: Array<{ sku: string; groupName: string }>;
  skipped: string[];
}

/** Chỉ gắn vào cây khi đang mở, để mỗi lần mở là một hộp thoại trống. */
export function PasteDialog({
  lines,
  groups,
  onApply,
  onClose,
}: {
  /** order.lines — để ưu tiên danh mục mà đơn đang có mã đó. */
  lines: OrderLine[];
  /** Các danh mục được chọn mua. */
  groups: ProductGroup[];
  onApply: (matches: SkuQtyMatch[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  // Một mã có thể nằm ở nhiều danh mục với khuyến mãi khác nhau: cho sale chỉ định danh mục nhận hàng.
  const [targetId, setTargetId] = useState("");
  const [report, setReport] = useState<PasteReport | null>(null);

  const apply = () => {
    const parsed = parseSkuQty(text);
    const target = groups.find((group) => group.id === targetId);
    const { matches, notFound, ambiguous } = matchSkuQty(lines, target ? [target] : groups, parsed.rows);
    if (matches.length > 0) onApply(matches);
    setReport({ applied: matches.length, notFound, searchedIn: target?.name ?? null, ambiguous, skipped: parsed.skipped });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Dán mã + số lượng"
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" onClick={apply} disabled={text.trim() === ""}>
            Nhập vào đơn
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-gray-600">
        Mỗi dòng một mã hàng và số lượng, copy 2 cột từ Excel hoặc gõ:{" "}
        <span className="font-mono whitespace-nowrap text-gray-900">P-AYPR285-3 15</span>
      </p>
      <Textarea
        autoFocus
        rows={8}
        aria-label="Danh sách mã hàng và số lượng"
        className="font-mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="mt-1 text-xs text-gray-500">Số lượng dán vào sẽ thay cho số lượng đang có của mã đó trong đơn.</p>

      {groups.length > 1 ? (
        <Field label="Nhập vào danh mục" className="mt-3">
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Tự động (danh mục đầu tiên có mã đó)</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {report ? (
        <div className="mt-3 space-y-2">
          <Notice tone={report.applied > 0 ? "success" : "warning"}>Đã nhập {report.applied} mã.</Notice>
          {report.notFound.length > 0 ? (
            <Notice tone="warning">
              Không tìm thấy {report.notFound.length} mã trong{" "}
              {report.searchedIn ? `«${report.searchedIn}»` : "danh mục bán"}: {report.notFound.join(", ")}
            </Notice>
          ) : null}
          {report.ambiguous.length > 0 ? (
            <Notice tone="info">
              {report.ambiguous.length} mã có ở nhiều danh mục, đã nhập vào:
              <ul className="my-1 list-disc pl-5">
                {report.ambiguous.map((entry) => (
                  <li key={entry.sku}>
                    {entry.sku} → «{entry.groupName}»
                  </li>
                ))}
              </ul>
              Cần danh mục khác thì sửa số lượng trong bảng; lần sau chọn trước ở ô «Nhập vào danh mục».
            </Notice>
          ) : null}
          {report.skipped.length > 0 ? (
            <Notice tone="warning">
              Không hiểu {report.skipped.length} dòng:
              <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                {report.skipped.map((line, i) => (
                  <li key={i} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
