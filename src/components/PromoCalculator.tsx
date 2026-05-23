import React, { useMemo, useState, useEffect } from "react";
import { Product, CartItem, FreeGiftSelection } from "../types";
import { 
  ShoppingBag, 
  Trash2, 
  Gift, 
  AlertCircle, 
  CheckCircle, 
  Percent, 
  Flame, 
  Sparkles, 
  Plus, 
  Minus,
  Check, 
  Printer,
  ChevronRight,
  Award,
  Info
} from "lucide-react";
import { 
  PROMO_CAMPAIGN_META, 
  PROMO_A_CONFIG, 
  PROMO_B1_CONFIG, 
  PROMO_B2_CONFIG, 
  GIFT_N65_STRINGS,
  CATALOG_INFO
} from "../promoData";

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

  // Formatter for Currency
  const formatVND = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  // Divide ordered items based on catalogs
  const catalog1Items = useMemo(() => cart.filter(i => i.catalogId === 1), [cart]);
  const catalog2Items = useMemo(() => cart.filter(i => i.catalogId === 2), [cart]);
  const catalog3Items = useMemo(() => cart.filter(i => i.catalogId === 3), [cart]);

  const catalog1TotalQty = useMemo(() => {
    return catalog1Items.reduce((acc, curr) => acc + curr.quantity, 0);
  }, [catalog1Items]);

  const catalog3TotalQty = useMemo(() => {
    return catalog3Items.reduce((acc, curr) => acc + curr.quantity, 0);
  }, [catalog3Items]);

  const catalog2WholesaleSum = useMemo(() => {
    return catalog2Items.reduce((acc, curr) => acc + (curr.product.don_gia_ban_buon * curr.quantity), 0);
  }, [catalog2Items]);

  // Determine Promo A qualification: 2-4 products from DM01 + at least 1 product from DM03
  const isPromoAEligible = catalog1TotalQty >= PROMO_A_CONFIG.minCatalog1Qty && 
                            catalog1TotalQty <= PROMO_A_CONFIG.maxCatalog1Qty && 
                            catalog3TotalQty >= PROMO_A_CONFIG.requiredCatalog3Qty;

  // Track selected colors for the free LiNing N65 strings in a localized hook
  // Keep size aligned with catalog1TotalQty
  const [stringColors, setStringColors] = useState<string[]>([]);

  useEffect(() => {
    // Sync size of colors with catalog1TotalQty
    setStringColors(prev => {
      const copy = [...prev];
      if (copy.length < catalog1TotalQty) {
        // Add default whites
        while (copy.length < catalog1TotalQty) {
          copy.push(GIFT_N65_STRINGS[0].sku);
        }
      } else if (copy.length > catalog1TotalQty) {
        copy.splice(catalog1TotalQty);
      }
      return copy;
    });
  }, [catalog1TotalQty]);

  const handleColorChange = (index: number, sku: string) => {
    setStringColors(prev => {
      const next = [...prev];
      next[index] = sku;
      return next;
    });
  };

  // Calculate real-time totals
  const calculatedSums = useMemo(() => {
    let totalRetail = 0;
    let totalWholesale = 0;

    cart.forEach(item => {
      const q = item.quantity;
      totalRetail += item.product.don_gia_ban_le * q;

      if (item.catalogId === 1) {
        // Apply Promo A 45% discount on Catalog 1 if qualified
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

  // Determine matching Tier for Promo B2 (Tấn công tích doanh số DM02)
  const activePromoB2Tier = useMemo(() => {
    const tiers = PROMO_B2_CONFIG.tiers;
    let matchedTier = tiers[0];
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (catalog2WholesaleSum >= tiers[i].minWholesalePrice) {
        matchedTier = tiers[i];
        break;
      }
    }
    return matchedTier;
  }, [catalog2WholesaleSum]);

  // Max value allowed for Catalog 1 free gift rackets in VND
  const maxGiftValueAllowed = useMemo(() => {
    if (activePromoB2Tier.giftPercent === 0) return 0;
    return (catalog2WholesaleSum * activePromoB2Tier.giftPercent) / 100;
  }, [catalog2WholesaleSum, activePromoB2Tier]);

  // Sum of selected free gift rackets
  const selectedGiftsValueSum = useMemo(() => {
    return giftSelections.reduce((acc, curr) => acc + (curr.product.don_gia_ban_buon * curr.quantity), 0);
  }, [giftSelections]);

  const remainingGiftValue = useMemo(() => {
    return maxGiftValueAllowed - selectedGiftsValueSum;
  }, [maxGiftValueAllowed, selectedGiftsValueSum]);

  // Find next tier to offer optimization recommendations
  const nextPromoB2TierInfo = useMemo(() => {
    const tiers = PROMO_B2_CONFIG.tiers;
    const currentIdx = tiers.findIndex(t => t.giftPercent === activePromoB2Tier.giftPercent);
    if (currentIdx !== -1 && currentIdx < tiers.length - 1) {
      const nextTier = tiers[currentIdx + 1];
      const distance = nextTier.minWholesalePrice - catalog2WholesaleSum;
      return {
        nextTier,
        distance
      };
    }
    return null;
  }, [activePromoB2Tier, catalog2WholesaleSum]);

  const handlePrintOrder = () => {
    window.print();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in" id="calculator-engine">
      
      {/* LEFT COLUMN: Receipt and Calculations layout (7 Cols) */}
      <div className="lg:col-span-7 bg-white rounded-xl shadow-sm ring-1 ring-black/5 overflow-hidden flex flex-col justify-between">
        
        {/* Header Ribbon bar */}
        <div className="p-4 bg-neutral-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <h3 className="text-xs font-black tracking-wider uppercase">Bản Tính Nháp Chiết Khấu Đại Lý</h3>
              <p className="text-[10px] text-zinc-405 font-mono">Bản nháp tự động áp dụng chính sách `{PROMO_CAMPAIGN_META.campaignName}`</p>
            </div>
          </div>
          <button 
            onClick={onClearCart}
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors px-2 py-1 bg-neutral-800 rounded-md border border-neutral-700 font-medium"
            title="Xóa toàn bộ sắm nháp"
          >
            <Trash2 className="w-3.5 h-3.5" /> Xóa giỏ hàng
          </button>
        </div>

        {/* Ordered Cart List */}
        <div className="p-4 flex-1 divide-y divide-neutral-100 max-h-[500px] overflow-y-auto">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-neutral-450 space-y-3">
              <ShoppingBag className="w-12 h-12 text-neutral-300 mx-auto animate-bounce" />
              <p className="text-sm font-bold text-neutral-800">Bản tính đại lý đang trống!</p>
              <p className="text-xs max-w-sm mx-auto text-neutral-500">
                Hãy chuyển sang tab <strong>Danh Mục & Catalog B2B</strong> để lựa chọn sắm vợt và phụ kiện, hệ thống sẽ tự động ghép nhóm chiết khấu 45% (Ưu đãi A) hoặc tính ngân sách sỉ quà tăng (Ưu đãi B2).
              </p>
              <button 
                onClick={() => onSetActiveTab("catalog")}
                className="text-xs bg-red-600 hover:bg-red-700 font-extrabold text-white px-4 py-2.5 rounded-lg transition uppercase tracking-wide"
              >
                Mở CATALOG sắm B2B
              </button>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {cart.map(item => {
                const isCat1 = item.catalogId === 1;
                const actualUnitPrice = isCat1 && isPromoAEligible && item.product.gia_sau_giam
                  ? item.product.gia_sau_giam
                  : item.product.don_gia_ban_buon;

                return (
                  <div key={`${item.catalogId}-${item.product.ma_hang}`} className="flex items-start justify-between gap-4 pt-4 first:pt-0 group">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider ${item.catalogId === 1 ? 'bg-red-105 text-red-750' : item.catalogId === 2 ? 'bg-indigo-100 text-indigo-700' : 'bg-stone-100 text-stone-700'}`}>
                          {CATALOG_INFO[item.catalogId].short}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400 font-bold">{item.product.ma_hang}</span>
                      </div>
                      
                      <h4 className="text-xs font-extrabold text-neutral-900 group-hover:text-red-650 transition-colors">
                        {item.product.ten_hang}
                      </h4>

                      <div className="flex items-center gap-3 text-[10px] text-neutral-500">
                        {item.product.series && <span>Dòng: <strong className="font-bold text-neutral-700">{item.product.series}</strong></span>}
                        {item.product.spec && item.product.spec !== "N/A" && <span>• Spec: <strong className="font-bold text-red-600">{item.product.spec}</strong></span>}
                      </div>

                      <div className="text-[10px] text-neutral-500 space-x-2">
                        <span>Lẻ niêm yết: <span className="line-through">{formatVND(item.product.don_gia_ban_le)}</span></span>
                        <span>Sỉ buôn gốc: <span className="font-mono">{formatVND(item.product.don_gia_ban_buon)}</span></span>
                        
                        {isCat1 && isPromoAEligible && (
                          <span className="text-red-700 font-black bg-red-50 border border-red-100 px-1 rounded">
                            KM 45%: {formatVND(item.product.gia_sau_giam || 0)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onUpdateCartQuantity(item.product, item.quantity - 1, item.catalogId)}
                          className="p-1.5 border border-zinc-300 rounded-md bg-white hover:bg-neutral-100 text-neutral-800 transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        
                        <input
                          type="number"
                          min="0"
                          value={item.quantity === 0 ? "" : item.quantity}
                          placeholder="0"
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            onUpdateCartQuantity(item.product, isNaN(val) ? 0 : Math.max(0, val), item.catalogId);
                          }}
                          className="w-12 text-center font-bold text-xs font-mono border border-neutral-300 rounded px-1 py-0.5 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 bg-white text-neutral-900"
                        />

                        <button
                          type="button"
                          onClick={() => onUpdateCartQuantity(item.product, item.quantity + 1, item.catalogId)}
                          className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="text-right">
                        <div className="text-xs font-black font-mono text-neutral-900">
                          {formatVND(actualUnitPrice * item.quantity)}
                        </div>
                        <div className="text-[9px] text-zinc-450 italic">
                          Thành tiền sỉ
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Section: Custom strings colorways chooser as detailed in Row 1 of Section B */}
          {catalog1TotalQty > 0 && (
            <div className="bg-red-50/70 border border-red-100 rounded-xl p-3.5 mt-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-bold text-red-900 flex items-center gap-1.5 uppercase tracking-wide">
                    <Gift className="w-4 h-4 text-red-600 animate-pulse" /> ƯU ĐÃI B1: MÀU CƯỚC TẶNG KÈM ({catalog1TotalQty} cây vợt DM01)
                  </h4>
                  <p className="text-[10px] text-neutral-500 font-sans mt-0.5">
                    Được tặng miễn phí <strong>01 sợi cước LiNing N65</strong> trị giá 150.000đ trên mỗi khung vợt Catalog 01. Chọn màu chi tiết dưới đây:
                  </p>
                </div>
                <span className="bg-red-100 text-red-700 font-black px-2 py-0.5 rounded text-[9px] uppercase tracking-wider">
                  Tặng 100%
                </span>
              </div>

              {/* Selector list for each cước slot */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                {Array.from({ length: catalog1TotalQty }).map((_, idx) => {
                  const currentValue = stringColors[idx] || GIFT_N65_STRINGS[0].sku;
                  const currentObj = GIFT_N65_STRINGS.find(s => s.sku === currentValue) || GIFT_N65_STRINGS[0];
                  
                  return (
                    <div key={idx} className="bg-white p-2 rounded-lg border border-red-101 flex flex-col justify-between gap-1.5 shadow-sm">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-neutral-800 text-[10px]">Sợi cước #{idx + 1}:</span>
                        <span className="font-mono text-[9px] text-red-600 font-semibold">{currentValue}</span>
                      </div>
                      
                      <select
                        value={currentValue}
                        onChange={(e) => handleColorChange(idx, e.target.value)}
                        className="w-full bg-neutral-50 border border-neutral-350 rounded p-1 text-[11px] font-sans focus:outline-none focus:ring-1 focus:ring-red-500 font-medium"
                      >
                        {GIFT_N65_STRINGS.map(s => (
                          <option key={s.sku} value={s.sku}>
                            {s.colorName} ({s.sku})
                          </option>
                        ))}
                      </select>
                      <p className="text-[9.5px] text-neutral-550 italic leading-none truncate">{currentObj.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Bill aggregate financial totals */}
        <div className="bg-stone-50 border-t border-neutral-200 p-4 space-y-2.5 text-xs select-none">
          <div className="flex justify-between text-neutral-500">
            <span>Tổng giá trị đơn hàng sơ khởi (đơn giá lẻ niêm yết):</span>
            <span className="font-mono text-neutral-700 font-bold">{formatVND(calculatedSums.totalRetail)}</span>
          </div>

          <div className="flex justify-between text-neutral-500 pb-2 border-b border-dashed border-neutral-200">
            <span>Áp dụng giảm 45% sỉ đặc biệt (Ưu đãi A):</span>
            <span className={`font-black uppercase tracking-wider ${isPromoAEligible ? 'text-green-600' : 'text-neutral-400'}`}>
              {isPromoAEligible ? "Đã áp dụng" : "Chưa kích hoạt"}
            </span>
          </div>

          <div className="flex justify-between text-base font-black text-neutral-950 pt-1">
            <span>Dự Chi Thanh Toán Đơn Sỉ (Đại lý tạm thu):</span>
            <span className="font-mono text-red-600 text-lg font-black">{formatVND(calculatedSums.totalWholesale)}</span>
          </div>

          <div className="flex justify-between text-xs text-green-700 font-bold bg-green-50/70 p-2.5 rounded-lg border border-green-200">
            <span className="flex items-center gap-1 font-sans">
              <Sparkles className="w-3.5 h-3.5 text-green-600" /> Tỉ suất lợi tức / Chiết khấu tiết kiệm:
            </span>
            <span className="font-mono">{formatVND(calculatedSums.savedAmount)} (giảm ~{calculatedSums.totalRetail > 0 ? Math.round((calculatedSums.savedAmount / calculatedSums.totalRetail) * 100) : 0}%)</span>
          </div>

          {/* Action links */}
          <div className="flex gap-3 pt-3">
            <button
              onClick={() => onSetActiveTab("catalog")}
              className="flex-1 bg-neutral-900 text-white rounded-lg py-2.5 px-4 font-bold text-xs text-center hover:bg-neutral-800 transition-all uppercase tracking-wider"
            >
              Thêm sản phẩm sỉ
            </button>
            <button
              disabled={cart.length === 0}
              onClick={handlePrintOrder}
              className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 font-bold text-xs border transition ${cart.length > 0 ? 'bg-white border-zinc-300 hover:bg-neutral-50 text-neutral-800' : 'bg-neutral-100 border-neutral-200 text-neutral-400 cursor-not-allowed'}`}
            >
              <Printer className="w-4 h-4" /> In báo cáo chiết khấu
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Optimization advisors & Gift rackets selector (5 Cols) */}
      <div className="lg:col-span-5 space-y-6">

        {/* CARD 1: EXPLANATORY OPTIMIZATION RULES */}
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-black/5 p-4 space-y-4 select-none">
          <h3 className="text-xs font-black text-neutral-900 border-b border-rose-100 pb-2 flex items-center gap-1.5 uppercase tracking-wider">
            <Award className="w-4.5 h-4.5 text-red-650" /> Hệ Thống Phân Tích & Tối Ưu Ưu Đãi B2B
          </h3>

          {/* Guide message explaining dynamic calculation action requirement */}
          {cart.length === 0 ? (
            <div className="bg-neutral-50 rounded-lg p-3 border border-neutral-200 text-xs space-y-2 text-neutral-600">
              <p className="font-sans font-semibold text-neutral-800 flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
                Hướng dẫn kích hoạt tính toán
              </p>
              <p className="leading-relaxed font-sans text-neutral-500">
                Hệ thống phân tích tự động sẽ bắt đầu tính toán các đề xuất tối ưu chính sách chiết khấu <strong>ngay khi đại lý đưa sản phẩm vào Bản tính nháp hoặc Bảng giá</strong>. Vui lòng thêm các sản phẩm để trải nghiệm thuật toán tối ưu hóa tự động của hãng.
              </p>
            </div>
          ) : (
            <div className="bg-emerald-50 text-emerald-900 rounded-lg p-3 border border-emerald-100 text-xs space-y-1">
              <p className="font-sans font-bold flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-emerald-850">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                Hệ thống đang hoạt động tối ưu
              </p>
              <p className="leading-relaxed font-sans text-emerald-750">
                Đã nhận diện hành động thiết lập giỏ hàng. Công cụ phân tích và tự động đề xuất phương án gom đơn sỉ nhằm giảm giá lớn nhất dựa trên các mốc thực tế dưới đây.
              </p>
            </div>
          )}

          {/* Advice block 1: Section A discount */}
          <div className="space-y-2">
            <span className="text-[10px] bg-red-50 text-red-650 font-black px-2 py-0.5 rounded uppercase tracking-wider">
              Gói A (Giảm sỉ sâu 45%)
            </span>
            
            {isPromoAEligible ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5 animate-bounce" />
                <div>
                  <p className="font-bold">Đã kích hoạt sỉ 45% DM01!</p>
                  <p className="text-neutral-600 mt-1">Đơn sỉ Catalog 01 được giảm giá trực tiếp từ mức bán lẻ niêm yết sang giá sau giám.</p>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2.5">
                <AlertCircle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p className="font-bold font-sans">Đề xuất đạt mốc giảm 45%:</p>
                  
                  {catalog1TotalQty < PROMO_A_CONFIG.minCatalog1Qty ? (
                    <p className="text-neutral-600 leading-snug">
                      Đại lý có <strong>{catalog1TotalQty} Vợt</strong> ở Danh mục 01 trong giỏ. Hãy đặt mua thêm <strong className="text-neutral-900 font-bold font-mono">{PROMO_A_CONFIG.minCatalog1Qty - catalog1TotalQty} chiếc</strong> nữa và 1 phụ phẩm DM03 để được áp giá chiết khấu 45%.
                    </p>
                  ) : catalog1TotalQty > PROMO_A_CONFIG.maxCatalog1Qty ? (
                    <p className="text-red-700 leading-snug font-bold">
                      Hiện tại số vợt DM01 ({catalog1TotalQty} cái) vượt quá hạn gói 02-04 cái của mốc KM 45%. Xin vui lòng tách dòng đơn sỉ.
                    </p>
                  ) : catalog3TotalQty === 0 ? (
                    <p className="text-neutral-600 leading-snug">
                      Đã chọn {catalog1TotalQty} vợt DM01. <strong className="text-red-600 font-bold">Hãy bổ sung ít nhất 01 sản phẩm ở Danh mục 03</strong> để được hưởng mức chiết khấu 45%.
                    </p>
                  ) : null}

                  <button 
                    onClick={() => onSetActiveTab("catalog")}
                    className="mt-1 flex items-center gap-1 font-bold text-red-650 hover:text-red-700 transition"
                  >
                    Xem sản phẩm thích hợp <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Advice block 2: Section B Tiers */}
          <div className="space-y-2 pt-3 border-t border-neutral-100">
            <span className="text-[10px] bg-red-50 text-red-650 font-black px-2 py-0.5 rounded uppercase tracking-wider">
              Gói B2 (Hạn mức quà tặng sỉ)
            </span>

            <div className="text-xs space-y-1 bg-neutral-50 p-2.5 rounded border border-neutral-100">
              <div className="flex justify-between font-bold">
                <span>Doanh sỉ mua DM02 hiện tại:</span>
                <span className="font-mono text-red-600">{formatVND(catalog2WholesaleSum)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-neutral-500">
                <span>Hạng tỉ lệ quà:</span>
                <span className="font-bold text-neutral-850">{activePromoB2Tier.label}</span>
              </div>
              <div className="flex justify-between text-[11px] text-neutral-500">
                <span>Quota hàng quà tối đa:</span>
                <span className="font-extrabold text-green-700 font-mono">{formatVND(maxGiftValueAllowed)} ({activePromoB2Tier.giftPercent}%)</span>
              </div>
            </div>

            {/* Next tier target indicator */}
            {nextPromoB2TierInfo ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>Mốc sỉ kế tiếp: {formatVND(nextPromoB2TierInfo.nextTier.minWholesalePrice)}</span>
                  <span className="font-bold text-red-600 font-mono">+{nextPromoB2TierInfo.nextTier.giftPercent}% Quà</span>
                </div>
                {/* Horizontal scale */}
                <div className="w-full bg-neutral-200 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-red-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min((catalog2WholesaleSum / nextPromoB2TierInfo.nextTier.minWholesalePrice) * 100, 100)}%` }}
                  ></div>
                </div>
                <p className="text-[11px] text-neutral-500 italic leading-snug pt-0.5">
                  *Đặt mua sỉ thêm <strong className="text-neutral-900 font-mono font-bold">{formatVND(nextPromoB2TierInfo.distance)}</strong> vợt thuộc DM02 để nâng tỉ suất ngân sách quà sỉ được thưởng lên mức <strong className="text-red-605 font-bold font-mono">{nextPromoB2TierInfo.nextTier.giftPercent}%</strong>!
                </p>
              </div>
            ) : catalog2WholesaleSum >= 50000000 ? (
              <div className="text-[11px] text-green-700 font-bold bg-green-50 p-2 rounded flex items-center gap-1 px-2.5 border border-green-200">
                <Check className="w-4 h-4 shrink-0" /> Đại lý đã chạm mốc quà sỉ lớn nhất (giảm thẳng 27% tích lũy). Tiết kiệm tối đa!
              </div>
            ) : null}
          </div>
        </div>

        {/* CARD 2: DISCOVERY OF DM01 FREE GIFTS RACKETS picker */}
        {maxGiftValueAllowed > 0 && (
          <div className="bg-white rounded-xl shadow-sm ring-1 ring-black/5 p-4 space-y-4" id="gift-selector-panel">
            <div className="flex justify-between items-center border-b border-neutral-100 pb-2">
              <h3 className="text-xs font-black text-neutral-905 flex items-center gap-1.5 uppercase tracking-wider">
                <Gift className="w-4.5 h-4.5 text-red-600" /> QUỐC KHỐI QUÀ TẶNG DOANH SỐ (DM01)
              </h3>
              <button 
                onClick={onClearGifts}
                className="text-[10px] text-neutral-500 hover:text-red-600 border border-neutral-200 px-2 py-0.5 rounded bg-zinc-50 transition-all font-semibold hover:scale-102"
              >
                Reset quà
              </button>
            </div>

            <div className="text-xs bg-red-50/20 p-3 rounded-lg ring-1 ring-red-100 space-y-2">
              <div className="flex justify-between">
                <span className="text-neutral-600 font-medium">Hạn mức sỉ sắm quà được phép:</span>
                <span className="font-extrabold text-neutral-900 font-mono">{formatVND(maxGiftValueAllowed)}</span>
              </div>
              <div className="flex justify-between text-red-600 font-extrabold">
                <span>Mức quà sắm thực tế:</span>
                <span className="font-mono">{formatVND(selectedGiftsValueSum)}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-red-200/40 pt-1.5">
                <span>Ngân sách quà hợp lệ còn lại:</span>
                <span className={`font-mono ${remainingGiftValue >= 0 ? 'text-green-700' : 'text-red-600 animate-pulse'}`}>
                  {formatVND(remainingGiftValue)}
                </span>
              </div>
              {remainingGiftValue < 0 && (
                <p className="text-[10px] text-red-700 font-bold leading-normal pt-1 flex items-start gap-1">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  Tổng giá trị quà vượt mốc ưu đãi tối đa cho phép. Vui lòng giảm bớt giỏ quà tặng để hợp lệ!
                </p>
              )}
            </div>

            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              <p className="text-[10px] text-neutral-450 font-black italic font-sans">
                Nhấp chọn sản phẩm trong {CATALOG_INFO[1].title} (Tính đơn sỉ gốc làm hạn mức quà tặng):
              </p>
              
              {catalog1Products.map(p => {
                const pickedItem = giftSelections.find(g => g.product.ma_hang === p.ma_hang);
                const count = pickedItem ? pickedItem.quantity : 0;
                
                return (
                  <div key={p.ma_hang} className="flex items-center justify-between text-xs gap-3.5 py-2 border-b border-neutral-100 last:border-b-0">
                    <div className="space-y-0.5 font-sans">
                      <div className="font-extrabold text-neutral-800 line-clamp-1">{p.ten_hang}</div>
                      <div className="text-[10px] text-neutral-500 flex items-center gap-2">
                        <span className="font-mono text-zinc-400 font-bold">{p.ma_hang}</span>
                        <span>• Đơn sỉ: <strong className="font-bold text-neutral-700">{formatVND(p.don_gia_ban_buon)}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onUpdateGiftQuantity(p, count - 1)}
                        disabled={count === 0}
                        className={`p-1.5 rounded-md border text-neutral-700 transition-colors ${count > 0 ? 'bg-white border-neutral-300 hover:bg-neutral-100' : 'bg-neutral-50 text-neutral-300 border-neutral-200 cursor-not-allowed'}`}
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      
                      <input
                        type="number"
                        min="0"
                        value={count === 0 ? "" : count}
                        placeholder="0"
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          onUpdateGiftQuantity(p, isNaN(val) ? 0 : Math.max(0, val));
                        }}
                        className="w-12 text-center font-bold text-xs font-mono border border-neutral-300 rounded px-1 py-0.5 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 bg-white text-neutral-900"
                      />

                      <button
                        type="button"
                        onClick={() => onUpdateGiftQuantity(p, count + 1)}
                        className="p-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
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
