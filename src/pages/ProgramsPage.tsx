// Danh sách chương trình khuyến mãi — màn hình đầu tiên của ứng dụng.
// Người quản lý tạo, nhân bản, xóa chương trình ở đây; vai trò khác (sale) chỉ mở xem và tạo đơn.
import { useState } from "react";
import { paginate, DEFAULT_PAGE_SIZE } from "../lib/paging";
import { Plus } from "lucide-react";
import type { Program, ProgramStatus } from "../types";
import { PROGRAM_STATUS_LABEL, formatNumber, formatPeriod, matchesSearch, programStatus } from "../lib/format";
import { newGroup, programItemCount } from "../lib/programOps";
import { canManage } from "../lib/roles";
import { Link, navigate } from "../lib/router";
import { useStore } from "../lib/store";
import {
  Button,
  EmptyState,
  FilterChip,
  FilterSelect,
  ListCard,
  PageHeader,
  Pagination,
  SearchInput,
  buttonCls,
  cx,
  numCls,
  tableCls,
  tableScrollCls,
  tdCls,
  thCls,
} from "../ui";
import ProgramStatusBadge from "../components/program/ProgramStatusBadge";
import SaleRoleNote from "../components/program/SaleRoleNote";
import { programPath, programTitle, useProgramActions } from "../components/program/programActions";

// Thứ tự các dòng trong bảng: đang chạy → sắp diễn ra → không thời hạn → đã kết thúc.
const ROW_ORDER: ProgramStatus[] = ["running", "upcoming", "open", "ended"];
const FILTER_OPTIONS: ProgramStatus[] = ["running", "upcoming", "ended", "open"];

/** Các nút trên một dòng: «Tạo đơn» cho mọi vai trò; «Nhân bản» và «Xóa» chỉ người quản lý mới có. */
function RowActions({ program, size }: { program: Program; size: "sm" | "md" }) {
  const { settings } = useStore();
  const actions = useProgramActions();
  return (
    <>
      <Button size={size} onClick={() => void actions.createOrderFor(program)} disabled={actions.creatingOrder}>
        {actions.creatingOrder ? "Đang tạo…" : "Tạo đơn"}
      </Button>
      {canManage(settings.role) ? (
        <>
          <Button size={size} onClick={() => actions.duplicate(program)}>
            Nhân bản
          </Button>
          <Button size={size} variant="danger" onClick={() => actions.remove(program)}>
            Xóa
          </Button>
        </>
      ) : null}
    </>
  );
}

/** Số đơn của chương trình. Có đơn thì bấm vào số để mở danh sách đơn hàng đã lọc theo chương trình này. */
function OrderCount({ program, unit = "" }: { program: Program; unit?: string }) {
  const { orderCountOf } = useStore();
  const count = orderCountOf(program.id);
  const text = `${formatNumber(count)}${unit}`;
  if (count === 0) return <>{text}</>;
  return (
    <Link to={`/orders?program=${encodeURIComponent(program.id)}`} className="text-blue-700 hover:underline">
      {text}
    </Link>
  );
}

// Bảng đủ 8 cột chỉ vừa màn hình rộng. Màn hình vừa bỏ hai cột đếm «Sản phẩm» và «Quy tắc», hai số đó ghi nhỏ ngay
// dưới tên; màn hình hẹp (điện thoại, máy tính bảng cầm dọc) chỉ còn cột tên, nội dung các cột khác ghi gọn dưới tên.
// Nhờ vậy không lúc nào phải kéo ngang bảng mới thấy các nút thao tác.
const FROM_LG = "max-lg:hidden";
const FROM_XL = "max-xl:hidden";

function ProgramRow({ program, status }: { program: Program; status: ProgramStatus }) {
  const brand = program.brand.trim();
  const period = formatPeriod(program.startDate, program.endDate);
  const itemCount = formatNumber(programItemCount(program));

  return (
    <tr className="hover:bg-blue-50/40">
      <td className={cx(tdCls, "lg:min-w-56")}>
        <Link to={programPath(program.id)} className="font-medium text-blue-700 hover:underline">
          {programTitle(program)}
        </Link>
        <p className="mt-0.5 hidden text-xs text-gray-500 lg:max-xl:block">
          {itemCount} sản phẩm · {program.rules.length} quy tắc
        </p>
        <div className="mt-1.5 space-y-2 text-gray-600 lg:hidden">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProgramStatusBadge status={status} />
            {[brand, status === "open" ? "" : period].filter(Boolean).join(" · ")}
          </p>
          <p>
            {itemCount} sản phẩm · {program.rules.length} quy tắc · <OrderCount program={program} unit=" đơn" />
          </p>
          <div className="flex flex-wrap gap-2">
            <RowActions program={program} size="md" />
          </div>
        </div>
      </td>
      <td className={cx(tdCls, FROM_LG, "whitespace-nowrap")}>{brand || "—"}</td>
      <td className={cx(tdCls, FROM_LG, "whitespace-nowrap")}>{period}</td>
      <td className={cx(tdCls, FROM_LG)}>
        <ProgramStatusBadge status={status} />
      </td>
      <td className={cx(tdCls, FROM_XL, numCls)}>{itemCount}</td>
      <td className={cx(tdCls, FROM_XL, numCls)}>{program.rules.length}</td>
      <td className={cx(tdCls, FROM_LG, numCls)}>
        <OrderCount program={program} />
      </td>
      <td className={cx(tdCls, FROM_LG)}>
        <div className="flex justify-end gap-1.5">
          <RowActions program={program} size="sm" />
        </div>
      </td>
    </tr>
  );
}

