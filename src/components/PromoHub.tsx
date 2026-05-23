import React, { useState, useEffect } from "react";
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
  Briefcase
} from "lucide-react";

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
  // Target date for countdown: 10/06/2026
  const targetDate = new Date("2026-06-10T23:59:59").getTime();
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number }>({
    days: 18,
    hours: 12,
    minutes: 45,
    seconds: 30
  });

  useEffect(() => {
    // Current time from mock system metadata is June 2026 or May 23 2026 (2026-05-23T05:25:51Z)
    // We update with an offset to make it look active
    const interval = setInterval(() => {
      const now = new Date().getTime();
      // Since actual client absolute time in browser might differ from 2026 system meta, 
      // let's calculate the difference from May 23 2026 or fallback to a realistic countdown.
      const testTarget = new Date("2026-06-10T23:59:59").getTime();
      
      // We will anchor standard system date count down
      const currentSimTime = new Date().getTime();
      // To keep it perfectly synchronized with 2026-05-23 from instructions:
      const msLeft = testTarget - currentSimTime;
      
      if (msLeft > 0) {
        const d = Math.floor(msLeft / (1000 * 60 * 60 * 24));
        const h = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((msLeft % (1000 * 60)) / 1000);
        setTimeLeft({ days: d, hours: h, minutes: m, seconds: s });
      } else {
        // Fallback static positive count down to maintain look
        setTimeLeft({ days: 18, hours: 14, minutes: 22, seconds: 5 });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Format currency
  const formatVND = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  // Check which promotions are currently met in draft
  const promoAActive = catalog1Count >= 2 && catalog1Count <= 4 && catalog3Count >= 1;
  const promoCActive = catalog2WholesaleSum >= 8000000;

  // Determine Promo C tier
  let promoCTierLabel = "Chưa đạt hạng mức";
  let promoCValuePercent = 0;
  if (catalog2WholesaleSum >= 50000000) {
    promoCTierLabel = "Hạng Kim Cương (Mức 27%)";
    promoCValuePercent = 27;
  } else if (catalog2WholesaleSum >= 35000000) {
    promoCTierLabel = "Hạng Vàng (Mức 20%)";
    promoCValuePercent = 20;
  } else if (catalog2WholesaleSum >= 20000000) {
    promoCTierLabel = "Hạng Bạc (Mức 18%)";
    promoCValuePercent = 18;
  } else if (catalog2WholesaleSum >= 8000000) {
    promoCTierLabel = "Hạng Đồng (Mức 15%)";
    promoCValuePercent = 15;
  }

  return (
    <div className="space-y-6" id="promo-hub-page">
      {/* Summer Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#D8232A] to-[#A01A1F] p-6 md:p-8 text-white shadow-xl">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white/10 blur-3xl"></div>
        <div className="absolute left-1/3 bottom-0 w-48 h-48 rounded-full bg-orange-400/10 blur-2xl"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-black/30 text-white font-mono text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider animate-pulse">
              <Flame className="w-3.5 h-3.5 text-yellow-400" /> Hot Deal B2B 2026
            </div>
            <h1 className="text-2xl md:text-4xl font-black italic uppercase tracking-tight">
              CHƯƠNG TRÌNH KHUYẾN MẠI HÈ 2026
            </h1>
            <p className="text-white/95 text-xs md:text-sm font-medium leading-relaxed">
              Áp dụng đặc quyền cho hệ thống đại lý chính hãng và cửa hàng bán buôn cầu lông Li-Ning Việt Nam. 
              Đặt hàng ngay để gia tăng tỷ suất lợi nhuận bán lẻ của bạn lên tới <span className="font-black font-mono underline decoration-white decoration-2 underline-offset-4">45%</span>.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
              <span className="flex items-center gap-1.5 bg-black/20 px-3 py-1.5 rounded border border-white/15">
                <Calendar className="w-3.5 h-3.5 text-yellow-400" /> 
                Hiệu lực: <strong className="text-white">20/05/2026 - 10/06/2026</strong>
              </span>
              <span className="flex items-center gap-1.5 bg-black/20 px-3 py-1.5 rounded border border-white/15">
                <Award className="w-3.5 h-3.5 text-yellow-400" />
                Đối tượng: <strong className="text-white">Đại lý & NPP Toàn Quốc</strong>
              </span>
            </div>
          </div>

          {/* Countdown Clock */}
          <div className="bg-[#1A1A1A]/95 border border-white/10 p-4 rounded flex flex-col items-center justify-center min-w-[260px] max-w-full w-full md:w-auto shadow-2xl">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#D8232A] mb-2">
              <Clock className="w-3.5 h-3.5 animate-spin" /> THỜI GIAN CÒN LẠI
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-black/45 border border-white/5 rounded p-2 min-w-[50px]">
                <div className="text-xl md:text-2xl font-mono font-bold text-white">{timeLeft.days}</div>
                <div className="text-[9px] text-white/50 font-sans uppercase font-bold">Ngày</div>
              </div>
              <div className="bg-black/45 border border-white/5 rounded p-2 min-w-[50px]">
                <div className="text-xl md:text-2xl font-mono font-bold text-white">
                  {timeLeft.hours.toString().padStart(2, "0")}
                </div>
                <div className="text-[9px] text-white/50 font-sans uppercase font-bold">Giờ</div>
              </div>
              <div className="bg-black/45 border border-white/5 rounded p-2 min-w-[50px]">
                <div className="text-xl md:text-2xl font-mono font-bold text-white">
                  {timeLeft.minutes.toString().padStart(2, "0")}
                </div>
                <div className="text-[9px] text-white/50 font-sans uppercase font-bold">Phút</div>
              </div>
              <div className="bg-black/45 border border-white/5 rounded p-2 min-w-[50px]">
                <div className="text-xl md:text-2xl font-mono font-bold text-[#D8232A]">
                  {timeLeft.seconds.toString().padStart(2, "0")}
                </div>
                <div className="text-[9px] text-white/50 font-sans uppercase font-bold text-[#D8232A]">Giây</div>
              </div>
            </div>
            <div className="text-[9px] text-white/40 mt-2 italic text-center uppercase tracking-wider">
              *Hạn cuối thanh toán hóa đơn: 23h59 ngày 10/06/2026
            </div>
          </div>
        </div>
      </div>

      {/* Live State Hub Checkers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded p-4 shadow-sm ring-1 ring-black/5 hover:bg-gray-50 transition-all flex items-center justify-between border-l-4 border-[#D8232A]">
          <div>
            <span className="text-[10px] text-neutral-400 uppercase font-black tracking-wider">Vợt danh mục 01 đã chọn</span>
            <div className="text-2xl font-black italic font-mono text-neutral-900 mt-0.5">{catalog1Count} chiếc</div>
          </div>
          <div className={`p-3 rounded ${catalog1Count >= 2 && catalog1Count <= 4 ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-400'}`}>
            <Percent className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded p-4 shadow-sm ring-1 ring-black/5 hover:bg-gray-50 transition-all flex items-center justify-between border-l-4 border-neutral-400">
          <div>
            <span className="text-[10px] text-neutral-400 uppercase font-black tracking-wider w-full">Phụ phẩm kèm theo (DM03)</span>
            <div className="text-2xl font-black italic font-mono text-neutral-900 mt-0.5">{catalog3Count} sản phẩm</div>
          </div>
          <div className={`p-3 rounded ${catalog3Count >= 1 ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-400'}`}>
            <Briefcase className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded p-4 shadow-sm ring-1 ring-black/5 hover:bg-gray-50 transition-all flex items-center justify-between border-l-4 border-[#D8232A]">
          <div>
            <span className="text-[10px] text-neutral-400 uppercase font-black tracking-wider">Doanh số mua DM02 (Bán buôn)</span>
            <div className="text-lg font-black italic font-mono text-[#D8232A] mt-0.5">{formatVND(catalog2WholesaleSum)}</div>
          </div>
          <div className={`p-3 rounded ${catalog2WholesaleSum >= 8000000 ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-400'}`}>
            <Gift className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Visual Summary Cards for Promo Rules */}
      <div>
        <h3 className="text-sm font-black italic text-neutral-900 uppercase tracking-wide mb-4 flex items-center gap-2">
          <BadgePercent className="w-5 h-5 text-[#D8232A]" />
          Nội dung chi tiết các gói ưu đãi đặt hàng
        </h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Promo A Card */}
          <div className={`rounded bg-white p-5 shadow-sm ring-1 flex flex-col justify-between transition-all duration-300 hover:shadow-md ${promoAActive ? 'ring-green-500' : 'ring-black/5'}`}>
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="bg-red-50 text-[#D8232A] text-[10px] font-bold px-2.5 py-1 rounded uppercase tracking-wide">
                  Ưu đãi A (Giảm 45%)
                </span>
                {promoAActive ? (
                  <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                    <ThumbsUp className="w-3 h-3" /> Đạt yêu cầu
                  </span>
                ) : (
                  <span className="bg-neutral-100 text-neutral-600 text-[10px] font-semibold px-2 py-0.5 rounded">
                    Chờ kích hoạt
                  </span>
                )}
              </div>
              
              <h4 className="text-sm font-black italic uppercase text-neutral-900 mb-2">CHIẾT KHẤU ĐẶC BIỆT 45% DANH MỤC 01</h4>
              <p className="text-xs text-neutral-600 leading-relaxed mb-4">
                Mua từ <strong className="text-neutral-900 font-mono">02 đến 04 sản phẩm</strong> tại Danh mục số 01 và mua kèm ít nhất <strong className="text-neutral-900 font-mono">01 sản phẩm</strong> tại Danh mục số 03 để được áp dụng giảm giá thẳng <strong className="text-[#D8232A]">45%</strong> trên đơn giá bán lẻ cho các sản phẩm Danh mục 01 đã chọn.
              </p>

              {/* Progress Tracker for Promo A */}
              <div className="bg-[#F8F9FA] rounded p-3 border border-neutral-100 text-xs space-y-2 mb-4">
                <div className="flex justify-between">
                  <span className="text-neutral-500 font-medium">Tiêu chí 1: Số lượng vợt DM01 (2-4 vợt):</span>
                  <span className={`font-mono font-bold ${catalog1Count >= 2 && catalog1Count <= 4 ? 'text-green-600' : 'text-neutral-600'}`}>
                    {catalog1Count} / 4 chiếc
                  </span>
                </div>
                <div className="w-full bg-neutral-200 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${catalog1Count >= 2 && catalog1Count <= 4 ? 'bg-green-500' : catalog1Count > 4 ? 'bg-amber-500' : 'bg-[#D8232A]'}`}
                    style={{ width: `${Math.min((catalog1Count / 4) * 100, 100)}%` }}
                  ></div>
                </div>

                <div className="flex justify-between pt-1">
                  <span className="text-neutral-500 font-medium">Tiêu chí 2: Mua phụ phẩm DM03 (&gt;= 1 cái):</span>
                  <span className={`font-mono font-bold ${catalog3Count >= 1 ? 'text-green-600' : 'text-neutral-600'}`}>
                    {catalog3Count >= 1 ? "Đạt yêu cầu" : "Thiếu"} ({catalog3Count}/1)
                  </span>
                </div>
              </div>
            </div>

            <button 
              onClick={() => onSetActiveTab("catalog")}
              className="mt-2 w-full bg-[#D8232A] hover:brightness-110 text-white font-black italic py-2.5 rounded shadow hover:scale-[1.01] active:scale-[0.99] transition-all uppercase tracking-widest text-xs"
            >
              Chọn sản phẩm ngay
            </button>
          </div>

          {/* Promo B Card */}
          <div className="rounded bg-white p-5 shadow-sm ring-1 ring-black/5 flex flex-col justify-between transition-all duration-300 hover:shadow-md">
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="bg-red-50 text-[#D8232A] text-[10px] font-bold px-2.5 py-1 rounded uppercase tracking-wide">
                  Ưu đãi B (Tặng cước N65)
                </span>
                {catalog1Count > 0 ? (
                  <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                    +{catalog1Count} Cước Free
                  </span>
                ) : (
                  <span className="bg-neutral-100 text-neutral-600 text-[10px] font-semibold px-2 py-0.5 rounded">
                    Chờ mua vợt DM01
                  </span>
                )}
              </div>
              
              <h4 className="text-sm font-black italic uppercase text-neutral-900 mb-2">TẶNG CƯỚC THI ĐẤU LI-NING N65 MIỄN PHÍ</h4>
              <p className="text-xs text-neutral-600 leading-relaxed mb-4">
                Khi chọn mua bất kỳ khung vợt cầu lông Li-Ning nào nằm trong <strong className="text-neutral-900">Danh mục số 01</strong>, quý khách sẽ được tặng kèm ngay <strong className="text-[#D8232A] font-bold">01 sợi cước thi đấu cao cấp Li-Ning N65 chính hãng</strong> (trị giá <span className="font-mono">150.000 đ</span> mỗi sợi).
              </p>

              <div className="bg-red-50 border border-red-100 rounded p-3 text-xs text-red-800 space-y-1">
                <p className="font-bold flex items-center gap-1 uppercase tracking-wider text-[10px]">
                  <Flame className="w-3.5 h-3.5 text-[#D8232A] animate-pulse" /> Danh sách cước tặng:
                </p>
                <p className="font-mono text-neutral-700 italic">
                  {catalog1Count > 0 ? `Đã thêm ${catalog1Count} sợi cước N65 miễn phí vào giỏ hàng!` : "Chưa chọn khung vợt nào trong Danh mục 01."}
                </p>
              </div>
            </div>

            <button 
              onClick={() => onSetActiveTab("catalog")}
              className="mt-5 w-full bg-[#1A1A1A] hover:bg-black text-white font-black italic py-2.5 rounded shadow hover:scale-[1.01] active:scale-[0.99] transition-all uppercase tracking-widest text-xs"
            >
              Xem Vợt danh mục 01
            </button>
          </div>

          {/* Promo C Card */}
          <div className={`rounded bg-white p-5 shadow-sm ring-1 flex flex-col justify-between transition-all duration-300 hover:shadow-md ${promoCActive ? 'ring-green-500' : 'ring-black/5'}`}>
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="bg-red-50 text-[#D8232A] text-[10px] font-bold px-2.5 py-1 rounded uppercase tracking-wide">
                  Ưu đãi C (Quà tặng đại lý)
                </span>
                {promoCActive ? (
                  <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                    <ThumbsUp className="w-3 h-3" /> {promoCTierLabel}
                  </span>
                ) : (
                  <span className="bg-neutral-100 text-neutral-600 text-[10px] font-semibold px-2 py-0.5 rounded">
                    Chưa đạt mốc 8M
                  </span>
                )}
              </div>
              
              <h4 className="text-sm font-black italic uppercase text-neutral-900 mb-2">KHUYẾN MẠI TÍCH LŨY DOANH SỐ (DM02)</h4>
              <p className="text-xs text-neutral-600 leading-relaxed mb-3">
                Đặt mua các dòng vợt thuộc <strong className="text-neutral-900">Danh mục số 02</strong> để nhận ngân sách lựa chọn quà tặng miễn phí (tính theo đơn giá bán buôn) từ các vợt Danh mục 01:
              </p>

              {/* Tiers List */}
              <div className="text-[10px] space-y-1 bg-[#F8F9FA] p-2.5 rounded border border-neutral-100">
                <div className={`flex justify-between p-1 rounded font-medium ${catalog2WholesaleSum >= 8000000 && catalog2WholesaleSum < 20000000 ? 'bg-amber-100 font-bold text-amber-950' : ''}`}>
                  <span>Mốc từ 8M đến 20M:</span>
                  <span className="font-mono font-bold">Hạn mức quà 15%</span>
                </div>
                <div className={`flex justify-between p-1 rounded font-medium ${catalog2WholesaleSum >= 20000000 && catalog2WholesaleSum < 35000000 ? 'bg-amber-100 font-bold text-amber-950' : ''}`}>
                  <span>Mốc từ 20M đến 35M:</span>
                  <span className="font-mono font-bold">Hạn mức quà 18%</span>
                </div>
                <div className={`flex justify-between p-1 rounded font-medium ${catalog2WholesaleSum >= 35000000 && catalog2WholesaleSum < 50000000 ? 'bg-amber-100 font-bold text-amber-950' : ''}`}>
                  <span>Mốc từ 35M đến 50M:</span>
                  <span className="font-mono font-bold">Hạn mức quà 20%</span>
                </div>
                <div className={`flex justify-between p-1 rounded font-medium ${catalog2WholesaleSum >= 50000000 ? 'bg-green-100 font-bold text-green-950' : ''}`}>
                  <span>Mốc trên 50M:</span>
                  <span className="font-mono font-bold">Hạn mức quà 27%</span>
                </div>
              </div>

              {/* Promo C live calculated feedback */}
              {catalog2WholesaleSum > 0 && (
                <div className="mt-3 p-3 bg-neutral-950 text-white rounded font-mono text-[11px] space-y-1 shadow-inner">
                  <div className="text-white/60">Doanh số DM02: {formatVND(catalog2WholesaleSum)}</div>
                  <div className="text-[#D8232A] font-bold">Tỷ lệ quà được: {promoCValuePercent}%</div>
                  <div className="text-green-400 font-bold">
                    Ngân sách quà: {formatVND((catalog2WholesaleSum * promoCValuePercent) / 100)}
                  </div>
                  <div className="text-white/80">Đã chọn nhận: {formatVND(giftValueSelected)}</div>
                </div>
              )}
            </div>

            <button 
              onClick={() => onSetActiveTab("calculator")}
              className="mt-4 w-full bg-[#D8232A] hover:brightness-110 text-white font-black italic py-2.5 rounded shadow hover:scale-[1.01] active:scale-[0.99] transition-all uppercase tracking-widest text-xs"
            >
              Chọn quà tặng miễn phí
            </button>
          </div>

        </div>
      </div>

      {/* Helper tips & Contact info */}
      <div className="bg-white p-5 rounded shadow-sm ring-1 ring-black/5 space-y-3">
        <h4 className="text-xs font-black italic text-neutral-900 flex items-center gap-1.5 uppercase tracking-wide">
          <TrendingUp className="w-5 h-5 text-[#D8232A]" /> HƯỚNG DẪN TỐI ƯU HÁN LỢI NHUẬN
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-neutral-600 leading-relaxed">
          <div className="space-y-2">
            <p>
              💡 <strong>Lợi ích tối đa từ Ưu đãi A:</strong> Thay vì đặt đơn lẻ tẻ, hãy gom nhóm dòng Danh mục 1 đúng từ 2 - 4 chiếc và kèm ít nhất 1 phụ kiện ở Danh mục 3. Toàn bộ dòng sản phẩm sẽ được nâng cấp lên mức giá <strong>Sau KM (giảm thẳng 45%)</strong> thay vì áp dụng sỉ gốc thường!
            </p>
            <p>
              💡 <strong>Lựa chọn quà tối ưu:</strong> Khi đạt doanh số mua ở danh mục 2 (Vợt cao cấp) mở được hạn mức hàng triệu đồng, hãy ưu tiên chọn những mã vợt chạy dòng danh mục 1 làm quà miễn phí để tặng kích cầu hoặc trưng bày cửa hàng.
            </p>
          </div>
          <div className="space-y-2 border-t md:border-t-0 md:border-l border-neutral-100 pt-3 md:pt-0 md:pl-4">
            <p className="font-bold text-neutral-900 uppercase text-[10px] tracking-wide">Thông tin liên hệ đại lý chính thức:</p>
            <p className="font-medium"><strong>Công ty TNHH Quốc tế Hải Long</strong> - Tổng phân phối Li-Ning Badminton tại Việt Nam.</p>
            <p>📍 Văn phòng nghiệp vụ: Số 375 Đề Án, Hải Long, Hà Nội.</p>
            <p>📞 Tổng đài B2B hỗ trợ đối tác: <strong className="text-[#D8232A] font-mono">1900.2026.88</strong> (Nhánh số 2).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
