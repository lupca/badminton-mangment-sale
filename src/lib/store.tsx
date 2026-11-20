// Kho dữ liệu: toàn bộ dữ liệu nằm trong bộ nhớ (React state) và được ghi tự động xuống localStorage.
// Muốn chuyển sang backend sau này chỉ cần thay 2 hàm readStorage / writeStorage.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import seedData from "../seed/seed.json";
import type {
  DB,
  GiftTier,
  ID,
  Order,
  OrderGift,
  OrderLine,
  ProductGroup,
  ProductItem,
  Program,
  Rule,
  Settings,
  Stock,
} from "../types";
import { newId, normalizeSku } from "./format";
import { applyStock, newerStock, stockQty } from "./stock";

const STORAGE_KEY = "kmdb.v1";

// ───────────────────────── Chuẩn hóa dữ liệu đọc vào ─────────────────────────
// Dữ liệu có thể đến từ localStorage cũ hoặc file JSON người dùng nhập — không tin tưởng hình dạng của nó.

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const qty = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const nullableQty = (v: unknown): number | null => (v == null || v === "" ? null : qty(v));
const dateOrNull = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const idList = (v: unknown): ID[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
/** Như `list` nhưng bỏ các phần tử không phải object (null, số, chuỗi…) — không tự dựng ra bản ghi rỗng từ dữ liệu rác. */
const records = (v: unknown): any[] => list(v).filter((x) => x != null && typeof x === "object" && !Array.isArray(x));
/** Số lượng của quy tắc: thiếu hẳn thì lấy `fallback`; đã ghi (kể cả 0) thì giữ đúng giá trị đã ghi. */
const qtyOr = (v: unknown, fallback: number): number => (v == null ? fallback : qty(v));

function normalizeItem(raw: any): ProductItem | null {
  const sku = normalizeSku(raw?.sku);
  if (!sku) return null;
  const item: ProductItem = {
    sku,
    name: str(raw.name),
    retailPrice: money(raw.retailPrice),
    wholesalePrice: money(raw.wholesalePrice),
  };
  if (str(raw.unit)) item.unit = str(raw.unit);
  if (str(raw.note)) item.note = str(raw.note);
  return item;
}

function normalizeGroup(raw: any): ProductGroup {
  return {
    id: str(raw?.id) || newId("g"),
    name: str(raw?.name, "Danh mục"),
    items: list(raw?.items)
      .map(normalizeItem)
      .filter((x): x is ProductItem => x !== null),
  };
}

function normalizeTier(raw: any): GiftTier {
  return {
    id: str(raw?.id) || newId("t"),
    min: money(raw?.min),
    limitType: raw?.limitType === "percent" ? "percent" : "amount",
    limitValue: Number.isFinite(Number(raw?.limitValue)) ? Math.max(0, Number(raw.limitValue)) : 0,
    maxQty: nullableQty(raw?.maxQty),
    allowedSkus: Array.isArray(raw?.allowedSkus) ? raw.allowedSkus.map(normalizeSku).filter(Boolean) : null,
  };
}

function normalizeRule(raw: any): Rule | null {
  const id = str(raw?.id) || newId("r");
  const name = str(raw?.name, "Quy tắc");
  if (raw?.type === "tier_gift") {
    return {
      id,
      type: "tier_gift",
      name,
      sourceGroupIds: idList(raw.sourceGroupIds),
      giftGroupId: str(raw.giftGroupId) || null,
      giftPriceBasis: raw.giftPriceBasis === "retail" ? "retail" : "wholesale",
      tiers: records(raw.tiers).map(normalizeTier),
    };
  }
  if (raw?.type === "discount") {
    return {
      id,
      type: "discount",
      name,
      targetGroupIds: idList(raw.targetGroupIds),
      discountPercent: Number.isFinite(Number(raw.discountPercent)) ? Number(raw.discountPercent) : 0,
      discountBasis: raw.discountBasis === "retail" ? "retail" : "wholesale",
      minQty: nullableQty(raw.minQty),
      maxQty: nullableQty(raw.maxQty),
      requireGroupIds: idList(raw.requireGroupIds),
      // Thiếu số lượng mua kèm → 1 (như quy tắc mới tạo), để điều kiện mua kèm không âm thầm mất hiệu lực.
      requireMinQty: qtyOr(raw.requireMinQty, 1),
    };
  }
  if (raw?.type === "buy_x_get_y") {
    return {
      id,
      type: "buy_x_get_y",
      name,
      sourceGroupIds: idList(raw.sourceGroupIds),
      // Số 0 người dùng đã lưu (ô đang để trống, quy tắc chưa có hiệu lực) phải giữ là 0: nếu đổi thành 1 thì sau mỗi lần
      // tải lại trang quy tắc tự biến thành "mua 1 tặng 1".
      buyQty: qtyOr(raw.buyQty, 1),
      getQty: qtyOr(raw.getQty, 1),
      giftMode: raw.giftMode === "group" || raw.giftMode === "text" ? raw.giftMode : "same",
      giftGroupId: str(raw.giftGroupId) || null,
      giftText: str(raw.giftText),
    };
  }
  return null;
}

function normalizeRules(raw: unknown): Rule[] {
  return list(raw)
    .map(normalizeRule)
    .filter((x): x is Rule => x !== null);
}

function normalizeProgram(raw: any): Program {
  const now = new Date().toISOString();
  return {
    id: str(raw?.id) || newId("p"),
    name: str(raw?.name, "Chương trình chưa đặt tên"),
    brand: str(raw?.brand),
    startDate: dateOrNull(raw?.startDate),
    endDate: dateOrNull(raw?.endDate),
    note: str(raw?.note),
    groups: records(raw?.groups).map(normalizeGroup),
    rules: normalizeRules(raw?.rules),
    createdAt: str(raw?.createdAt, now),
    updatedAt: str(raw?.updatedAt, now),
  };
}

function normalizeLine(raw: any): OrderLine | null {
  const sku = normalizeSku(raw?.sku);
  if (!sku) return null;
  return {
    groupId: str(raw.groupId),
    sku,
    name: str(raw.name),
    retailPrice: money(raw.retailPrice),
    wholesalePrice: money(raw.wholesalePrice),
    qty: qty(raw.qty),
  };
}

function normalizeGift(raw: any): OrderGift | null {
  const line = normalizeLine(raw);
  if (!line) return null;
  return { ...line, ruleId: str(raw.ruleId) };
}

function normalizeOrder(raw: any): Order {
  const now = new Date().toISOString();
  const order: Order = {
    id: str(raw?.id) || newId("o"),
    code: str(raw?.code),
    programId: str(raw?.programId),
    customerName: str(raw?.customerName),
    customerPhone: str(raw?.customerPhone),
    salesperson: str(raw?.salesperson),
    note: str(raw?.note),
    status: raw?.status === "confirmed" ? "confirmed" : "draft",
    lines: list(raw?.lines)
      .map(normalizeLine)
      .filter((x): x is OrderLine => x !== null),
    gifts: list(raw?.gifts)
      .map(normalizeGift)
      .filter((x): x is OrderGift => x !== null),
    createdAt: str(raw?.createdAt, now),
    updatedAt: str(raw?.updatedAt, now),
  };
  if (Array.isArray(raw?.frozenRules)) order.frozenRules = normalizeRules(raw.frozenRules);
  return order;
}

/** Tồn kho: chỉ giữ các cặp (mã hàng, số). Dữ liệu lưu trước khi có tồn kho thì không có mục này → tồn kho rỗng. */
function normalizeStock(raw: any): Stock {
  const bySku: Record<string, number> = {};
  const source = raw?.bySku;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source)) {
      const sku = normalizeSku(key);
      const amount = stockQty(value);
      if (sku && amount != null) bySku[sku] = amount;
    }
  }
  const updatedAt = typeof raw?.updatedAt === "string" && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : null;
  return { bySku, updatedAt };
}

