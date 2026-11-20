// Màn hình tính đơn: nhập số lượng, xem ngay tiền phải trả, mức khuyến mãi đạt được và chọn quà.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, CopyPlus, FileSpreadsheet, LockOpen, Printer, Trash2 } from "lucide-react";
import type { CalcLine, ID, Order, Rule } from "../types";
import { calculateOrder } from "../lib/engine";
import { exportTableXlsx, safeFileName } from "../lib/exportXlsx";
import { copyText, formatDate, formatPeriod, programStatus } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useStore } from "../lib/store";
import { Badge, Button, EmptyState, Notice, PageHeader, buttonCls, cx, toast } from "../ui";
import { MobileBar } from "../components/order/MobileBar";
import { OrderInfoCard } from "../components/order/OrderInfoCard";
import { OrderPrint } from "../components/order/OrderPrint";
import { OrphanLines } from "../components/order/OrphanLines";
import { PasteDialog } from "../components/order/PasteDialog";
import { ProductPicker } from "../components/order/ProductPicker";
import { ResultPanel } from "../components/order/ResultPanel";
import { ORDER_STATUS_LABEL, buildOrderSheet, buildOrderText, contactLine } from "../components/order/orderExport";
import type { OrderDocument } from "../components/order/orderExport";
import {
  buildCatalog,
  linesInCatalogOrder,
  orphanLines,
  purchasableGroups,
  refreshPrices,
  removeGiftsAt,
  saleProfileToOffer,
  setGiftQty,
  setLineQty,
  stalePriceSkus,
} from "../components/order/orderOps";
import type { PricedItem, SkuQtyMatch } from "../components/order/orderOps";
import { orderStockView } from "../components/order/stockView";
import type { StockWarning } from "../components/order/stockView";
import { useStableCallback } from "../components/order/useStableCallback";

const NO_RULES: Rule[] = [];
const NO_STOCK_WARNINGS: StockWarning[] = [];

export default function OrderEditPage({ orderId }: { orderId: string }) {
  const order = useStore().getOrder(orderId);
  if (!order) {
    return (
      <EmptyState
        title="Không tìm thấy đơn hàng"
        hint="Đơn này có thể đã bị xóa."
        action={
          <Link to="/orders" className={buttonCls("primary")}>
            Về danh sách đơn hàng
          </Link>
        }
      />
    );
  }
  return <OrderEditor order={order} />;
}

