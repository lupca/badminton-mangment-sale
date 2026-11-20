// Phần dùng chung khi hiện sản phẩm của một danh mục, cho cả khung sửa (quản lý) lẫn khung chỉ xem (sale):
// ô tìm và cách thu gọn danh mục dài, và xuất danh mục ra Excel.
import { useMemo, useState, type ReactNode } from "react";
import type { ProductGroup, ProductItem } from "../../types";
import { exportTableXlsx, safeFileName } from "../../lib/exportXlsx";
import { matchesSearch } from "../../lib/format";
import { Button, SearchInput, toast } from "../../ui";
import { hintCls } from "./fields";

const SEARCH_OVER = 15; // danh mục nhiều hơn số này thì có ô tìm
const COLLAPSE_OVER = 30; // danh mục nhiều hơn số này thì mặc định chỉ hiện các dòng đầu
const COLLAPSED_ROWS = 15;

/** Trạng thái xem một danh mục: chữ đang tìm, bảng đang mở hết hay thu gọn, và các dòng cần hiện. */
export function useItemsView(items: ProductItem[]) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const searchText = items.length > SEARCH_OVER ? query.trim() : "";
  const visible = useMemo(() => {
    if (searchText) {
      return items.filter((item) => matchesSearch(`${item.sku} ${item.name} ${item.note ?? ""}`, searchText));
    }
    return expanded || items.length <= COLLAPSE_OVER ? items : items.slice(0, COLLAPSED_ROWS);
  }, [items, searchText, expanded]);

  return { query, setQuery, expanded, setExpanded, searchText, visible };
}

/**
 * Ô tìm (khi danh mục dài), bảng sản phẩm, rồi dòng «tìm thấy …» hoặc «đang hiện … / hiện tất cả».
 * `children` là bảng vẽ các dòng `view.visible`; không có dòng nào để hiện thì bảng được ẩn đi.
 */
export function ItemsBrowser({
  items,
  view,
  children,
}: {
  items: ProductItem[];
  view: ReturnType<typeof useItemsView>;
  children: ReactNode;
}) {
  const { query, setQuery, expanded, setExpanded, searchText, visible } = view;
  return (
    <>
      {items.length > SEARCH_OVER ? (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Tìm mã hoặc tên hàng…"
          className="mb-3 sm:max-w-sm"
        />
      ) : null}

      {visible.length > 0 ? children : null}

      {searchText ? (
        <p className={hintCls}>
          {visible.length > 0
            ? `Tìm thấy ${visible.length} / ${items.length} sản phẩm.`
            : `Không có sản phẩm nào khớp «${searchText}».`}
        </p>
      ) : items.length > COLLAPSE_OVER ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-600">
          {expanded ? null : (
            <span>
              Đang hiện {COLLAPSED_ROWS} / {items.length} sản phẩm.
            </span>
          )}
          <Button size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Thu gọn bảng" : `Hiện tất cả ${items.length} sản phẩm`}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Xuất các sản phẩm của một danh mục ra file Excel rồi báo kết quả. */
export async function exportGroupExcel(programName: string, group: ProductGroup): Promise<void> {
  const { items } = group;
  try {
    await exportTableXlsx(safeFileName(`${programName} - ${group.name}`), [
      {
        name: group.name,
        rows: [
          ["Mã hàng", "Tên hàng", "Giá lẻ", "Giá sỉ", "Ghi chú"],
          ...items.map((item) => [item.sku, item.name, item.retailPrice, item.wholesalePrice, item.note ?? ""]),
        ],
        colWidths: [18, 50, 14, 14, 30],
      },
    ]);
    toast(`Đã xuất ${items.length} sản phẩm ra file Excel.`);
  } catch {
    toast("Không xuất được file Excel. Hãy thử lại.", "error");
  }
}
