// Màn hình «Sản phẩm»: mỗi mã hàng một dòng, kèm hãng, loại hàng, giá lẻ và tồn kho.
// Tìm, lọc (hãng, loại hàng, mức giá, tình trạng tồn kho), sắp xếp theo cột, phân trang.
// Chương trình khuyến mại chứa mã hàng nằm trong khung chi tiết mở ra khi bấm vào một dòng.
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Download,
  Package,
  SearchX,
  TrendingDown,
  Upload,
} from "lucide-react";
import ImportStockDialog from "../components/ImportStockDialog";
import ProgramStatusBadge from "../components/program/ProgramStatusBadge";
import { programPath } from "../components/program/programActions";
import {
  CATALOG_SORT_KEYS,
  NO_BRAND,
  NO_BRAND_LABEL,
  PRICE_RANGES,
  buildCatalog,
  catalogFacets,
  filterCatalog,
  sortCatalog,
  summarizeCatalog,
  type CatalogFilter,
  type CatalogProduct,
  type CatalogSortKey,
  type SortDir,
} from "../lib/catalog";
import { exportTableXlsx } from "../lib/exportXlsx";
import { formatDateTime, formatNumber, formatQty, formatVND, todayISO } from "../lib/format";
import { DEFAULT_PAGE_SIZE, paginate, pageSizeOf } from "../lib/paging";
import { canManage } from "../lib/roles";
import { Link, useQueryState } from "../lib/router";
import { productNames, unlistedStockCount, type StockFilter, type StockLevel } from "../lib/stock";
import { useStore } from "../lib/store";
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  FilterChip,
  FilterSelect,
  ListCard,
  Notice,
  PageHeader,
  Pagination,
  SearchInput,
  SortTh,
  StatTile,
  buttonCls,
  cx,
  inputCls,
  numCls,
  tableCls,
  tableScrollCls,
  tdCls,
  thCls,
  toast,
  useMediaQuery,
} from "../ui";

const QUERY_DEFAULTS = {
  q: "",
  brand: "",
  cat: "",
  price: "",
  stock: "all",
  sort: "name",
  dir: "asc",
  page: "1",
  size: String(DEFAULT_PAGE_SIZE),
};

const SORT_LABEL: Record<CatalogSortKey, string> = {
  sku: "Mã hàng",
  name: "Tên hàng",
  brand: "Hãng",
  category: "Loại hàng",
  price: "Giá lẻ",
  stock: "Tồn kho",
};

const LEVEL_BADGE: Record<StockLevel, { tone: "green" | "amber" | "red" | "gray"; label: string }> = {
  in: { tone: "green", label: "Còn hàng" },
  low: { tone: "amber", label: "Sắp hết" },
  out: { tone: "red", label: "Hết hàng" },
  unknown: { tone: "gray", label: "Chưa có số liệu" },
};

const STOCK_FILTER_LABEL: Record<StockFilter, string> = {
  all: "Tất cả",
  attention: "Cần chú ý",
  in: "Còn hàng",
  low: "Sắp hết",
  out: "Hết hàng",
  unknown: "Chưa có số liệu",
};

