// Màn hình «Hướng dẫn»: theo vai trò (Sale / Quản lý), mỗi việc là vài bước đánh số kèm ảnh chụp màn hình thật
// và nút đi thẳng tới đúng màn hình; cuối trang là các câu hỏi thường gặp.
// Theo cách các phần mềm thương mại làm: trung tâm trợ giúp chia theo vai trò, hướng dẫn ngắn theo từng việc,
// nút «Hướng dẫn» ngay trên từng màn hình dẫn tới đúng mục.
import { useEffect, type ReactNode } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { canManage } from "../lib/roles";
import { Link, useQueryState } from "../lib/router";
import { useStore } from "../lib/store";
import { PageHeader, Tabs, buttonCls, cx } from "../ui";
import shotOrderEdit from "../assets/guide/order-edit.webp";
import shotNewOrder from "../assets/guide/new-order.webp";
import shotOrders from "../assets/guide/orders.webp";
import shotProducts from "../assets/guide/products.webp";
import shotPrograms from "../assets/guide/programs.webp";
import shotImport from "../assets/guide/import-products.webp";
import shotRules from "../assets/guide/rules.webp";
import shotStock from "../assets/guide/stock.webp";
import shotReport from "../assets/guide/report.webp";

type Audience = "sale" | "manager";

interface Topic {
  id: string;
  title: string;
  /** Một câu: làm việc này để được gì. */
  why: string;
  steps: ReactNode[];
  shot?: { src: string; alt: string };
  go?: { to: string; label: string };
  tip?: ReactNode;
}

const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-gray-900">{children}</strong>;

const SALE_TOPICS: Topic[] = [
  {
    id: "tao-don",
    title: "Tạo đơn cho đại lý",
    why: "Nhập hàng đại lý đặt, hệ thống tự tính giá sau khuyến mại và quà được tặng.",
    steps: [
      <>Vào <B>Đơn hàng</B>, bấm <B>Tạo đơn</B> rồi chọn chương trình khuyến mại.</>,
      <>Ghi <B>tên và số điện thoại đại lý</B>. Tên sale tự điền sẵn.</>,
      <>Gõ <B>số lượng</B> vào ô cạnh từng mã hàng. Có sẵn danh sách trong Excel / Zalo thì bấm <B>Dán mã + số lượng</B>.</>,
      <>Xem khung bên phải: <B>tiền thanh toán</B> và <B>quà tặng</B> tự cập nhật. Có quà được chọn thì chọn ở mục «Quà tặng».</>,
      <>Bấm <B>Chốt đơn</B>. Gửi cho đại lý bằng <B>Sao chép</B> (dán vào Zalo), <B>In</B> hoặc <B>Xuất Excel</B>.</>,
    ],
    shot: { src: shotOrderEdit, alt: "Màn hình nhập đơn: danh sách hàng bên trái, tiền và quà tặng bên phải" },
    go: { to: "/orders", label: "Mở Đơn hàng" },
    tip: <>Đơn chưa chốt là <B>Nháp</B>: sửa thoải mái, đóng trang không mất.</>,
  },
  {
    id: "chon-chuong-trinh",
    title: "Chọn đúng chương trình",
    why: "Mỗi chương trình có danh mục hàng và quà riêng; đơn tính theo chương trình bạn chọn lúc tạo.",
    steps: [
      <>Chương trình <B>Đang chạy</B> (nhãn xanh lá) là chương trình đang áp dụng.</>,
      <>Chưa chắc chương trình có gì: vào <B>Chương trình</B>, mở chương trình đó, xem tab <B>Quy tắc khuyến mãi</B>.</>,
    ],
    shot: { src: shotNewOrder, alt: "Hộp chọn chương trình khi tạo đơn" },
    go: { to: "/programs", label: "Xem các chương trình" },
  },
  {
    id: "xem-gia-ton",
    title: "Xem giá và tồn kho trước khi báo giá",
    why: "Biết mã nào còn hàng, giá lẻ bao nhiêu, đang nằm trong khuyến mại nào.",
    steps: [
      <>Vào <B>Sản phẩm</B>. Gõ mã hoặc tên vào ô tìm (không cần gõ dấu).</>,
      <>Lọc theo <B>hãng</B>, <B>loại hàng</B>, <B>mức giá</B>. Bấm ô <B>Sắp hết</B> / <B>Hết hàng</B> để xem riêng các mã đó.</>,
      <>Bấm vào một mã để xem <B>các chương trình có mã đó</B>, kèm giá lẻ và giá sỉ.</>,
    ],
    shot: { src: shotProducts, alt: "Màn hình sản phẩm với ô tìm, bộ lọc và số tồn kho" },
    go: { to: "/products", label: "Mở Sản phẩm" },
    tip: <>Đặt quá số tồn thì đơn có cảnh báo, nhưng vẫn chốt được (số tồn có thể đã cũ).</>,
  },
  {
    id: "tim-sua-don",
    title: "Tìm lại, sửa hoặc nhân bản đơn",
    why: "Đại lý đặt lại đơn giống lần trước, hoặc cần sửa đơn đã chốt.",
    steps: [
      <>Vào <B>Đơn hàng</B>, tìm theo mã đơn, tên đại lý hoặc số điện thoại; lọc theo chương trình, trạng thái.</>,
      <>Đơn đã chốt muốn sửa: mở đơn, bấm <B>Mở lại để sửa</B>, sửa xong bấm <B>Chốt đơn</B> lại.</>,
      <>Đơn giống đơn cũ: bấm <B>Nhân bản</B> rồi chỉ sửa chỗ khác.</>,
    ],
    shot: { src: shotOrders, alt: "Danh sách đơn hàng với bộ lọc và cột sale" },
    go: { to: "/orders", label: "Mở Đơn hàng" },
  },
];