export function normalizeDB(raw: any): DB {
  if (!raw || typeof raw !== "object" || (!Array.isArray(raw.programs) && !Array.isArray(raw.orders))) {
    throw new Error("File không đúng định dạng dữ liệu của hệ thống (thiếu danh sách chương trình / đơn hàng).");
  }
  return {
    version: 1,
    programs: records(raw.programs).map(normalizeProgram),
    orders: records(raw.orders).map(normalizeOrder),
    settings: { salesperson: str(raw.settings?.salesperson) },
    stock: normalizeStock(raw.stock),
  };
}

export function seedDB(): DB {
  return normalizeDB(JSON.parse(JSON.stringify(seedData)));
}

// ───────────────────────── Đọc / ghi ─────────────────────────

function readStorage(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeDB(JSON.parse(raw));
  } catch (error) {
    console.error("Không đọc được dữ liệu đã lưu, dùng dữ liệu mẫu.", error);
  }
  return seedDB();
}

function writeStorage(db: DB): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    return true;
  } catch (error) {
    console.error("Không ghi được dữ liệu xuống trình duyệt.", error);
    return false;
  }
}

// ───────────────────────── Tiện ích ─────────────────────────

/** Mã đơn dạng DH261120-001: ngày tạo + số thứ tự trong ngày. */
function nextOrderCode(orders: Order[]): string {
  const d = new Date();
  const day = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const prefix = `DH${day}-`;
  const used = orders
    .filter((o) => o.code.startsWith(prefix))
    .map((o) => Number(o.code.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

/** Sao chép chương trình với id mới cho mọi danh mục / quy tắc / mức, giữ nguyên các tham chiếu. */
function cloneProgram(source: Program, name: string): Program {
  const groupIds = new Map<ID, ID>(source.groups.map((g) => [g.id, newId("g")]));
  const mapId = (id: ID) => groupIds.get(id) ?? id;
  const now = new Date().toISOString();
  return {
    ...source,
    id: newId("p"),
    name,
    groups: source.groups.map((g) => ({ ...g, id: mapId(g.id), items: g.items.map((i) => ({ ...i })) })),
    rules: source.rules.map((rule): Rule => {
      const id = newId("r");
      if (rule.type === "tier_gift") {
        return {
          ...rule,
          id,
          sourceGroupIds: rule.sourceGroupIds.map(mapId),
          giftGroupId: rule.giftGroupId ? mapId(rule.giftGroupId) : null,
          tiers: rule.tiers.map((t) => ({ ...t, id: newId("t"), allowedSkus: t.allowedSkus ? [...t.allowedSkus] : null })),
        };
      }
      if (rule.type === "discount") {
        return { ...rule, id, targetGroupIds: rule.targetGroupIds.map(mapId), requireGroupIds: rule.requireGroupIds.map(mapId) };
      }
      return { ...rule, id, sourceGroupIds: rule.sourceGroupIds.map(mapId), giftGroupId: rule.giftGroupId ? mapId(rule.giftGroupId) : null };
    }),
    createdAt: now,
    updatedAt: now,
  };
}

// ───────────────────────── Store ─────────────────────────

export interface Store {
  db: DB;
  programs: Program[];
  orders: Order[];
  settings: Settings;
  /** Tồn kho theo mã hàng, dùng chung cho mọi chương trình. */
  stock: Stock;
  /** false nếu lần ghi gần nhất xuống trình duyệt thất bại (vd hết dung lượng). */
  saveOk: boolean;

  getProgram(id: ID | null | undefined): Program | undefined;
  getOrder(id: ID | null | undefined): Order | undefined;
  /** Số đơn hàng thuộc một chương trình. */
  orderCountOf(programId: ID): number;

  createProgram(init?: Partial<Program>): Program;
  /** Sửa chương trình bằng hàm thuần `fn`; `updatedAt` được cập nhật tự động. Lưu tự động. */
  updateProgram(id: ID, fn: (program: Program) => Program): void;
  /** Xóa chương trình. Trả về false (không xóa) nếu còn đơn hàng thuộc chương trình. */
  deleteProgram(id: ID): boolean;
  duplicateProgram(id: ID): Program | null;

  createOrder(programId: ID, init?: Partial<Order>): Order;
  /** Sửa đơn bằng hàm thuần `fn`; `updatedAt` được cập nhật tự động. Lưu tự động. */
  updateOrder(id: ID, fn: (order: Order) => Order): void;
  deleteOrder(id: ID): void;
  /** Nhân bản đơn thành một đơn nháp mới (mã mới, bỏ trạng thái chốt). */
  duplicateOrder(id: ID): Order | null;

  updateSettings(patch: Partial<Settings>): void;

  /**
   * Ghi tồn kho đọc từ file (mã hàng → số lượng). "merge" = chỉ cập nhật các mã có trong `entries`, giữ số liệu của
   * các mã khác; "replace" = bỏ hết số liệu cũ. Thời điểm cập nhật được ghi tự động.
   */
  updateStock(entries: Record<string, number>, mode: "merge" | "replace"): void;

  /** Toàn bộ dữ liệu dạng JSON (để sao lưu / gửi cho người khác). */
  exportJSON(): string;
  /**
   * Nhập dữ liệu JSON. "replace" = thay toàn bộ; "merge" = thêm vào, bản ghi trùng id thì ghi đè, còn tồn kho
   * thì lấy trọn bộ được cập nhật gần đây hơn. Ném Error (thông báo tiếng Việt) nếu file không hợp lệ.
   */
  importJSON(text: string, mode: "replace" | "merge"): { programs: number; orders: number };
  /** Xóa hết và nạp lại dữ liệu mẫu. */
  resetToSeed(): void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDbState] = useState<DB>(readStorage);
  const [saveOk, setSaveOk] = useState(true);
  const dbRef = useRef(db);

  // Mọi thay đổi đi qua đây: cập nhật ref ngay (để các lệnh gọi liên tiếp thấy dữ liệu mới) rồi mới setState.
  const commit = useCallback((next: DB) => {
    dbRef.current = next;
    setDbState(next);
  }, []);

  // Ghi xuống localStorage, gom các thay đổi liên tiếp trong 250ms.
  const pendingSave = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (pendingSave.current != null) {
      window.clearTimeout(pendingSave.current);
      pendingSave.current = null;
      setSaveOk(writeStorage(dbRef.current));
    }
  }, []);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (pendingSave.current != null) window.clearTimeout(pendingSave.current);
    pendingSave.current = window.setTimeout(() => {
      pendingSave.current = null;
      setSaveOk(writeStorage(dbRef.current));
    }, 250);
  }, [db]);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [flush]);

  // Tab khác của cùng trình duyệt vừa ghi dữ liệu → nạp lại để hai tab không ghi đè nhau.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue == null) return;
      try {
        const next = normalizeDB(JSON.parse(event.newValue));
        dbRef.current = next;
        setDbState(next);
      } catch {
        // bỏ qua dữ liệu hỏng
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const store = useMemo<Store>(() => {
    const now = () => new Date().toISOString();
    return {
      db,
      programs: db.programs,
      orders: db.orders,
      settings: db.settings,
      stock: db.stock,
      saveOk,

      getProgram: (id) => (id ? db.programs.find((p) => p.id === id) : undefined),
      getOrder: (id) => (id ? db.orders.find((o) => o.id === id) : undefined),
      orderCountOf: (programId) => db.orders.filter((o) => o.programId === programId).length,

      createProgram(init) {
        const program = normalizeProgram({ name: "Chương trình mới", ...init, id: newId("p"), createdAt: now(), updatedAt: now() });
        const cur = dbRef.current;
        commit({ ...cur, programs: [program, ...cur.programs] });
        return program;
      },
      updateProgram(id, fn) {
        const cur = dbRef.current;
        commit({
          ...cur,
          programs: cur.programs.map((p) => (p.id === id ? { ...fn(p), id: p.id, updatedAt: now() } : p)),
        });
      },
      deleteProgram(id) {
        const cur = dbRef.current;
        if (cur.orders.some((o) => o.programId === id)) return false;
        commit({ ...cur, programs: cur.programs.filter((p) => p.id !== id) });
        return true;
      },
      duplicateProgram(id) {
        const cur = dbRef.current;
        const source = cur.programs.find((p) => p.id === id);
        if (!source) return null;
        const copy = cloneProgram(source, `${source.name} (bản sao)`);
        const at = cur.programs.findIndex((p) => p.id === id);
        const programs = [...cur.programs];
        programs.splice(at + 1, 0, copy);
        commit({ ...cur, programs });
        return copy;
      },

      createOrder(programId, init) {
        const cur = dbRef.current;
        const order = normalizeOrder({
          salesperson: cur.settings.salesperson,
          ...init,
          id: newId("o"),
          code: nextOrderCode(cur.orders),
          programId,
          status: "draft",
          createdAt: now(),
          updatedAt: now(),
        });
        delete order.frozenRules;
        commit({ ...cur, orders: [order, ...cur.orders] });
        return order;
      },
      updateOrder(id, fn) {
        const cur = dbRef.current;
        commit({
          ...cur,
          orders: cur.orders.map((o) => (o.id === id ? { ...fn(o), id: o.id, updatedAt: now() } : o)),
        });
      },
      deleteOrder(id) {
        const cur = dbRef.current;
        commit({ ...cur, orders: cur.orders.filter((o) => o.id !== id) });
      },
      duplicateOrder(id) {
        const cur = dbRef.current;
        const source = cur.orders.find((o) => o.id === id);
        if (!source) return null;
        const copy: Order = {
          ...source,
          id: newId("o"),
          code: nextOrderCode(cur.orders),
          status: "draft",
          lines: source.lines.map((l) => ({ ...l })),
          gifts: source.gifts.map((g) => ({ ...g })),
          createdAt: now(),
          updatedAt: now(),
        };
        delete copy.frozenRules;
        commit({ ...cur, orders: [copy, ...cur.orders] });
        return copy;
      },

      updateSettings(patch) {
        const cur = dbRef.current;
        commit({ ...cur, settings: { ...cur.settings, ...patch } });
      },

      updateStock(entries, mode) {
        const cur = dbRef.current;
        commit({ ...cur, stock: applyStock(mode === "replace" ? null : cur.stock, entries, now()) });
      },

      exportJSON: () => JSON.stringify(dbRef.current, null, 2),
      importJSON(text, mode) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("File không phải JSON hợp lệ.");
        }
        const incoming = normalizeDB(parsed);
        const cur = dbRef.current;
        if (mode === "replace") {
          commit(incoming);
        } else {
          const programIds = new Set(incoming.programs.map((p) => p.id));
          const orderIds = new Set(incoming.orders.map((o) => o.id));
          commit({
            ...cur,
            programs: [...incoming.programs, ...cur.programs.filter((p) => !programIds.has(p.id))],
            orders: [...incoming.orders, ...cur.orders.filter((o) => !orderIds.has(o.id))],
            stock: newerStock(cur.stock, incoming.stock),
          });
        }
        return { programs: incoming.programs.length, orders: incoming.orders.length };
      },
      resetToSeed() {
        commit(seedDB());
      },
    };
  }, [db, saveOk, commit]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore phải được dùng bên trong <StoreProvider>.");
  return store;
}