function OrderEditor({ order }: { order: Order }) {
  const { orders, settings, stock, getProgram, updateOrder, deleteOrder, duplicateOrder, updateSettings } = useStore();
  const program = getProgram(order.programId) ?? null;
  const locked = order.status === "confirmed";

  const calc = useMemo(() => calculateOrder(program, order), [program, order]);
  // Cùng nguồn quy tắc với engine: đơn đã chốt dùng bản chụp lúc chốt.
  const rules = order.frozenRules ?? program?.rules ?? NO_RULES;
  const groups = useMemo(() => purchasableGroups(program, rules), [program, rules]);
  const catalog = useMemo(() => buildCatalog(program), [program]);
  const strayLines = useMemo(() => orphanLines(calc.lines, catalog, groups), [calc.lines, catalog, groups]);
  // Đơn đã chốt giữ nguyên giá lúc chốt; đơn nháp thì báo khi danh mục đã đổi giá.
  const staleSkus = useMemo(() => (locked ? [] : stalePriceSkus(order, catalog)), [locked, order, catalog]);
  // Tồn kho chỉ hiện trên đơn nháp và khi đã có số liệu; các mã kho không đủ chỉ được cảnh báo, không chặn chốt đơn.
  const stockView = useMemo(
    () => orderStockView(stock, settings.lowStockThreshold, order.status, calc),
    [stock, settings.lowStockThreshold, order.status, calc],
  );
  const stockWarnings = stockView?.warnings ?? NO_STOCK_WARNINGS;
  const doc = useMemo<OrderDocument>(
    () => ({ order, program, calc, lines: linesInCatalogOrder(calc.lines, catalog) }),
    [order, program, calc, catalog],
  );
  const customerNames = useMemo(() => {
    const names = new Set<string>();
    for (const other of orders) {
      const name = other.customerName.trim();
      if (other.id !== order.id && name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "vi"));
  }, [orders, order.id]);

  const update = useStableCallback((fn: (current: Order) => Order) => updateOrder(order.id, fn));
  const setLine = useStableCallback((groupId: ID, item: PricedItem, qty: number) =>
    update((current) => setLineQty(current, groupId, item, qty)),
  );
  const setGift = (ruleId: ID, groupId: ID, item: PricedItem, qty: number) =>
    update((current) => setGiftQty(current, ruleId, groupId, item, qty));
  const applyPaste = (matches: SkuQtyMatch[]) =>
    update((current) => matches.reduce((next, m) => setLineQty(next, m.groupId, m.item, m.qty), current));
  const removeLine = (line: CalcLine) => update((current) => setLineQty(current, line.groupId, line, 0));
  // Tính lại trên đơn mới nhất để vị trí quà cần xóa luôn khớp với order.gifts.
  const removeOrphanGifts = () =>
    update((current) => removeGiftsAt(current, calculateOrder(program, current).orphanGiftIndexes));
  const updatePrices = () => {
    update((current) => refreshPrices(current, catalog));
    toast("Đã cập nhật giá theo danh mục");
  };
  // Máy chưa lưu thông tin sale: mời lưu luôn tên + điện thoại vừa gõ trên đơn để các đơn sau tự điền.
  const saleProfile = saleProfileToOffer(settings, order);
  const saveSaleProfile = () => {
    if (!saleProfile) return;
    updateSettings(saleProfile);
    toast(`Đã lưu, đơn mới sẽ tự điền sale: ${contactLine(saleProfile.salesperson, saleProfile.salespersonPhone)}`);
  };

  const [pasting, setPasting] = useState(false);
  const closePaste = useCallback(() => setPasting(false), []);

  // Điện thoại: nút trên thanh đáy nhảy qua lại giữa phần chọn hàng và phần kết quả.
  const pickerRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const [atResult, setAtResult] = useState(false);
  useEffect(() => {
    const result = resultRef.current;
    if (!result) return;
    const observer = new IntersectionObserver(([entry]) => setAtResult(entry.isIntersecting), {
      rootMargin: "0px 0px -50% 0px", // tính là "đang ở kết quả" khi nó đã lên tới nửa trên màn hình
    });
    observer.observe(result);
    return () => observer.disconnect();
  }, []);
  const jump = () => (atResult ? pickerRef : resultRef).current?.scrollIntoView({ block: "start" });

  const copySummary = async () => {
    const ok = await copyText(buildOrderText(doc));
    toast(ok ? "Đã sao chép nội dung đơn" : "Không sao chép được, hãy thử lại.", ok ? "success" : "error");
  };
  const exportExcel = async () => {
    try {
      await exportTableXlsx(safeFileName(`${order.code} ${order.customerName}`), [buildOrderSheet(doc)]);
      toast("Đã xuất file Excel");
    } catch {
      toast("Không xuất được file Excel.", "error");
    }
  };
  const duplicate = () => {
    const copy = duplicateOrder(order.id);
    if (!copy) return;
    navigate(`/orders/${copy.id}`);
    toast(`Đã nhân bản thành đơn ${copy.code}`);
  };
  const remove = () => {
    if (!window.confirm(`Xóa đơn ${order.code}? Thao tác này không thể hoàn tác.`)) return;
    navigate("/orders", { replace: true });
    deleteOrder(order.id);
    toast(`Đã xóa đơn ${order.code}`);
  };
  const confirmOrder = () => {
    update((current) => ({ ...current, status: "confirmed", frozenRules: structuredClone(rules) }));
    toast(`Đã chốt đơn ${order.code}`);
  };
  const reopenOrder = () => {
    const rulesChanged = JSON.stringify(order.frozenRules ?? null) !== JSON.stringify(program?.rules ?? null);
    if (
      rulesChanged &&
      !window.confirm(
        "Quy tắc của chương trình đã thay đổi sau khi đơn này được chốt. Mở lại thì đơn sẽ được tính lại theo quy tắc hiện tại. Tiếp tục?",
      )
    ) {
      return;
    }
    update((current) => {
      const next: Order = { ...current, status: "draft" };
      delete next.frozenRules;
      return next;
    });
    toast("Đã mở lại đơn để sửa");
  };

  const confirmBlocked =
    calc.totalQty === 0
      ? "Đơn chưa có dòng hàng nào."
      : calc.hasError
        ? "Đơn còn lỗi cần sửa trước khi chốt (xem phần Kết quả)."
        : null;
  const confirmButton = (className?: string) => (
    <Button
      variant="primary"
      className={className}
      onClick={confirmOrder}
      disabled={confirmBlocked != null}
      title={confirmBlocked ?? undefined}
    >
      <Check className="h-4 w-4" /> Chốt đơn
    </Button>
  );
  const period = program ? programStatus(program) : null;
  const periodNote = locked ? null : period === "ended" ? "đã kết thúc" : period === "upcoming" ? "chưa bắt đầu" : null;

  return (
    <>
      {/* Lề đáy chừa chỗ cho thanh tổng tiền trên điện thoại; thanh cao thêm một dòng khi có cảnh báo tồn kho. */}
      <div className={cx("lg:pb-0 print:hidden", stockWarnings.length > 0 ? "pb-32" : "pb-28")}>
        <PageHeader
          backTo="/orders"
          title={
            <span className="flex flex-wrap items-center gap-2">
              Đơn {order.code}
              <Badge tone={locked ? "green" : "gray"}>{ORDER_STATUS_LABEL[order.status]}</Badge>
            </span>
          }
          subtitle={
            <>
              {program ? (
                <>
                  <Link to={`/programs/${program.id}`} className="text-blue-700 hover:underline">
                    {program.name}
                  </Link>
                  {" · "}
                  {formatPeriod(program.startDate, program.endDate)}
                  {periodNote ? <span className="text-amber-700"> ({periodNote})</span> : null}
                </>
              ) : (
                <span className="text-amber-700">Chương trình đã bị xóa</span>
              )}
              {" · "}Tạo ngày {formatDate(order.createdAt)}
            </>
          }
          actions={
            <>
              <Button onClick={copySummary}>
                <Copy className="h-4 w-4" /> Sao chép
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> In
              </Button>
              <Button onClick={exportExcel}>
                <FileSpreadsheet className="h-4 w-4" /> Xuất Excel
              </Button>
              <Button onClick={duplicate}>
                <CopyPlus className="h-4 w-4" /> Nhân bản
              </Button>
              <Button variant="danger" onClick={remove}>
                <Trash2 className="h-4 w-4" /> Xóa
              </Button>
              {locked ? (
                <Button onClick={reopenOrder}>
                  <LockOpen className="h-4 w-4" /> Mở lại để sửa
                </Button>
              ) : (
                confirmButton()
              )}
            </>
          }
        />

        {locked ? (
          <Notice tone="info" className="mb-4">
            Đơn đã chốt. Bấm «Mở lại để sửa» nếu cần thay đổi.
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)] lg:items-start">
          <div className="min-w-0 space-y-4">
            <OrderInfoCard
              order={order}
              customerNames={customerNames}
              disabled={locked}
              onChange={(patch) => update((current) => ({ ...current, ...patch }))}
              onSaveSaleProfile={saleProfile ? saveSaleProfile : undefined}
            />
            {staleSkus.length > 0 ? (
              <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span className="min-w-0 flex-1 basis-64">
                  Danh mục đã đổi giá sau khi nhập {staleSkus.length} mã ({staleSkus.join(", ")}). Đơn vẫn đang tính
                  theo giá lúc nhập.
                </span>
                <Button size="sm" onClick={updatePrices}>
                  Cập nhật giá theo danh mục
                </Button>
              </Notice>
            ) : null}
            <OrphanLines lines={strayLines} disabled={locked} onRemove={removeLine} />
            <div ref={pickerRef} className="scroll-mt-2">
              {/* Gắn lại khi chốt / mở lại: đơn đã chốt mặc định chỉ hiện các dòng đã nhập. */}
              <ProductPicker
                key={order.status}
                groups={groups}
                lines={calc.lines}
                stockView={stockView}
                disabled={locked}
                emptyText={
                  program
                    ? "Chương trình chưa có sản phẩm nào để bán. Hãy thêm sản phẩm ở trang chương trình."
                    : "Chương trình của đơn này không còn tồn tại nên không có danh mục hàng để chọn."
                }
                onQty={setLine}
                onPaste={() => setPasting(true)}
              />
            </div>
          </div>

          <aside
            ref={resultRef}
            className="min-w-0 scroll-mt-2 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:flex-col"
          >
            <ResultPanel
              order={order}
              groups={program?.groups ?? []}
              rules={rules}
              calc={calc}
              stockView={stockView}
              disabled={locked}
              // Lặp lại nút chốt ngay dưới tổng tiền: sau khi kéo qua danh sách hàng dài thì thanh tiêu đề đã khuất.
              action={
                locked ? null : (
                  <>
                    {confirmButton("mt-3 w-full")}
                    {confirmBlocked ? <p className="mt-1 text-xs text-gray-500">{confirmBlocked}</p> : null}
                  </>
                )
              }
              onGiftQty={setGift}
              onRemoveOrphanGifts={removeOrphanGifts}
            />
          </aside>
        </div>
      </div>

      <MobileBar calc={calc} stockWarnings={stockWarnings} atResult={atResult} onToggle={jump} />
      <OrderPrint {...doc} />
      {pasting ? <PasteDialog lines={order.lines} groups={groups} onApply={applyPaste} onClose={closePaste} /> : null}
    </>
  );
}
