// Danh sách sản phẩm của màn hình «Sản phẩm»: mỗi mã hàng MỘT dòng, gộp từ mọi danh mục đã nhập trong các chương trình,
// kèm hãng, loại hàng, giá lẻ và tồn kho — rồi lọc, sắp xếp. Các hàm đều thuần.
//
// Sản phẩm hiện chỉ được nhập (từ Excel) vào danh mục của từng chương trình, nên một mã có thể nằm ở nhiều nơi, với tên
// và giá ghi khác nhau. Màn hình «Sản phẩm» lấy tên và giá ở nơi «đáng tin nhất»: chương trình chưa kết thúc, cập nhật
// gần đây nhất. Hãng lấy theo hãng của chương trình; loại hàng nhận theo tên hàng (file Excel không có cột nào cho hai thứ đó).
import type { Program, ProgramStatus, Stock } from "../types";
import { normalizeSku, programStatus, searchKey, todayISO } from "./format";
import { stockLevel, stockOf, type StockFilter, type StockLevel } from "./stock";

// ───────────────────────── Loại hàng (nhận theo tên) ─────────────────────────

export const OTHER_CATEGORY = "Khác";

interface CategoryRule {
  label: string;
  /** Mỗi từ khóa là một hay nhiều từ liền nhau, viết thường, có dấu. */
  keywords: string[];
  /** Các từ khóa chỉ nhận khi tên hàng viết có dấu: bỏ dấu thì trùng với từ khác («quần» / «quấn», «áo» / «ao»…). */
  accentOnly?: string[];
}

// Tên hàng tiếng Việt gần như luôn bắt đầu bằng loại hàng («Khung vợt cầu lông …», «Túi vợt …», «Giày cầu lông …»), nên
// từ khóa nào xuất hiện SỚM NHẤT trong tên thì quyết định. Cùng vị trí thì từ khóa dài hơn thắng, rồi tới thứ tự dưới đây.
const CATEGORY_RULES: CategoryRule[] = [
  { label: "Vợt tennis", keywords: ["vợt tennis"] },
  { label: "Vợt pickleball", keywords: ["vợt pickleball", "pickleball"] },
  { label: "Quấn cán", keywords: ["quấn cán", "cuốn cán", "quấn cốt", "overgrip", "grip"] },
  { label: "Cước", keywords: ["cước", "dây cước", "dây đan vợt"] },
  { label: "Túi, balo", keywords: ["túi", "balo", "ba lô", "bao vợt", "bao đựng vợt"] },
  { label: "Giày", keywords: ["giày", "giầy", "dép"], accentOnly: ["dép"] },
  { label: "Quần áo", keywords: ["bộ quần áo", "quần áo", "áo", "quần", "váy"], accentOnly: ["áo", "quần", "váy"] },
  { label: "Quả cầu", keywords: ["quả cầu", "ống cầu", "cầu lông"] },
  {
    label: "Vợt cầu lông",
    keywords: [
      "khung vợt",
      "vợt cầu lông",
      "vợt",
      // Tên các dòng vợt hay được ghi trống không, thiếu chữ «vợt» ở đầu.
      "aeronaut",
      "axforce",
      "bladex",
      "halbertec",
      "tectonic",
      "calibar",
      "windstorm",
      "winstom",
      "turbo charging",
      "astrox",
      "nanoflare",
      "arcsaber",
      "duora",
      "voltric",
      "nanoray",
      "thruster",
      "auraspeed",
      "jetspeed",
    ],
  },
  {
    label: "Phụ kiện",
    keywords: ["phụ kiện", "bình nước", "lót giày", "móc khóa", "tất", "vớ", "băng", "khăn", "mũ", "nón"],
    accentOnly: ["tất", "vớ", "băng", "khăn", "mũ", "nón"],
  },
];

/** Thứ tự các loại hàng khi liệt kê (theo bảng quy tắc; «Khác» đứng cuối). */
export const CATEGORY_ORDER: string[] = [
  "Vợt cầu lông",
  "Vợt tennis",
  "Vợt pickleball",
  "Giày",
  "Quần áo",
  "Túi, balo",
  "Cước",
  "Quả cầu",
  "Quấn cán",
  "Phụ kiện",
  OTHER_CATEGORY,
];

