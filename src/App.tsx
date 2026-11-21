import { Component, Suspense, useMemo, type ReactNode } from "react";
import { CircleHelp, Database, Package, ReceiptText, Tags, UserCircle, Users, type LucideIcon } from "lucide-react";
import { LockedScreen, PendingScreen } from "./components/account/WaitingScreens";
import { usePendingAccountCount } from "./lib/cloud/accounts";
import { AuthProvider, useAuth, useOptionalAuth } from "./lib/cloud/auth";
import { CloudStoreProvider } from "./lib/cloud/CloudStore";
import { cloudEnabled } from "./lib/cloud/config";
import { ROLE_LABEL, canManage } from "./lib/roles";
import LiNingMark from "./components/brand/LiNingMark";
import { hasStockAttention } from "./lib/catalog";
import { isChunkLoadError, lazyPage } from "./lib/lazyPage";
import { StoreProvider, useStore } from "./lib/store";
import { Link, useRoute } from "./lib/router";
import { Button, CenteredScreen, Notice, Toaster, cx } from "./ui";

// Mỗi màn hình là một phần tải riêng: lỗi ở màn hình này không làm hỏng màn hình khác.
const ProgramsPage = lazyPage(() => import("./pages/ProgramsPage"));
const ProgramEditPage = lazyPage(() => import("./pages/ProgramEditPage"));
const OrdersPage = lazyPage(() => import("./pages/OrdersPage"));
const OrderEditPage = lazyPage(() => import("./pages/OrderEditPage"));
const ProductsPage = lazyPage(() => import("./pages/ProductsPage"));
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"));
const AccountsPage = lazyPage(() => import("./pages/AccountsPage"));
const AuthPage = lazyPage(() => import("./pages/AuthPage"));
const HelpPage = lazyPage(() => import("./pages/HelpPage"));

const NAV: Array<{ to: string; section: string; label: string; icon: LucideIcon }> = [
  { to: "/programs", section: "programs", label: "Chương trình", icon: Tags },
  { to: "/orders", section: "orders", label: "Đơn hàng", icon: ReceiptText },
  { to: "/products", section: "products", label: "Sản phẩm", icon: Package },
  { to: "/settings", section: "settings", label: "Dữ liệu", icon: Database },
];
// Chỉ có khi chạy với máy chủ, và chỉ người quản lý thấy.
const ACCOUNTS_NAV = { to: "/accounts", section: "accounts", label: "Tài khoản", icon: Users };

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Notice tone="error">
        {isChunkLoadError(this.state.error) ? (
          <p className="font-medium">Ứng dụng vừa được cập nhật lên bản mới. Hãy tải lại trang để dùng tiếp.</p>
        ) : (
          <>
            <p className="font-medium">Có lỗi khi hiển thị màn hình này.</p>
            <p className="mt-1 break-words font-mono text-xs">{this.state.error.message}</p>
          </>
        )}
        <Button className="mt-3" onClick={() => window.location.reload()}>
          Tải lại trang
        </Button>
      </Notice>
    );
  }
}

/** Chấm đỏ nhắc việc trên một mục của thanh điều hướng. */
function NavDot({ label, title }: { label: string; title: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={title}
      className="absolute right-0 top-2 h-2 w-2 rounded-full bg-red-500 sm:right-1"
    />
  );
}