function LevelBadge({ level }: { level: StockLevel }) {
  const { tone, label } = LEVEL_BADGE[level];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

function StockNumber({ stock }: { stock: number | null }) {
  if (stock == null) return <span className="text-gray-400">—</span>;
  return <span className={cx(stock <= 0 && "font-medium text-red-700")}>{formatQty(stock)}</span>;
}

function PriceText({ product }: { product: CatalogProduct }) {
  if (!product.retailPrice) return <span className="text-gray-400">—</span>;
  const varies = product.retailMin !== product.retailMax;
  return (
    <span title={varies ? `Giá lẻ khác nhau giữa các chương trình: ${formatVND(product.retailMin)} – ${formatVND(product.retailMax)}` : undefined}>
      {formatVND(product.retailPrice)}
      {varies ? <span className="block text-xs font-normal text-amber-700">nhiều mức giá</span> : null}
    </span>
  );
}

/** Bảng sản phẩm (màn hình rộng). Memo để gõ ô tìm hay mở hộp thoại không vẽ lại khi trang đang xem chưa đổi. */
const ProductTable = memo(function ProductTable({
  items,
  start,
  sort,
  dir,
  onSort,
  onOpen,
}: {
  items: CatalogProduct[];
  /** Số thứ tự của dòng đầu trang (theo cả danh sách đang lọc, không phải theo trang). */
  start: number;
  sort: CatalogSortKey;
  dir: SortDir;
  onSort: (key: CatalogSortKey) => void;
  onOpen: (sku: string) => void;
}) {
  const th = (key: CatalogSortKey, extra?: { numeric?: boolean; className?: string }) => (
    <SortTh
      label={SORT_LABEL[key]}
      active={sort === key}
      dir={dir}
      onSort={() => onSort(key)}
      numeric={extra?.numeric}
      className={extra?.className}
    />
  );
  return (
    <div className={tableScrollCls}>
      <table className={tableCls}>
        <thead>
          <tr>
            <th className={cx(thCls, "w-14 !text-center")}>STT</th>
            {th("sku")}
            {th("name")}
            {th("brand")}
            {th("category", { className: "max-lg:hidden" })}
            {th("price", { numeric: true })}
            {th("stock", { numeric: true })}
            <th className={thCls}>Trạng thái</th>
            <th className={cx(thCls, "w-8")}>
              <span className="sr-only">Chi tiết</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((product, index) => (
            <tr
              key={product.sku}
              data-sku={product.sku}
              onClick={() => onOpen(product.sku)}
              className="group cursor-pointer hover:bg-blue-50/40"
            >
              <td className={cx(tdCls, "w-14 text-center tabular-nums text-gray-500")}>{formatNumber(start + index)}</td>
              <td className={cx(tdCls, "whitespace-nowrap font-medium text-gray-900")}>{product.sku}</td>
              <td className={cx(tdCls, "min-w-56")}>
                {/* Nút thật để mở bằng bàn phím; cả dòng bấm được bằng chuột. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(product.sku);
                  }}
                  className="cursor-pointer text-left text-gray-900 hover:text-blue-700 focus:outline-none focus-visible:underline"
                >
                  {product.name || <span className="text-gray-400">(chưa có tên)</span>}
                </button>
              </td>
              <td className={cx(tdCls, "whitespace-nowrap")}>
                {product.brand || <span className="text-gray-400">{NO_BRAND_LABEL}</span>}
              </td>
              <td className={cx(tdCls, "whitespace-nowrap text-gray-600 max-lg:hidden")}>{product.category}</td>
              <td className={cx(tdCls, numCls)}>
                <PriceText product={product} />
              </td>
              <td className={cx(tdCls, numCls)}>
                <StockNumber stock={product.stock} />
              </td>
              <td className={tdCls}>
                <LevelBadge level={product.level} />
              </td>
              <td className={cx(tdCls, "pl-0 text-gray-300 group-hover:text-blue-600")}>
                <ChevronRight aria-hidden className="h-4 w-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/** Danh sách dạng thẻ (điện thoại). */
const ProductCards = memo(function ProductCards({
  items,
  start,
  onOpen,
}: {
  items: CatalogProduct[];
  start: number;
  onOpen: (sku: string) => void;
}) {
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((product, index) => (
        <li key={product.sku} data-sku={product.sku}>
          <button
            type="button"
            onClick={() => onOpen(product.sku)}
            className="flex w-full cursor-pointer items-start gap-3 px-3 py-3 text-left active:bg-gray-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-900">{product.name || "(chưa có tên)"}</span>
              <span className="mt-0.5 block text-xs text-gray-500">
                #{formatNumber(start + index)} · {product.sku} · {product.brand || NO_BRAND_LABEL} · {product.category}
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-2">
                <LevelBadge level={product.level} />
                {product.stock != null ? (
                  <span className="text-xs text-gray-600">
                    Tồn <StockNumber stock={product.stock} />
                  </span>
                ) : null}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">
              <PriceText product={product} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
});

/** Khung chi tiết của một mã: thông tin chung và mọi chương trình khuyến mại có mã này. */
function ProductDrawer({ product, onClose }: { product: CatalogProduct | null; onClose: () => void }) {
  return (
    <Drawer
      open={product != null}
      onClose={onClose}
      title={product?.name || "(chưa có tên)"}
      subtitle={product ? `Mã hàng ${product.sku}` : null}
    >
      {product ? (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-gray-500">Hãng</dt>
              <dd className="font-medium text-gray-900">{product.brand || NO_BRAND_LABEL}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Loại hàng</dt>
              <dd className="font-medium text-gray-900">{product.category}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Giá lẻ</dt>
              <dd className="font-medium tabular-nums text-gray-900">
                {product.retailPrice ? formatVND(product.retailPrice) : "—"}
                {product.retailMin !== product.retailMax ? (
                  <span className="block text-xs font-normal text-amber-700">
                    Các chương trình ghi từ {formatVND(product.retailMin)} đến {formatVND(product.retailMax)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Tồn kho</dt>
              <dd className="flex items-center gap-2 font-medium tabular-nums text-gray-900">
                <StockNumber stock={product.stock} />
                <LevelBadge level={product.level} />
              </dd>
            </div>
            {product.unit ? (
              <div>
                <dt className="text-gray-500">Đơn vị</dt>
                <dd className="font-medium text-gray-900">{product.unit}</dd>
              </div>
            ) : null}
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Có trong {formatNumber(product.sources.length)} danh mục khuyến mại
            </h3>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {product.sources.map((source, index) => (
                <li key={`${source.programId}-${source.groupId}-${index}`} className="px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={programPath(source.programId, "groups")}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {source.programName.trim() || "(Chưa đặt tên)"}
                    </Link>
                    <ProgramStatusBadge status={source.programStatus} />
                  </div>
                  <div className="mt-0.5 text-gray-500">{source.groupName.trim() || "(chưa đặt tên)"}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-gray-700 tabular-nums">
                    <span>Giá lẻ {source.retailPrice ? formatVND(source.retailPrice) : "—"}</span>
                    <span>Giá sỉ {source.wholesalePrice ? formatVND(source.wholesalePrice) : "—"}</span>
                  </div>
                  {source.note ? <div className="mt-1 text-xs text-gray-500">{source.note}</div> : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

export default function ProductsPage() {
  const { programs, stock, settings, updateStock } = useStore();
  const [query, setQuery] = useQueryState(QUERY_DEFAULTS);
  const [importing, setImporting] = useState(false);
  const [openSku, setOpenSku] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 768px)");
  const manager = canManage(settings.role);
  const lowThreshold = settings.lowStockThreshold;
  // Gõ ô tìm không bị khựng: danh sách được lọc lại ngay sau khi ô nhập đã hiện chữ.
  const search = useDeferredValue(query.q);

  const names = useMemo(() => productNames(programs), [programs]);
  const stockCount = Object.keys(stock.bySku).length;
  const unlisted = useMemo(() => unlistedStockCount(programs, stock), [programs, stock]);
  const catalog = useMemo(() => buildCatalog(programs, stock, lowThreshold), [programs, stock, lowThreshold]);
  const facets = useMemo(() => catalogFacets(catalog), [catalog]);

  // Giá trị đọc từ địa chỉ trang có thể đã cũ (hãng không còn, ngưỡng đổi về 0…): không hợp lệ thì coi như không lọc.
  const stockFilters: StockFilter[] = ["all", "attention", "in", ...(lowThreshold > 0 ? (["low"] as const) : []), "out", "unknown"];
  const filter: CatalogFilter = {
    search,
    brand: facets.brands.some((o) => o.value === query.brand) ? query.brand : "",
    category: facets.categories.some((o) => o.value === query.cat) ? query.cat : "",
    price: PRICE_RANGES.some((r) => r.key === query.price) ? query.price : "",
    stock: stockCount > 0 && stockFilters.includes(query.stock as StockFilter) ? (query.stock as StockFilter) : "all",
  };
  const sort: CatalogSortKey = (CATALOG_SORT_KEYS as string[]).includes(query.sort) ? (query.sort as CatalogSortKey) : "name";
  const dir: SortDir = query.dir === "desc" ? "desc" : "asc";

  // Số liệu ở các ô tóm tắt tính theo các bộ lọc khác (trừ tồn kho), để bấm ô nào cũng ra đúng con số ghi trên ô.
  const beforeStock = useMemo(
    () => filterCatalog(catalog, { ...filter, stock: "all" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, filter.search, filter.brand, filter.category, filter.price],
  );
  const summary = useMemo(() => summarizeCatalog(beforeStock), [beforeStock]);
  const attentionAll = useMemo(() => summarizeCatalog(catalog), [catalog]);
  const visible = useMemo(
    () => sortCatalog(filterCatalog(beforeStock, { ...filter, search: "", brand: "", category: "", price: "" }), sort, dir),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beforeStock, filter.stock, sort, dir],
  );
  const page = paginate(visible, Number(query.page), pageSizeOf(query.size));
  const closeDrawer = useCallback(() => setOpenSku(null), []);
  const openProduct = openSku ? (catalog.find((p) => p.sku === openSku) ?? null) : null;

  /** Đổi bộ lọc thì về trang 1. */
  const setFilter = (patch: Partial<typeof QUERY_DEFAULTS>) => setQuery({ ...patch, page: "1" });
  const onSort = (key: CatalogSortKey) =>
    setQuery({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc", page: "1" });
  const onPage = (n: number) => {
    setQuery({ page: String(n) });
    window.scrollTo({ top: 0 });
  };

  const chips: Array<{ label: string; clear: () => void }> = [];
  if (query.q.trim()) chips.push({ label: `Tìm: “${query.q.trim()}”`, clear: () => setFilter({ q: "" }) });
  if (filter.brand)
    chips.push({ label: `Hãng: ${filter.brand === NO_BRAND ? NO_BRAND_LABEL : filter.brand}`, clear: () => setFilter({ brand: "" }) });
  if (filter.category) chips.push({ label: `Loại: ${filter.category}`, clear: () => setFilter({ cat: "" }) });
  if (filter.price)
    chips.push({ label: `Giá: ${PRICE_RANGES.find((r) => r.key === filter.price)?.label}`, clear: () => setFilter({ price: "" }) });
  if (filter.stock !== "all")
    chips.push({ label: `Tồn kho: ${STOCK_FILTER_LABEL[filter.stock]}`, clear: () => setFilter({ stock: "all" }) });
  const clearAll = () => setFilter({ q: "", brand: "", cat: "", price: "", stock: "all" });

  const importStock = (entries: Record<string, number>, mode: "merge" | "replace") => {
    updateStock(entries, mode);
    toast(`Đã cập nhật tồn kho của ${formatNumber(Object.keys(entries).length)} mã hàng.`);
  };

  const exportList = async () => {
    const rows = [
      ["STT", "Mã hàng", "Tên hàng", "Hãng", "Loại hàng", "Đơn vị", "Giá lẻ", "Tồn kho", "Trạng thái", "Số danh mục khuyến mại"],
      ...visible.map((p, index) => [
        index + 1,
        p.sku,
        p.name,
        p.brand,
        p.category,
        p.unit,
        p.retailPrice || null,
        p.stock,
        LEVEL_BADGE[p.level].label,
        p.sources.length,
      ]),
    ];
    try {
      await exportTableXlsx(`san-pham-${todayISO()}.xlsx`, [
        { name: "Sản phẩm", rows, colWidths: [6, 16, 48, 14, 16, 8, 14, 10, 16, 12] },
      ]);
    } catch {
      toast("Không xuất được file Excel. Thử lại sau.", "error");
    }
  };

  const tile = (value: StockFilter, props: Omit<Parameters<typeof StatTile>[0], "active" | "onClick">) => (
    <StatTile
      {...props}
      active={filter.stock === value}
      onClick={() => setFilter({ stock: filter.stock === value && value !== "all" ? "all" : value })}
    />
  );

  const sortSelect = (
    <select
      aria-label="Sắp xếp"
      value={`${sort}:${dir}`}
      onChange={(e) => {
        const [key, d] = e.target.value.split(":");
        setQuery({ sort: key, dir: d, page: "1" });
      }}
      className={cx(inputCls, "cursor-pointer pr-8")}
    >
      <option value="name:asc">Tên A → Z</option>
      <option value="name:desc">Tên Z → A</option>
      <option value="price:asc">Giá thấp → cao</option>
      <option value="price:desc">Giá cao → thấp</option>
      <option value="stock:asc">Tồn kho ít → nhiều</option>
      <option value="stock:desc">Tồn kho nhiều → ít</option>
      <option value="sku:asc">Mã hàng A → Z</option>
      <option value="brand:asc">Hãng A → Z</option>
      <option value="category:asc">Loại hàng A → Z</option>
    </select>
  );

  const attentionCount = attentionAll.attentionOut + attentionAll.attentionLow;

  return (
    <>
      <PageHeader
        title="Sản phẩm và tồn kho"
        subtitle="Mỗi mã hàng một dòng, kèm hãng, giá bán lẻ và số tồn kho. Bấm vào một mã để xem các chương trình khuyến mại có mã đó."
        actions={
          names.size > 0 || manager ? (
            <>
              {names.size > 0 ? (
                <Button onClick={exportList} disabled={visible.length === 0}>
                  <Download className="h-4 w-4" /> Xuất Excel
                </Button>
              ) : null}
              {manager ? (
                <Button variant="primary" onClick={() => setImporting(true)}>
                  <Upload className="h-4 w-4" /> Cập nhật tồn kho
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {names.size === 0 ? (
        <EmptyState
          title="Chưa có sản phẩm nào"
          hint={
            manager
              ? "Sản phẩm được nhập từ Excel vào danh mục của từng chương trình. Mở một chương trình, vào tab «Danh mục sản phẩm» rồi bấm «Nhập từ Excel»."
              : "Sản phẩm nằm trong danh mục của các chương trình do người quản lý tạo."
          }
          action={
            <Link to="/programs" className={buttonCls()}>
              Mở danh sách chương trình
            </Link>
          }
        />
      ) : (
        <>
          {stockCount === 0 ? (
            <Notice tone="info" className="mb-4">
              {manager
                ? "Chưa có số liệu tồn kho. Bấm «Cập nhật tồn kho» rồi chọn file Excel xuất từ phần mềm kho — file chỉ cần có cột mã hàng và cột số lượng tồn."
                : "Chưa có số liệu tồn kho. Người quản lý cập nhật tồn kho từ file Excel của phần mềm kho."}
            </Notice>
          ) : (
            <>
              {attentionCount > 0 ? (
                <div
                  role="note"
                  className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  <AlertTriangle aria-hidden className="h-5 w-5 shrink-0 text-amber-600 max-sm:hidden" />
                  <p className="min-w-0 flex-1 max-sm:basis-full">
                    <strong className="font-semibold">Cảnh báo tồn kho:</strong> trong các chương trình chưa kết thúc có{" "}
                    {[
                      attentionAll.attentionOut > 0 ? `${formatNumber(attentionAll.attentionOut)} mã hết hàng` : "",
                      attentionAll.attentionLow > 0
                        ? `${formatNumber(attentionAll.attentionLow)} mã sắp hết (tồn từ ${formatNumber(lowThreshold)} trở xuống)`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" và ")}
                    .
                    {manager ? (
                      <>
                        {" "}
                        Ngưỡng «sắp hết» đổi ở mục{" "}
                        <Link to="/settings" className="font-medium underline">
                          Dữ liệu
                        </Link>
                        .
                      </>
                    ) : null}
                  </p>
                  {filter.stock !== "attention" ? (
                    <Button size="sm" onClick={() => setQuery({ q: "", brand: "", cat: "", price: "", stock: "attention", page: "1" })}>
                      Xem các mã cần chú ý
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <div className={cx("mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3", lowThreshold > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
                {/* Điện thoại: bỏ ô «Tất cả» cho gọn — tổng số đã có ở dòng phân trang, bấm lại ô đang chọn là bỏ lọc. */}
                {tile("all", {
                  label: "Tất cả mã hàng",
                  value: formatNumber(summary.total),
                  tone: "blue",
                  icon: <Package className="h-5 w-5" />,
                  className: "max-sm:hidden",
                })}
                {tile("in", { label: "Còn hàng", value: formatNumber(summary.inStock), tone: "green", icon: <CircleCheck className="h-5 w-5" /> })}
                {lowThreshold > 0
                  ? tile("low", {
                      label: "Sắp hết",
                      value: formatNumber(summary.low),
                      hint: `Tồn ≤ ${formatNumber(lowThreshold)}`,
                      tone: "amber",
                      icon: <TrendingDown className="h-5 w-5" />,
                    })
                  : null}
                {tile("out", { label: "Hết hàng", value: formatNumber(summary.out), tone: "red", icon: <CircleSlash className="h-5 w-5" /> })}
                {tile("unknown", {
                  label: "Chưa có số liệu",
                  value: formatNumber(summary.unknown),
                  hint: "Không có trong file kho",
                  tone: "gray",
                  icon: <CircleHelp className="h-5 w-5" />,
                })}
              </div>
            </>
          )}

          <ListCard
            toolbar={
              <div className="space-y-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <SearchInput
                    className="lg:flex-1"
                    value={query.q}
                    onChange={(q) => setFilter({ q })}
                    placeholder="Tìm theo mã, tên hoặc hãng…"
                    aria-label="Tìm sản phẩm"
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
                    <FilterSelect
                      className="lg:w-44"
                      label="Hãng"
                      allLabel="Tất cả hãng"
                      value={filter.brand}
                      onChange={(brand) => setFilter({ brand })}
                      options={facets.brands}
                    />
                    <FilterSelect
                      className="lg:w-48"
                      label="Loại hàng"
                      allLabel="Tất cả loại hàng"
                      value={filter.category}
                      onChange={(cat) => setFilter({ cat })}
                      options={facets.categories}
                    />
                    <FilterSelect
                      className="lg:w-44"
                      label="Mức giá"
                      allLabel="Mọi mức giá"
                      value={filter.price}
                      onChange={(price) => setFilter({ price })}
                      options={PRICE_RANGES.map((r) => ({ value: r.key, label: r.label }))}
                    />
                    {!wide ? sortSelect : null}
                  </div>
                </div>
                {chips.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-500">Đang lọc:</span>
                    {chips.map((chip) => (
                      <FilterChip key={chip.label} label={chip.label} onRemove={chip.clear} />
                    ))}
                    <button
                      type="button"
                      onClick={clearAll}
                      className="cursor-pointer text-xs font-medium text-blue-700 hover:underline"
                    >
                      Xóa bộ lọc
                    </button>
                  </div>
                ) : null}
              </div>
            }
            footer={
              visible.length > 0 ? (
                <Pagination
                  page={page}
                  unit="sản phẩm"
                  onPage={onPage}
                  onSize={(size) => setQuery({ size: String(size), page: "1" })}
                  note={visible.length < catalog.length ? `(lọc từ ${formatNumber(catalog.length)})` : undefined}
                />
              ) : null
            }
          >
            {visible.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <SearchX aria-hidden className="mx-auto mb-3 h-8 w-8 text-gray-300" />
                <p className="text-sm font-medium text-gray-900">Không có sản phẩm nào khớp bộ lọc</p>
                <p className="mt-1 text-sm text-gray-500">Thử đổi từ khóa tìm hoặc bỏ bớt bộ lọc.</p>
                <div className="mt-4">
                  <Button onClick={clearAll}>Xóa bộ lọc</Button>
                </div>
              </div>
            ) : wide ? (
              <ProductTable items={page.items} start={page.from} sort={sort} dir={dir} onSort={onSort} onOpen={setOpenSku} />
            ) : (
              <ProductCards items={page.items} start={page.from} onOpen={setOpenSku} />
            )}
          </ListCard>

          <p className="mt-3 text-xs text-gray-500">
            {stockCount > 0
              ? `Tồn kho theo file kho ${stock.updatedAt ? `cập nhật lúc ${formatDateTime(stock.updatedAt)}` : "đã nhập"}. Đơn hàng chốt trên hệ thống này không tự trừ tồn kho. `
              : ""}
            Hãng và loại hàng được nhận ra từ tên chương trình, tên danh mục và tên hàng.
          </p>
          {unlisted > 0 ? (
            <p className="mt-1 text-xs text-gray-500">
              Còn {formatNumber(unlisted)} mã có số liệu tồn kho nhưng chưa thuộc danh mục nào nên không hiện ở đây. Thêm
              mã đó vào danh mục của một chương trình thì tồn kho sẽ hiện ra.
            </p>
          ) : null}
        </>
      )}

      <ProductDrawer product={openProduct} onClose={closeDrawer} />

      {manager ? (
        <ImportStockDialog
          open={importing}
          onClose={() => setImporting(false)}
          products={names}
          existingCount={stockCount}
          onImport={importStock}
        />
      ) : null}
    </>
  );
}