/** Tách chữ thành các từ (chữ cái, chữ số), viết thường. */
function words(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

interface CompiledKeyword {
  label: string;
  /** Các từ của từ khóa, có dấu. */
  accented: string[];
  /** Các từ đó sau khi bỏ dấu; null = chỉ nhận khi tên hàng viết có dấu. */
  plain: string[] | null;
  order: number;
}

const KEYWORDS: CompiledKeyword[] = CATEGORY_RULES.flatMap((rule, order) =>
  rule.keywords.map((keyword) => {
    const accented = words(keyword);
    return { label: rule.label, accented, plain: rule.accentOnly?.includes(keyword) ? null : accented.map(searchKey), order };
  }),
);

/**
 * Loại hàng nhận theo một dòng chữ (tên hàng, hoặc tên danh mục): từ khóa xuất hiện sớm nhất quyết định.
 * Không thấy từ khóa nào → «Khác».
 */
export function categoryOf(text: string): string {
  const tokens = words(text);
  if (tokens.length === 0) return OTHER_CATEGORY;
  const plainTokens = tokens.map(searchKey);
  let best: { at: number; length: number; order: number; label: string } | null = null;
  for (const keyword of KEYWORDS) {
    const size = keyword.accented.length;
    for (let at = 0; at + size <= tokens.length; at++) {
      // Chưa xét tiếp nếu vị trí này đã thua kết quả đang giữ.
      if (best && at > best.at) break;
      let hit = true;
      for (let i = 0; i < size; i++) {
        const token = tokens[at + i];
        const exact = token === keyword.accented[i];
        // Từ viết không dấu thì so theo dạng bỏ dấu (nếu từ khóa cho phép).
        const loose = !exact && keyword.plain !== null && token === plainTokens[at + i] && token === keyword.plain[i];
        if (!exact && !loose) {
          hit = false;
          break;
        }
      }
      if (!hit) continue;
      const better =
        !best ||
        at < best.at ||
        (at === best.at && (size > best.length || (size === best.length && keyword.order < best.order)));
      if (better) best = { at, length: size, order: keyword.order, label: keyword.label };
      break;
    }
  }
  return best?.label ?? OTHER_CATEGORY;
}

// ───────────────────────── Hãng ─────────────────────────

/** "Li-Ning, Ashaway" → ["Li-Ning", "Ashaway"]. Bỏ tên trùng (không phân biệt hoa thường, dấu). */
export function splitBrands(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,;/&+|]|\s+và\s+/i)) {
    const name = part.replace(/\s+/g, " ").trim();
    const key = brandKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Khóa so sánh tên hãng: bỏ dấu, hoa thường và mọi ký tự không phải chữ, số ("Li-Ning" = "LINING" = "li ning"). */
export function brandKey(name: string): string {
  return searchKey(name).replace(/[^a-z0-9]+/g, "");
}

/**
 * Hãng của một mặt hàng. Chương trình chỉ ghi một hãng thì lấy hãng đó. Ghi nhiều hãng ("Li-Ning, Ashaway") thì lấy
 * hãng có tên nằm trong tên danh mục (vd danh mục «Ashaway»), không thì trong tên hàng. Không xác định được → "".
 */
export function brandOf(programBrand: string, groupName: string, itemName: string): string {
  const brands = splitBrands(programBrand);
  if (brands.length <= 1) return brands[0] ?? "";
  for (const text of [groupName, itemName]) {
    const key = brandKey(text);
    const hits = brands.filter((brand) => key.includes(brandKey(brand)));
    if (hits.length === 1) return hits[0];
  }
  return "";
}

// ───────────────────────── Gộp sản phẩm ─────────────────────────

/** Một nơi mã hàng xuất hiện: danh mục của một chương trình, với tên và giá ghi ở đó. */
export interface ProductSource {
  programId: string;
  programName: string;
  programStatus: ProgramStatus;
  groupId: string;
  groupName: string;
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  note: string;
}

export interface CatalogProduct {
  /** Mã hàng đã chuẩn hóa. */
  sku: string;
  name: string;
  /** "" = chưa rõ hãng. */
  brand: string;
  /** Loại hàng, vd "Vợt cầu lông"; không nhận ra thì là «Khác». */
  category: string;
  unit: string;
  /** Giá lẻ đang hiện (lấy ở nơi đứng đầu `sources`); 0 = chưa có giá. */
  retailPrice: number;
  /** Giá lẻ thấp nhất / cao nhất giữa các nơi ghi mã này (bằng nhau khi các nơi thống nhất). */
  retailMin: number;
  retailMax: number;
  /** null = chưa có số liệu tồn kho. */
  stock: number | null;
  level: StockLevel;
  /** Còn nằm trong ít nhất một chương trình chưa kết thúc (hàng đang được bán). */
  selling: boolean;
  /** Cần sale chú ý: hàng đang bán mà đã hết hoặc sắp hết. */
  attention: boolean;
  /** Mọi nơi mã này xuất hiện; nơi đứng đầu là nơi lấy tên và giá. */
  sources: ProductSource[];
  /** Khóa tìm kiếm: mã, tên, hãng — bỏ dấu, viết thường. */
  key: string;
}

/**
 * Gộp sản phẩm của mọi chương trình thành danh sách mỗi mã một dòng, kèm tồn kho.
 * `lowThreshold` = ngưỡng «sắp hết» (0 = không cảnh báo sắp hết).
 */
export function buildCatalog(
  programs: readonly Program[],
  stock: Stock,
  lowThreshold: number,
  today: string = todayISO(),
): CatalogProduct[] {
  // Nơi đáng tin hơn đứng trước: chương trình chưa kết thúc, rồi tới chương trình cập nhật gần đây hơn.
  const ordered = programs
    .map((program, index) => ({ program, index, status: programStatus(program, today) }))
    .sort(
      (a, b) =>
        Number(a.status === "ended") - Number(b.status === "ended") ||
        (b.program.updatedAt ?? "").localeCompare(a.program.updatedAt ?? "") ||
        a.index - b.index,
    );

  interface Draft {
    sku: string;
    unit: string;
    sources: ProductSource[];
    brands: string[];
    groupNames: string[];
    seen: Set<string>;
  }
  const drafts = new Map<string, Draft>();
  // Cùng một hãng viết khác nhau ở các chương trình ("Li-Ning", "LI-NING") thì dùng cách viết gặp đầu tiên.
  const brandSpelling = new Map<string, string>();

  for (const { program, status } of ordered) {
    for (const group of program.groups) {
      for (const item of group.items) {
        const sku = normalizeSku(item.sku);
        if (!sku) continue;
        let draft = drafts.get(sku);
        if (!draft) {
          draft = { sku, unit: "", sources: [], brands: [], groupNames: [], seen: new Set() };
          drafts.set(sku, draft);
        }
        // Dữ liệu cũ có thể ghi một mã hai lần trong cùng danh mục: chỉ tính lần đầu.
        const place = `${program.id}\u0000${group.id}`;
        if (draft.seen.has(place)) continue;
        draft.seen.add(place);
        draft.sources.push({
          programId: program.id,
          programName: program.name,
          programStatus: status,
          groupId: group.id,
          groupName: group.name,
          name: (item.name ?? "").trim(),
          retailPrice: Number.isFinite(item.retailPrice) ? item.retailPrice : 0,
          wholesalePrice: Number.isFinite(item.wholesalePrice) ? item.wholesalePrice : 0,
          note: (item.note ?? "").trim(),
        });
        draft.groupNames.push(group.name);
        if (!draft.unit && item.unit?.trim()) draft.unit = item.unit.trim();
        const brand = brandOf(program.brand ?? "", group.name, item.name ?? "");
        if (brand) {
          const key = brandKey(brand);
          if (!brandSpelling.has(key)) brandSpelling.set(key, brand);
          draft.brands.push(brandSpelling.get(key) ?? brand);
        }
      }
    }
  }

  const products: CatalogProduct[] = [];
  for (const draft of drafts.values()) {
    const { sku, sources } = draft;
    const name = sources.find((source) => source.name)?.name ?? "";
    const prices = sources.map((source) => source.retailPrice).filter((price) => price > 0);
    const retailPrice = prices[0] ?? 0;
    const brand = draft.brands[0] ?? "";
    // Loại hàng: theo tên hàng ở từng nơi; tên không nói lên điều gì thì theo tên danh mục (vd «Danh mục 01 (vợt trung cấp)»).
    const category =
      sources.map((source) => categoryOf(source.name)).find((label) => label !== OTHER_CATEGORY) ??
      draft.groupNames.map(categoryOf).find((label) => label !== OTHER_CATEGORY) ??
      OTHER_CATEGORY;
    const qty = stockOf(stock, sku);
    const level = stockLevel(qty, lowThreshold);
    const selling = sources.some((source) => source.programStatus !== "ended");
    products.push({
      sku,
      name,
      brand,
      category,
      unit: draft.unit,
      retailPrice,
      retailMin: prices.length > 0 ? Math.min(...prices) : 0,
      retailMax: prices.length > 0 ? Math.max(...prices) : 0,
      stock: qty,
      level,
      selling,
      attention: selling && (level === "out" || level === "low"),
      sources,
      key: searchKey(`${sku} ${name} ${brand}`),
    });
  }
  return products;
}

// ───────────────────────── Lọc ─────────────────────────

/** Giá trị của ô lọc hãng cho các mã chưa rõ hãng ("" đã dùng cho «tất cả»). */
export const NO_BRAND = "(chưa rõ)";
export const NO_BRAND_LABEL = "Chưa rõ hãng";

export interface PriceRange {
  key: string;
  label: string;
  /** Giá lẻ từ `min` (tính cả) đến dưới `max`. */
  min: number;
  max: number;
}

export const PRICE_RANGES: PriceRange[] = [
  { key: "lt1", label: "Dưới 1 triệu", min: 1, max: 1_000_000 },
  { key: "1-2", label: "1 – 2 triệu", min: 1_000_000, max: 2_000_000 },
  { key: "2-3", label: "2 – 3 triệu", min: 2_000_000, max: 3_000_000 },
  { key: "3-5", label: "3 – 5 triệu", min: 3_000_000, max: 5_000_000 },
  { key: "gt5", label: "Từ 5 triệu trở lên", min: 5_000_000, max: Number.POSITIVE_INFINITY },
];

export interface CatalogFilter {
  /** Tìm theo mã, tên hoặc hãng. */
  search: string;
  /** "" = mọi hãng; `NO_BRAND` = các mã chưa rõ hãng. */
  brand: string;
  /** "" = mọi loại hàng. */
  category: string;
  stock: StockFilter;
  /** Khóa của một mức trong `PRICE_RANGES`; "" = mọi mức giá. */
  price: string;
}

export const NO_FILTER: CatalogFilter = { search: "", brand: "", category: "", stock: "all", price: "" };

function matchesStock(product: CatalogProduct, filter: StockFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "in":
      return product.level === "in" || product.level === "low";
    case "attention":
      return product.attention;
    default:
      return product.level === filter;
  }
}