const MANAGER_TOPICS: Topic[] = [
  {
    id: "tao-chuong-trinh",
    title: "Tạo chương trình khuyến mại",
    why: "Mỗi đợt khuyến mại là một chương trình: thời gian, danh mục hàng và quy tắc riêng.",
    steps: [
      <>Vào <B>Chương trình</B>, bấm <B>Tạo chương trình</B>.</>,
      <>Tab <B>Thông tin</B>: đặt tên, hãng, thời gian áp dụng (để trống = không thời hạn).</>,
      <>Có đợt cũ gần giống: bấm <B>Nhân bản</B> ở đợt cũ rồi sửa, nhanh hơn làm từ đầu.</>,
    ],
    shot: { src: shotPrograms, alt: "Danh sách chương trình khuyến mại" },
    go: { to: "/programs", label: "Mở Chương trình" },
  },
  {
    id: "nhap-san-pham",
    title: "Nhập danh mục sản phẩm từ Excel",
    why: "Đưa bảng giá (mã hàng, tên, giá lẻ, giá sỉ) vào chương trình, không phải gõ tay.",
    steps: [
      <>Mở chương trình, tab <B>Danh mục sản phẩm</B>, bấm <B>Nhập từ Excel</B>.</>,
      <>Chọn file Excel (hoặc dán các ô đã sao chép). Hệ thống tự nhận cột mã hàng, tên, giá.</>,
      <>Kiểm tra bảng xem trước. Danh mục đã có hàng thì chọn <B>Thêm vào / cập nhật theo mã hàng</B> (giữ mã cũ) hay <B>Thay thế toàn bộ</B>.</>,
      <>Bấm <B>Nhập</B>. Một chương trình có thể có nhiều danh mục: hàng áp dụng, hàng tặng…</>,
    ],
    shot: { src: shotImport, alt: "Hộp nhập sản phẩm từ Excel với bảng xem trước" },
    go: { to: "/programs", label: "Mở Chương trình" },
    tip: <>File có cột tồn kho thì số tồn cũng được cập nhật luôn.</>,
  },
  {
    id: "quy-tac",
    title: "Khai báo quy tắc khuyến mại",
    why: "Quy tắc quyết định đơn được giảm gì, tặng gì. Sale không phải tự tính.",
    steps: [
      <>Mở chương trình, tab <B>Quy tắc khuyến mãi</B>, bấm <B>Thêm quy tắc</B>.</>,
      <>Chọn kiểu: <B>Giảm giá</B> (theo %), <B>Mua X tặng Y</B>, hoặc <B>Tặng theo doanh số</B> (đạt mức tiền thì được chọn quà trong hạn mức).</>,
      <>Chọn danh mục áp dụng, danh mục quà và các mức. Quy tắc thiếu thông tin sẽ báo đỏ.</>,
      <>Thử ngay: tạo một đơn nháp của chương trình, nhập vài mã và xem kết quả bên phải.</>,
    ],
    shot: { src: shotRules, alt: "Tab quy tắc khuyến mại của một chương trình" },
    go: { to: "/programs", label: "Mở Chương trình" },
    tip: <>Sửa quy tắc không làm đổi đơn đã chốt: đơn đã chốt giữ quy tắc lúc chốt.</>,
  },
  {
    id: "ton-kho",
    title: "Cập nhật tồn kho",
    why: "Sale thấy mã nào sắp hết, hết hàng khi báo giá.",
    steps: [
      <>Xuất file tồn kho từ phần mềm kho (chỉ cần cột mã hàng và số lượng tồn).</>,
      <>Vào <B>Sản phẩm</B>, bấm <B>Cập nhật tồn kho</B>, chọn file.</>,
      <>Mặc định chỉ cập nhật các mã có trong file; mã khác giữ số cũ. Bấm nút <B>Cập nhật tồn kho … mã</B>.</>,
      <>Ngưỡng «sắp hết» (mặc định 5) đổi ở mục <B>Dữ liệu</B>.</>,
    ],
    shot: { src: shotStock, alt: "Hộp cập nhật tồn kho từ file Excel" },
    go: { to: "/products", label: "Mở Sản phẩm" },
    tip: <>Chốt đơn không tự trừ tồn kho; số tồn là số trong file kho lần nhập gần nhất.</>,
  },
  {
    id: "bao-cao",
    title: "Xem doanh số theo sale và chương trình",
    why: "Biết chương trình bán được bao nhiêu, tốn bao nhiêu tiền quà, sale nào chạy tốt.",
    steps: [
      <>Mở chương trình, tab <B>Tổng hợp</B>: doanh số, số lượng, giá trị quà theo từng sale.</>,
      <>Hoặc vào <B>Đơn hàng</B>, lọc theo sale / chương trình / trạng thái rồi bấm <B>Xuất Excel</B>.</>,
    ],
    shot: { src: shotReport, alt: "Tab tổng hợp doanh số theo sale" },
    go: { to: "/programs", label: "Mở Chương trình" },
  },
];

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: "Quà tặng và giảm giá được tính thế nào?",
    a: "Tự động theo quy tắc của chương trình mỗi khi số lượng thay đổi. Với «Tặng theo doanh số», hệ thống cho biết đơn đã đạt mức nào và còn bao nhiêu hạn mức để sale chọn quà.",
  },
  {
    q: "Sửa chương trình có làm thay đổi đơn đã chốt không?",
    a: "Không. Đơn đã chốt giữ nguyên quy tắc và giá lúc chốt. Đơn nháp thì tính theo chương trình hiện tại.",
  },
  {
    q: "Nhập Excel có xóa sản phẩm cũ không?",
    a: "Mặc định không: mã mới được thêm, mã đã có được cập nhật, mã không có trong file giữ nguyên. Chỉ khi bạn chọn «Thay thế toàn bộ» thì danh mục mới thành đúng như file.",
  },
  {
    q: "Tồn kho có tự trừ khi chốt đơn không?",
    a: "Không. Hệ thống chỉ hiển thị số tồn từ file kho và cảnh báo khi đặt quá số tồn. Kho thật vẫn quản lý ở phần mềm kho.",
  },
  {
    q: "Hãng và loại hàng ở màn hình Sản phẩm lấy từ đâu?",
    a: "File Excel không có hai cột này nên hệ thống tự nhận ra: hãng lấy từ chương trình, loại hàng từ tên hàng (vd «Khung vợt cầu lông…» là Vợt cầu lông).",
  },
  {
    q: "Dùng trên điện thoại được không?",
    a: "Được. Mở trang bằng trình duyệt điện thoại; danh sách tự chuyển sang dạng thẻ, tổng tiền của đơn nằm ở thanh dưới cùng.",
  },
];

