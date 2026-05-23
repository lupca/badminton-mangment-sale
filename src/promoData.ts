import { Product } from "./types";

// Unified configuration for Catalog Titles, Badges, and Descriptions
export const CATALOG_INFO = {
  1: {
    title: "Danh Mục 01 (Vợt trung cấp ưu đãi)",
    short: "Danh Mục 01",
    badge: "Giảm 45% & Tặng cước N65",
    desc: "Hỗ trợ mức giá chiết khấu đặc biệt giảm thẳng tới 45% (giá mua chỉ từ 486k) khi mua từ 2-4 sản phẩm và mua kèm 1 món bất kỳ thuộc Danh mục 03. Ngoài ra, toàn bộ khung vợt thuộc Danh mục 01 đều được tặng kèm 01 sợi cước N65 miễn phí!"
  },
  2: {
    title: "Danh Mục 02 (Vợt cao cấp tích lũy quà)",
    short: "Danh Mục 02",
    badge: "Mua Vợt Tặng Quà",
    desc: "Tập hợp các dòng vợt siêu cao cấp dòng Axforce, Bladex, Halbertec chính hãng. Doanh thu tích lũy từ danh mục này sẽ giúp đại lý mở khóa hạn mức tặng thêm các món quà tự chọn miễn phí từ Danh mục 01 (tỷ lệ lên tới 27%)."
  },
  3: {
    title: "Danh Mục 03 (Vợt điều kiện kèm theo)",
    short: "Danh Mục 03",
    badge: "Nhóm vợt điều kiện",
    desc: "Các sản phẩm vợt cần thiết trong danh sách hãng. Đây là sản phẩm điều kiện bắt buộc để kích hoạt gói Ưu đãi A giảm 45% cho nhóm vợt thuộc Danh mục 01."
  }
};

// General Campaign Metadata based on the uploaded announcement image
export const PROMO_CAMPAIGN_META = {
  campaignName: "KHUYẾN MẠI HÈ",
  scale: "LỚN",
  targetGroup: "Theo từng nội dung khuyến mại",
  startDate: "20/05/2026",
  endDate: "10/06/2026",
  announcementTitle: "THÔNG BÁO KHUYẾN MẠI",
  supplier: "HÃNG LINING VIỆT NAM",
  distributor: "TOP VN SPORT / Công ty TNHH Quốc tế Hải Long",
  hotlinePhone: "02437835993",
  hotlineDisplay: "0243.783.5993",
};

// Interactive structures for Section A of the Promotion Program
export interface PromoARules {
  name: string;
  description: string;
  minCatalog1Qty: number;
  maxCatalog1Qty: number;
  requiredCatalog3Qty: number;
  discountRate: number; // 45% -> 0.45
  appliesTo: string;
  period: string;
}

export const PROMO_A_CONFIG: PromoARules = {
  name: "CHƯƠNG TRÌNH KHUYẾN MẠI GIẢM GIÁ 45%",
  description: "Khi quý khách hàng mua 02-04 sản phẩm tại danh mục số 01 được hưởng mức chiết khấu 45% và phải mua kèm 01 sản phẩm tại danh mục số 03",
  minCatalog1Qty: 2,
  maxCatalog1Qty: 4,
  requiredCatalog3Qty: 1,
  discountRate: 0.45,
  appliesTo: "Đại lý",
  period: "Từ ngày 20/05/2026 đến ngày 10/06/2026",
};

// Interactive structures for Section B: N65 badminton gift string colors
export interface GiftStringSku {
  sku: string;
  colorName: string;
  description: string;
  estimatedPrice: number;
}

export const GIFT_N65_STRINGS: GiftStringSku[] = [
  { sku: "P-AXJT037-1", colorName: "Trắng (White)", description: "Cước cầu lông LiNing N65 - Sợi mềm nảy cao", estimatedPrice: 150000 },
  { sku: "P-AXJT037-2", colorName: "Đen (Black)", description: "Cước cầu lông LiNing N65 - Sợi bền chống mài mòn", estimatedPrice: 150000 },
  { sku: "P-AXJT037-3", colorName: "Vàng chanh (Yellow)", description: "Cước cầu lông LiNing N65 - Sợi nảy trợ lực tốt", estimatedPrice: 150000 },
  { sku: "P-AXJT037-5", colorName: "Đỏ (Red)", description: "Cước cầu lông LiNing N65 - Co giãn tối đa", estimatedPrice: 150000 },
  { sku: "P-AXJT037-6", colorName: "Xanh chuối (Neon Green)", description: "Cước cầu lông LiNing N65 - Màu sắc phản quang", estimatedPrice: 150000 },
  { sku: "P-AXJT037-8", colorName: "Hồng (Pink)", description: "Cước cầu lông LiNing N65 - Hạn chế chấn thương cổ tay", estimatedPrice: 150000 },
  { sku: "P-AXJT037-9", colorName: "Cam (Orange)", description: "Cước cầu lông LiNing N65 - Kiểm soát cầu ổn định", estimatedPrice: 150000 },
  { sku: "P-AXJT037-19", colorName: "Xanh dương (Blue)", description: "Cước cầu lông LiNing N65 - Đàn hồi tối ưu", estimatedPrice: 150000 }
];

