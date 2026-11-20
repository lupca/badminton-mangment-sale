// Màn hình «Sản phẩm»: toàn bộ sản phẩm trong danh mục của các chương trình, kèm giá lẻ và tồn kho,
// và danh sách các mã hết hàng / sắp hết mà sale cần chú ý.
import { Fragment, memo, useDeferredValue, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import ImportStockDialog from "../components/ImportStockDialog";
import ProgramStatusBadge from "../components/program/ProgramStatusBadge";
import { programPath, programTitle } from "../components/program/programActions";
import { formatDateTime, formatNumber, formatQty, formatVND, programStatus } from "../lib/format";
import { canManage } from "../lib/roles";
import { Link, navigate, useRoute } from "../lib/router";
import {
  listProducts,
  productNames,
  stockAlerts,
  summarizeProducts,
  unlistedStockCount,
  type ProgramProducts,
  type StockAlert,
  type StockFilter,
  type StockLevel,
} from "../lib/stock";
import { useStore } from "../lib/store";
import {
  Badge,
  Button,
  EmptyState,
  Notice,
  PageHeader,
  SearchInput,
  Select,
  buttonCls,
  cx,
  numCls,
  tableCls,
  tableWrapCls,
  tdCls,
  thCls,
  toast,
} from "../ui";

const COLUMNS = 4;
/** Số mã hiện sẵn trong khung cảnh báo; nhiều hơn thì có nút xem tất cả. */
const ALERTS_SHOWN = 5;

function StockCell({ stock, level }: { stock: number | null; level: StockLevel }) {
  if (stock == null) {
    return (
      <span className="text-gray-400" title="Chưa có số liệu tồn kho">
        —
      </span>
    );
  }
  // Tồn âm (kho xuất quá số nhập) cũng là hết hàng, như ở màn hình nhập đơn; ở đây hiện thêm con số để người quản lý thấy.
  if (stock <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge tone="red">Hết hàng</Badge>
        {stock < 0 ? <span className="font-medium text-red-700">{formatQty(stock)}</span> : null}
      </span>
    );
  }
  if (level === "low") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge tone="amber">Sắp hết</Badge>
        {formatQty(stock)}
      </span>
    );
  }
  return <>{formatQty(stock)}</>;
}

