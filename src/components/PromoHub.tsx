import React, { useState, useEffect, useMemo } from "react";
import { 
  Calendar, 
  Percent, 
  Gift, 
  RotateCw, 
  Award, 
  TrendingUp, 
  Flame, 
  BadgePercent,
  ChevronRight,
  Clock,
  ThumbsUp,
  Briefcase,
  Layers,
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

interface PromoHubProps {
  onSetActiveTab: (tab: string) => void;
  catalog1Count: number;
  catalog3Count: number;
  catalog2WholesaleSum: number;
  giftValueSelected: number;
}

export default function PromoHub({ 
  onSetActiveTab, 
  catalog1Count, 
  catalog3Count, 
  catalog2WholesaleSum,
  giftValueSelected
}: PromoHubProps) {
  // Target date for countdown: 10/06/2026 based on official campaign date
  const targetDateStr = `${PROMO_CAMPAIGN_META.endDate.split("/").reverse().join("-")}T23:59:59`;
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number }>({
    days: 18,
    hours: 12,
    minutes: 45,
    seconds: 30
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const targetTime = new Date(targetDateStr).getTime();
      const currentSimTime = new Date().getTime();
      const msLeft = targetTime - currentSimTime;
      
      if (msLeft > 0) {
        const d = Math.floor(msLeft / (1000 * 60 * 60 * 24));
        const h = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((msLeft % (1000 * 60)) / 1000);
        setTimeLeft({ days: d, hours: h, minutes: m, seconds: s });
      } else {
        // Fallback static positive countdown representation if current date passes limit
        setTimeLeft({ days: 18, hours: 14, minutes: 22, seconds: 5 });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDateStr]);

  // Format currency helper
  const formatVND = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  // Determine activation state based on centralized configs
  const promoAActive = catalog1Count >= PROMO_A_CONFIG.minCatalog1Qty && 
                        catalog1Count <= PROMO_A_CONFIG.maxCatalog1Qty && 
                        catalog3Count >= PROMO_A_CONFIG.requiredCatalog3Qty;
                        
  const promoB1Active = catalog1Count > 0;

  // Find active Tier from centralized Config for Bullet 2 / Promo B2
  const activePromoB2Tier = useMemo(() => {
    const tiers = PROMO_B2_CONFIG.tiers;
    let fallback = tiers[0];
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (catalog2WholesaleSum >= tiers[i].minWholesalePrice) {
        fallback = tiers[i];
        break;
      }
    }
    return fallback;
  }, [catalog2WholesaleSum]);

  const maxGiftValueAllowed = useMemo(() => {
    if (activePromoB2Tier.giftPercent === 0) return 0;
    return (catalog2WholesaleSum * activePromoB2Tier.giftPercent) / 100;
  }, [catalog2WholesaleSum, activePromoB2Tier]);

  return (
    <div className="space-y-6 animate-fade-in" id="promo-hub-page">
      
      {/* Summer Campaign Banner Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-600 to-red-805 p-6 md:p-8 text-white shadow-lg border-b-4 border-red-700">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white/5 blur-3xl"></div>
        <div className="absolute left-1/3 bottom-0 w-48 h-48 rounded-full bg-orange-400/10 blur-2xl"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-3.5 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 bg-black/30 text-white font-mono text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider">
              <Flame className="w-3.5 h-3.5 text-yellow-400" /> {PROMO_CAMPAIGN_META.announcementTitle}
            </div>
            
            <h1 className="text-2xl md:text-3.5xl font-extrabold italic uppercase tracking-tight leading-tight">
              {PROMO_CAMPAIGN_META.campaignName} 2026 - {PROMO_CAMPAIGN_META.supplier}
            </h1>
            
            <p className="text-white/95 text-xs md:text-sm font-medium leading-relaxed font-sans">
              Kính gửi Quý khách hàng, {PROMO_CAMPAIGN_META.supplier} xin trân trọng gửi tới quý khách hàng chương trình khuyến mại lớn mùa hè, áp dụng đặc trị định vị thúc đẩy thương mại cho hệ thống đại lý.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px]">
              <span className="flex items-center gap-1.5 bg-black/20 px-3 py-1.5 rounded border border-white/10 font-medium">
                <Calendar className="w-3.5 h-3.5 text-yellow-405" /> 
                Hiệu lực: <strong className="text-white font-bold">{PROMO_CAMPAIGN_META.startDate} – {PROMO_CAMPAIGN_META.endDate}</strong>
              </span>
              <span className="flex items-center gap-1.5 bg-black/20 px-3 py-1.5 rounded border border-white/10 font-medium">
                <Award className="w-3.5 h-3.5 text-yellow-450" />
                Quy mô: <strong className="text-white uppercase font-bold">{PROMO_CAMPAIGN_META.scale}</strong>
              </span>
              <span className="flex items-center gap-1.5 bg-black/20 px-3 py-1.5 rounded border border-white/10 font-medium">
                <Layers className="w-3.5 h-3.5 text-yellow-300" />
                Đối tượng: <strong className="text-white font-bold">{PROMO_CAMPAIGN_META.targetGroup}</strong>
              </span>
            </div>
          </div>

          {/* Realtime synchronized countdown clock */}
          <div className="bg-neutral-950 border border-white/15 p-4 rounded flex flex-col items-center justify-center min-w-[260px] max-w-full w-full md:w-auto shadow-xl">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-500 mb-2">
              <Clock className="w-3.5 h-3.5 animate-pulse" /> THỜI GIAN CÒN LẠI
            </div>
            <div className="grid grid-cols-4 gap-2 text-center select-none">
              <div className="bg-black/60 border border-white/5 rounded p-2 min-w-[50px]">
                <div className="text-xl md:text-2xl font-mono font-bold text-white">{timeLeft.days}</div>
                <div className="text-[9px] text-zinc-400 uppercase font-bold">Ngày</div>
              </div>
              <div className="bg-black/60 border border-white/5 rounded p-2 min-w-[50px]">
                <div className="text-xl md:text-2xl font-mono font-bold text-white">
                  {timeLeft.hours.toString().padStart(2, "0")}
                </div>
                <div className="text-[9px] text-zinc-400 uppercase font-bold">Giờ</div>
              </div>
              <div className="bg-black/60 border border-white/5 rounded p-2 min-w-[50px]">
                <div className="text-xl md:text-2xl font-mono font-bold text-white">
                  {timeLeft.minutes.toString().padStart(2, "0")}
                </div>
                <div className="text-[9px] text-zinc-400 uppercase font-bold">Phút</div>
              </div>
              <div className="bg-black/60 border border-white/5 rounded p-2 min-w-[50px]">
                <div className="text-xl md:text-2xl font-mono font-bold text-red-505 animate-pulse">
                  {timeLeft.seconds.toString().padStart(2, "0")}
                </div>
                <div className="text-[9px] text-red-500 uppercase font-bold">Giây</div>
              </div>
            </div>
            <div className="text-[9px] text-white/40 mt-2 italic text-center uppercase">
              *Hạn cuối ưu đãi sỉ gốc: {PROMO_CAMPAIGN_META.endDate}
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Order Summary Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cat 1 Quantity indicator */}
        <div className="bg-white rounded-xl p-4 shadow-sm ring-1 ring-black/5 hover:bg-neutral-50 transition-all flex items-center justify-between border-l-4 border-red-600">
          <div>
            <span className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider">Đã đặt ở {CATALOG_INFO[1].short}</span>
            <div className="text-2xl font-black italic font-mono text-neutral-900 mt-0.5">{catalog1Count} sản phẩm</div>
            <span className="text-[9px] text-neutral-500 font-sans mt-1 block">Yêu cầu ưu đãi A: từ 2 đến 4 SP</span>
          </div>
          <div className={`p-3 rounded-xl ${promoAActive ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-600'}`}>
            <Percent className="w-5 h-5 shrink-0" />
          </div>
        </div>

        {/* Cat 3 Quantity indicator */}
        <div className="bg-white rounded-xl p-4 shadow-sm ring-1 ring-black/5 hover:bg-neutral-50 transition-all flex items-center justify-between border-l-4 border-neutral-400">
          <div>
            <span className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider">Đã đặt ở {CATALOG_INFO[3].short}</span>
            <div className="text-2xl font-black italic font-mono text-neutral-900 mt-0.5">{catalog3Count} sản phẩm</div>
            <span className="text-[9px] text-neutral-500 font-sans mt-1 block">Yêu cầu ưu đãi A: tối thiểu 1 SP</span>
          </div>
          <div className={`p-3 rounded-xl ${catalog3Count >= 1 ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-400'}`}>
            <Briefcase className="w-5 h-5 shrink-0" />
          </div>
        </div>

        {/* Wholesale sum indicator */}
        <div className="bg-white rounded-xl p-4 shadow-sm ring-1 ring-black/5 hover:bg-neutral-50 transition-all flex items-center justify-between border-l-4 border-red-600">
          <div>
            <span className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider">Doanh số mua sỉ {CATALOG_INFO[2].short}</span>
            <div className="text-lg font-black italic font-mono text-red-600 mt-0.5">{formatVND(catalog2WholesaleSum)}</div>
            <span className="text-[9px] text-neutral-500 font-sans mt-1 block">Tỷ lệ quà tặng: {activePromoB2Tier.giftPercent}%</span>
          </div>
          <div className={`p-3 rounded-xl ${catalog2WholesaleSum >= 8000000 ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-400'}`}>
            <Gift className="w-5 h-5 shrink-0" />
          </div>
        </div>
      </div>

      {/* Main detailed cards comparing Sections A & B from the announcement */}
      <div>
        <h3 className="text-xs font-black italic text-neutral-900 uppercase tracking-widest mb-4 flex items-center gap-2">
          <BadgePercent className="w-5 h-5 text-red-600 shrink-0" />
          Nội dung chi tiết các mốc ưu đãi đặt hàng
        </h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Section A Promo Card */}
          <div className={`rounded-xl bg-white p-5 border shadow-sm flex flex-col justify-between transition-all duration-300 hover:shadow-md ${promoAActive ? 'border-green-500 shadow-green-50' : 'border-neutral-200'}`}>
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="bg-red-50 text-red-605 text-[10px] font-black px-2.5 py-1 rounded uppercase tracking-wider border border-red-100">
                  Phần A. GIẢM GIÁ ĐẠI LÝ 45%
                </span>
                {promoAActive ? (
                  <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                    <ThumbsUp className="w-3 h-3" /> Hợp lệ (KM 45%)
                  </span>
                ) : (
                  <span className="bg-neutral-100 text-neutral-600 text-[10px] font-semibold px-2 py-0.5 rounded">
                    Chưa đủ điều kiện
                  </span>
                )}
              </div>
              
              <h4 className="text-sm font-black italic uppercase text-neutral-905 mb-2">{PROMO_A_CONFIG.name}</h4>
              <p className="text-xs text-neutral-600 leading-relaxed mb-4">
                {PROMO_A_CONFIG.description}.
              </p>

              <div className="bg-neutral-50 rounded-lg p-3.5 border border-neutral-200 text-xs space-y-3 mb-4">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-neutral-500 font-medium">1. Mua 02-04 sản phẩm tại {CATALOG_INFO[1].short}:</span>
                  <span className={`font-mono font-bold ${catalog1Count >= PROMO_A_CONFIG.minCatalog1Qty && catalog1Count <= PROMO_A_CONFIG.maxCatalog1Qty ? 'text-green-600' : 'text-neutral-500'}`}>
                    {catalog1Count} / 4 chiếc
                  </span>
                </div>
                {/* Visual bar */}
                <div className="w-full bg-neutral-200 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${catalog1Count >= PROMO_A_CONFIG.minCatalog1Qty && catalog1Count <= PROMO_A_CONFIG.maxCatalog1Qty ? 'bg-green-500' : catalog1Count > PROMO_A_CONFIG.maxCatalog1Qty ? 'bg-amber-500' : 'bg-red-600'}`}
                    style={{ width: `${Math.min((catalog1Count / 4) * 100, 100)}%` }}
                  ></div>
                </div>

                <div className="flex justify-between items-center text-[11px] pt-1">
                  <span className="text-neutral-500 font-medium">2. Mua kèm ít nhất 01 sản phẩm tại {CATALOG_INFO[3].short}:</span>
                  <span className={`font-mono font-bold ${catalog3Count >= PROMO_A_CONFIG.requiredCatalog3Qty ? 'text-green-600' : 'text-neutral-500'}`}>
                    {catalog3Count >= PROMO_A_CONFIG.requiredCatalog3Qty ? "Đạt yêu cầu" : "Thiếu"} ({catalog3Count}/{PROMO_A_CONFIG.requiredCatalog3Qty})
                  </span>
                </div>
                
                <div className="text-[10px] text-neutral-500 border-t border-neutral-200 pt-2 space-y-0.5 font-sans leading-relaxed">
                  <div>• <strong>Đối tượng:</strong> {PROMO_A_CONFIG.appliesTo}</div>
                  <div>• <strong>Thời gian:</strong> {PROMO_A_CONFIG.period}</div>
                </div>
              </div>
            </div>

            <button 
              onClick={() => onSetActiveTab("catalog")}
              className="mt-2 w-full bg-red-600 hover:bg-red-700 text-white font-bold italic py-2.5 rounded shadow hover:scale-[1.01] active:scale-[0.99] transition-all uppercase tracking-wider text-xs"
            >
              Chọn sản phẩm {CATALOG_INFO[1].short} & {CATALOG_INFO[3].short}
            </button>
          </div>

          {/* Section B Promo Card */}
          <div className="rounded-xl bg-white p-5 border border-neutral-200 shadow-sm flex flex-col justify-between transition-all duration-300 hover:shadow-md select-none">
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="bg-red-50 text-red-605 text-[10px] font-black px-2.5 py-1 rounded uppercase tracking-wider border border-red-100">
                  Phần B. MUA VỢT TẶNG VỢT, CƯỚC
                </span>
                <span className="bg-indigo-50 text-indigo-700 text-[10px] font-semibold px-2 py-0.5 rounded border border-indigo-100">
                  Tích lũy & Tặng kèm
                </span>
              </div>
              
              <h4 className="text-sm font-black italic uppercase text-neutral-905 mb-2">QUÀ TẶNG CƯỚC LINING N65 & VỢT {CATALOG_INFO[1].short}</h4>
              
              <div className="space-y-3.5 mb-4 text-xs text-neutral-600">
                {/* Sub-item 1: N65 Strings gift */}
                <div className="bg-red-50/50 p-3 rounded-lg border border-red-100/80">
                  <span className="text-[10px] bg-red-105 text-red-700 font-extrabold px-2 py-0.5 rounded mb-1.5 inline-block uppercase">
                    Ưu đãi B1: Tặng cước N65
                  </span>
                  <p className="leading-relaxed">
                    <strong>{PROMO_B1_CONFIG.description}</strong>.
                  </p>
                  <p className="mt-1.5 text-[11px] text-neutral-500 italic flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 shrink-0 text-red-500" />
                    Định lượng: Mua {catalog1Count} cây tặng {catalog1Count} sợi cước N65. (Gồm {GIFT_N65_STRINGS.length} màu mã {GIFT_N65_STRINGS[0].sku.substring(0, 9)}... chọn trực tiếp ở tab Giỏ hàng).
                  </p>
                </div>

                {/* Sub-item 2: Order Tiers */}
                <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-200 space-y-1.5">
                  <span className="text-[10px] bg-neutral-900 text-white font-extrabold px-2 py-0.5 rounded inline-block uppercase">
                    Ưu đãi B2: Tặng vợt {CATALOG_INFO[1].short} theo tỉ lệ sỉ
                  </span>
                  <p className="leading-relaxed">
                    Khách hàng mua vợt {CATALOG_INFO[2].short} đạt doanh số sỉ được chọn tặng sản phẩm bất kỳ trong {CATALOG_INFO[1].short} với tổng giá trị hàng tặng không vượt quá hạn mức (tính theo đơn giá bán buôn):
                  </p>
                  
                  {/* Tiers list directly from image */}
                  <div className="text-[10px] space-y-1.5 pt-1.5 border-t border-neutral-200 font-mono">
                    {PROMO_B2_CONFIG.tiers.slice(1).map((tier, index) => {
                      const isMatched = catalog2WholesaleSum >= tier.minWholesalePrice && catalog2WholesaleSum < tier.maxWholesalePrice;
                      return (
                        <div 
                          key={index}
                          className={`flex justify-between p-1.5 rounded ${isMatched ? 'bg-amber-100 font-bold text-amber-950 border border-amber-200' : 'text-neutral-600'}`}
                        >
                          <span className="truncate">{tier.label}:</span>
                          <span className="shrink-0 font-bold text-red-650">{tier.valueLimitText}</span>
                        </div>
                      );
                    })}
                  </div>

                  {catalog2WholesaleSum > 0 && (
                    <div className="mt-2.5 p-2 bg-neutral-950 text-white rounded font-mono text-[11px] space-y-1 shadow-inner">
                      <div>• Tiền sỉ sắm {CATALOG_INFO[2].short}: {formatVND(catalog2WholesaleSum)}</div>
                      <div>• Hạng quà sỉ được hưởng: <strong className="text-red-500 font-bold">{activePromoB2Tier.giftPercent}%</strong></div>
                      <div>
                        • Tổng ngân sách quà {CATALOG_INFO[1].short}: <strong className="text-green-400 font-bold">{formatVND(maxGiftValueAllowed)}</strong>
                      </div>
                      <div>• Quá đã sắm thực tế: {formatVND(giftValueSelected)}</div>
                    </div>
                  )}
                </div>

                <div className="text-[9.5px] text-zinc-500 italic leading-snug">
                  *<strong>Lưu ý:</strong> {PROMO_B2_CONFIG.notes}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => onSetActiveTab("catalog")}
                className="flex-1 bg-neutral-900 hover:bg-neutral-805 text-white font-bold italic py-2.5 rounded shadow hover:scale-[1.01] active:scale-[0.99] transition-all uppercase tracking-wider text-xs"
              >
                Mua vợt {CATALOG_INFO[1].short} & {CATALOG_INFO[2].short}
              </button>
              <button 
                onClick={() => onSetActiveTab("calculator")}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold italic py-2.5 rounded shadow hover:scale-[1.01] active:scale-[0.99] transition-all uppercase tracking-wider text-xs"
              >
                Nhập quà miễn phí
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Helper Tips & Official Distributor Info Section */}
      <div className="bg-white p-5 rounded-xl border border-neutral-200 space-y-3">
        <h4 className="text-xs font-black italic text-neutral-905 flex items-center gap-1.5 uppercase tracking-wide">
          <TrendingUp className="w-5 h-5 text-red-600 shrink-0" /> HƯỚNG DẪN TỐI ƯU HÓA LỢI NHUẬN / CHIẾT KHẤU ĐẠI LÝ
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs text-neutral-600 leading-relaxed">
          <div className="space-y-2.5">
            <p className="font-sans leading-relaxed">
              💡 <strong>Lợi ích tối đa từ Ưu đãi A:</strong> Vui lòng gom đơn đặt sản phẩm ở {CATALOG_INFO[1].title} theo lô đúng từ <strong>02 đến 04 sản phẩm</strong> và mua kèm ít nhất <strong>01 sản phẩm ở {CATALOG_INFO[3].title}</strong>. Khi đó, toàn bộ danh sách vợt ở Catalog 1 trong gói đó sẽ chuyển sang đơn giá <strong>Siêu khuyến mại 45%</strong> lý tưởng.
            </p>
            <p className="font-sans leading-relaxed">
              💡 <strong>Hạn mức quà tặng tối đa B2:</strong> Đừng bỏ lỡ các mốc doanh số sỉ {CATALOG_INFO[2].short} quan trọng như <strong>8M, 20M, 35M, và 50M</strong>. Đặt thêm một vài cây vợt để vượt ngưỡng doanh số sỉ sẽ nâng ngay tổng ngân sách lựa chọn vợt tặng từ Catalog 1 sỉ gốc lên tới <strong>27%</strong>!
            </p>
          </div>
          <div className="space-y-2 border-t md:border-t-0 md:border-l border-neutral-200 pt-3 md:pt-0 md:pl-5 text-neutral-600">
            <p className="font-bold text-neutral-900 uppercase text-[10px] tracking-widest text-red-600">Đơn vị phân phối ủy quyền:</p>
            <p className="font-bold text-neutral-800">{PROMO_CAMPAIGN_META.distributor}</p>
            <p>📍 Trụ sở chính: Tòa nhà Hải Long, Đống Đa, Hà Nội, Việt Nam.</p>
            <p>📞 Tổng đài kinh doanh & hỗ trợ NPP: <strong className="text-red-600 font-mono font-bold">{PROMO_CAMPAIGN_META.hotlineDisplay}</strong> (Hỗ trợ 24/7).</p>
            <p className="text-[10px] text-neutral-450 italic mt-1">• Văn bản thông báo chính thức có hiệu lực từ {PROMO_CAMPAIGN_META.startDate}. Quy đổi sỉ tự động.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
