// Nút «Hướng dẫn» trên tiêu đề của một màn hình: mở trang hướng dẫn đúng vai trò, cuộn tới đúng việc.
import { CircleHelp } from "lucide-react";
import { Link } from "../lib/router";
import { buttonCls, cx } from "../ui";

export function helpPath(role: "sale" | "manager", topic = ""): string {
  return `/help?role=${role}${topic ? `&topic=${topic}` : ""}`;
}

export default function HelpLink({ role, topic }: { role: "sale" | "manager"; topic: string }) {
  return (
    <Link to={helpPath(role, topic)} className={cx(buttonCls("ghost"), "text-gray-600")} title="Xem hướng dẫn cho màn hình này">
      <CircleHelp className="h-4 w-4" /> Hướng dẫn
    </Link>
  );
}