/** Lọc danh sách sản phẩm. Mức giá không có trong `PRICE_RANGES` coi như không lọc theo giá. */
export function filterCatalog(products: readonly CatalogProduct[], filter: CatalogFilter): CatalogProduct[] {
  const query = searchKey(filter.search).trim();
  const queryWords = query ? query.split(/\s+/) : [];
  const wantNoBrand = filter.brand === NO_BRAND;
  const wantBrand = !wantNoBrand && filter.brand ? brandKey(filter.brand) : "";
  const range = PRICE_RANGES.find((item) => item.key === filter.price);
  return products.filter((product) => {
    if (wantNoBrand && product.brand) return false;
    if (wantBrand && brandKey(product.brand) !== wantBrand) return false;
    if (filter.category && product.category !== filter.category) return false;
    if (!matchesStock(product, filter.stock)) return false;
    if (range && !(product.retailPrice >= range.min && product.retailPrice < range.max)) return false;
    return queryWords.every((word) => product.key.includes(word));
  });
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface CatalogFacets {
  brands: FacetOption[];
  categories: FacetOption[];
}

const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

/** Các hãng và loại hàng có trong danh sách, kèm số mã của từng mục — để dựng các ô lọc. */
export function catalogFacets(products: readonly CatalogProduct[]): CatalogFacets {
  const brandCount = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  for (const product of products) {
    brandCount.set(product.brand, (brandCount.get(product.brand) ?? 0) + 1);
    categoryCount.set(product.category, (categoryCount.get(product.category) ?? 0) + 1);
  }
  const brands = [...brandCount]
    .filter(([brand]) => brand)
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([brand, count]) => ({ value: brand, label: brand, count }));
  const unknown = brandCount.get("") ?? 0;
  if (unknown > 0) brands.push({ value: NO_BRAND, label: NO_BRAND_LABEL, count: unknown });
  const rank = (label: string) => {
    const at = CATEGORY_ORDER.indexOf(label);
    return at < 0 ? CATEGORY_ORDER.length : at;
  };
  const categories = [...categoryCount]
    .sort(([a], [b]) => rank(a) - rank(b) || collator.compare(a, b))
    .map(([category, count]) => ({ value: category, label: category, count }));
  return { brands, categories };
}

