// Hộp thoại "Tạo đơn": chọn chương trình khuyến mãi rồi mở ngay đơn mới của chương trình đó.
import { formatPeriod, programStatus } from "../../lib/format";
import { Link, navigate } from "../../lib/router";
import { useStore } from "../../lib/store";
import type { Program, ProgramStatus } from "../../types";
import { Modal, cx } from "../../ui";
import ProgramStatusBadge from "../program/ProgramStatusBadge";

// Chương trình đang bán được xếp trước, đã kết thúc xếp cuối.
const STATUS_ORDER: Record<ProgramStatus, number> = { running: 0, open: 1, upcoming: 2, ended: 3 };

const choiceCls =
  "flex w-full cursor-pointer items-start justify-between gap-3 rounded-md border border-gray-200 px-3 py-2.5 " +
  "text-left hover:border-blue-500 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/** "Li-Ning · 05/11/2026 – 30/11/2026"; chương trình không thời hạn chỉ hiện hãng (nhãn trạng thái đã nói rõ). */
function describe(program: Program): string {
  const period = program.startDate || program.endDate ? formatPeriod(program.startDate, program.endDate) : "";
  return [program.brand, period].filter(Boolean).join(" · ");
}

export default function NewOrderDialog({ onClose }: { onClose: () => void }) {
  const { programs, createOrder } = useStore();
  const choices = programs
    .map((program) => ({ program, status: programStatus(program) }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const choose = (program: Program) => {
    const order = createOrder(program.id);
    navigate(`/orders/${encodeURIComponent(order.id)}`);
  };

  return (
    <Modal open onClose={onClose} title="Chọn chương trình">
      {choices.length === 0 ? (
        <p className="text-sm text-gray-700">
          Chưa có chương trình nào. Cần tạo chương trình khuyến mãi trước, sau đó mới tạo được đơn hàng.{" "}
          <Link to="/programs" className="font-medium text-blue-700 hover:underline">
            Đến trang Chương trình
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {choices.map(({ program, status }) => (
            <li key={program.id}>
              <button type="button" onClick={() => choose(program)} className={choiceCls}>
                <span className="min-w-0">
                  <span
                    className={cx("block text-sm font-medium", status === "ended" ? "text-gray-500" : "text-gray-900")}
                  >
                    {program.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">{describe(program)}</span>
                </span>
                <ProgramStatusBadge status={status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
