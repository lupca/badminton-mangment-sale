// Hộp thoại thêm / sửa một sản phẩm của danh mục.
import { useId, useState, type FormEvent } from "react";
import type { ProductItem } from "../../types";
import { normalizeSku } from "../../lib/format";
import { Button, Field, Input, Modal, MoneyInput, Notice } from "../../ui";

export default function ProductItemDialog({
  item,
  groupName,
  takenSkus,
  onSave,
  onClose,
}: {
  /** Sản phẩm đang sửa; null = thêm sản phẩm mới. */
  item: ProductItem | null;
  groupName: string;
  /** Mã hàng (đã chuẩn hóa) của các sản phẩm khác trong danh mục. */
  takenSkus: Set<string>;
  onSave: (item: ProductItem) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [sku, setSku] = useState(item?.sku ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [retailPrice, setRetailPrice] = useState(item?.retailPrice ?? 0);
  const [wholesalePrice, setWholesalePrice] = useState(item?.wholesalePrice ?? 0);
  const [note, setNote] = useState(item?.note ?? "");
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const key = normalizeSku(sku);
    if (!key) {
      setError("Chưa nhập mã hàng.");
      return;
    }
    if (takenSkus.has(key)) {
      setError(`Mã hàng ${key} đã có trong danh mục này. Mỗi mã chỉ được có một dòng.`);
      return;
    }
    const next: ProductItem = { ...item, sku: key, name: name.trim(), retailPrice, wholesalePrice };
    if (note.trim()) next.note = note.trim();
    else delete next.note;
    onSave(next);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? `Sửa sản phẩm ${item.sku}` : `Thêm sản phẩm vào «${groupName}»`}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" type="submit" form={formId}>
            {item ? "Lưu" : "Thêm sản phẩm"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <Field label="Mã hàng" hint="Mã được viết hoa và bỏ khoảng trắng. Không trùng với mã khác trong danh mục.">
          <Input
            autoFocus
            value={sku}
            onChange={(e) => {
              setSku(e.target.value);
              setError("");
            }}
            placeholder="vd P-AYPT399-4"
            aria-invalid={error ? true : undefined}
          />
        </Field>
        {error ? (
          <Notice tone="error">
            <span role="alert">{error}</span>
          </Notice>
        ) : null}
        <Field label="Tên hàng">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="vd Khung vợt cầu lông 3D Calibar 001"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giá lẻ (đ)">
            <MoneyInput value={retailPrice} onChange={setRetailPrice} />
          </Field>
          <Field label="Giá sỉ (đ)">
            <MoneyInput value={wholesalePrice} onChange={setWholesalePrice} />
          </Field>
        </div>
        <Field label="Ghi chú">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Không bắt buộc" />
        </Field>
      </form>
    </Modal>
  );
}
