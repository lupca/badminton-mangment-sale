import type { ProgramStatus } from "../../types";
import { PROGRAM_STATUS_LABEL } from "../../lib/format";
import { Badge } from "../../ui";

const STATUS_TONE = {
  running: "green",
  upcoming: "blue",
  ended: "gray",
  open: "gray",
} as const satisfies Record<ProgramStatus, string>;

/** Nhãn trạng thái: đang chạy (xanh lá), sắp diễn ra (xanh dương), đã kết thúc / không thời hạn (xám). */
export default function ProgramStatusBadge({ status }: { status: ProgramStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{PROGRAM_STATUS_LABEL[status]}</Badge>;
}