export interface PromoB1Rules {
  name: string;
  description: string;
  target: string;
  racketCatalogId: number;
  giftItemName: string;
  giftSkus: string[];
  period: string;
}

export const PROMO_B1_CONFIG: PromoB1Rules = {
  name: "ƯU ĐÃI TẶNG CƯỚC THI ĐẤU LINING N65",
  description: "Khi mua sản phẩm khung vợt cầu lông LiNing trong danh mục số 01 sẽ được tặng kèm 01 sợi cước cầu lông LiNing N65",
  target: "Khách lẻ & đại lý",
  racketCatalogId: 1,
  giftItemName: "Cước cầu lông LiNing N65",
  giftSkus: GIFT_N65_STRINGS.map(s => s.sku),
  period: "Từ ngày 20/05/2026 đến ngày 10/06/2026"
};

// Interactive structures for Section B: Wholesale Volume Gift Rewards
export interface PromoB2Tier {
  minWholesalePrice: number;
  maxWholesalePrice: number;
  giftPercent: number; // 15, 18, 20, 27
  label: string;
  valueLimitText: string;
  explanation: string;
}

export const PROMO_B2_TIERS: PromoB2Tier[] = [
  {
    minWholesalePrice: 0,
    maxWholesalePrice: 7999999,
    giftPercent: 0,
    label: "Doanh số dưới 8M",
    valueLimitText: "0%",
    explanation: "Chưa đạt hạn mức tối thiểu để được tặng kèm vợt"
  },
  {
    minWholesalePrice: 8000000,
    maxWholesalePrice: 19999999,
    giftPercent: 15,
    label: "Đơn hàng từ 8.000.000đ đến dưới 20.000.000đ",
    valueLimitText: "< 15% đại lý tích lũy",
    explanation: "Được chọn quà tặng bất kỳ trong DM01 với tổng giá trị sỉ dưới 15% đơn hàng DM02"
  },
  {
    minWholesalePrice: 20000000,
    maxWholesalePrice: 34999999,
    giftPercent: 18,
    label: "Đơn hàng từ 20.000.000đ đến dưới 35.000.000đ",
    valueLimitText: "< 18% đại lý tích lũy",
    explanation: "Được chọn quà tặng bất kỳ trong DM01 với tổng giá trị sỉ dưới 18% đơn hàng DM02"
  },
  {
    minWholesalePrice: 35000000,
    maxWholesalePrice: 49999999,
    giftPercent: 20,
    label: "Đơn hàng từ 35.000.000đ đến dưới 50.000.000đ",
    valueLimitText: "< 20% đại lý tích lũy",
    explanation: "Được chọn quà tặng bất kỳ trong DM01 với tổng giá trị sỉ dưới 20% đơn hàng DM02"
  },
  {
    minWholesalePrice: 50000000,
    maxWholesalePrice: Infinity,
    giftPercent: 27,
    label: "Đơn hàng từ 50.000.000đ trở lên",
    valueLimitText: "< 27% đại lý tích lũy",
    explanation: "Được chọn quà tặng bất kỳ trong DM01 với tổng giá trị sỉ dưới 27% đơn hàng DM02"
  }
];

export interface PromoB2Rules {
  name: string;
  description: string;
  sourceCatalogId: number; // Catalog 2 (DM02) buy rackets
  giftCatalogId: number; // Catalog 1 (DM01) free gift rackets
  tiers: PromoB2Tier[];
  appliesTo: string;
  period: string;
  notes: string;
}

export const PROMO_B2_CONFIG: PromoB2Rules = {
  name: "CHƯƠNG TRÌNH KHUYẾN MẠI MUA VỢT TẶNG VỢT THEO DOANH SỐ",
  description: "Khi mua đơn hàng vợt cầu lông LiNing trong danh mục số 02 sẽ được tặng sản phẩm trong danh mục số 01. Khách hàng được chọn sản phẩm bất kì nhưng tổng giá trị hàng tặng không vượt quá các mức quy định (theo đơn giá bán buôn).",
  sourceCatalogId: 2,
  giftCatalogId: 1,
  tiers: PROMO_B2_TIERS,
  appliesTo: "Đại lý",
  period: "Từ ngày 20/05/2026 đến ngày 10/06/2026",
  notes: "Mỗi sản phẩm chỉ tham gia 01 nội dung khuyến mại, không áp dụng đồng thời với CTKM khác."
};
