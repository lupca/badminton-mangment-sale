// Trang một chương trình: thông tin, danh mục sản phẩm, quy tắc khuyến mãi, tổng hợp.
// Người quản lý sửa được mọi thứ; vai trò khác (sale) thấy cùng các tab đó ở dạng chỉ xem và chỉ có nút «Tạo đơn».
import { useCallback, useEffect, useRef } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { Program } from "../types";
import { formatPeriod, programStatus } from "../lib/format";
import { programItemCount } from "../lib/programOps";
import { canManage } from "../lib/roles";
import { Link, navigate, useRoute } from "../lib/router";
import { useStore } from "../lib/store";
import { Button, EmptyState, PageHeader, Tabs, buttonCls } from "../ui";
import ProgramReport from "../components/ProgramReport";
import ProductGroupsTab from "../components/program/ProductGroupsTab";
import ProgramInfoTab from "../components/program/ProgramInfoTab";
import ProgramReadOnly from "../components/program/ProgramReadOnly";
import RulesTab from "../components/program/RulesTab";
import { pruneAllowedSkus, type UpdateProgram } from "../components/program/programEdits";
import ProgramStatusBadge from "../components/program/ProgramStatusBadge";
import { programPath, programTitle, useProgramActions } from "../components/program/programActions";
import HelpLink from "../components/HelpLink";

const TAB_KEYS = ["info", "groups", "rules", "report"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** Ba tab sửa được của người quản lý. Chỉ được vẽ khi vai trò có quyền sửa chương trình. */
function ProgramEditor({ program, tab }: { program: Program; tab: Exclude<TabKey, "report"> }) {
  const { updateProgram, orderCountOf } = useStore();
  const programId = program.id;

  // `updateProgram` của kho là hàm mới sau mỗi lần lưu. Các bảng sản phẩm dài được memo, nên cần một hàm `update`
  // không đổi qua các lần vẽ lại — nếu không thì gõ một phím là vẽ lại cả trăm dòng.
  const latestUpdate = useRef(updateProgram);
  useEffect(() => {
    latestUpdate.current = updateProgram;
  });
  const update = useCallback<UpdateProgram>(
    (fn) => latestUpdate.current(programId, (current) => pruneAllowedSkus(fn(current))),
    [programId],
  );

  return (
    <>
      {tab === "info" ? <ProgramInfoTab program={program} update={update} /> : null}
      {tab === "groups" ? <ProductGroupsTab program={program} update={update} /> : null}
      {tab === "rules" ? <RulesTab program={program} orderCount={orderCountOf(programId)} update={update} /> : null}

      <p className="mt-4 text-xs text-gray-500 print:hidden">Mọi thay đổi được lưu tự động, không cần bấm Lưu.</p>
    </>
  );
}

export default function ProgramEditPage({ programId }: { programId: string }) {
  const { getProgram, settings } = useStore();
  const route = useRoute();
  const actions = useProgramActions();
  const manager = canManage(settings.role);

  // Tab đang mở nằm trên địa chỉ (#/programs/ID?tab=rules) để tải lại trang vẫn ở đúng tab.
  const tab: TabKey = TAB_KEYS.find((key) => key === route.query.get("tab")) ?? "info";

  const program = getProgram(programId);
  if (!program) {
    return (
      <EmptyState
        title="Không tìm thấy chương trình"
        hint="Chương trình này có thể đã bị xóa."
        action={
          <Link to="/programs" className={buttonCls()}>
            Về danh sách chương trình
          </Link>
        }
      />
    );
  }

  const openTab = (key: TabKey) =>
    navigate(programPath(program.id, key === "info" ? undefined : key), { replace: true });
  const status = programStatus(program);
  // Chương trình không thời hạn: nhãn trạng thái đã nói đủ, không ghi lại «Không thời hạn» lần nữa.
  const period = status === "open" ? "" : formatPeriod(program.startDate, program.endDate);

  return (
    <>
      <PageHeader
        title={programTitle(program)}
        backTo="/programs"
        subtitle={
          <>
            {[program.brand.trim(), period].filter(Boolean).map((fact) => `${fact} · `)}
            <ProgramStatusBadge status={status} />
          </>
        }
        actions={
          <>
            <HelpLink role={manager ? "manager" : "sale"} topic={manager ? "quy-tac" : "chon-chuong-trinh"} />
            <Button variant="primary" onClick={() => void actions.createOrderFor(program)} disabled={actions.creatingOrder}>
              <Plus className="h-4 w-4" /> {actions.creatingOrder ? "Đang tạo…" : "Tạo đơn"}
            </Button>
            {manager ? (
              <>
                <Button
                  onClick={() => {
                    // Mở luôn bản sao, để người dùng không sửa nhầm vào bản gốc.
                    const copy = actions.duplicate(program);
                    if (copy) navigate(programPath(copy.id));
                  }}
                >
                  <Copy className="h-4 w-4" /> Nhân bản
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (actions.remove(program)) navigate("/programs");
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Xóa
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={openTab}
        tabs={[
          { key: "info", label: "Thông tin" },
          { key: "groups", label: "Danh mục sản phẩm", count: programItemCount(program) },
          { key: "rules", label: "Quy tắc khuyến mãi", count: program.rules.length },
          { key: "report", label: "Tổng hợp" },
        ]}
      />

      {/* Tab «Tổng hợp» chỉ có số liệu nên vai trò nào cũng xem như nhau; ba tab còn lại tùy quyền sửa chương trình. */}
      {tab === "report" ? (
        <ProgramReport programId={program.id} />
      ) : manager ? (
        <ProgramEditor program={program} tab={tab} />
      ) : (
        <ProgramReadOnly program={program} tab={tab} />
      )}
    </>
  );
}