// ───────────────────────── Sắp xếp ─────────────────────────

export type CatalogSortKey = "sku" | "name" | "brand" | "category" | "price" | "stock";
export type SortDir = "asc" | "desc";
export const CATALOG_SORT_KEYS: CatalogSortKey[] = ["sku", "name", "brand", "category", "price", "stock"];

/** Sắp xếp (không đổi mảng gốc). Giá trị trống — chưa rõ hãng, chưa có giá, chưa có số liệu tồn kho — luôn đứng cuối. */
export function sortCatalog(products: readonly CatalogProduct[], key: CatalogSortKey, dir: SortDir = "asc"): CatalogProduct[] {
  const sign = dir === "desc" ? -1 : 1;
  const text = (a: string, b: string) => (a === b ? 0 : !a ? 1 : !b ? -1 : sign * collator.compare(a, b));
  const number = (a: number | null, b: number | null) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : sign * (a - b));
  const compare = (a: CatalogProduct, b: CatalogProduct): number => {
    switch (key) {
      case "sku":
        return text(a.sku, b.sku);
      case "name":
        return text(a.name, b.name);
      case "brand":
        return text(a.brand, b.brand);
      case "category":
        return text(a.category, b.category);
      case "price":
        return number(a.retailPrice || null, b.retailPrice || null);
      case "stock":
        return number(a.stock, b.stock);
    }
  };
  // Bằng nhau thì theo tên rồi mã, để thứ tự không đổi giữa các lần vẽ.
  return [...products].sort((a, b) => compare(a, b) || collator.compare(a.name, b.name) || collator.compare(a.sku, b.sku));
}

