import React, { useState, useMemo } from "react";
import { 
  Flame, 
  HelpCircle, 
  TrendingUp, 
  ChevronRight, 
  ShoppingBag, 
  Percent, 
  Gift, 
  Settings, 
  Activity, 
  Award, 
  Package, 
  FileText, 
  PhoneCall, 
  UserCheck, 
  Grid, 
  Clock, 
  Info,
  ChevronDown,
  Sparkles,
  RefreshCw,
  BellRing
} from "lucide-react";
import { 
  getCatalog1Products, 
  getCatalog2Products, 
  getCatalog3Products 
} from "./productsData";
import { Product, CartItem, FreeGiftSelection } from "./types";
import PromoHub from "./components/PromoHub";
import ProductCatalog from "./components/ProductCatalog";
import PromoCalculator from "./components/PromoCalculator";

export default function App() {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState<string>("dashboard");

  // Load catalogs data
  const catalog1Products = useMemo(() => getCatalog1Products(), []);
  const catalog2Products = useMemo(() => getCatalog2Products(), []);
  const catalog3Products = useMemo(() => getCatalog3Products(), []);

  // Cart LocalState
  const [cart, setCart] = useState<CartItem[]>([]);
  
  // Free Gifts selection LocalState
  const [giftSelections, setGiftSelections] = useState<FreeGiftSelection[]>([]);

  // Mobile tools drawer state
  const [mobileToolsOpen, setMobileToolsOpen] = useState<boolean>(false);

  // User Profile Simulator
  const [selectedAgent, setSelectedAgent] = useState({
    name: "Đại lý Thể Thao Hoàng Nam",
    code: "DL-HANOI-9981",
    tier: "Đại lý Cấp 1",
    region: "Khu vực Miền Bắc"
  });

  // Calculate quick metrics for the headers and stats badge
  const catalog1Count = useMemo(() => {
    return cart.filter(i => i.catalogId === 1).reduce((acc, curr) => acc + curr.quantity, 0);
  }, [cart]);

  const catalog3Count = useMemo(() => {
    return cart.filter(i => i.catalogId === 3).reduce((acc, curr) => acc + curr.quantity, 0);
  }, [cart]);

  const catalog2WholesaleSum = useMemo(() => {
    return cart.filter(i => i.catalogId === 2).reduce((acc, curr) => acc + (curr.product.don_gia_ban_buon * curr.quantity), 0);
  }, [cart]);

  const selectedGiftsValueSum = useMemo(() => {
    return giftSelections.reduce((acc, curr) => acc + (curr.product.don_gia_ban_buon * curr.quantity), 0);
  }, [giftSelections]);

  const totalCartWholesaleRaw = useMemo(() => {
    // Normal wholesale calculation
    return cart.reduce((acc, curr) => acc + (curr.product.don_gia_ban_buon * curr.quantity), 0);
  }, [cart]);

  // Handler to adjust cart quantity
  const handleUpdateCartQuantity = (product: Product, quantity: number, catalogId: 1 | 2 | 3) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(item => item.product.ma_hang !== product.ma_hang));
    } else {
      setCart(prev => {
        const idx = prev.findIndex(item => item.product.ma_hang === product.ma_hang);
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], quantity };
          return updated;
        } else {
          return [...prev, { product, quantity, catalogId }];
        }
      });
    }
  };

  // Handler to adjust gift selections
  const handleUpdateGiftQuantity = (product: Product, quantity: number) => {
    if (quantity <= 0) {
      setGiftSelections(prev => prev.filter(item => item.product.ma_hang !== product.ma_hang));
    } else {
      setGiftSelections(prev => {
        const idx = prev.findIndex(item => item.product.ma_hang === product.ma_hang);
        if (idx > -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], quantity };
          return updated;
        } else {
          return [...prev, { product, quantity }];
        }
      });
    }
  };

  const handleClearCart = () => {
    setCart([]);
    setGiftSelections([]);
  };

  const handleClearGifts = () => {
    setGiftSelections([]);
  };

  // Format currency helper
  const formatVND = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans" id="lining-b2b-app">
      
      {/* 1. TOP STICKY HEADER BRAND BAR */}
      <header className="sticky top-0 z-40 bg-zinc-900 border-b-2 border-red-600 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Branding Logo Pairings */}
            <div className="flex items-center gap-3">
              <div className="bg-red-600 p-2 rounded-lg text-white font-extrabold tracking-widest text-sm flex items-center justify-center animate-pulse">
                LI-NING
              </div>
              <div className="hidden sm:block border-l border-zinc-700 pl-3">
                <h1 className="text-sm font-bold tracking-tight uppercase">
                  Wholesale & Promotion Management
                </h1>
                <p className="text-[10px] text-red-500 font-semibold uppercase tracking-wider">
                  Cổng Nghiệp Vụ Đại Lý Hải Long 2026
                </p>
              </div>
            </div>

            {/* Live Ticker banner or warnings */}
            <div className="hidden lg:flex items-center gap-2 bg-zinc-800/80 px-3.5 py-1.5 rounded-full border border-zinc-700/60 text-xs">
              <BellRing className="w-3.5 h-3.5 text-red-500 animate-bounce" />
              <span className="text-zinc-300">
                Ưu đãi hiện có: <strong className="text-white">A (giảm 45%)</strong>, <strong className="text-white">B (tuyển N65)</strong>, <strong className="text-white">C (tích doanh số)</strong>
              </span>
            </div>

            {/* Active profile quick viewer */}
            <div className="flex items-center gap-2.5">
              <div className="text-right hidden md:block">
                <div className="text-xs font-bold text-white flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-red-500" /> {selectedAgent.name}
                </div>
                <div className="text-[9px] text-zinc-400 font-mono italic">
                  Mã: {selectedAgent.code} | {selectedAgent.tier}
                </div>
              </div>
              
              {/* Reset Cart trigger right on heading */}
              <div 
                onClick={() => {
                  setActiveTab("calculator");
                }}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer shadow transition hover:scale-102"
              >
                <ShoppingBag className="w-4 h-4" />
                <span className="font-mono bg-white text-red-600 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                  {cart.reduce((s, i) => s + i.quantity, 0)}
                </span>
                <span className="hidden sm:inline">Bản tính nháp</span>
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* 2. CORE LAYOUT SIDEBAR AND WORKSPACE CONTROLS */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row gap-6">
        
        {/* MOBILE NAVIGATION & COLLAPSIBLE ASSISTANT TOOLS */}
        <div className="block md:hidden w-full space-y-4">
          {/* Native-feeling Segment Control Tabs */}
          <div className="bg-white p-1 rounded-xl shadow-sm ring-1 ring-black/5 flex border border-neutral-200">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold text-center transition-all ${activeTab === "dashboard" ? "bg-[#D8232A] text-white shadow" : "text-neutral-500 hover:text-neutral-850"}`}
            >
              Phần khuyến mại
            </button>
            <button
              onClick={() => setActiveTab("catalog")}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold text-center transition-all ${activeTab === "catalog" ? "bg-[#D8232A] text-white shadow" : "text-neutral-500 hover:text-neutral-850"}`}
            >
              Bảng giá B2B
            </button>
            <button
              onClick={() => setActiveTab("calculator")}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold text-center transition-all ${activeTab === "calculator" ? "bg-[#D8232A] text-white shadow" : "text-neutral-500 hover:text-neutral-850"} flex items-center justify-center gap-1`}
            >
              Bản tính nháp
              <span className="font-mono bg-neutral-100 text-[#D8232A] text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            </button>
          </div>

          {/* Trigger Accordion for settings & assistant */}
          <div className="bg-white rounded-xl shadow-sm ring-1 ring-black/5 overflow-hidden">
            <button
              onClick={() => setMobileToolsOpen(!mobileToolsOpen)}
              className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-neutral-800 hover:bg-neutral-50 transition"
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#D8232A]" />
                <span className="truncate">Trợ lý Ưu đãi B2B</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${mobileToolsOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Collapsed Panel Content */}
            {mobileToolsOpen && (
              <div className="px-4 pb-4 pt-1 space-y-4 border-t border-neutral-100 bg-neutral-50/50">
                {/* Active promotion status wrapper */}
                <div className="bg-indigo-950 text-indigo-100 rounded-lg p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] bg-indigo-800 text-indigo-200 font-extrabold px-2 py-0.5 rounded uppercase tracking-wide">
                      Trợ lý thông thái B2B
                    </span>
                    <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div>
                      <div className="text-indigo-300 font-semibold text-[10px]">Ưu đãi C đạt được:</div>
                      <div className="font-mono text-white text-xs font-bold">
                        {catalog2WholesaleSum >= 50000000 ? "27% Mức Kim Cương" : 
                         catalog2WholesaleSum >= 35000000 ? "20% Mức Vàng" : 
                         catalog2WholesaleSum >= 20000000 ? "18% Mức Bạc" : 
                         catalog2WholesaleSum >= 8000000 ? "15% Mức Đồng" : "Chưa đạt hạng (Mốc >8M)"}
                      </div>
                    </div>
                    {/* Progress line */}
                    <div className="w-full bg-indigo-900 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-emerald-400 h-full rounded-full transition-all duration-300" 
                        style={{ width: `${Math.min((catalog2WholesaleSum / 50000000) * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Navigation Sidebar Drawer */}
        <aside className="hidden md:block w-full md:w-64 shrink-0 space-y-5">
          
          {/* Main Quick Hub Navigation */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-1.5">
            <h3 className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3 pl-1">
              Phân Hệ Bán Buôn
            </h3>

            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === "dashboard" ? "bg-red-600 text-white shadow-md shadow-red-200" : "text-neutral-600 hover:bg-neutral-100/80 hover:text-neutral-900"}`}
            >
              <div className="flex items-center gap-2.5">
                <Flame className="w-4 h-4 shrink-0" />
                <span>Trang Chủ Khuyến Mại</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setActiveTab("catalog")}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === "catalog" ? "bg-red-600 text-white shadow-md shadow-red-200" : "text-neutral-600 hover:bg-neutral-100/80 hover:text-neutral-900"}`}
            >
              <div className="flex items-center gap-2.5">
                <Package className="w-4 h-4 shrink-0" />
                <span>Danh Mục & Catalog B2B</span>
              </div>
              <span className="bg-neutral-100 text-neutral-600 text-[10px] font-mono px-1.5 py-0.5 rounded-full group-hover:bg-neutral-200 font-bold">
                HOT
              </span>
            </button>

            <button
              onClick={() => setActiveTab("calculator")}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === "calculator" ? "bg-red-600 text-white shadow-md shadow-red-200" : "text-neutral-600 hover:bg-neutral-100/80 hover:text-neutral-900"}`}
            >
              <div className="flex items-center gap-2.5">
                <ShoppingBag className="w-4 h-4 shrink-0" />
                <span>Bản Tính Ưu Đãi B2B</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Realtime Active Promotion status on sidebar */}
          <div className="bg-indigo-950 text-indigo-100 rounded-xl p-4 border border-indigo-900 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] bg-indigo-800 text-indigo-200 font-extrabold px-2 py-0.5 rounded tracking-wide uppercase">
                Trợ lý thông thái B2B
              </span>
              <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="text-indigo-300 font-semibold mb-1">Mức ưu đãi C đạt được:</div>
                <div className="font-mono text-white text-sm font-bold">
                  {catalog2WholesaleSum >= 50000000 ? "27% Mức Kim Cương" : 
                   catalog2WholesaleSum >= 35000000 ? "20% Mức Vàng" : 
                   catalog2WholesaleSum >= 20000000 ? "18% Mức Bạc" : 
                   catalog2WholesaleSum >= 8000000 ? "15% Mức Đồng" : "Chưa đạt hạng (Mốc >8M)"}
                </div>
              </div>

              {/* Progress visual line for Promo C */}
              <div className="w-full bg-indigo-900 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-400 h-full rounded-full transition-all duration-300" 
                  style={{ width: `${Math.min((catalog2WholesaleSum / 50000000) * 100, 100)}%` }}
                ></div>
              </div>

              <div className="text-[10px] text-indigo-300 leading-relaxed italic pt-1 border-t border-indigo-900/40">
                💡 {catalog1Count >= 2 && catalog1Count <= 4 && catalog3Count >= 1 
                  ? "Đã kích hoạt ưu đãi A (chiết khấu 45%) cho dòng vợt thuộc DM01!" 
                  : "Chưa kích hoạt ưu đãi A. Hãy mua 2-4 vợt DM01 và 1 phụ phẩm DM03 để được giảm 45%."}
              </div>
            </div>
          </div>



        </aside>

        {/* 3. MAIN WORKSPACE */}
        <main className="flex-1 space-y-6">
          
          {/* Active View Router rendering */}
          {activeTab === "dashboard" && (
            <PromoHub 
              onSetActiveTab={setActiveTab} 
              catalog1Count={catalog1Count}
              catalog3Count={catalog3Count}
              catalog2WholesaleSum={catalog2WholesaleSum}
              giftValueSelected={selectedGiftsValueSum}
            />
          )}

          {activeTab === "catalog" && (
            <ProductCatalog
              productsCatalog1={catalog1Products}
              productsCatalog2={catalog2Products}
              productsCatalog3={catalog3Products}
              cart={cart}
              onUpdateCartQuantity={handleUpdateCartQuantity}
              onClearCart={handleClearCart}
            />
          )}

          {activeTab === "calculator" && (
            <PromoCalculator
              cart={cart}
              giftSelections={giftSelections}
              catalog1Products={catalog1Products}
              onUpdateCartQuantity={handleUpdateCartQuantity}
              onUpdateGiftQuantity={handleUpdateGiftQuantity}
              onClearCart={handleClearCart}
              onClearGifts={handleClearGifts}
              onSetActiveTab={setActiveTab}
            />
          )}

        </main>
      </div>

      {/* 4. BRANDED FOOTER DESKS */}
      <footer className="bg-zinc-900 border-t border-zinc-800 text-zinc-400 text-xs py-5 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p>© 2026 LI-NING Badminton Wholesale Portal. Phối hợp vận hành bởi TNHH Quốc tế Hải Long.</p>
          <div className="flex gap-4">
            <a href="#" className="hover:underline">Bảng Pháp Nhân Luật</a>
            <span>•</span>
            <a href="#" className="hover:underline">Bộ tiêu chí đại lý chính hãng</a>
            <span>•</span>
            <a href="#" className="hover:underline">Hotline: 1900.2026.88</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
