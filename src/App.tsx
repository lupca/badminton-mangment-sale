import { Component, Suspense, lazy, type ReactNode } from "react";
import { StoreProvider, useStore } from "./lib/store";
import { Link, useRoute } from "./lib/router";
import { Button, Notice, Toaster, cx } from "./ui";

// Mỗi màn hình là một phần tải riêng: lỗi ở màn hình này không làm hỏng màn hình khác.
const ProgramsPage = lazy(() => import("./pages/ProgramsPage"));
const ProgramEditPage = lazy(() => import("./pages/ProgramEditPage"));
const OrdersPage = lazy(() => import("./pages/OrdersPage"));
const OrderEditPage = lazy(() => import("./pages/OrderEditPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const NAV = [
  { to: "/programs", section: "programs", label: "Chương trình" },
  { to: "/orders", section: "orders", label: "Đơn hàng" },
  { to: "/settings", section: "settings", label: "Dữ liệu" },
];

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Notice tone="error">
        <p className="font-medium">Có lỗi khi hiển thị màn hình này.</p>
        <p className="mt-1 break-words font-mono text-xs">{this.state.error.message}</p>
        <Button className="mt-3" onClick={() => window.location.reload()}>
          Tải lại trang
        </Button>
      </Notice>
    );
  }
}

function Shell() {
  const route = useRoute();
  const { saveOk } = useStore();
  const [section = "programs", id] = route.parts;

  let page: ReactNode;
  if (section === "programs") page = id ? <ProgramEditPage key={id} programId={id} /> : <ProgramsPage />;
  else if (section === "orders") page = id ? <OrderEditPage key={id} orderId={id} /> : <OrdersPage />;
  else if (section === "settings") page = <SettingsPage />;
  else page = <ProgramsPage />;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 print:bg-white">
      <header className="border-b border-gray-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 px-4">
          <Link to="/programs" className="py-3 text-base font-semibold text-gray-900">
            Quản lý khuyến mãi
          </Link>
          <nav className="flex gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cx(
                  "border-b-2 px-3 py-3 text-sm font-medium",
                  section === item.section
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-gray-600 hover:text-gray-900",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 print:max-w-none print:p-0">
        {!saveOk ? (
          <Notice tone="error" className="mb-4 print:hidden">
            Không lưu được dữ liệu xuống trình duyệt (có thể đã hết dung lượng). Hãy vào mục «Dữ liệu» để xuất file sao
            lưu ngay.
          </Notice>
        ) : null}
        <ErrorBoundary key={route.path}>
          <Suspense fallback={<p className="text-sm text-gray-500">Đang tải…</p>}>{page}</Suspense>
        </ErrorBoundary>
      </main>
      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
