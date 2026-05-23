import React, { useState, useMemo } from "react";
import { Product, CartItem } from "../types";
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
  ShoppingBag
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

  // Helper to format currency
  const formatVND = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  // Helper to get present quantity in cart
  const getCartQuantity = (productId: string) => {
    const item = cart.find(i => i.product.ma_hang === productId);
    return item ? item.quantity : 0;
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
          Danh Mục 01 (Giảm 45%) ({productsCatalog1.length})
        </button>
        <button
          onClick={() => setActiveCatalogTab(2)}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${activeCatalogTab === 2 ? "border-[#D8232A] text-[#D8232A]" : "border-transparent text-gray-400 hover:text-gray-800"}`}
        >
          Danh Mục 02 (Mua Vợt Tặng Quà) ({productsCatalog2.length})
        </button>
        <button
          onClick={() => setActiveCatalogTab(3)}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${activeCatalogTab === 3 ? "border-[#D8232A] text-[#D8232A]" : "border-transparent text-gray-400 hover:text-gray-800"}`}
        >
          Danh Mục 03 (Phụ Kiện Kèm Theo) ({productsCatalog3.length})
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
              🔥 <strong>Danh Mục Hàng Số 01:</strong> Hỗ trợ mức giá chiết khấu đặc biệt giảm thẳng tới <strong className="text-red-600">45%</strong> (giá mua chỉ từ <strong className="text-green-600">486k</strong>) khi mua từ 2-4 sản phẩm và mua kèm 1 món bất kỳ thuộc Danh mục 03. 
              Ngoài ra, toàn bộ khung vợt thuộc Danh mục 01 đều được <strong className="text-red-600">tặng kèm 01 sợi cước N65</strong> miễn phí!
            </p>
          )}
          {activeCatalogTab === 2 && (
            <p>
              💎 <strong>Danh Mục Hàng Số 02:</strong> Tập hợp các dòng vợt siêu cao cấp dòng Axforce, Bladex, Halbertec chính hãng. 
              Doanh thu tích lũy từ danh mục này sẽ giúp đại lý mở khóa hạn mức tặng thêm các món quà tự chọn miễn phí từ Danh mục 01 (tỷ lệ lên tới <strong className="text-red-900 font-bold">27%</strong>).
            </p>
          )}
          {activeCatalogTab === 3 && (
            <p>
              ⚡ <strong>Danh Mục Hàng Số 03:</strong> Các phụ sản hỗ trợ thi đấu cần thiết. Đây là sản phẩm điều kiện bắt buộc để kích hoạt gói Ưu đãi A giảm 45% cho nhóm vợt thuộc Danh mục 01.
            </p>
          )}
        </div>
      </div>

      {/* No Products Alert */}
      {filteredProducts.length === 0 && (
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
            }}
            className="text-xs bg-neutral-900 text-white rounded px-3 py-1.5 font-semibold hover:bg-neutral-800 transition-colors"
          >
            Hiển thị lại tất cả sản phẩm
          </button>
        </div>
      )}

      {/* Grid View Layout */}
      {viewMode === "grid" && filteredProducts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" id="catalog-grid">
          {filteredProducts.map(p => {
            const qty = getCartQuantity(p.ma_hang);
            return (
              <div 
                key={p.ma_hang}
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
                      onClick={() => onUpdateCartQuantity(p, qty - 1, p.catalogId)}
                      className={`p-1.5 rounded-lg border transition-all ${qty > 0 ? 'bg-white border-neutral-300 hover:bg-neutral-100 text-neutral-800' : 'bg-neutral-100 border-neutral-200 text-neutral-300 cursor-not-allowed'}`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    
                    <span className="w-8 text-center font-bold text-sm font-mono text-neutral-800">
                      {qty}
                    </span>

                    <button
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
      {viewMode === "table" && filteredProducts.length > 0 && (
        <div className="overflow-hidden" id="catalog-table">
          <div className="overflow-x-auto pr-2">
            <table className="w-full text-left border-separate border-spacing-y-2">
              <thead className="sticky top-0 bg-[#F8F9FA] z-10">
                <tr className="text-[10px] text-gray-400 uppercase font-black tracking-wider">
                  <th className="px-4 py-2">Phân Loại</th>
                  <th className="px-4 py-2">Mã hàng (SKU)</th>
                  <th className="px-4 py-2">Tên sản phẩm</th>
                  <th className="px-4 py-2 text-right">Đơn giá lẻ</th>
                  <th className="px-4 py-2 text-right">Giá gốc sỉ</th>
                  <th className="px-4 py-2 text-right">Giá Siêu KM</th>
                  <th className="px-4 py-2 text-center">Đặt Nháp B2B</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {filteredProducts.map(p => {
                  const qty = getCartQuantity(p.ma_hang);
                  const inCart = qty > 0;
                  return (
                    <tr 
                      key={p.ma_hang}
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
                          <span className="text-gray-400 font-sans font-normal italic text-[10px]">Học tặng quà C</span>
                        )}
                      </td>

                      {/* Quick Add Counter with +/- */}
                      <td className="px-4 py-3.5 rounded-r">
                        <div className="flex items-center justify-center gap-1.5 max-w-[120px] mx-auto">
                          <button
                            disabled={qty === 0}
                            onClick={() => onUpdateCartQuantity(p, qty - 1, p.catalogId)}
                            className={`p-1.5 rounded bg-white border border-neutral-200 transition-all ${qty > 0 ? 'hover:bg-neutral-100 text-neutral-800' : 'text-neutral-300 cursor-not-allowed'}`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          
                          <span className="w-6 text-center font-bold font-mono text-xs text-neutral-850">
                            {qty}
                          </span>

                          <button
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
