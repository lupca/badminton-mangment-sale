// Mô hình dữ liệu của hệ thống quản lý chương trình khuyến mãi.
// Mọi số tiền đều là VND (đồng), số nguyên. Ngày dạng "YYYY-MM-DD".

export type ID = string;

/** Giá dùng để tính: giá lẻ hay giá sỉ (bán buôn). */
export type PriceBasis = "retail" | "wholesale";

// ───────────────────────── Sản phẩm & danh mục ─────────────────────────

export interface ProductItem {
  sku: string; // mã hàng (đã chuẩn hóa: viết hoa, bỏ khoảng trắng thừa)
  name: string;
  retailPrice: number; // giá lẻ
  wholesalePrice: number; // giá sỉ
  unit?: string; // đơn vị tính
  note?: string;
}

/** Một danh mục hàng trong chương trình (vd "Danh mục áp dụng", "Danh mục hàng tặng"). */
export interface ProductGroup {
  id: ID;
  name: string;
  items: ProductItem[];
}

// ───────────────────────── Quy tắc khuyến mãi ─────────────────────────

/** Một mức doanh số của quy tắc "đạt doanh số → tặng hàng". */
export interface GiftTier {
  id: ID;
  /** Doanh số từ (>=). Mức đạt được là mức có `min` lớn nhất mà doanh số vẫn >= `min`. */
  min: number;
  /** Hạn mức quà: số tiền cố định, hoặc % doanh số. */
  limitType: "amount" | "percent";
  limitValue: number;
  /** Số lượng quà tối đa (null = không giới hạn số lượng). */
  maxQty: number | null;
  /** Chỉ được chọn quà trong các mã này (null = cả danh mục quà). */
  allowedSkus: string[] | null;
}

/** Đạt doanh số ở các danh mục nguồn → được chọn quà trong danh mục quà, tổng giá trị không vượt hạn mức. */
export interface TierGiftRule {
  id: ID;
  type: "tier_gift";
  name: string;
  /** Doanh số tính từ các danh mục này (thành tiền sau giảm giá). */
  sourceGroupIds: ID[];
  /** Quà chọn từ danh mục này. */
  giftGroupId: ID | null;
  /** Giá trị quà tính theo giá lẻ hay giá sỉ của danh mục quà. */
  giftPriceBasis: PriceBasis;
  tiers: GiftTier[];
}

/** Giảm giá % cho các danh mục đích khi đủ điều kiện số lượng. */
export interface DiscountRule {
  id: ID;
  type: "discount";
  name: string;
  /** Các danh mục được giảm giá. */
  targetGroupIds: ID[];
  discountPercent: number; // vd 45
  /** Giảm % trên giá lẻ hay giá sỉ. Đơn giá sau giảm = giá gốc × (1 − %). */
  discountBasis: PriceBasis;
  /** Tổng số lượng mua ở danh mục đích phải >= minQty và <= maxQty (null = không ràng buộc). */
  minQty: number | null;
  maxQty: number | null;
  /** Phải mua kèm ít nhất `requireMinQty` sản phẩm ở các danh mục này (rỗng = không yêu cầu). */
  requireGroupIds: ID[];
  requireMinQty: number;
}

/** Mua X tặng Y. */
export interface BuyXGetYRule {
  id: ID;
  type: "buy_x_get_y";
  name: string;
  sourceGroupIds: ID[];
  buyQty: number; // cứ mua `buyQty` sản phẩm…
  getQty: number; // …được tặng `getQty`
  /**
   * same  = tặng chính sản phẩm đó (tính theo từng mã, vd "mua 1 tặng 1")
   * group = được chọn quà trong danh mục `giftGroupId` (tính trên tổng số lượng mua)
   * text  = tặng món quà ghi bằng chữ `giftText`, không có trong danh mục (vd "Cước N65")
   */
  giftMode: "same" | "group" | "text";
  giftGroupId: ID | null;
  giftText: string;
}

export type Rule = TierGiftRule | DiscountRule | BuyXGetYRule;
export type RuleType = Rule["type"];

// ───────────────────────── Chương trình ─────────────────────────