function Shell() {
  const route = useRoute();
  const { saveOk, programs, stock, settings, mode, sync } = useStore();
  const auth = useOptionalAuth();
  const [section = "programs", id] = route.parts;
  const cloud = mode === "cloud";
  const manager = canManage(settings.role);
  const accountAdmin = cloud && manager;
  // Có mã hết hàng / sắp hết trong các chương trình chưa kết thúc thì mục «Sản phẩm» có chấm đỏ để sale chú ý.
  const hasStockAlert = useMemo(
    () => hasStockAttention(programs, stock, settings.lowStockThreshold),
    [programs, stock, settings.lowStockThreshold],
  );
  const pendingAccounts = usePendingAccountCount(accountAdmin);

  let page: ReactNode;
  if (section === "programs") page = id ? <ProgramEditPage key={id} programId={id} /> : <ProgramsPage />;
  else if (section === "orders") page = id ? <OrderEditPage key={id} orderId={id} /> : <OrdersPage />;
  else if (section === "products") page = <ProductsPage />;
  else if (section === "settings") page = <SettingsPage />;
  else if (section === "help") page = <HelpPage />;
  else if (section === "accounts" && accountAdmin) page = <AccountsPage />;
  else page = <ProgramsPage />;

  const nav = accountAdmin ? [...NAV, ACCOUNTS_NAV] : NAV;
  const accountName = auth?.profile ? auth.profile.fullName.trim() || auth.profile.email : "";

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900 print:bg-white">
      <header className="border-b border-gray-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 px-4 sm:gap-x-6">
          <Link to="/programs" className="flex shrink-0 items-center gap-2 py-2.5" aria-label="Li-Ning — Chương trình khuyến mãi">
            <LiNingMark className="h-8 w-8 shrink-0 text-[#C5242C] sm:h-9 sm:w-9" />
            <span className="flex flex-col leading-tight">
              <span className="text-[15px] font-extrabold uppercase italic tracking-wide text-[#C5242C] sm:text-base">Li-Ning</span>
              <span className="whitespace-nowrap text-xs font-medium text-gray-600 sm:text-[13px]">Chương trình khuyến mãi</span>
            </span>
          </Link>
          {/* Điện thoại: thu hẹp lề từng mục để các mục vừa một hàng; không vừa (quản lý có thêm mục «Tài khoản») thì
              mục cuối xuống hàng — không mục nào bị khuất phải kéo ngang mới thấy.
              Màn hình hẹp: thanh mục xuống hàng dưới, vai trò nằm cùng hàng với tên ứng dụng. */}
          <nav className="flex max-w-full flex-wrap max-md:order-last sm:gap-1">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cx(
                  "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-1.5 py-3 text-sm font-medium sm:px-3 sm:py-3.5",
                  section === item.section
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-gray-600 hover:text-gray-900",
                )}
              >
                <item.icon aria-hidden className="h-4 w-4 max-sm:hidden" />
                {item.label}
                {item.section === "products" && hasStockAlert ? (
                  <NavDot label="có cảnh báo tồn kho" title="Có mã hết hàng hoặc sắp hết" />
                ) : null}
                {item.section === "accounts" && pendingAccounts > 0 ? (
                  <NavDot label="có tài khoản chờ duyệt" title={`${pendingAccounts} tài khoản đang chờ duyệt`} />
                ) : null}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            <Link
              to="/help"
              title="Hướng dẫn sử dụng"
              aria-label="Hướng dẫn sử dụng"
              className={cx(
                "flex shrink-0 items-center gap-1.5 rounded-full p-1 text-xs font-medium hover:bg-gray-100 sm:px-2.5",
                section === "help" ? "text-blue-700" : "text-gray-600",
              )}
            >
              <CircleHelp aria-hidden className="h-[18px] w-[18px] sm:h-4 sm:w-4" />
              <span className="max-sm:hidden">Hướng dẫn</span>
            </Link>
            {cloud && sync.state !== "idle" ? (
              <span
                role="status"
                className={cx("whitespace-nowrap text-xs", sync.state === "retrying" ? "text-amber-700" : "text-gray-500")}
              >
                {sync.state === "retrying" ? "Chưa lưu được" : "Đang lưu…"}
              </span>
            ) : null}
            {cloud ? (
              <Link
                to="/settings"
                title="Tài khoản đang đăng nhập — bấm để xem, đổi mật khẩu hoặc đăng xuất"
                className="flex min-w-0 items-center gap-1.5 rounded-full border border-gray-300 py-1 pl-1.5 pr-2.5 text-xs text-gray-600 shadow-xs hover:bg-gray-50"
              >
                <UserCircle aria-hidden className="h-4 w-4 shrink-0 text-gray-500" />
                {/* Màn hình hẹp chỉ hiện vai trò để còn nằm cùng hàng với tên ứng dụng. */}
                <span className="max-w-40 truncate max-sm:hidden">{accountName}</span>
                <span className="max-sm:hidden">·</span>
                <span className="font-semibold text-gray-900">{ROLE_LABEL[settings.role]}</span>
              </Link>
            ) : (
              <Link
                to="/settings"
                title="Vai trò trên máy này — bấm để đổi"
                className="flex items-center gap-1.5 rounded-full border border-gray-300 py-1 pl-1.5 pr-2.5 text-xs text-gray-600 shadow-xs hover:bg-gray-50"
              >
                <UserCircle aria-hidden className="h-4 w-4 shrink-0 text-gray-500" />
                {/* Màn hình rất hẹp chỉ hiện tên vai trò để còn nằm cùng hàng với tên ứng dụng. */}
                <span className="max-[399px]:hidden">Vai trò: </span>
                <span className="font-semibold text-gray-900">{ROLE_LABEL[settings.role]}</span>
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 print:max-w-none print:p-0">
        {!saveOk ? (
          <Notice tone="error" className="mb-4 print:hidden">
            Không lưu được dữ liệu xuống trình duyệt (có thể đã hết dung lượng). Hãy vào mục «Dữ liệu» để xuất file sao
            lưu ngay.
          </Notice>
        ) : null}
        {cloud && sync.state === "retrying" ? (
          <Notice tone="warning" className="mb-4 print:hidden">
            Chưa lưu được {sync.pending} thay đổi lên máy chủ (có thể đang mất mạng). Hệ thống sẽ tự lưu lại khi có
            mạng — đừng đóng hay tải lại trang này cho tới khi dòng này biến mất.
          </Notice>
        ) : null}
        <ErrorBoundary key={route.path}>
          <Suspense fallback={<p className="text-sm text-gray-500">Đang tải…</p>}>{page}</Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

/** Có máy chủ: phải đăng nhập, và tài khoản phải được quản lý duyệt, rồi mới vào được ứng dụng. */
function CloudGate() {
  const auth = useAuth();
  if (auth.status === "loading") {
    return (
      <CenteredScreen>
        {auth.error ? (
          <>
            <Notice tone="error">{auth.error}</Notice>
            <Button className="mt-3" onClick={() => void auth.refreshProfile()}>
              Thử lại
            </Button>
          </>
        ) : (
          <p className="text-sm text-gray-500">Đang tải…</p>
        )}
      </CenteredScreen>
    );
  }
  if (auth.status === "signedOut" || !auth.profile) {
    return (
      <Suspense fallback={null}>
        <AuthPage />
      </Suspense>
    );
  }
  if (auth.profile.role === "pending") return <PendingScreen />;
  if (auth.profile.role === "locked") return <LockedScreen />;
  // Đổi tài khoản thì dựng lại toàn bộ kho dữ liệu: không để dữ liệu của người trước lẫn sang người sau.
  return (
    <CloudStoreProvider key={auth.profile.id}>
      <Shell />
    </CloudStoreProvider>
  );
}

export default function App() {
  return (
    <>
      {cloudEnabled ? (
        <AuthProvider>
          <CloudGate />
        </AuthProvider>
      ) : (
        <StoreProvider>
          <Shell />
        </StoreProvider>
      )}
      <Toaster />
    </>
  );
}