/** Các mã sale cần chú ý: hết hàng trước, rồi tới các mã tồn ít nhất. Mỗi mã một dòng dù nằm ở nhiều danh mục. */
function StockAlertsCard({
  alerts,
  lowThreshold,
  manager,
}: {
  alerts: StockAlert[];
  lowThreshold: number;
  manager: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const outCount = alerts.filter((alert) => alert.level === "out").length;
  const lowCount = alerts.length - outCount;
  const counts = [
    outCount > 0 ? `${formatNumber(outCount)} mã hết hàng` : "",
    lowCount > 0 ? `${formatNumber(lowCount)} mã sắp hết (tồn từ ${formatNumber(lowThreshold)} trở xuống)` : "",
  ].filter(Boolean);
  const shown = expanded ? alerts : alerts.slice(0, ALERTS_SHOWN);
  return (
    // Khung riêng (không dùng Card): viền vàng và danh sách sát mép khung.
    <section className="mb-4 rounded-lg border border-amber-300 bg-white">
      <h2 className="border-b border-amber-200 px-4 py-2.5 text-sm font-semibold text-gray-900">Cảnh báo tồn kho</h2>
      <p className="px-4 py-2.5 text-sm text-gray-800">
        Trong các chương trình chưa kết thúc có <strong>{counts.join(" và ")}</strong>.
        {manager ? (
          <>
            {" "}
            Ngưỡng «sắp hết» đổi ở mục{" "}
            <Link to="/settings" className="text-blue-700 hover:underline">
              Dữ liệu
            </Link>
            .
          </>
        ) : null}
      </p>
      <ul className="divide-y divide-gray-100 border-t border-gray-200">
        {shown.map((alert) => (
          <li key={alert.sku} className="flex items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm max-sm:flex-wrap">
            <span className="shrink-0 whitespace-nowrap font-medium">{alert.sku}</span>
            {/* Màn hình hẹp: tên xuống dòng riêng, mã và tồn kho nằm trên một dòng. */}
            <span className="min-w-0 flex-1 text-gray-600 max-sm:order-last max-sm:basis-full">
              {alert.name}
              <span className="text-gray-400 max-sm:hidden">
                {" · "}
                {alert.programName.trim() || "(Chưa đặt tên)"} › {alert.groupName.trim() || "(chưa đặt tên)"}
              </span>
            </span>
            <span className="ml-auto shrink-0 tabular-nums">
              <StockCell stock={alert.stock} level={alert.level} />
            </span>
          </li>
        ))}
      </ul>
      {alerts.length > ALERTS_SHOWN ? (
        <div className="border-t border-gray-200 px-4 py-2">
          <Button size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Thu gọn" : `Xem tất cả ${formatNumber(alerts.length)} mã`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Bảng sản phẩm. Được memo để việc mở hộp thoại hay gõ ô tìm không phải vẽ lại hàng trăm dòng khi danh sách chưa đổi. */
const ProductsTable = memo(function ProductsTable({
  list,
  showProgram,
}: {
  list: ProgramProducts[];
  /** Đang xem nhiều chương trình: thêm một dòng tên chương trình phía trên các danh mục của nó. */
  showProgram: boolean;
}) {
  const th = cx(thCls, "max-sm:px-2");
  // Màn hình hẹp: mỗi sản phẩm chiếm hai dòng — mã, giá, tồn kho ở dòng trên; tên hàng trải hết bề ngang ở dòng dưới.
  const td = cx(tdCls, "max-sm:border-b-0 max-sm:px-2 max-sm:pb-0");
  return (
    <div className={tableWrapCls}>
      <table className={tableCls}>
        <thead>
          <tr>
            <th className={cx(th, "max-sm:whitespace-normal")}>
              Mã hàng<span className="sm:hidden"> / Tên hàng</span>
            </th>
            <th className={cx(th, "max-sm:hidden")}>Tên hàng</th>
            <th className={cx(th, numCls)}>Giá lẻ</th>
            <th className={cx(th, numCls)}>Tồn kho</th>
          </tr>
        </thead>
        {list.map(({ program, groups }) => (
          <tbody key={program.id}>
            {showProgram ? (
              <tr>
                <th
                  colSpan={COLUMNS}
                  scope="rowgroup"
                  className="border-b border-gray-200 bg-gray-100 px-3 py-2 text-left text-sm font-semibold text-gray-900 max-sm:px-2"
                >
                  <Link to={programPath(program.id, "groups")} className="hover:underline">
                    {programTitle(program)}
                  </Link>{" "}
                  <ProgramStatusBadge status={programStatus(program)} />
                </th>
              </tr>
            ) : null}
            {groups.map(({ group, rows }) => (
              <Fragment key={group.id}>
                <tr>
                  <th
                    colSpan={COLUMNS}
                    scope="rowgroup"
                    className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-sm font-medium text-gray-800 max-sm:px-2"
                  >
                    {group.name.trim() || "(chưa đặt tên)"}
                    <span className="font-normal text-gray-500">
                      {" · "}
                      {rows.length === group.items.length
                        ? `${formatNumber(rows.length)} sản phẩm`
                        : `${formatNumber(rows.length)} / ${formatNumber(group.items.length)} sản phẩm`}
                    </span>
                  </th>
                </tr>
                {/* key theo vị trí: dòng không có trạng thái riêng, và dữ liệu cũ có thể trùng mã trong một danh mục */}
                {rows.map(({ item, stock, level }, index) => (
                  <Fragment key={index}>
                    <tr data-sku={item.sku} className="sm:hover:bg-gray-50">
                      <td className={cx(td, "whitespace-nowrap font-medium")}>{item.sku}</td>
                      <td className={cx(td, "min-w-48 max-sm:hidden")}>{item.name}</td>
                      <td className={cx(td, numCls)}>{formatVND(item.retailPrice)}</td>
                      <td className={cx(td, numCls)}>
                        <StockCell stock={stock} level={level} />
                      </td>
                    </tr>
                    <tr className="sm:hidden">
                      <td colSpan={COLUMNS} className="border-b border-gray-100 px-2 pb-2 pt-0.5 text-gray-600">
                        {item.name}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
});

export default function ProductsPage() {
  const { programs, stock, settings, updateStock } = useStore();
  const route = useRoute();
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [importing, setImporting] = useState(false);
  // Gõ ô tìm không bị khựng khi danh sách dài: bảng được lọc lại ngay sau khi ô nhập đã hiện chữ.
  const deferredSearch = useDeferredValue(search);
  const manager = canManage(settings.role);
  const lowThreshold = settings.lowStockThreshold;

  // Bộ lọc chương trình nằm trên địa chỉ (#/products?program=ID) để tải lại trang vẫn giữ.
  const programInUrl = route.query.get("program") ?? "";
  const programId = programs.some((p) => p.id === programInUrl) ? programInUrl : "";
  const setProgramId = (id: string) =>
    navigate(id ? `/products?program=${encodeURIComponent(id)}` : "/products", { replace: true });

  const names = useMemo(() => productNames(programs), [programs]);
  const stockCount = Object.keys(stock.bySku).length;
  const unlisted = useMemo(() => unlistedStockCount(programs, stock), [programs, stock]);
  const alerts = useMemo(() => stockAlerts(programs, stock, lowThreshold), [programs, stock, lowThreshold]);

  const stockFilters: Array<{ value: StockFilter; label: string }> = [
    { value: "all", label: "Tất cả tồn kho" },
    { value: "attention", label: lowThreshold > 0 ? "Cần chú ý (sắp hết + hết hàng)" : "Cần chú ý (hết hàng)" },
    { value: "in", label: "Còn hàng" },
    ...(lowThreshold > 0 ? [{ value: "low" as const, label: "Sắp hết hàng" }] : []),
    { value: "out", label: "Hết hàng" },
    { value: "unknown", label: "Chưa có số liệu" },
  ];
  // Chưa có số liệu tồn kho thì bộ lọc tồn kho không có nghĩa (và không hiện ra); ngưỡng về 0 thì không còn mức «sắp hết».
  const activeStockFilter =
    stockCount === 0 || !stockFilters.some((option) => option.value === stockFilter) ? "all" : stockFilter;

  const list = useMemo(
    () => listProducts(programs, stock, { programId, search: deferredSearch, stock: activeStockFilter, lowThreshold }),
    [programs, stock, programId, deferredSearch, activeStockFilter, lowThreshold],
  );
  const summary = useMemo(() => summarizeProducts(list), [list]);

  const clearFilters = () => {
    setSearch("");
    setStockFilter("all");
    if (programId) setProgramId("");
  };

  const importStock = (entries: Record<string, number>, mode: "merge" | "replace") => {
    updateStock(entries, mode);
    toast(`Đã cập nhật tồn kho của ${formatNumber(Object.keys(entries).length)} mã hàng.`);
  };

  return (
    <>
      <PageHeader
        title="Sản phẩm và tồn kho"
        subtitle="Toàn bộ sản phẩm trong danh mục của các chương trình, kèm giá lẻ và tồn kho."
        actions={
          manager ? (
            <Button variant="primary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" /> Cập nhật tồn kho
            </Button>
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
            <Notice tone="info" className="mb-3">
              {manager
                ? "Chưa có số liệu tồn kho. Bấm «Cập nhật tồn kho» rồi chọn file Excel xuất từ phần mềm kho — file chỉ cần có cột mã hàng và cột số lượng tồn."
                : "Chưa có số liệu tồn kho. Người quản lý cập nhật tồn kho từ file Excel của phần mềm kho."}
            </Notice>
          ) : (
            <p className="mb-3 text-sm text-gray-600">
              Tồn kho là số trong file kho
              {stock.updatedAt ? ` cập nhật lúc ${formatDateTime(stock.updatedAt)}` : " đã nhập"}. Đơn hàng chốt trên hệ
              thống này không tự trừ tồn kho.
            </p>
          )}

          {alerts.length > 0 ? <StockAlertsCard alerts={alerts} lowThreshold={lowThreshold} manager={manager} /> : null}

          <div className="mb-3 flex flex-col gap-2 md:flex-row">
            <SearchInput
              className="md:max-w-sm md:flex-1"
              value={search}
              onChange={setSearch}
              placeholder="Tìm mã hoặc tên hàng…"
            />
            <Select
              className="md:w-72"
              aria-label="Lọc theo chương trình"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
            >
              <option value="">Tất cả chương trình</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {programTitle(p)}
                </option>
              ))}
            </Select>
            {stockCount > 0 ? (
              <Select
                className="md:w-64"
                aria-label="Lọc theo tồn kho"
                value={activeStockFilter}
                onChange={(e) => setStockFilter(e.target.value as StockFilter)}
              >
                {stockFilters.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>

          {list.length === 0 ? (
            <EmptyState
              title="Không có sản phẩm nào khớp bộ lọc"
              hint="Thử đổi từ khóa tìm, chương trình hoặc bộ lọc tồn kho."
              action={<Button onClick={clearFilters}>Bỏ lọc</Button>}
            />
          ) : (
            <>
              <p className="mb-2 text-sm text-gray-600">
                <strong className="font-semibold text-gray-900">{formatNumber(summary.skus)}</strong> mã hàng
                {stockCount > 0 ? (
                  <>
                    {" · "}
                    {formatNumber(summary.inStock)} còn hàng
                    {summary.low > 0 ? ` (${formatNumber(summary.low)} sắp hết)` : ""} ·{" "}
                    {formatNumber(summary.outOfStock)} hết hàng · {formatNumber(summary.unknown)} chưa có số liệu
                  </>
                ) : null}
              </p>
              <ProductsTable list={list} showProgram={!programId} />
            </>
          )}

          {unlisted > 0 ? (
            <p className="mt-3 text-xs text-gray-500">
              Còn {formatNumber(unlisted)} mã có số liệu tồn kho nhưng chưa thuộc danh mục nào nên không hiện ở đây. Thêm
              mã đó vào danh mục của một chương trình thì tồn kho sẽ hiện ra.
            </p>
          ) : null}
        </>
      )}

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