export interface Program {
  id: ID;
  name: string;
  brand: string; // hãng: "Li-Ning", "Yonex", "Ashaway"…
  startDate: string | null; // null = không giới hạn
  endDate: string | null;
  note: string;
  groups: ProductGroup[];
  rules: Rule[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Trạng thái tính theo ngày: sắp diễn ra / đang chạy / đã kết thúc / không thời hạn. */
export type ProgramStatus = "upcoming" | "running" | "ended" | "open";

// ───────────────────────── Đơn hàng ─────────────────────────

/** Dòng hàng mua. Tên và giá được chép từ danh mục tại lúc thêm vào đơn. Duy nhất theo (groupId, sku). */
export interface OrderLine {
  groupId: ID;
  sku: string;
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  qty: number;
}

/** Quà do sale chọn cho một quy tắc (tier_gift, hoặc buy_x_get_y kiểu "group"). Duy nhất theo (ruleId, sku). */
export interface OrderGift {
  ruleId: ID;
  groupId: ID; // danh mục quà
  sku: string;
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  qty: number;
}

export interface Order {
  id: ID;
  code: string; // vd DH261120-001
  programId: ID;
  customerName: string; // đại lý / nhà phân phối
  customerPhone: string;
  salesperson: string; // tên sale phụ trách đơn
  salespersonPhone: string; // số điện thoại của sale đó
  note: string;
  status: "draft" | "confirmed"; // nháp / đã chốt
  lines: OrderLine[];
  gifts: OrderGift[];
  /** Bản chụp quy tắc tại lúc chốt đơn — để đơn đã chốt không đổi khi chương trình bị sửa. */
  frozenRules?: Rule[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// ───────────────────────── Kết quả tính (engine) ─────────────────────────

export interface CalcLine {
  index: number; // vị trí trong order.lines
  groupId: ID;
  sku: string;
  name: string;
  qty: number;
  retailPrice: number;
  wholesalePrice: number;
  unitPrice: number; // đơn giá thực tính (sau giảm giá nếu có)
  amount: number; // unitPrice × qty
  discountRuleId: ID | null; // quy tắc giảm giá đã áp vào dòng này
  discountPercent: number | null;
}

export interface CalcGift {
  ruleId: ID;
  sku: string; // rỗng nếu là quà dạng chữ
  name: string;
  qty: number;
  unitValue: number; // giá trị 1 đơn vị quà (theo cách tính của quy tắc)
  value: number; // unitValue × qty
  auto: boolean; // true = hệ thống tự tặng; false = sale chọn
}

export interface TierGiftResult {
  type: "tier_gift";
  ruleId: ID;
  ruleName: string;
  revenue: number; // doanh số tính mức
  tiers: GiftTier[]; // các mức, đã sắp tăng dần theo min
  tierIndex: number; // -1 = chưa đạt mức nào
  tier: GiftTier | null;
  nextTier: GiftTier | null;
  amountToNextTier: number; // 0 nếu đã ở mức cao nhất
  budget: number; // hạn mức quà (đ) ở mức hiện tại
  used: number; // giá trị quà đã chọn
  remaining: number; // budget − used (âm = vượt)
  giftQty: number; // số lượng quà đã chọn
  maxQty: number | null;
  allowedSkus: string[] | null;
  giftGroupId: ID | null;
  giftPriceBasis: PriceBasis;
  ok: boolean; // không có lỗi ở quy tắc này
}

export interface DiscountResult {
  type: "discount";
  ruleId: ID;
  ruleName: string;
  eligible: boolean;
  /** Câu giải thích: vì sao đạt / chưa đạt. */
  reason: string;
  targetQty: number;
  requireQty: number;
  savedAmount: number; // số tiền giảm so với giá sỉ
  ok: boolean;
}

export interface BuyXGetYResult {
  type: "buy_x_get_y";
  ruleId: ID;
  ruleName: string;
  giftMode: "same" | "group" | "text";
  sourceQty: number; // tổng số lượng mua ở danh mục nguồn
  entitledQty: number; // số quà được tặng
  chosenQty: number; // (kiểu group) số quà đã chọn
  remainingQty: number; // (kiểu group) còn được chọn
  giftGroupId: ID | null;
  ok: boolean;
}

export type RuleResult = TierGiftResult | DiscountResult | BuyXGetYResult;

export interface CalcIssue {
  level: "error" | "warning" | "info";
  ruleId: ID | null;
  message: string;
}

export interface CalcResult {
  lines: CalcLine[];
  totalQty: number;
  totalRetail: number; // Σ giá lẻ × SL
  totalWholesale: number; // Σ giá sỉ × SL (trước giảm giá)
  discountAmount: number; // totalWholesale − totalAmount
  totalAmount: number; // tiền hàng phải thanh toán
  gifts: CalcGift[]; // toàn bộ quà hợp lệ (tự động + sale chọn)
  giftQty: number;
  giftValue: number;
  rules: RuleResult[]; // theo đúng thứ tự quy tắc của chương trình
  issues: CalcIssue[];
  hasError: boolean;
  /** Vị trí trong order.gifts của các quà không còn quy tắc tương ứng (nên xóa). */
  orphanGiftIndexes: number[];
}

// ───────────────────────── Kho dữ liệu ─────────────────────────

/**
 * Vai trò của người đang dùng ứng dụng. Quản lý: tạo / sửa chương trình, cập nhật tồn kho, quản trị dữ liệu, và tạo đơn.
 * Sale: xem chương trình và tồn kho, tạo đơn.
 */
export type Role = "manager" | "sale";

export interface Settings {
  /** Vai trò: của tài khoản đang đăng nhập (khi có máy chủ), hoặc thiết lập của máy này (khi không có máy chủ). */
  role: Role;
  /** Tên và điện thoại sale, tự ghi vào mỗi đơn mới: lấy từ tài khoản (có máy chủ) hoặc thiết lập của máy này. */
  salesperson: string;
  salespersonPhone: string;
  /** Mã có tồn kho từ 1 đến số này được cảnh báo «sắp hết hàng». 0 = không cảnh báo sắp hết. Có máy chủ thì dùng chung cả nhóm. */
  lowStockThreshold: number;
}

/**
 * Tồn kho lấy từ file Excel của phần mềm kho. Mỗi mã hàng một con số, dùng chung cho mọi chương trình:
 * cùng một mã nằm ở nhiều danh mục vẫn chỉ có một tồn kho.
 */
export interface Stock {
  /** Mã hàng (đã chuẩn hóa) → số lượng tồn; có thể là 0 hoặc âm. Mã không có ở đây = chưa có số liệu. */
  bySku: Record<string, number>;
  /** Lần cập nhật gần nhất (ISO); null = chưa nhập tồn kho lần nào. */
  updatedAt: string | null;
}

export interface DB {
  version: 1;
  programs: Program[];
  orders: Order[];
  settings: Settings;
  stock: Stock;
}
