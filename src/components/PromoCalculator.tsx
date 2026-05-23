import React, { useMemo } from "react";
import { Product, CartItem, FreeGiftSelection } from "../types";
import { 
  ShoppingBag, 
  Trash2, 
  ArrowRight, 
  Gift, 
  AlertCircle, 
  CheckCircle, 
  Percent, 
  Flame, 
  Sparkles, 
  Plus, 
  Minus,
  Check, 
  PackageCheck,
  Building,
  Printer,
  ChevronRight,
  RefreshCw,
  Award
} from "lucide-react";
import { PROMO_C_TIERS } from "../productsData";

interface PromoCalculatorProps {
  cart: CartItem[];
  giftSelections: FreeGiftSelection[];
  catalog1Products: Product[];
  onUpdateCartQuantity: (product: Product, quantity: number, catalogId: 1 | 2 | 3) => void;
  onUpdateGiftQuantity: (product: Product, quantity: number) => void;
  onClearCart: () => void;
  onClearGifts: () => void;
  onSetActiveTab: (tab: string) => void;
}

export default function PromoCalculator({
  cart,
  giftSelections,
  catalog1Products,
  onUpdateCartQuantity,
  onUpdateGiftQuantity,
  onClearCart,
  onClearGifts,
  onSetActiveTab
}: PromoCalculatorProps) {

  // Formatter
  const formatVND = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  // Extract separate counts and sums
  const catalog1Items = useMemo(() => cart.filter(i => i.catalogId === 1), [cart]);
  const catalog2Items = useMemo(() => cart.filter(i => i.catalogId === 2), [cart]);
  const catalog3Items = useMemo(() => cart.filter(i => i.catalogId === 3), [cart]);

  const catalog1TotalQty = useMemo(() => {
    return catalog1Items.reduce((acc, curr) => acc + curr.quantity, 0);
  }, [catalog1Items]);

  const catalog3TotalQty = useMemo(() => {
    return catalog3Items.reduce((acc, curr) => acc + curr.quantity, 0);
  }, [catalog3Items]);

  // Wholesale value of Catalog 02 ordered items
  const catalog2WholesaleSum = useMemo(() => {
    return catalog2Items.reduce((acc, curr) => acc + (curr.product.don_gia_ban_buon * curr.quantity), 0);
  }, [catalog2Items]);

  // Determine Promo A (45% Discount on Cat 1 matches: buy 2-4 items in Cat 1 + at least 1 item in Cat 3)
  const isPromoAEligible = catalog1TotalQty >= 2 && catalog1TotalQty <= 4 && catalog3TotalQty >= 1;

  // Real-time Bill Calculations
  const calculatedSums = useMemo(() => {
    let totalRetail = 0;
    
    // Wholesale sum depends on Promo A activation status for Catalog 1 items
    let totalWholesale = 0;

    cart.forEach(item => {
      const q = item.quantity;
      totalRetail += item.product.don_gia_ban_le * q;

      if (item.catalogId === 1) {
        if (isPromoAEligible && item.product.gia_sau_giam) {
          totalWholesale += item.product.gia_sau_giam * q;
        } else {
          totalWholesale += item.product.don_gia_ban_buon * q;
        }
      } else {
        totalWholesale += item.product.don_gia_ban_buon * q;
      }
    });

    const savedAmount = totalRetail - totalWholesale;

    return {
      totalRetail,
      totalWholesale,
      savedAmount
    };
  }, [cart, isPromoAEligible]);

  // Determine Promo C Gift Allowance (based on Catalog 02 total wholesale value)
  const activePromoCTier = useMemo(() => {
    // Tiers mapping
    // >8M: <15%
    // >20M: <18%
    // >35M: <20%
    // >50M: <27%
    let matchedTier = PROMO_C_TIERS[0];
    for (let i = PROMO_C_TIERS.length - 1; i >= 0; i--) {
      if (catalog2WholesaleSum >= PROMO_C_TIERS[i].minWholesalePrice) {
        matchedTier = PROMO_C_TIERS[i];
        break;
      }
    }
    return matchedTier;
  }, [catalog2WholesaleSum]);

  // Calculate maximum total value allowed for gifts in Vietnam Đống
  const maxGiftValueAllowed = useMemo(() => {
    if (activePromoCTier.giftPercent === 0) return 0;
    return (catalog2WholesaleSum * activePromoCTier.giftPercent) / 100;
  }, [catalog2WholesaleSum, activePromoCTier]);

  // Calculate selected gifts value
  const selectedGiftsValueSum = useMemo(() => {
    return giftSelections.reduce((acc, curr) => acc + (curr.product.don_gia_ban_buon * curr.quantity), 0);
  }, [giftSelections]);

  const remainingGiftValue = useMemo(() => {
    return maxGiftValueAllowed - selectedGiftsValueSum;
  }, [maxGiftValueAllowed, selectedGiftsValueSum]);

  // Next tier optimization calculations
  const nextPromoCTierInfo = useMemo(() => {
    const currentIdx = PROMO_C_TIERS.findIndex(t => t.giftPercent === activePromoCTier.giftPercent);
    if (currentIdx !== -1 && currentIdx < PROMO_C_TIERS.length - 1) {
      const nextTier = PROMO_C_TIERS[currentIdx + 1];
      const distance = nextTier.minWholesalePrice - catalog2WholesaleSum;
      return {
        nextTier,
        distance
      };
    }
    return null;
  }, [activePromoCTier, catalog2WholesaleSum]);

  // Free strings counts in Promo B
  const freeStringsCount = useMemo(() => {
    return catalog1TotalQty;
  }, [catalog1TotalQty]);

  // Submit Draft simulation flow
  const handlePrintOrder = () => {
    window.print();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="calculator-engine">
      
      {/* LEFT COLUMN: Order Review Receipt Layout (7 Cols) */}
      <div className="lg:col-span-7 bg-white rounded shadow-sm ring-1 ring-black/5 overflow-hidden flex flex-col justify-between">
        
        {/* Header Receipt Card */}
        <div className="p-4 bg-neutral-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#D8232A]" />
            <div>
              <h3 className="text-xs font-black tracking-wider uppercase">Bản Dự Toán Chi Chiết Khấu Nháp</h3>
              <p className="text-[10px] text-gray-400 font-mono">ID: LN-2026-{(calculatedSums.totalWholesale % 100000).toString().padStart(5, "0")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={onClearCart}
              title="Xóa toàn bộ giỏ"
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors px-2 py-1 bg-neutral-900 rounded border border-neutral-800 hover:bg-neutral-800"
            >
              <Trash2 className="w-3.5 h-3.5" /> Xóa giỏ hàng
            </button>
          </div>
        </div>

        {/* List of Cart Items */}
        <div className="p-4 flex-1 divide-y divide-neutral-100 max-h-[500px] overflow-y-auto">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-neutral-400 space-y-3">
              <ShoppingBag className="w-12 h-12 text-neutral-300 mx-auto animate-bounce" />
              <p className="text-sm font-medium">Bản tính nháp của đại lý đang trống!</p>
              <p className="text-xs max-w-sm mx-auto">Vui lòng quay lại tab Danh Mục Sản Phẩm để lựa chọn các mã vợt và phụ kiện cần phối hợp tính toán chiết khấu.</p>
              <button 
                onClick={() => onSetActiveTab("catalog")}
                className="text-xs bg-red-600 font-semibold text-white px-4 py-2 rounded-lg hover:bg-red-700 transition"
              >
                Tới xem catalog
              </button>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {cart.map(item => {
                const isCat1 = item.catalogId === 1;
                // Cost calculation per item: Check if Promo A is currently qualifying
                const actualUnitPrice = isCat1 && isPromoAEligible && item.product.gia_sau_giam
                  ? item.product.gia_sau_giam
                  : item.product.don_gia_ban_buon;

                return (
                  <div key={item.product.ma_hang} className="flex items-start justify-between gap-4 pt-4 first:pt-0 group">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${item.catalogId === 1 ? 'bg-red-100 text-red-700' : item.catalogId === 2 ? 'bg-indigo-100 text-indigo-700' : 'bg-stone-100 text-stone-700'}`}>
                          Danh Mục 0{item.catalogId}
                        </span>
                        <span className="font-mono text-[10px] text-neutral-400 group-hover:text-neutral-600">{item.product.ma_hang}</span>
                      </div>
                      
                      <h4 className="text-xs font-bold text-neutral-900 group-hover:text-[#D8232A] transition-colors">
                        {item.product.ten_hang}
                      </h4>

                      {/* Display specs badges */}
                      <div className="flex items-center gap-3 text-[10px] text-neutral-500">
                        {item.product.series && <span>Dòng: <strong className="font-bold text-neutral-700">{item.product.series}</strong></span>}
                        {item.product.spec && item.product.spec !== "N/A" && <span>• Spec: <strong className="font-bold text-[#D8232A]">{item.product.spec}</strong></span>}
                      </div>

                      {/* Price labels feedback */}
                      <div className="text-[10px] text-neutral-500 space-x-2">
                        <span>Lẻ: <span className="line-through">{formatVND(item.product.don_gia_ban_le)}</span></span>
                        <span>Buôn gốc: <span className="font-mono font-medium">{formatVND(item.product.don_gia_ban_buon)}</span></span>
                        
                        {isCat1 && isPromoAEligible && (
                          <span className="text-[#D8232A] font-bold bg-red-50 px-1 rounded">
                            KM 45%: {formatVND(item.product.gia_sau_giam || 0)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quantity manipulation and price sum */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onUpdateCartQuantity(item.product, item.quantity - 1, item.catalogId)}
                          className="p-2 border border-neutral-300 rounded-lg bg-white hover:bg-neutral-100 text-neutral-800 active:scale-90 transition-all"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center text-xs font-bold font-mono text-neutral-800">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => onUpdateCartQuantity(item.product, item.quantity + 1, item.catalogId)}
                          className="p-2 bg-[#D8232A] hover:bg-red-750 text-white rounded-lg active:scale-90 transition-all"
                          aria-label="Increase quantity"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="text-right">
                        <div className="text-xs font-bold font-mono text-neutral-900">
                          {formatVND(actualUnitPrice * item.quantity)}
                        </div>
                        <div className="text-[9px] text-neutral-400">
                          Tổng đơn buôn
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Section: Automatic Free Gift Deliveries in Promo B (Strings) */}
          {freeStringsCount > 0 && (
            <div className="bg-red-50/70 border border-red-100 rounded-xl p-3 mt-4 space-y-2">
              <h4 className="text-xs font-bold text-red-900 flex items-center gap-1.5 uppercase">
                <Gift className="w-4 h-4 text-red-600 animate-bounce" /> Quà Tặng Tự Động Kèm Vợt (Ưu đãi B)
              </h4>
              <div className="flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-bold text-neutral-900">Sợi cước cầu lông Li-Ning N65 chính hãng</div>
                  <div className="text-[10px] text-neutral-500 font-mono">SKU: FREE-N65-STRING • Định lượng {freeStringsCount} sợi</div>
                  <div className="text-[10px] text-neutral-400 italic">Áp dụng: Tặng miễn phí 1 sợi trên mỗi khung vợt Catalog 01</div>
                </div>
                <div className="text-right">
                  <span className="bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded text-[10px] uppercase tracking-wider block">
                    Miễn phí
                  </span>
                  <span className="text-[10px] text-neutral-400 line-through mt-1 block">
                    {formatVND(150000 * freeStringsCount)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bill aggregate list */}
        <div className="bg-neutral-50 border-t border-neutral-200 p-4 space-y-2.5 text-xs">
          <div className="flex justify-between text-neutral-500">
            <span>Tổng giá trị hàng (đơn giá bán lẻ niêm yết):</span>
            <span className="font-mono text-neutral-700">{formatVND(calculatedSums.totalRetail)}</span>
          </div>

          <div className="flex justify-between text-neutral-500 pb-2 border-b border-dashed border-neutral-200">
            <span>Ưu đãi A (Giảm 45% Catalog 01):</span>
            <span className={`font-semibold ${isPromoAEligible ? 'text-green-600' : 'text-neutral-400'}`}>
              {isPromoAEligible ? "Đã áp dụng" : "Chưa kích hoạt"}
            </span>
          </div>

          <div className="flex justify-between text-base font-bold text-neutral-950 pt-1">
            <span>Tổng Dự Chi Bán Buôn Đại Lý (Nháp):</span>
            <span className="font-mono text-red-600 text-lg">{formatVND(calculatedSums.totalWholesale)}</span>
          </div>

          <div className="flex justify-between text-xs text-green-700 font-bold bg-green-50 p-2.5 rounded-lg border border-green-200">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> Lợi nhuận / Chiết khấu sỉ tiết kiệm:
            </span>
            <span className="font-mono">{formatVND(calculatedSums.savedAmount)} (giảm ~{calculatedSums.totalRetail > 0 ? Math.round((calculatedSums.savedAmount / calculatedSums.totalRetail) * 100) : 0}%)</span>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-3">
            <button
              onClick={() => onSetActiveTab("catalog")}
              className="flex-1 bg-neutral-900 text-white rounded-lg py-2.5 px-4 font-semibold text-xs text-center hover:bg-neutral-800 transition"
            >
              Thêm sản phẩm chiết khấu
            </button>
            <button
              disabled={cart.length === 0}
              onClick={handlePrintOrder}
              className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 font-semibold text-xs border transition ${cart.length > 0 ? 'bg-white border-neutral-300 hover:bg-neutral-50 text-neutral-800' : 'bg-neutral-100 border-neutral-200 text-neutral-400 cursor-not-allowed'}`}
            >
              <Printer className="w-4 h-4" /> In bản tính chiết khấu
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Optimization Recommendations & Free Gift Picker (5 Cols) */}
      <div className="lg:col-span-5 space-y-6">

        {/* CARD 1: SMART RECOMMENDATION ADVICE */}
        <div className="bg-white rounded shadow-sm ring-1 ring-black/5 p-4 space-y-4">
          <h3 className="text-xs font-black text-neutral-900 border-b border-neutral-100 pb-2 flex items-center gap-1.5 uppercase">
            <Award className="w-4.5 h-4.5 text-[#D8232A]" /> Công Cụ Gợi Ý Tối Ưu Hóa KM
          </h3>

          {/* Advise 1: Promo A (Catalog 01 + Catalog 03) */}
          <div className="space-y-2.5">
            <span className="text-[10px] bg-red-50 text-[#D8232A] font-bold px-2 py-0.5 rounded tracking-wide">
              Mục tiêu: Đạt ưu đãi A (Giảm 45%)
            </span>
            
            {isPromoAEligible ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Đơn hàng của bạn đạt ưu đãi 45%!</p>
                  <p className="text-neutral-600 mt-1">Đã áp dụng mức giá siêu KM cho tất cả vợt ở Danh mục 01. Tiết kiệm tối ưu.</p>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2.5">
                <AlertCircle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p className="font-sans font-bold">Chưa Kích Hoạt Ưu Đãi A (Khuyến nghị):</p>
                  
                  {/* Explaining rules dynamically */}
                  {catalog1TotalQty < 2 ? (
                    <p className="text-neutral-600 leading-snug">
                      Đại lý đã chọn <strong>{catalog1TotalQty} Vợt</strong> ở Danh mục 01. Vui lòng đặt thêm ít nhất <strong className="text-neutral-900 font-mono font-bold">{2 - catalog1TotalQty} chiếc</strong> nữa và 1 phụ kiện DM03 để được giảm 45% toàn bộ vợt DM01.
                    </p>
                  ) : catalog1TotalQty > 4 ? (
                    <p className="text-neutral-600 leading-snug font-semibold text-red-700">
                      Cảnh báo: Bạn đang chọn {catalog1TotalQty} Vợt ở Danh mục 01 (Vượt quá hạn mức 02-04 cái/gói). Hãy chia nhỏ đơn hoặc liên hệ admin kinh doanh.
                    </p>
                  ) : catalog3TotalQty === 0 ? (
                    <p className="text-neutral-600 leading-snug">
                      Số lượng vợt DM01 đã đạt ({catalog1TotalQty} chiếc). <strong className="text-red-600 font-bold">Mua thêm ít nhất 01 sản phẩm phụ phẩm Danh mục 03</strong> để được chiết khấu 45%.
                    </p>
                  ) : null}

                  <button 
                    onClick={() => onSetActiveTab("catalog")}
                    className="mt-1 flex items-center gap-1 font-bold text-red-600 hover:text-red-700 transition"
                  >
                    Xem sản phẩm thích hợp <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Advise 2: Promo C Tiers */}
          <div className="space-y-2.5 pt-3 border-t border-neutral-100">
            <span className="text-[10px] bg-red-50 text-[#D8232A] font-bold px-2 py-0.5 rounded tracking-wide">
              Mục tiêu: Đạt Quà Tặng Doanh Số DM02
            </span>

            {/* Current Tier layout */}
            <div className="text-xs space-y-1 bg-neutral-50 p-2.5 rounded ring-1 ring-black/5">
              <div className="flex justify-between font-bold">
                <span>Doanh buôn DM02 hiện tại:</span>
                <span className="font-mono text-[#D8232A]">{formatVND(catalog2WholesaleSum)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-neutral-500">
                <span>Hạng ưu đãi:</span>
                <span className="font-bold text-neutral-850">{activePromoCTier.label}</span>
              </div>
              <div className="flex justify-between text-[11px] text-neutral-500">
                <span>Ngân sách quà tặng:</span>
                <span className="font-bold text-emerald-600 font-mono">{formatVND(maxGiftValueAllowed)} ({activePromoCTier.giftPercent}%)</span>
              </div>
            </div>

            {/* Progress Bar with Next Goal */}
            {nextPromoCTierInfo ? (
              <div className="space-y-1 text-xs">
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>Mốc tiếp theo: {formatVND(nextPromoCTierInfo.nextTier.minWholesalePrice)}</span>
                  <span className="font-black text-[#D8232A] font-mono">+{nextPromoCTierInfo.nextTier.giftPercent}% Quà</span>
                </div>
                {/* Horizontal scale */}
                <div className="w-full bg-neutral-200 h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-[#D8232A] h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min((catalog2WholesaleSum / nextPromoCTierInfo.nextTier.minWholesalePrice) * 100, 100)}%` }}
                  ></div>
                </div>
                <p className="text-[11px] text-neutral-500 italic mt-1 leading-snug">
                  *Đặt thêm <strong className="text-neutral-900 font-mono font-bold">{formatVND(nextPromoCTierInfo.distance)}</strong> vợt thuộc Danh mục 02 để tăng hạn mức quà tặng lên <strong className="text-neutral-900 font-bold font-mono">{nextPromoCTierInfo.nextTier.giftPercent}%</strong>!
                </p>
              </div>
            ) : catalog2WholesaleSum >= 50000000 ? (
              <div className="text-[11px] text-green-700 font-bold bg-green-50 p-2 rounded flex items-center gap-1.5 border border-green-200 leading-normal">
                <Check className="w-4 h-4 shrink-0" /> Chúc mừng! Bạn đã mở khóa mốc quà tặng cao nhất (27% doanh thu đơn hàng). Bản nháp của bạn cực kỳ tối ưu.
              </div>
            ) : null}
          </div>
        </div>

        {/* CARD 2: FREE GIFT PICKER FOR PROMO C (Catalog 01 products) */}
        {maxGiftValueAllowed > 0 && (
          <div className="bg-white rounded shadow-sm ring-1 ring-black/5 p-4 space-y-4" id="gift-selector-panel">
            <div className="flex justify-between items-center border-b border-rose-100 pb-2">
              <h3 className="text-xs font-black text-neutral-900 flex items-center gap-1.5 uppercase">
                <Gift className="w-4.5 h-4.5 text-[#D8232A]" /> QUẦY CHỌN QUÀ TẶNG DOANH SỐ
              </h3>
              <button 
                onClick={onClearGifts}
                className="text-[10px] text-neutral-500 hover:text-[#D8232A] border border-neutral-200 px-2 py-0.5 rounded shadow-sm hover:scale-102 bg-stone-50 transition"
              >
                Xóa quà đã chọn
              </button>
            </div>

            <div className="text-xs bg-red-50/20 p-3 rounded ring-1 ring-[#D8232A]/20 space-y-2">
              <div className="flex justify-between">
                <span className="text-neutral-600 font-medium">Tổng quota quà tặng được phép:</span>
                <span className="font-extrabold text-neutral-900 font-mono">{formatVND(maxGiftValueAllowed)}</span>
              </div>
              <div className="flex justify-between text-[#D8232A] font-extrabold">
                <span>Đã sử dụng:</span>
                <span className="font-mono">{formatVND(selectedGiftsValueSum)}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-red-200/50 pt-1.55">
                <span>Hợp quy còn lại:</span>
                <span className={`font-mono ${remainingGiftValue >= 0 ? 'text-green-700' : 'text-red-600 animate-pulse'}`}>
                  {formatVND(remainingGiftValue)}
                </span>
              </div>
              {remainingGiftValue < 0 && (
                <p className="text-[10px] text-[#D8232A] font-black leading-relaxed">
                  ⚠️ Tổng giá trị quà vượt mốc ưu đãi tối đa cho phép. Vui lòng giảm bớt giỏ quà tặng để hợp lệ!
                </p>
              )}
            </div>

            {/* List of Catalog 1 items to add as free items */}
            <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
              <p className="text-[10px] text-neutral-450 italic font-bold">
                Chọn vợt Danh mục 01 (Tính theo đơn giá bán buôn làm quà):
              </p>
              
              {catalog1Products.slice(0, 15).map(p => {
                const pickedItem = giftSelections.find(g => g.product.ma_hang === p.ma_hang);
                const count = pickedItem ? pickedItem.quantity : 0;
                
                return (
                  <div key={p.ma_hang} className="flex items-center justify-between text-xs gap-3.5 py-2 border-b border-gray-100 last:border-b-0">
                    <div className="space-y-0.5">
                      <div className="font-bold text-neutral-900 line-clamp-1">{p.ten_hang}</div>
                      <div className="text-[10px] text-gray-500 flex items-center gap-2">
                        <span className="font-mono text-neutral-650">{p.ma_hang}</span>
                        <span>• Đơn giá sỉ: <strong className="font-bold text-neutral-800">{formatVND(p.don_gia_ban_buon)}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onUpdateGiftQuantity(p, count - 1)}
                        disabled={count === 0}
                        className={`p-2 rounded-lg transition ${count > 0 ? 'bg-white border border-neutral-350 hover:bg-neutral-150 text-neutral-850' : 'bg-neutral-100 text-neutral-300 cursor-not-allowed'}`}
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-5 text-center font-bold font-mono">{count}</span>
                      <button
                        onClick={() => onUpdateGiftQuantity(p, count + 1)}
                        className="p-2 rounded-lg bg-[#D8232A] text-white hover:bg-red-750 font-semibold"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