function ProgramsTable({ rows }: { rows: Array<{ program: Program; status: ProgramStatus }> }) {
  return (
    <div className={tableScrollCls}>
      <table className={tableCls}>
        <thead className={FROM_LG}>
          <tr>
            <th className={thCls}>Tên</th>
            <th className={thCls}>Hãng</th>
            <th className={thCls}>Thời gian</th>
            <th className={thCls}>Trạng thái</th>
            <th className={cx(thCls, FROM_XL, numCls)}>Sản phẩm</th>
            <th className={cx(thCls, FROM_XL, numCls)}>Quy tắc</th>
            <th className={cx(thCls, numCls)}>Đơn</th>
            <th className={thCls} aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ program, status }) => (
            <ProgramRow key={program.id} program={program} status={status} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ProgramsPage() {
  const { programs, settings, mode, createProgram } = useStore();
  const manager = canManage(settings.role);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProgramStatus | "all">("all");
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const create = () => {
    const program = createProgram({ name: "Chương trình mới", groups: [newGroup("Danh mục áp dụng")] });
    navigate(programPath(program.id));
  };

  const rows = programs
    .map((program) => ({ program, status: programStatus(program) }))
    // Trong mỗi trạng thái: ngày bắt đầu mới nhất xếp trước; trùng ngày thì giữ thứ tự của kho
    // (bản sao nằm ngay sau bản gốc).
    .sort(
      (a, b) =>
        ROW_ORDER.indexOf(a.status) - ROW_ORDER.indexOf(b.status) ||
        (b.program.startDate ?? "").localeCompare(a.program.startDate ?? ""),
    );
  const visible = rows.filter(
    ({ program, status }) =>
      (statusFilter === "all" || status === statusFilter) && matchesSearch(`${program.name} ${program.brand}`, query),
  );

  const page = paginate(visible, pageNo, pageSize);
  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setPageNo(1);
  };

  // Chỉ người quản lý mới có nút tạo chương trình (ở tiêu đề trang và ở khung «chưa có chương trình»).
  const createButton = manager ? (
    <Button variant="primary" onClick={create}>
      <Plus className="h-4 w-4" /> Tạo chương trình
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Chương trình khuyến mãi"
        subtitle={
          manager ? (
            "Mỗi chương trình gồm danh mục sản phẩm và các quy tắc khuyến mãi dùng để tính đơn hàng."
          ) : (
            <SaleRoleNote />
          )
        }
        actions={createButton}
      />

      {programs.length === 0 ? (
        <EmptyState
          title="Chưa có chương trình nào"
          hint={
            manager
              ? "Tạo chương trình đầu tiên, nhập danh mục sản phẩm từ Excel rồi khai báo quy tắc khuyến mãi." +
                (mode === "cloud" ? " Hoặc vào mục «Dữ liệu» để nạp chương trình mẫu hay đưa dữ liệu cũ của máy này lên." : "")
              : "Chương trình khuyến mãi do người quản lý tạo. Khi có chương trình, bạn mở ra xem và tạo đơn ở đây."
          }
          action={
            manager && mode === "cloud" ? (
              <>
                {createButton}
                <Link to="/settings" className={buttonCls()}>
                  Đến mục «Dữ liệu»
                </Link>
              </>
            ) : (
              createButton
            )
          }
        />
      ) : (
        <>
          <ListCard
            toolbar={
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <SearchInput
                    value={query}
                    onChange={(value) => {
                      setQuery(value);
                      setPageNo(1);
                    }}
                    placeholder="Tìm theo tên hoặc hãng…"
                    className="min-w-0 flex-1"
                  />
                  <FilterSelect
                    className="sm:w-52"
                    label="Trạng thái"
                    allLabel="Tất cả trạng thái"
                    value={statusFilter === "all" ? "" : statusFilter}
                    onChange={(value) => {
                      setStatusFilter((value || "all") as ProgramStatus | "all");
                      setPageNo(1);
                    }}
                    options={FILTER_OPTIONS.map((status) => ({ value: status, label: PROGRAM_STATUS_LABEL[status] }))}
                  />
                </div>
                {query.trim() || statusFilter !== "all" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-500">Đang lọc:</span>
                    {query.trim() ? <FilterChip label={`Tìm: “${query.trim()}”`} onRemove={() => setQuery("")} /> : null}
                    {statusFilter !== "all" ? (
                      <FilterChip
                        label={`Trạng thái: ${PROGRAM_STATUS_LABEL[statusFilter]}`}
                        onRemove={() => setStatusFilter("all")}
                      />
                    ) : null}
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
                  unit="chương trình"
                  onPage={setPageNo}
                  onSize={(size) => {
                    setPageSize(size);
                    setPageNo(1);
                  }}
                  note={visible.length < rows.length ? `(lọc từ ${formatNumber(rows.length)})` : undefined}
                />
              ) : null
            }
          >
            {visible.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <p className="text-sm font-medium text-gray-900">Không có chương trình nào khớp</p>
                <p className="mt-1 text-sm text-gray-500">Thử từ khóa khác hoặc đổi bộ lọc trạng thái.</p>
                <div className="mt-4">
                  <Button onClick={clearFilters}>Bỏ lọc</Button>
                </div>
              </div>
            ) : (
              <ProgramsTable rows={page.items} />
            )}
          </ListCard>
        </>
      )}
    </>
  );
}
