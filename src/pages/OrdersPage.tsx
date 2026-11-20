// Danh sách đơn hàng: lọc, xem tổng, mở / nhân bản / xóa đơn, xuất Excel.
import { useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import NewOrderDialog from "../components/orders/NewOrderDialog";
import OrdersTable, { type OrderRow } from "../components/orders/OrdersTable";
import { exportOrderList } from "../components/orders/excel";
import { ORDER_STATUS_LABEL } from "../components/orders/labels";
import { sumOrders } from "../components/orders/totals";
import { calculateOrder } from "../lib/engine";
import { matchesSearch } from "../lib/format";
import { navigate, useRoute } from "../lib/router";
import { useStore } from "../lib/store";
import type { Order } from "../types";
import { Button, EmptyState, PageHeader, SearchInput, Select, toast } from "../ui";

type StatusFilter = "all" | Order["status"];

/** Chữ dùng để tìm: mã đơn, đại lý, điện thoại (cả dạng viết liền), sale. */
function searchText(order: Order): string {
  return [
    order.code,
    order.customerName,
    order.customerPhone,
    order.customerPhone.replace(/\D/g, ""),
    order.salesperson,
  ].join(" ");
}

export default function OrdersPage() {
  const { orders, programs, duplicateOrder, deleteOrder } = useStore();
  const route = useRoute();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);

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

  const visible = useMemo(
    () =>
      rows.filter(
        ({ order }) =>
          (!programId || order.programId === programId) &&
          (status === "all" || order.status === status) &&
          matchesSearch(searchText(order), search),
      ),
    [rows, programId, status, search],
  );
  const totals = useMemo(() => sumOrders(visible), [visible]);

  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    if (programId) setProgramId("");
  };

  const exportExcel = () => {
    exportOrderList(visible, totals)
      .then(() => toast(`Đã xuất ${visible.length} đơn ra file Excel`))
      .catch(() => toast("Không xuất được file Excel. Hãy thử lại.", "error"));
  };

  const duplicate = (order: Order) => {
    const copy = duplicateOrder(order.id);
    if (copy) toast(`Đã nhân bản đơn ${order.code} thành đơn nháp ${copy.code}`);
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
          <div className="mb-3 flex flex-col gap-2 md:flex-row">
            <SearchInput
              className="md:max-w-sm md:flex-1"
              value={search}
              onChange={setSearch}
              placeholder="Tìm mã đơn, đại lý, số điện thoại, sale…"
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
                  {p.name}
                </option>
              ))}
            </Select>
            <Select
              className="md:w-52"
              aria-label="Lọc theo trạng thái"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="draft">{ORDER_STATUS_LABEL.draft}</option>
              <option value="confirmed">{ORDER_STATUS_LABEL.confirmed}</option>
            </Select>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="Không có đơn nào khớp bộ lọc"
              hint="Thử đổi từ khóa tìm, chương trình hoặc trạng thái."
              action={<Button onClick={clearFilters}>Bỏ lọc</Button>}
            />
          ) : (
            <OrdersTable
              rows={visible}
              totals={totals}
              allCount={orders.length}
              onDuplicate={duplicate}
              onDelete={remove}
            />
          )}
        </>
      )}

      {creating ? <NewOrderDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
