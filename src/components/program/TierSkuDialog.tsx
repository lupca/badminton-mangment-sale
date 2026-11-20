// Hộp thoại chọn các mã quà mà một mức doanh số được phép chọn.
import { useState } from "react";
import type { GiftTier, PriceBasis, ProductGroup, ProductItem } from "../../types";
import { priceOf } from "../../lib/engine";
import { formatVND, matchesSearch, normalizeSku } from "../../lib/format";
import { PRICE_BASIS_LABEL } from "../../lib/programOps";
import { Button, Modal, SearchInput } from "../../ui";

export default function TierSkuDialog({
  tier,
  giftGroup,
  priceBasis,
  onChange,
  onClose,
}: {
  tier: GiftTier;
  giftGroup: ProductGroup;
  /** Loại giá mà quy tắc dùng để tính giá trị quà — hiện bên cạnh từng mã. */
  priceBasis: PriceBasis;
  /** Gọi sau mỗi lần tích / bỏ tích. null = được chọn mọi mã của danh mục quà. */
  onChange: (allowedSkus: string[] | null) => void;
  onClose: () => void;
}) {
  const { items } = giftGroup;
  // Giữ các ô đã tích ở đây để «tích hết» vẫn hiện là tích hết, dù khi đó dữ liệu lưu là null.
  const [ticked, setTicked] = useState(() => new Set((tier.allowedSkus ?? []).map(normalizeSku)));
  const [query, setQuery] = useState("");

  /** Tích / bỏ tích một loạt mã rồi ghi ngay vào quy tắc. */
  const setTicks = (targets: ProductItem[], checked: boolean) => {
    const next = new Set(ticked);
    for (const item of targets) {
      if (checked) next.add(normalizeSku(item.sku));
      else next.delete(normalizeSku(item.sku));
    }
    setTicked(next);
    const skus = items.map((item) => item.sku).filter((sku) => next.has(normalizeSku(sku)));
    onChange(skus.length === 0 || skus.length === items.length ? null : skus);
  };

  const tickedCount = items.filter((item) => ticked.has(normalizeSku(item.sku))).length;
  const unrestricted = tickedCount === 0 || tickedCount === items.length;
  const visible = items.filter((item) => matchesSearch(`${item.sku} ${item.name}`, query));
  // Đang tìm thì hai nút tích hàng loạt chỉ tác động lên các mã đang hiện, để không vô tình tích cả những mã bị ẩn.
  const filtering = visible.length < items.length;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Mã quà được chọn — mức từ ${formatVND(tier.min)}`}
      footer={
        <>
          <p className="mr-auto self-center text-sm text-gray-700">
            {unrestricted
              ? `Mức này được chọn tất cả ${items.length} mã.`
              : `Mức này chỉ được chọn ${tickedCount} / ${items.length} mã đã tích.`}
          </p>
          <Button variant="primary" onClick={onClose}>
            Xong
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-700">
        Tích các mã trong «{giftGroup.name}» mà mức này được chọn làm quà. Không tích mã nào (hoặc tích hết) = được chọn
        mọi mã. Giá bên phải là {PRICE_BASIS_LABEL[priceBasis]}, loại giá dùng để tính giá trị quà.
      </p>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">Danh mục quà chưa có sản phẩm nào.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {items.length > 15 ? (
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Tìm mã hoặc tên hàng…"
                className="min-w-0 flex-1 basis-48"
              />
            ) : null}
            <Button size="sm" disabled={visible.length === 0} onClick={() => setTicks(visible, true)}>
              {filtering ? "Tích các mã đang hiện" : "Tích tất cả"}
            </Button>
            <Button size="sm" disabled={visible.length === 0} onClick={() => setTicks(visible, false)}>
              {filtering ? "Bỏ tích các mã đang hiện" : "Bỏ tích tất cả"}
            </Button>
          </div>

          <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {/* key theo vị trí: dòng không có trạng thái riêng, và dữ liệu nhập từ file có thể trùng mã */}
            {visible.map((item, index) => (
              <label key={index} className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-gray-50">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                  checked={ticked.has(normalizeSku(item.sku))}
                  onChange={(e) => setTicks([item], e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium max-sm:block">{item.sku}</span>{" "}
                  <span className="text-gray-700">{item.name}</span>
                </span>
                <span className="whitespace-nowrap tabular-nums text-gray-700">
                  {formatVND(priceOf(item, priceBasis))}
                </span>
              </label>
            ))}
            {visible.length === 0 ? <p className="px-3 py-2 text-sm text-gray-600">Không có mã nào khớp.</p> : null}
          </div>
        </>
      )}
    </Modal>
  );
}