// ───────────────────────── Tổng hợp ─────────────────────────

export interface CatalogSummary {
  total: number;
  /** Số mã còn hàng (> 0), gồm cả các mã sắp hết. */
  inStock: number;
  /** Trong số mã còn hàng, số mã sắp hết. */
  low: number;
  out: number;
  unknown: number;
  /** Số mã cần sale chú ý (hàng đang bán mà hết hoặc sắp hết), tách theo hai mức. */
  attentionOut: number;
  attentionLow: number;
}

export function summarizeCatalog(products: readonly CatalogProduct[]): CatalogSummary {
  const summary: CatalogSummary = { total: products.length, inStock: 0, low: 0, out: 0, unknown: 0, attentionOut: 0, attentionLow: 0 };
  for (const product of products) {
    if (product.level === "unknown") summary.unknown++;
    else if (product.level === "out") summary.out++;
    else summary.inStock++;
    if (product.level === "low") summary.low++;
    if (product.attention) {
      if (product.level === "out") summary.attentionOut++;
      else summary.attentionLow++;
    }
  }
  return summary;
}

/** Có mã nào cần sale chú ý không (để đặt chấm đỏ trên mục «Sản phẩm»). Không dựng cả danh sách. */
export function hasStockAttention(
  programs: readonly Program[],
  stock: Stock,
  lowThreshold: number,
  today: string = todayISO(),
): boolean {
  if (Object.keys(stock.bySku).length === 0) return false;
  for (const program of programs) {
    if (programStatus(program, today) === "ended") continue;
    for (const group of program.groups) {
      for (const item of group.items) {
        const level = stockLevel(stockOf(stock, item.sku), lowThreshold);
        if (level === "out" || level === "low") return true;
      }
    }
  }
  return false;
}
