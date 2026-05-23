import React, { useState, useMemo } from "react";
import { Product, CartItem } from "../types";
import { CATALOG_INFO } from "../promoData";
import { 
  Search, 
  Grid, 
  List, 
  Plus, 
  Minus, 
  Filter, 
  CheckCircle2, 
  Tag, 
  Dribbble, 
  HelpCircle,
  TrendingDown,
  Percent,
  ChevronDown,
  ShoppingBag,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from "lucide-react";

interface ProductCatalogProps {
  productsCatalog1: Product[];
  productsCatalog2: Product[];
  productsCatalog3: Product[];
  cart: CartItem[];
  onUpdateCartQuantity: (product: Product, quantity: number, catalogId: 1 | 2 | 3) => void;
  onClearCart: () => void;
}

export default function ProductCatalog({
  productsCatalog1,
  productsCatalog2,
  productsCatalog3,
  cart,
  onUpdateCartQuantity,
  onClearCart
}: ProductCatalogProps) {
  // Tabs
  const [activeCatalogTab, setActiveCatalogTab] = useState<"all" | 1 | 2 | 3>("all");
  
  // View Toggle: "table" (B2B default with clean columns) vs "grid"
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeries, setSelectedSeries] = useState<string>("all");
  const [selectedSpec, setSelectedSpec] = useState<string>("all");

  // Extracted unique racket series & weights for quick filtration
  const racketSeriesOptions = useMemo(() => {
    const all = [...productsCatalog1, ...productsCatalog2];
    const seriesSet = new Set<string>();
    all.forEach(p => {
      if (p.series) seriesSet.add(p.series);
    });
    return ["all", ...Array.from(seriesSet)];
  }, [productsCatalog1, productsCatalog2]);

  const racketSpecOptions = useMemo(() => {
    const all = [...productsCatalog1, ...productsCatalog2];
    const specSet = new Set<string>();
    all.forEach(p => {
      if (p.spec && p.spec !== "N/A") specSet.add(p.spec);
    });
    return ["all", ...Array.from(specSet)];
  }, [productsCatalog1, productsCatalog2]);

  // Combine products with their catalogs index
  const mergedProducts = useMemo(() => {
    const list: (Product & { catalogId: 1 | 2 | 3 })[] = [];
    productsCatalog1.forEach(p => list.push({ ...p, catalogId: 1 }));
    productsCatalog2.forEach(p => list.push({ ...p, catalogId: 2 }));
    productsCatalog3.forEach(p => list.push({ ...p, catalogId: 3 }));
    return list;
  }, [productsCatalog1, productsCatalog2, productsCatalog3]);

  // Filter logic
  const filteredProducts = useMemo(() => {
    return mergedProducts.filter(p => {
      // Catalog tab filter
      if (activeCatalogTab !== "all" && p.catalogId !== activeCatalogTab) {
        return false;
      }

      // Search query (fuzzy: sku or name)
      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase();
        const matchesSku = p.ma_hang.toLowerCase().includes(query);
        const matchesName = p.ten_hang.toLowerCase().includes(query);
        if (!matchesSku && !matchesName) return false;
      }

      // Racket Series Filter (only applicable to rackets, catalog 1 & 2)
      if (selectedSeries !== "all" && p.series !== selectedSeries) {
        return false;
      }

      // Specification Filter (3U, 4U, 5U)
      if (selectedSpec !== "all" && p.spec !== selectedSpec) {
        return false;
      }

      return true;
    });
  }, [mergedProducts, activeCatalogTab, searchQuery, selectedSeries, selectedSpec]);

  // Sorting States & Actions for premium B2B user experience
  const [sortField, setSortField] = useState<"catalogId" | "ma_hang" | "ten_hang" | "don_gia_ban_le" | "don_gia_ban_buon" | "gia_sau_giam" | "cart_qty" | null>("ma_hang");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (field: "catalogId" | "ma_hang" | "ten_hang" | "don_gia_ban_le" | "don_gia_ban_buon" | "gia_sau_giam" | "cart_qty") => {
    if (sortField === field) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Helper to get present quantity in cart
  const getCartQuantity = (productId: string) => {
    const item = cart.find(i => i.product.ma_hang === productId);
    return item ? item.quantity : 0;
  };

  // Combined sorted products array
  const sortedProducts = useMemo(() => {
    if (!sortField) return filteredProducts;

    return [...filteredProducts].sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === "cart_qty") {
        valA = getCartQuantity(a.ma_hang);
        valB = getCartQuantity(b.ma_hang);
      } else if (sortField === "gia_sau_giam") {
        const hasA = a.gia_sau_giam !== undefined && a.gia_sau_giam !== null;
        const hasB = b.gia_sau_giam !== undefined && b.gia_sau_giam !== null;
        if (!hasA && !hasB) return 0;
        if (!hasA) return 1; // Put undefined/null prices at the bottom in both directions
        if (!hasB) return -1;
        valA = a.gia_sau_giam;
        valB = b.gia_sau_giam;
      } else {
        valA = a[sortField];
        valB = b[sortField];
      }

      if (typeof valA === "string" && typeof valB === "string") {
        return sortDirection === "asc"
          ? valA.localeCompare(valB, "vi")
          : valB.localeCompare(valA, "vi");
      }

      // Numeric comparison
      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredProducts, sortField, sortDirection, cart]);

  // Helper to format currency
  const formatVND = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  // Helper to render interactive table sort indicator
  const renderSortIndicator = (field: "catalogId" | "ma_hang" | "ten_hang" | "don_gia_ban_le" | "don_gia_ban_buon" | "gia_sau_giam" | "cart_qty") => {
    if (sortField !== field) {
      return (
        <ArrowUpDown className="w-3 h-3 text-neutral-400 opacity-40 group-hover:opacity-100 transition-opacity ml-1.5 shrink-0" />
      );
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3 h-3 text-[#D8232A] font-bold ml-1.5 shrink-0" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#D8232A] font-bold ml-1.5 shrink-0" />
    );
  };

  return (
    <div className="space-y-6" id="product-catalog-section">
      {/* Search and Filters Strip */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
          
          {/* Main Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-neutral-400" />
            <input 
              type="text" 
              placeholder="Tìm kiếm sản phẩm theo Mã hàng (SKU) hoặc Tên hàng..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-neutral-50 hover:bg-neutral-100/50 focus:bg-white border border-neutral-200 rounded-lg outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600 transition-all"
            />
          </div>

          {/* Grid/Table View Mode Controls */}
          <div className="flex items-center gap-2 self-end md:self-auto bg-neutral-100 p-1 rounded-lg border border-neutral-200">
            <button
              onClick={() => setViewMode("table")}
              title="Xem dạng Bảng chi tiết"
              className={`p-1.5 rounded-md flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide transition-all ${viewMode === "table" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
            >
              <List className="w-4 h-4" /> Bảng B2B
            </button>
            <button
              onClick={() => setViewMode("grid")}
              title="Xem dạng lưới ảnh"
              className={`p-1.5 rounded-md flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide transition-all ${viewMode === "grid" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
            >
              <Grid className="w-4 h-4" /> Lưới Thẻ
            </button>
          </div>
        </div>

        {/* Dropdown Filters for Series & Weights Specs */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-neutral-100 text-xs">
          <div className="flex items-center gap-1.5 text-neutral-500">
            <Filter className="w-3.5 h-3.5 text-red-600" /> Bộ lọc nhanh:
          </div>
          
          {/* Series selector */}
          <div className="flex items-center gap-1">
            <span className="text-neutral-400">Dòng vợt:</span>
            <select
              value={selectedSeries}
              onChange={(e) => setSelectedSeries(e.target.value)}
              className="bg-neutral-50 border border-neutral-200 hover:border-neutral-300 rounded px-2.5 py-1 text-xs text-neutral-800 focus:outline-none focus:ring-2 focus:ring-red-600/10 focus:border-red-600"
            >
              <option value="all">Tất cả các dòng vợt</option>
              {racketSeriesOptions.filter(o => o !== "all").map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* Spec Weight selector */}
          <div className="flex items-center gap-1">
            <span className="text-neutral-400">Trọng lượng (Spec):</span>
            <select
              value={selectedSpec}
              onChange={(e) => setSelectedSpec(e.target.value)}
              className="bg-neutral-50 border border-neutral-200 hover:border-neutral-300 rounded px-2.5 py-1 text-xs text-neutral-800 focus:outline-none focus:ring-2 focus:ring-red-600/10 focus:border-red-600"
            >
              <option value="all">Tất cả thông số (3U/4U/5U)</option>
              {racketSpecOptions.filter(o => o !== "all").map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* Reset Filters action */}
          {(searchQuery || selectedSeries !== "all" || selectedSpec !== "all") && (
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedSeries("all");
                setSelectedSpec("all");
              }}
              className="text-red-600 hover:text-red-700 font-semibold underline underline-offset-2 ml-auto cursor-pointer"
            >
              Xóa bộ lọc
            </button>
          )}
        </div>
      </div>

      {/* Catalog Tabs Strip */}
      <div className="flex border-b border-gray-200 mb-4 overflow-x-auto whitespace-nowrap scrollbar-none">
        <button
          onClick={() => setActiveCatalogTab("all")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${activeCatalogTab === "all" ? "border-[#D8232A] text-[#D8232A]" : "border-transparent text-gray-400 hover:text-gray-800"}`}
        >
          Tất cả sản phẩm ({mergedProducts.length})
        </button>
        <button
          onClick={() => setActiveCatalogTab(1)}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${activeCatalogTab === 1 ? "border-[#D8232A] text-[#D8232A]" : "border-transparent text-gray-400 hover:text-gray-800"}`}
        >
          {CATALOG_INFO[1].title} ({productsCatalog1.length})
        </button>
        <button
          onClick={() => setActiveCatalogTab(2)}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${activeCatalogTab === 2 ? "border-[#D8232A] text-[#D8232A]" : "border-transparent text-gray-400 hover:text-gray-800"}`}
        >
          {CATALOG_INFO[2].title} ({productsCatalog2.length})
        </button>
        <button
          onClick={() => setActiveCatalogTab(3)}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${activeCatalogTab === 3 ? "border-[#D8232A] text-[#D8232A]" : "border-transparent text-gray-400 hover:text-gray-800"}`}
        >
          {CATALOG_INFO[3].title} ({productsCatalog3.length})
        </button>
      </div>

      {/* Active Tab Explanation Header */}
      <div className="bg-red-50/50 p-3 rounded-lg border border-red-100 flex items-start gap-2.5 text-xs text-neutral-700">
        <Tag className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
        <div>
          {activeCatalogTab === "all" && (
            <p>
              💡 <strong>Xem toàn bộ kho hàng B2B:</strong> Nhấp vào các tab phía trên để thu hẹp phạm vi sản phẩm thuộc từng chương trình ưu đãi tương ứng.
            </p>
          )}
          {activeCatalogTab === 1 && (
            <p>
              🔥 <strong>{CATALOG_INFO[1].short}:</strong> {CATALOG_INFO[1].desc}
            </p>
          )}
          {activeCatalogTab === 2 && (
            <p>
              💎 <strong>{CATALOG_INFO[2].short}:</strong> {CATALOG_INFO[2].desc}
            </p>
          )}
          {activeCatalogTab === 3 && (
            <p>
              ⚡ <strong>{CATALOG_INFO[3].short}:</strong> {CATALOG_INFO[3].desc}
            </p>
          )}
        </div>
      </div>

      {/* Visual B2B Sorting status & reset utility for premium UI/UX */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-neutral-50 px-4 py-3 rounded-xl border border-neutral-200 text-xs text-neutral-600 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-[#D8232A]/10 p-1.5 rounded-lg text-[#D8232A]">
            <ArrowUpDown className="w-4 h-4 shrink-0" />
          </div>
          <div>
            Đang hiển thị <strong className="text-neutral-900 font-bold">{filteredProducts.length}</strong> sản phẩm. 
            {sortField ? (
              <span>
                {" "}Sắp xếp theo: <strong className="text-[#D8232A] font-bold">{
                  sortField === "catalogId" ? "Phân loại Danh mục" :
                  sortField === "ma_hang" ? "Mã hàng (SKU)" :
                  sortField === "ten_hang" ? "Tên sản phẩm" :
                  sortField === "don_gia_ban_le" ? "Giá lẻ niêm yết" :
                  sortField === "don_gia_ban_buon" ? "Giá gốc bán sỉ" :
                  sortField === "gia_sau_giam" ? "Giá khuyến mại sỉ 45%" :
                  sortField === "cart_qty" ? "Số lượng đã đặt nháp" : ""
                }</strong> ({sortDirection === "asc" ? "Tăng dần" : "Giảm dần"}).
              </span>
            ) : (
              <span> Nhấp trực tiếp vào tên cột ở bảng biểu B2B dưới đây để sắp xếp nhanh.</span>
            )}
          </div>
        </div>
        {sortField && (
          <button
            onClick={() => {
              setSortField(null);
              setSortDirection("asc");
            }}
            className="text-xs text-[#D8232A] hover:text-red-700 font-bold hover:underline transition-colors cursor-pointer self-end sm:self-auto"
          >
            Đặt lại mặc định
          </button>
        )}
      </div>

      {/* No Products Alert */}
      {sortedProducts.length === 0 && (
        <div className="bg-neutral-50 rounded-xl py-12 px-4 border border-dashed border-neutral-300 text-center space-y-2">
          <HelpCircle className="w-10 h-10 text-neutral-400 mx-auto" />
          <p className="text-sm font-semibold text-neutral-700">Không tìm thấy sản phẩm nào khớp với điều kiện lọc!</p>
          <p className="text-xs text-neutral-500">Hãy thử gõ từ khóa khác hoặc xóa bớt tiêu chí dòng vợt.</p>
          <button 
            onClick={() => {
              setSearchQuery("");
              setSelectedSeries("all");
              setSelectedSpec("all");
              setActiveCatalogTab("all");
              setSortField("ma_hang");
              setSortDirection("asc");
            }}
            className="text-xs bg-neutral-900 text-white rounded px-3 py-1.5 font-semibold hover:bg-neutral-805 transition-colors"
          >
            Hiển thị lại tất cả sản phẩm
          </button>
        </div>
      )}

      {/* Grid View Layout */}
      {viewMode === "grid" && sortedProducts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" id="catalog-grid">
          {sortedProducts.map(p => {
            const qty = getCartQuantity(p.ma_hang);
            return (
              <div 
                key={`${p.catalogId}-${p.ma_hang}`}
                className="bg-white rounded shadow-sm ring-1 ring-black/5 overflow-hidden hover:shadow-md transition-all flex flex-col justify-between border-t-4 border-[#D8232A]"
              >
                {/* Product Meta Header banner */}
                <div className="p-4 space-y-2.5">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-[10px] bg-neutral-100 text-neutral-600 font-mono px-2 py-0.5 rounded border border-neutral-200">
                      {p.ma_hang}
                    </span>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded uppercase ${p.catalogId === 1 ? 'bg-red-50 text-red-600 border border-red-200' : p.catalogId === 2 ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-neutral-100 text-neutral-600'}`}>
                      Danh mục 0{p.catalogId}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-neutral-900 line-clamp-2 h-10 min-h-[40px] leading-snug">
                    {p.ten_hang}
                  </h4>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5">
                    {p.series && (
                      <span className="bg-stone-100 text-stone-700 text-[10px] font-semibold px-2 py-0.5 rounded">
                        {p.series}
                      </span>
                    )}
                    {p.spec && p.spec !== "N/A" && (
                      <span className="bg-red-50 text-red-600 text-[10px] font-semibold px-2 py-0.5 rounded">
                        Spec: {p.spec}
                      </span>
                    )}
                    {p.catalogId === 1 && (
                      <span className="bg-yellow-100 text-yellow-800 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <Percent className="w-2.5 h-2.5" /> Giảm 45% & Tặng cước N65
                      </span>
                    )}
                  </div>

                  {/* Prices structure */}
                  <div className="space-y-1 pt-2 border-t border-neutral-100">
                    <div className="flex justify-between text-xs text-neutral-500">
                      <span>Giá lẻ hãng niêm yết:</span>
                      <span className="line-through">{formatVND(p.don_gia_ban_le)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold text-neutral-700">
                      <span>Giá bán buôn đại lý:</span>
                      <span className="font-mono text-neutral-900">{formatVND(p.don_gia_ban_buon)}</span>
                    </div>
                    {p.catalogId === 1 && p.gia_sau_giam && (
                      <div className="flex justify-between text-xs font-bold text-red-600 bg-red-50 p-1.5 rounded">
                        <span>Giá siêu khuyến mại 45%:</span>
                        <span className="font-mono text-red-600">{formatVND(p.gia_sau_giam)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Add to order actions bottom bar */}
                <div className="bg-neutral-50 border-t border-neutral-100 p-3 flex items-center justify-between">
                  <div className="text-[10px] text-neutral-400 italic">Số lượng trong nháp</div>
                  
                  <div className="flex items-center gap-1.5">
                    <button
                      disabled={qty === 0}
                      type="button"
                      onClick={() => onUpdateCartQuantity(p, qty - 1, p.catalogId)}
                      className={`p-1.5 rounded-lg border transition-all ${qty > 0 ? 'bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-800' : 'bg-neutral-100 border-neutral-200 text-neutral-300 cursor-not-allowed'}`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    
                    <input
                      type="number"
                      min="0"
                      value={qty === 0 ? "" : qty}
                      placeholder="0"
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        onUpdateCartQuantity(p, isNaN(val) ? 0 : Math.max(0, val), p.catalogId);
                      }}
                      className="w-12 text-center font-bold text-sm font-mono border border-neutral-300 rounded px-1 py-0.5 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 bg-white text-neutral-900"
                    />

                    <button
                      type="button"
                      onClick={() => onUpdateCartQuantity(p, qty + 1, p.catalogId)}
                      className="p-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm border border-red-700 hover:scale-105 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* B2B Dense Table View (Highly Preferred by Dealers) */}
      {viewMode === "table" && sortedProducts.length > 0 && (
        <div className="overflow-hidden" id="catalog-table">
          <div className="overflow-x-auto pr-2">
            <table className="w-full text-left border-separate border-spacing-y-2">
              <thead className="sticky top-0 bg-[#F8F9FA] z-10">
                <tr className="text-[10px] text-gray-500 uppercase font-bold tracking-wider select-none">
                  {/* Column 1: Catalog ID */}
                  <th 
                    onClick={() => handleSort("catalogId")}
                    title="Nhấp để sắp xếp theo Phân loại danh mục"
                    className="px-4 py-3 cursor-pointer group hover:bg-neutral-100 hover:text-[#D8232A] transition-colors rounded-l-lg"
                  >
                    <div className="flex items-center gap-1">
                      <span>Phân Loại</span>
                      {renderSortIndicator("catalogId")}
                    </div>
                  </th>

                  {/* Column 2: SKU */}
                  <th 
                    onClick={() => handleSort("ma_hang")}
                    title="Nhấp để sắp xếp theo Mã hàng (SKU)"
                    className="px-4 py-3 cursor-pointer group hover:bg-neutral-100 hover:text-[#D8232A] transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Mã hàng (SKU)</span>
                      {renderSortIndicator("ma_hang")}
                    </div>
                  </th>

                  {/* Column 3: Name */}
                  <th 
                    onClick={() => handleSort("ten_hang")}
                    title="Nhấp để sắp xếp theo Tên sản phẩm"
                    className="px-4 py-3 cursor-pointer group hover:bg-neutral-100 hover:text-[#D8232A] transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Tên sản phẩm</span>
                      {renderSortIndicator("ten_hang")}
                    </div>
                  </th>

                  {/* Column 4: List retail price */}
                  <th 
                    onClick={() => handleSort("don_gia_ban_le")}
                    title="Nhấp để sắp xếp theo Giá bán lẻ niêm yết"
                    className="px-4 py-3 cursor-pointer group hover:bg-neutral-100 hover:text-[#D8232A] transition-colors text-right"
                  >
                    <div className="flex items-center gap-1 justify-end">
                      <span>Đơn giá lẻ</span>
                      {renderSortIndicator("don_gia_ban_le")}
                    </div>
                  </th>

                  {/* Column 5: Wholesale Price */}
                  <th 
                    onClick={() => handleSort("don_gia_ban_buon")}
                    title="Nhấp để sắp xếp theo Giá gốc sỉ đại lý"
                    className="px-4 py-3 cursor-pointer group hover:bg-neutral-100 hover:text-[#D8232A] transition-colors text-right"
                  >
                    <div className="flex items-center gap-1 justify-end">
                      <span>Giá gốc sỉ</span>
                      {renderSortIndicator("don_gia_ban_buon")}
                    </div>
                  </th>

                  {/* Column 6: Special Promoted Price */}
                  <th 
                    onClick={() => handleSort("gia_sau_giam")}
                    title="Nhấp để sắp xếp theo Giá Siêu Khuyến Mãi"
                    className="px-4 py-3 cursor-pointer group hover:bg-neutral-100 hover:text-[#D8232A] transition-colors text-right"
                  >
                    <div className="flex items-center gap-1 justify-end">
                      <span>Giá Siêu KM</span>
                      {renderSortIndicator("gia_sau_giam")}
                    </div>
                  </th>

                  {/* Column 7: Draft Cart quantity */}
                  <th 
                    onClick={() => handleSort("cart_qty")}
                    title="Nhấp để sắp xếp lượng SP đang đặt trong nháp"
                    className="px-4 py-3 cursor-pointer group hover:bg-neutral-100 hover:text-[#D8232A] transition-colors text-center rounded-r-lg"
                  >
                    <div className="flex items-center gap-1 justify-center">
                      <span>Đặt Nháp B2B</span>
                      {renderSortIndicator("cart_qty")}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {sortedProducts.map(p => {
                  const qty = getCartQuantity(p.ma_hang);
                  const inCart = qty > 0;
                  return (
                    <tr 
                      key={`${p.catalogId}-${p.ma_hang}`}
                      className={`shadow-sm ring-1 ring-black/5 rounded transition-all bg-white hover:bg-gray-50 ${inCart ? 'ring-[#D8232A]/50 bg-red-50/10' : ''}`}
                    >
                      {/* Catalog Tag */}
                      <td className="px-4 py-3.5 rounded-l">
                        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded text-center whitespace-nowrap ${p.catalogId === 1 ? 'bg-red-50 text-[#D8232A]' : p.catalogId === 2 ? 'bg-indigo-50 text-indigo-800' : 'bg-neutral-100 text-neutral-800'}`}>
                          Danh Mục 0{p.catalogId}
                        </span>
                      </td>

                      {/* SKU */}
                      <td className="px-4 py-3.5 font-mono font-bold text-neutral-700 select-all">
                        {p.ma_hang}
                      </td>

                      {/* Name & Series specs */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-neutral-900">{p.ten_hang}</div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-neutral-500">
                          {p.series && <span>Dòng: <strong className="text-neutral-700 font-bold">{p.series}</strong></span>}
                          {p.spec && p.spec !== "N/A" && <span>• Spec: <strong className="text-[#D8232A] font-bold">{p.spec}</strong></span>}
                        </div>
                      </td>

                      {/* Retail Price */}
                      <td className="px-4 py-3.5 text-right text-gray-400 line-through">
                        {formatVND(p.don_gia_ban_le)}
                      </td>

                      {/* Wholesale Price */}
                      <td className="px-4 py-3.5 text-right font-semibold font-mono text-neutral-800">
                        {formatVND(p.don_gia_ban_buon)}
                      </td>

                      {/* After Promo Price */}
                      <td className="px-4 py-3.5 text-right font-black font-mono text-[#D8232A]">
                        {p.gia_sau_giam ? (
                          <div className="space-y-0.5">
                            <div>{formatVND(p.gia_sau_giam)}</div>
                            <div className="text-[9px] text-[#D8232A] font-sans font-bold uppercase tracking-wider">(Gói 45%)</div>
                          </div>
                        ) : (
                          <span className="text-neutral-400 font-sans font-normal text-xs">—</span>
                        )}
                      </td>

                      {/* Quick Add Counter with +/- */}
                      <td className="px-4 py-3.5 rounded-r">
                        <div className="flex items-center justify-center gap-1.5 max-w-[120px] mx-auto">
                          <button
                            disabled={qty === 0}
                            type="button"
                            onClick={() => onUpdateCartQuantity(p, qty - 1, p.catalogId)}
                            className={`p-1.5 rounded bg-white border border-neutral-200 transition-all ${qty > 0 ? 'hover:bg-neutral-100 text-neutral-800' : 'text-neutral-300 cursor-not-allowed'}`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          
                          <input
                            type="number"
                            min="0"
                            value={qty === 0 ? "" : qty}
                            placeholder="0"
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              onUpdateCartQuantity(p, isNaN(val) ? 0 : Math.max(0, val), p.catalogId);
                            }}
                            className="w-12 text-center font-bold text-xs font-mono border border-neutral-300 rounded px-1 py-0.5 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 bg-white text-neutral-900"
                          />

                          <button
                            type="button"
                            onClick={() => onUpdateCartQuantity(p, qty + 1, p.catalogId)}
                            className="p-1.5 rounded bg-[#D8232A] hover:bg-red-700 text-white shadow-sm transition-transform active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
