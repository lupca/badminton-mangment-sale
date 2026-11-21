// Danh sách đơn hàng: lọc, xem tổng, mở / nhân bản / xóa đơn, xuất Excel.
import { useEffect, useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import NewOrderDialog from "../components/orders/NewOrderDialog";
import OrdersTable, { type OrderRow } from "../components/orders/OrdersTable";
import { exportOrderList } from "../components/orders/excel";
import { NO_SALES_NAME, ORDER_STATUS_LABEL } from "../components/orders/labels";
import { salesKey, salesNames, sumOrders } from "../components/orders/totals";
import { calculateOrder } from "../lib/engine";
import { formatNumber, matchesSearch } from "../lib/format";
import { DEFAULT_PAGE_SIZE, paginate } from "../lib/paging";
import { canManage } from "../lib/roles";
import { navigate, useRoute } from "../lib/router";
import { useStore } from "../lib/store";
import type { Order } from "../types";
import { Button, EmptyState, FilterChip, FilterSelect, ListCard, PageHeader, Pagination, SearchInput, toast } from "../ui";

type StatusFilter = "all" | Order["status"];

/** Chữ dùng để tìm: mã đơn, đại lý, sale, điện thoại của đại lý và của sale (cả dạng viết liền). */
function searchText(order: Order): string {
  return [
    order.code,
    order.customerName,
    order.customerPhone,
    order.customerPhone.replace(/\D/g, ""),
    order.salesperson,
    order.salespersonPhone,
    order.salespersonPhone.replace(/\D/g, ""),
  ].join(" ");
}

// Giá trị của ô lọc sale: "" = tất cả; mỗi sale là "=" + khóa gộp tên, nhờ vậy nhóm đơn chưa ghi sale (khóa rỗng)
// không trùng với «tất cả».
const ALL_SALES = "";
const saleValue = (key: string) => `=${key}`;

export default function OrdersPage() {
  const { orders, programs, mode, settings, duplicateOrder, deleteOrder } = useStore();
  const route = useRoute();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sale, setSale] = useState(ALL_SALES);
  const [creating, setCreating] = useState(false);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Bộ lọc chương trình nằm trên địa chỉ (#/orders?program=ID) để trang chương trình dẫn thẳng tới đây được.
  const programInUrl = route.query.get("program") ?? "";
  const programId = programs.some((p) => p.id === programInUrl) ? programInUrl : "";
  const setProgramId = (id: string) =>
    navigate(id ? `/orders?program=${encodeURIComponent(id)}` : "/orders", { replace: true });

  // Tính mỗi đơn một lần, mới nhất đứng trước.
  const rows = useMemo<OrderRow[]>(() => {
    const programById = new Map(programs.map((p) => [p.id, p]));
    return [...orders]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((order) => {
        const program = programById.get(order.programId);
        return { order, program, calc: calculateOrder(program, order) };
      });
  }, [orders, programs]);

  // Các sale có trong toàn bộ đơn, xếp theo tên; nhóm đơn chưa ghi sale đứng cuối.
  const saleChoices = useMemo(
    () =>
      [...salesNames(orders)]
        .sort(([, a], [, b]) => Number(!a) - Number(!b) || a.localeCompare(b, "vi"))
        .map(([key, name]) => ({ value: saleValue(key), label: name || NO_SALES_NAME })),
    [orders],
  );
  // Chỉ có một lựa chọn thì lọc theo sale không để làm gì: ô lọc không hiện và không lọc.
  const showSaleFilter = saleChoices.length > 1;
  const saleFilter = showSaleFilter && saleChoices.some((choice) => choice.value === sale) ? sale : ALL_SALES;

  const visible = useMemo(
    () =>
      rows.filter(
        ({ order }) =>
          (!programId || order.programId === programId) &&
          (saleFilter === ALL_SALES || saleValue(salesKey(order.salesperson)) === saleFilter) &&
          (status === "all" || order.status === status) &&
          matchesSearch(searchText(order), search),
      ),
    [rows, programId, saleFilter, status, search],
  );
  const totals = useMemo(() => sumOrders(visible), [visible]);
  // Đổi bộ lọc thì về trang 1.
  useEffect(() => setPageNo(1), [programId, saleFilter, status, search]);
  const page = paginate(visible, pageNo, pageSize);
  const programName = programs.find((p) => p.id === programId)?.name;
  const chips: Array<{ label: string; clear: () => void }> = [];
  if (search.trim()) chips.push({ label: `Tìm: “${search.trim()}”`, clear: () => setSearch("") });
  if (programId) chips.push({ label: `Chương trình: ${programName?.trim() || "(Chưa đặt tên)"}`, clear: () => setProgramId("") });
  if (saleFilter !== ALL_SALES)
    chips.push({ label: `Sale: ${saleChoices.find((c) => c.value === saleFilter)?.label ?? ""}`, clear: () => setSale(ALL_SALES) });
  if (status !== "all") chips.push({ label: `Trạng thái: ${ORDER_STATUS_LABEL[status]}`, clear: () => setStatus("all") });

  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setSale(ALL_SALES);
    if (programId) setProgramId("");
  };

  const exportExcel = () => {
    exportOrderList(visible, totals)
      .then(() => toast(`Đã xuất ${visible.length} đơn ra file Excel`))
      .catch(() => toast("Không xuất được file Excel. Hãy thử lại.", "error"));
  };

  const duplicate = (order: Order) => {
    duplicateOrder(order.id)
      .then((copy) => {
        if (copy) toast(`Đã nhân bản đơn ${order.code} thành đơn nháp ${copy.code}`);
      })
      .catch((error) => toast(`Không nhân bản được đơn: ${error instanceof Error ? error.message : "hãy thử lại."}`, "error"));
  };

  const remove = (order: Order) => {
    const dealer = order.customerName.trim();
    const question =
      `Xóa đơn ${order.code} ${dealer ? `của đại lý «${dealer}»` : "(chưa ghi tên đại lý)"}?` +
      (order.status === "confirmed" ? " Đơn này đã chốt." : "") +
      "\nĐơn đã xóa không khôi phục được.";
    if (!window.confirm(question)) return;
    deleteOrder(order.id);
    toast(`Đã xóa đơn ${order.code}`);
  };

  return (
    <>
      <PageHeader
        title="Đơn hàng"
        subtitle={
          // Có máy chủ: mỗi sale chỉ thấy đơn của mình, quản lý thấy đơn của mọi người.
          mode !== "cloud"
            ? undefined
            : canManage(settings.role)
              ? "Đơn của mọi sale trong nhóm."
              : "Các đơn của bạn. Người quản lý xem được đơn của mọi sale."
        }
        actions={
          <>
            <Button onClick={exportExcel} disabled={visible.length === 0}>
              <Download className="h-4 w-4" /> Xuất Excel
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Tạo đơn
            </Button>
          </>
        }
      />

      {orders.length === 0 ? (
        <EmptyState
          title="Chưa có đơn hàng nào"
          hint="Bấm «Tạo đơn», chọn chương trình khuyến mãi rồi nhập các mặt hàng đại lý đặt mua."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Tạo đơn
            </Button>
          }
        />
      ) : (
        <>
          <ListCard
            toolbar={
              <div className="space-y-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <SearchInput
                    className="lg:min-w-56 lg:flex-1"
                    value={search}
                    onChange={setSearch}
                    placeholder="Tìm mã đơn, đại lý, số điện thoại, sale…"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
                    <FilterSelect
                      className="lg:w-64"
                      label="Chương trình"
                      allLabel="Tất cả chương trình"
                      value={programId}
                      onChange={setProgramId}
                      options={programs.map((p) => ({ value: p.id, label: p.name }))}
                    />
                    {showSaleFilter ? (
                      <FilterSelect
                        className="lg:w-48"
                        label="Sale"
                        allLabel="Tất cả sale"
                        value={saleFilter}
                        onChange={setSale}
                        options={saleChoices}
                      />
                    ) : null}
                    <FilterSelect
                      className="lg:w-44"
                      label="Trạng thái"
                      allLabel="Tất cả trạng thái"
                      value={status === "all" ? "" : status}
                      onChange={(value) => setStatus((value || "all") as StatusFilter)}
                      options={[
                        { value: "draft", label: ORDER_STATUS_LABEL.draft },
                        { value: "confirmed", label: ORDER_STATUS_LABEL.confirmed },
                      ]}
                    />
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
                      onClick={clearFilters}
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
                  unit="đơn"
                  onPage={(n) => {
                    setPageNo(n);
                    window.scrollTo({ top: 0 });
                  }}
                  onSize={(size) => {
                    setPageSize(size);
                    setPageNo(1);
                  }}
                  note={visible.length < orders.length ? `(lọc từ ${formatNumber(orders.length)})` : undefined}
                />
              ) : null
            }
          >
            {visible.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <p className="text-sm font-medium text-gray-900">Không có đơn nào khớp bộ lọc</p>
                <p className="mt-1 text-sm text-gray-500">
                  Thử đổi từ khóa tìm, chương trình{showSaleFilter ? ", sale" : ""} hoặc trạng thái.
                </p>
                <div className="mt-4">
                  <Button onClick={clearFilters}>Bỏ lọc</Button>
                </div>
              </div>
            ) : (
              <OrdersTable
                rows={page.items}
                totals={totals}
                allCount={orders.length}
                onDuplicate={duplicate}
                onDelete={remove}
              />
            )}
          </ListCard>
        </>
      )}

      {creating ? <NewOrderDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