function TopicCard({ topic }: { topic: Topic }) {
  return (
    <section id={`huong-dan-${topic.id}`} className="scroll-mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="p-4 sm:p-5">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">{topic.title}</h2>
          <p className="mt-1 text-sm text-gray-600">{topic.why}</p>
          <ol className="mt-4 space-y-3">
            {topic.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-700">
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
                >
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          {topic.tip ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-semibold">Mẹo: </span>
              {topic.tip}
            </p>
          ) : null}
          {topic.go ? (
            <Link to={topic.go.to} className={cx(buttonCls("default"), "mt-4")}>
              {topic.go.label} <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
        {topic.shot ? (
          <div className="border-t border-gray-200 bg-slate-50 p-3 sm:p-4 lg:border-l lg:border-t-0">
            <img
              src={topic.shot.src}
              alt={topic.shot.alt}
              loading="lazy"
              className="mx-auto block h-auto max-w-full rounded-lg border border-gray-200 bg-white shadow-xs"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function HelpPage() {
  const { settings } = useStore();
  const manager = canManage(settings.role);
  const [query, setQuery] = useQueryState({ role: manager ? "manager" : "sale", topic: "" });
  const audience: Audience = query.role === "manager" ? "manager" : "sale";
  const topics = audience === "manager" ? MANAGER_TOPICS : SALE_TOPICS;

  // Mở từ nút «Hướng dẫn» của một màn hình: cuộn tới đúng mục.
  useEffect(() => {
    if (!query.topic) return;
    const el = document.getElementById(`huong-dan-${query.topic}`);
    el?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.topic, audience]);

  return (
    <>
      <PageHeader
        title="Hướng dẫn sử dụng"
        subtitle="Mỗi việc chỉ vài bước. Chọn vai trò của bạn, làm theo các bước, rồi bấm nút để mở đúng màn hình."
      />

      <Tabs
        value={audience}
        onChange={(role) => setQuery({ role, topic: "" })}
        tabs={[
          { key: "sale", label: "Dành cho Sale" },
          { key: "manager", label: "Dành cho Quản lý" },
        ]}
      />

      <nav aria-label="Các việc trong hướng dẫn" className="mb-5 mt-1 flex flex-wrap gap-2">
        {topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => {
              setQuery({ topic: topic.id });
              document.getElementById(`huong-dan-${topic.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="cursor-pointer rounded-full border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 shadow-xs hover:border-blue-400 hover:text-blue-700"
          >
            {topic.title}
          </button>
        ))}
      </nav>

      <div className="space-y-4">
        {topics.map((topic) => (
          <TopicCard key={topic.id} topic={topic} />
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-gray-900">Câu hỏi thường gặp</h2>
        <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs">
          {FAQ.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-4 pb-4 text-sm text-gray-600">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
