// Independent verification of every aggregation a manager sees or exports:
//   order-list totals (OrdersPage / OrdersTable), the program «Tổng hợp» report (ProgramReport), Excel exports
//   (order list, report, single order), the copy-to-Zalo text and the print view.
// The reference here is built from first principles: Σ calculateOrder(...) per order, grouped by keys written in this
// file — never by calling the app's aggregators. Demo-data numbers were computed by a separate Python script.
import { beforeEach, describe, expect, it, vi } from "vitest";

// ───────────────────────── Mocks (hoisted) ─────────────────────────
const h = vi.hoisted(() => ({
  workbooks: [] as Array<{ wb: any; name: string }>,
  store: null as any,
  route: { path: "/orders", parts: ["orders"], query: new URLSearchParams("") },
  includeDrafts: undefined as boolean | undefined,
}));

// Capture the workbook instead of writing a file to disk.
vi.mock("xlsx", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    writeFile: (wb: any, name: string) => {
      h.workbooks.push({ wb, name });
    },
  };
});
vi.mock("../store", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useStore: () => h.store };
});
vi.mock("../router", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useRoute: () => h.route, navigate: () => {} };
});
// Lets a static render show ProgramReport with «Tính cả đơn nháp» unticked (its only `useState(true)`).
vi.mock("react", async (importOriginal) => {
  const actual: any = await importOriginal();
  const useState = (init: unknown) => {
    const pair = actual.useState(init);
    return init === true && h.includeDrafts !== undefined ? [h.includeDrafts, pair[1]] : pair;
  };
  return { ...actual, default: { ...(actual.default ?? actual), useState }, useState };
});

import * as XLSX from "xlsx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateOrder } from "../engine";
import { seedDB } from "../store";
import { formatNumber, formatVND } from "../format";
import type { CalcResult, DB, Order, OrderGift, OrderLine, Program, Rule } from "../../types";
import {
  salesKey,
  salesNames,
  sumOrders,
  summarizeOrders,
  type OrderCalc,
  type OrdersSummary,
} from "../../components/orders/totals";
import { exportOrderList, exportProgramReport } from "../../components/orders/excel";
import type { OrderRow } from "../../components/orders/OrdersTable";
import OrdersTable from "../../components/orders/OrdersTable";
import ProgramReport from "../../components/ProgramReport";
import OrdersPage from "../../pages/OrdersPage";
import { buildOrderSheet, buildOrderText, type OrderDocument } from "../../components/order/orderExport";
import { OrderPrint } from "../../components/order/OrderPrint";
import { buildCatalog, linesInCatalogOrder } from "../../components/order/orderOps";
import { exportTableXlsx } from "../exportXlsx";

// ───────────────────────── Independent reference aggregator ─────────────────────────

/** Person-name key written from scratch: no diacritics, đ→d, lower case, single spaces. */
function myNameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}
const myClean = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");
/** Dealer key as the app documents it: case + whitespace only. */
const myDealerKey = (s: string) => myClean(s).toLocaleLowerCase("vi");
const mySku = (s: string) => s.replace(/\s/g, "").toUpperCase();
const myGiftKey = (sku: string, name: string) => (sku ? mySku(sku) : `text:${name}`);

interface Acc {
  count: number;
  qty: number;
  amount: number;
  giftQty: number;
  giftValue: number;
}
interface Ref extends Acc {
  errors: number;
  items: Map<string, { qty: number; value: number }>;
  gifts: Map<string, { qty: number; value: number }>;
  sales: Map<string, Acc>;
  dealers: Map<string, Acc>;
}

function bump(map: Map<string, { qty: number; value: number }>, key: string, qty: number, value: number) {
  const row = map.get(key) ?? { qty: 0, value: 0 };
  row.qty += qty;
  row.value += value;
  map.set(key, row);
}
function addAcc(map: Map<string, Acc>, key: string, c: CalcResult) {
  const a = map.get(key) ?? { count: 0, qty: 0, amount: 0, giftQty: 0, giftValue: 0 };
  a.count += 1;
  a.qty += c.totalQty;
  a.amount += c.totalAmount;
  a.giftQty += c.giftQty;
  a.giftValue += c.giftValue;
  map.set(key, a);
}

function reference(entries: OrderCalc[]): Ref {
  const r: Ref = {
    count: 0,
    qty: 0,
    amount: 0,
    giftQty: 0,
    giftValue: 0,
    errors: 0,
    items: new Map(),
    gifts: new Map(),
    sales: new Map(),
    dealers: new Map(),
  };
  for (const { order, calc } of entries) {
    r.count += 1;
    // Recompute from the line/gift level rather than trusting calc.total*.
    let q = 0;
    let a = 0;
    for (const l of calc.lines) {
      q += l.qty;
      a += l.amount;
      if (l.qty > 0) bump(r.items, mySku(l.sku), l.qty, l.amount);
    }
    let gq = 0;
    let gv = 0;
    for (const g of calc.gifts) {
      gq += g.qty;
      gv += g.value;
      if (g.qty > 0) bump(r.gifts, myGiftKey(g.sku, g.name), g.qty, g.value);
    }
    expect(q).toBe(calc.totalQty);
    expect(a).toBe(calc.totalAmount);
    expect(gq).toBe(calc.giftQty);
    expect(gv).toBe(calc.giftValue);
    r.qty += q;
    r.amount += a;
    r.giftQty += gq;
    r.giftValue += gv;
    if (calc.issues.some((i) => i.level === "error")) r.errors += 1;
    addAcc(r.sales, myNameKey(order.salesperson), calc);
    addAcc(r.dealers, myDealerKey(order.customerName), calc);
  }
  return r;
}

/** Expected display name per sales key: most-used cleaned spelling, then the newest order, then vi collation. */
function myDisplayNames(orders: Order[]): Map<string, string> {
  const by = new Map<string, Map<string, { n: number; latest: string }>>();
  for (const o of orders) {
    const name = myClean(o.salesperson);
    const k = myNameKey(o.salesperson);
    const m = by.get(k) ?? new Map();
    const s = m.get(name) ?? { n: 0, latest: "" };
    s.n += 1;
    if (o.createdAt > s.latest) s.latest = o.createdAt;
    m.set(name, s);
    by.set(k, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of by) {
    const best = [...m.entries()].sort(
      ([an, a], [bn, b]) => b.n - a.n || (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0) || an.localeCompare(bn, "vi"),
    )[0];
    out.set(k, best[0]);
  }
  return out;
}

function expectSummaryMatches(s: OrdersSummary, r: Ref, allOrders: Order[]) {
  expect({
    orderCount: s.orderCount,
    errorCount: s.errorCount,
    totalQty: s.totalQty,
    totalAmount: s.totalAmount,
    giftQty: s.giftQty,
    giftValue: s.giftValue,
  }).toEqual({
    orderCount: r.count,
    errorCount: r.errors,
    totalQty: r.qty,
    totalAmount: r.amount,
    giftQty: r.giftQty,
    giftValue: r.giftValue,
  });
  for (const n of [s.totalQty, s.totalAmount, s.giftQty, s.giftValue]) expect(Number.isSafeInteger(n)).toBe(true);

  // Items
  const items = new Map(s.items.map((row) => [mySku(row.sku), { qty: row.qty, value: row.value }]));
  expect(items.size).toBe(s.items.length); // no key appears twice
  expect(items).toEqual(r.items);
  expect(s.items.reduce((t, x) => t + x.qty, 0)).toBe(s.totalQty);
  expect(s.items.reduce((t, x) => t + x.value, 0)).toBe(s.totalAmount);
  // Gifts
  const gifts = new Map(s.gifts.map((row) => [myGiftKey(row.sku, row.name), { qty: row.qty, value: row.value }]));
  expect(gifts.size).toBe(s.gifts.length);
  expect(gifts).toEqual(r.gifts);
  expect(s.gifts.reduce((t, x) => t + x.qty, 0)).toBe(s.giftQty);
  expect(s.gifts.reduce((t, x) => t + x.value, 0)).toBe(s.giftValue);
  // Sorting: most qty first, then value
  for (const list of [s.items, s.gifts]) {
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      expect(a.qty > b.qty || (a.qty === b.qty && a.value >= b.value)).toBe(true);
    }
  }
  // Sales
  const names = myDisplayNames(allOrders);
  const sales = new Map(
    s.sales.map((row) => [myNameKey(row.name), { count: row.orderCount, qty: row.totalQty, amount: row.totalAmount, giftValue: row.giftValue }]),
  );
  expect(sales.size).toBe(s.sales.length);
  const refSales = new Map([...r.sales].map(([k, a]) => [k, { count: a.count, qty: a.qty, amount: a.amount, giftValue: a.giftValue }]));
  expect(sales).toEqual(refSales);
  for (const row of s.sales) expect(row.name).toBe(names.get(myNameKey(row.name)));
  expect(s.sales.reduce((t, x) => t + x.orderCount, 0)).toBe(s.orderCount);
  expect(s.sales.reduce((t, x) => t + x.totalQty, 0)).toBe(s.totalQty);
  expect(s.sales.reduce((t, x) => t + x.totalAmount, 0)).toBe(s.totalAmount);
  expect(s.sales.reduce((t, x) => t + x.giftValue, 0)).toBe(s.giftValue);
  for (let i = 1; i < s.sales.length; i++) expect(s.sales[i - 1].totalAmount).toBeGreaterThanOrEqual(s.sales[i].totalAmount);
  // Dealers
  const dealers = new Map(
    s.dealers.map((row) => [myDealerKey(row.name), { count: row.orderCount, amount: row.totalAmount, giftValue: row.giftValue }]),
  );
  expect(dealers.size).toBe(s.dealers.length);
  expect(dealers).toEqual(new Map([...r.dealers].map(([k, a]) => [k, { count: a.count, amount: a.amount, giftValue: a.giftValue }])));
  expect(s.dealers.reduce((t, x) => t + x.orderCount, 0)).toBe(s.orderCount);
  expect(s.dealers.reduce((t, x) => t + x.totalAmount, 0)).toBe(s.totalAmount);
  expect(s.dealers.reduce((t, x) => t + x.giftValue, 0)).toBe(s.giftValue);
}

// ───────────────────────── Helpers: HTML, Excel ─────────────────────────

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}
function tableRows(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])),
  );
}
function sections(html: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const m of html.matchAll(/<section>([\s\S]*?)<\/section>/g)) {
    const title = text(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(m[1])?.[1] ?? "");
    out.set(title, tableRows(m[1]));
  }
  return out;
}
function figures(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/g)) out.set(text(m[1]), text(m[2]));
  return out;
}
/** "1.234.567 đ" / "−1.000 đ" / "" → number. */
function num(s: string): number {
  const digits = s.replace(/\D/g, "");
  if (!digits) return 0;
  return /^[−-]/.test(s.trim()) ? -Number(digits) : Number(digits);
}

async function capture(run: () => Promise<void>): Promise<Map<string, unknown[][]>> {
  h.workbooks.length = 0;
  await run();
  expect(h.workbooks).toHaveLength(1);
  // Round-trip through real .xlsx bytes, exactly what the user downloads.
  const bytes = XLSX.write(h.workbooks[0].wb, { type: "buffer", bookType: "xlsx" });
  const book = XLSX.read(bytes, { type: "buffer" });
  const out = new Map<string, unknown[][]>();
  for (const name of book.SheetNames) {
    out.set(name, XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null, raw: true }) as unknown[][]);
  }
  return out;
}

function makeDoc(order: Order, program: Program | null): OrderDocument {
  const calc = calculateOrder(program, order);
  return { order, program, calc, lines: linesInCatalogOrder(calc.lines, buildCatalog(program)) };
}

/** Copy text, Excel sheet and print view of one order all carry calculateOrder's numbers. */
function checkOrderDocument(doc: OrderDocument) {
  const { calc } = doc;
  // ── copy text ──
  const t = buildOrderText(doc).split("\n");
  const lineRe = /^\d+\. .* × ([\d.]+) = ([\d.]+) đ/;
  const tLines = t.filter((l) => lineRe.test(l)).map((l) => lineRe.exec(l)!);
  expect(tLines).toHaveLength(doc.lines.length);
  expect(tLines.reduce((s, m) => s + num(m[1]), 0)).toBe(calc.totalQty);
  expect(tLines.reduce((s, m) => s + num(m[2]), 0)).toBe(calc.totalAmount);
  const field = (label: string) => t.find((l) => l.startsWith(`${label}: `))?.slice(label.length + 2);
  expect(num(field("Tổng số lượng")!)).toBe(calc.totalQty);
  expect(num(field("Thanh toán")!)).toBe(calc.totalAmount);
  if (calc.discountAmount > 0) {
    expect(num(field("Tổng giá sỉ")!) + num(field("Giảm giá")!)).toBe(calc.totalAmount);
  } else {
    expect(field("Giảm giá")).toBeUndefined();
  }
  const giftLines = t.filter((l) => l.startsWith("- ")).map((l) => num(/× ([\d.]+)$/.exec(l)![1]));
  expect(giftLines.reduce((s, n) => s + n, 0)).toBe(calc.giftQty);

  // ── Excel sheet ──
  const rows = buildOrderSheet(doc).rows;
  const head = rows.findIndex((r) => r[0] === "STT");
  const end = rows.findIndex((r) => r[2] === "Tổng số lượng");
  const body = rows.slice(head + 1, end);
  expect(body).toHaveLength(doc.lines.length);
  for (const r of body) expect((r[6] as number) * (r[3] as number)).toBe(r[7]);
  expect(body.reduce((s, r) => s + (r[3] as number), 0)).toBe(calc.totalQty);
  expect(body.reduce((s, r) => s + (r[7] as number), 0)).toBe(calc.totalAmount);
  expect(rows[end][3]).toBe(calc.totalQty);
  const total = (label: string) => rows.find((r) => r[2] === label)?.[7] as number | undefined;
  expect(total("Tổng giá lẻ")).toBe(body.reduce((s, r) => s + (r[4] as number) * (r[3] as number), 0));
  expect(total("Tổng giá sỉ")).toBe(body.reduce((s, r) => s + (r[5] as number) * (r[3] as number), 0));
  expect(total("Thanh toán")).toBe(calc.totalAmount);
  expect(total("Tổng giá sỉ")! + (total("Giảm giá") ?? 0)).toBe(calc.totalAmount);
  if (calc.gifts.length > 0) {
    const gh = rows.findIndex((r, i) => i > end && r[0] === "STT");
    const ge = rows.findIndex((r) => r[2] === "Tổng quà tặng");
    const gb = rows.slice(gh + 1, ge);
    expect(gb.reduce((s, r) => s + (r[3] as number), 0)).toBe(calc.giftQty);
    expect(gb.reduce((s, r) => s + (r[5] as number), 0)).toBe(calc.giftValue);
    for (const r of gb) expect((r[4] as number) * (r[3] as number)).toBe(r[5]);
    expect(rows[ge][3]).toBe(calc.giftQty);
    expect(rows[ge][5]).toBe(calc.giftValue);
  }
  for (const r of rows) for (const c of r) if (typeof c === "number") expect(Number.isSafeInteger(c)).toBe(true);

  // ── print ──
  const html = renderToStaticMarkup(createElement(OrderPrint, doc));
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => tableRows(m[0]));
  const [lt, gt] = tables;
  const lb = lt.slice(1, -1);
  expect(lb).toHaveLength(doc.lines.length);
  for (const r of lb) expect(num(r[4]) * num(r[3])).toBe(num(r[5]));
  expect(lb.reduce((s, r) => s + num(r[5]), 0)).toBe(calc.totalAmount);
  expect(lt.at(-1)![0]).toBe("Tổng cộng");
  expect(num(lt.at(-1)![1])).toBe(calc.totalQty);
  expect(num(lt.at(-1)![3])).toBe(calc.totalAmount);
  if (calc.gifts.length > 0) {
    const gbody = gt.slice(1, -1);
    expect(gbody.reduce((s, r) => s + num(r[2]), 0)).toBe(calc.giftQty);
    expect(gbody.reduce((s, r) => s + num(r[3]), 0)).toBe(calc.giftValue);
    expect(gt.at(-1)![0]).toBe("Tổng quà tặng"); // colSpan=2 → [label, SL, Giá trị]
    expect(num(gt.at(-1)![1])).toBe(calc.giftQty);
    expect(num(gt.at(-1)![2])).toBe(calc.giftValue);
  } else {
    expect(gt).toBeUndefined();
  }
  expect(text(html)).toContain(`Thanh toán${formatVND(calc.totalAmount)}`);
}

function storeOf(db: DB, extra: Partial<Record<string, unknown>> = {}) {
  return {
    orders: db.orders,
    programs: db.programs,
    getProgram: (id: string) => db.programs.find((p) => p.id === id),
    mode: "local",
    settings: db.settings,
    stock: db.stock,
    duplicateOrder: async () => null,
    deleteOrder: () => {},
    ...extra,
  };
}

/** Render ProgramReport and check every figure / table against the reference. */
function checkProgramReportRender(db: DB, programId: string, includeDrafts: boolean) {
  h.store = storeOf(db);
  h.includeDrafts = includeDrafts;
  try {
    const program = db.programs.find((p) => p.id === programId)!;
    const all = db.orders.filter((o) => o.programId === programId);
    const sel = includeDrafts ? all : all.filter((o) => o.status === "confirmed");
    const r = reference(sel.map((order) => ({ order, calc: calculateOrder(program, order) })));
    const html = renderToStaticMarkup(createElement(ProgramReport, { programId }));
    const confirmed = all.filter((o) => o.status === "confirmed").length;
    expect(text(html)).toContain(
      includeDrafts
        ? `Đang tính tất cả ${all.length} đơn của chương trình (${confirmed} đã chốt, ${all.length - confirmed} nháp).`
        : `Đang chỉ tính ${confirmed} đơn đã chốt, bỏ qua ${all.length - confirmed} đơn nháp.`,
    );
    if (r.errors > 0) expect(text(html)).toContain(`Có ${r.errors} đơn đang có lỗi`);
    else expect(text(html)).not.toContain("đơn đang có lỗi");
    if (r.count === 0) {
      expect(text(html)).toContain("Chưa có đơn nào đã chốt");
      return;
    }
    const f = figures(html);
    expect(num(f.get("Số đơn")!)).toBe(r.count);
    expect(num(f.get("Số lượng bán")!)).toBe(r.qty);
    expect(num(f.get("Doanh thu")!)).toBe(r.amount);
    expect(num(f.get("Số lượng quà")!)).toBe(r.giftQty);
    expect(num(f.get("Giá trị quà")!)).toBe(r.giftValue);

    const sec = sections(html);
    const skuTable = (title: string, ref: Map<string, { qty: number; value: number }>, tq: number, tv: number) => {
      const rows = sec.get(title)!;
      if (ref.size === 0) {
        expect(rows).toEqual([]);
        return;
      }
      const body = rows.slice(1, -1);
      const foot = rows.at(-1)!;
      const got = new Map(body.map((row) => [row[0] === "—" ? `text:${row[1]}` : mySku(row[0]), { qty: num(row[2]), value: num(row[3]) }]));
      expect(got).toEqual(ref);
      expect(foot[0]).toBe(`Tổng: ${formatNumber(ref.size)} mã`);
      expect(num(foot[1])).toBe(tq);
      expect(num(foot[2])).toBe(tv);
      expect(body.reduce((s, x) => s + num(x[2]), 0)).toBe(num(foot[1]));
      expect(body.reduce((s, x) => s + num(x[3]), 0)).toBe(num(foot[2]));
    };
    skuTable("Hàng bán theo mã", r.items, r.qty, r.amount);
    skuTable("Quà tặng theo mã", r.gifts, r.giftQty, r.giftValue);

    const names = myDisplayNames(db.orders);
    const salesRows = sec.get("Theo sale")!;
    const sBody = salesRows.slice(1, -1);
    const sGot = new Map(
      sBody.map((row) => [row[0] === "Chưa ghi sale" ? "" : myNameKey(row[0]), [num(row[1]), num(row[2]), num(row[3]), num(row[4])]]),
    );
    expect(sGot).toEqual(new Map([...r.sales].map(([k, a]) => [k, [a.count, a.qty, a.amount, a.giftValue]])));
    for (const row of sBody) if (row[0] !== "Chưa ghi sale") expect(row[0]).toBe(names.get(myNameKey(row[0])));
    const sFoot = salesRows.at(-1)!;
    expect(sFoot[0]).toBe(`Tổng: ${formatNumber([...r.sales.keys()].filter(Boolean).length)} sale`);
    expect(sFoot.slice(1).map(num)).toEqual([r.count, r.qty, r.amount, r.giftValue]);

    const dRows = sec.get("Theo đại lý")!;
    const dBody = dRows.slice(1, -1);
    const dGot = new Map(dBody.map((row) => [row[0] === "(chưa ghi tên)" ? "" : myDealerKey(row[0]), [num(row[1]), num(row[2]), num(row[3])]]));
    expect(dGot).toEqual(new Map([...r.dealers].map(([k, a]) => [k, [a.count, a.amount, a.giftValue]])));
    expect(dRows.at(-1)!.slice(1).map(num)).toEqual([r.count, r.amount, r.giftValue]);
  } finally {
    h.includeDrafts = undefined;
  }
}

/** Export the program report to xlsx exactly as ProgramReport's button does, read it back, check against reference. */
async function checkReportExcel(db: DB, programId: string, includeDrafts: boolean) {
  const program = db.programs.find((p) => p.id === programId)!;
  const all = db.orders.filter((o) => o.programId === programId).map((order) => ({ order, calc: calculateOrder(program, order) }));
  const sel = includeDrafts ? all : all.filter((e) => e.order.status === "confirmed");
  const summary = summarizeOrders(sel, salesNames(db.orders));
  const confirmedCount = all.filter((e) => e.order.status === "confirmed").length;
  const r = reference(sel);
  const book = await capture(() =>
    exportProgramReport({ programName: program.name, includeDrafts, confirmedCount, draftCount: all.length - confirmedCount, summary }),
  );
  expect([...book.keys()]).toEqual(["Tổng hợp", "Hàng bán theo mã", "Quà tặng theo mã", "Theo sale", "Theo đại lý"]);
  const head = new Map(book.get("Tổng hợp")!.map((row) => [row[0] as string, row[1]]));
  expect(head.get("Số đơn được tính")).toBe(r.count);
  expect(head.get("Số đơn đã chốt")).toBe(confirmedCount);
  expect(head.get(includeDrafts ? "Số đơn nháp" : "Số đơn nháp (không tính)")).toBe(all.length - confirmedCount);
  expect(head.get("Số lượng bán")).toBe(r.qty);
  expect(head.get("Doanh thu")).toBe(r.amount);
  expect(head.get("Số lượng quà")).toBe(r.giftQty);
  expect(head.get("Giá trị quà")).toBe(r.giftValue);

  const sku = (name: string, ref: Map<string, { qty: number; value: number }>, tq: number, tv: number) => {
    const rows = book.get(name)!;
    const body = rows.slice(1, -1);
    const got = new Map(body.map((row) => [row[0] ? mySku(String(row[0])) : `text:${row[1]}`, { qty: row[2], value: row[3] }]));
    expect(got).toEqual(ref);
    for (const row of body) {
      expect(typeof row[2]).toBe("number");
      expect(typeof row[3]).toBe("number");
    }
    expect(rows.at(-1)).toEqual(["Tổng", "", tq, tv]);
  };
  sku("Hàng bán theo mã", r.items, r.qty, r.amount);
  sku("Quà tặng theo mã", r.gifts, r.giftQty, r.giftValue);

  const sales = book.get("Theo sale")!;
  const sGot = new Map(sales.slice(1, -1).map((row) => [row[0] === "Chưa ghi sale" ? "" : myNameKey(String(row[0])), row.slice(1)]));
  expect(sGot).toEqual(new Map([...r.sales].map(([k, a]) => [k, [a.count, a.qty, a.amount, a.giftValue]])));
  expect(sales.at(-1)).toEqual(["Tổng", r.count, r.qty, r.amount, r.giftValue]);
  const dealers = book.get("Theo đại lý")!;
  const dGot = new Map(dealers.slice(1, -1).map((row) => [row[0] === "(chưa ghi tên)" ? "" : myDealerKey(String(row[0])), row.slice(1)]));
  expect(dGot).toEqual(new Map([...r.dealers].map(([k, a]) => [k, [a.count, a.amount, a.giftValue]])));
  expect(dealers.at(-1)).toEqual(["Tổng", r.count, r.amount, r.giftValue]);
}

/** Export the order list (as OrdersPage does), read it back. */
async function checkOrderListExcel(rows: OrderRow[]) {
  const totals = sumOrders(rows);
  const r = reference(rows);
  const book = await capture(() => exportOrderList(rows, totals));
  const sheet = book.get("Đơn hàng")!;
  expect(sheet[0]).toEqual([
    "Mã đơn", "Ngày tạo", "Đại lý", "Số điện thoại", "Sale", "Số điện thoại sale", "Chương trình",
    "SL", "Thanh toán", "SL quà", "Giá trị quà", "Trạng thái", "Ghi chú",
  ]);
  const body = sheet.slice(1, -1);
  expect(body).toHaveLength(rows.length);
  body.forEach((row, i) => {
    const { calc, order } = rows[i];
    expect(row[0]).toBe(order.code);
    expect(row.slice(7, 11)).toEqual([calc.totalQty, calc.totalAmount, calc.giftQty, calc.giftValue]);
    expect(String(row[11]).endsWith(" (có lỗi)")).toBe(calc.hasError);
  });
  const sum = (c: number) => body.reduce((s, row) => s + (row[c] as number), 0);
  const foot = sheet.at(-1)!;
  expect(foot[0]).toBe(`Tổng ${r.count} đơn`);
  expect(foot.slice(7, 11)).toEqual([r.qty, r.amount, r.giftQty, r.giftValue]);
  expect([sum(7), sum(8), sum(9), sum(10)]).toEqual([r.qty, r.amount, r.giftQty, r.giftValue]);
}

// ───────────────────────── (a) The 17 demo orders ─────────────────────────

const demo = seedDB();
const progById = new Map(demo.programs.map((p) => [p.id, p]));
const KM11 = "seed-km-2026-11";
const BG = "seed-bang-gia-sau-ck";
const HE = "seed-km-2026-he";

// Computed by an independent Python re-implementation of the demo rules (see report).
const DEMO_ORDERS: Record<string, [qty: number, amount: number, giftQty: number, giftValue: number]> = {
  "demo-o08": [7, 8563420, 0, 0],
  "demo-o13": [6, 10266911, 1, 920000],
  "demo-o07": [8, 8316001, 0, 0],
  "demo-o06": [14, 15807272, 1, 1200000],
  "demo-o12": [6, 6127163, 3, 3220000],
  "demo-o05": [15, 19381092, 1, 1200000],
  "demo-o11": [8, 13123166, 2, 1900000],
  "demo-o04": [11, 11656148, 1, 1200000],
  "demo-o03": [12, 11236910, 1, 1200000],
  "demo-o10": [7, 9188547, 2, 2900000],
  "demo-o02": [7, 9113236, 0, 0],
  "demo-o01": [9, 12742039, 1, 1200000],
  "demo-o09": [9, 12183454, 2, 1840000],
  "demo-o17": [10, 8680256, 4, 600000], // 4 DM01 → 4 N65 strings × 150.000
  "demo-o16": [10, 9361637, 2, 300000], // 2 strings × 150.000
  "demo-o15": [7, 8844219, 2, 300000], // 2 strings × 150.000
  "demo-o14": [7, 7132909, 3, 450000], // 3 strings × 150.000
};

const demoEntries = (pid?: string, confirmedOnly = false): OrderCalc[] =>
  demo.orders
    .filter((o) => (!pid || o.programId === pid) && (!confirmedOnly || o.status === "confirmed"))
    .map((order) => ({ order, calc: calculateOrder(progById.get(order.programId), order) }));

const pick = (s: OrdersSummary) => [s.orderCount, s.totalQty, s.totalAmount, s.giftQty, s.giftValue, s.errorCount];
const salesRows = (s: OrdersSummary) => s.sales.map((x) => [x.name, x.orderCount, x.totalQty, x.totalAmount, x.giftValue]);
const skuRows = (rows: OrdersSummary["items"]) => rows.map((x) => [x.sku, x.qty, x.value]);

describe("demo data (17 orders, 4 salespeople) — exact numbers", () => {
  beforeEach(() => {
    h.route = { path: "/orders", parts: ["orders"], query: new URLSearchParams("") };
  });

  it("each order's calculateOrder matches the independent computation", () => {
    expect(demo.orders).toHaveLength(17);
    for (const { order, calc } of demoEntries()) {
      expect([calc.totalQty, calc.totalAmount, calc.giftQty, calc.giftValue], order.id).toEqual(DEMO_ORDERS[order.id]);
      expect(calc.hasError, order.id).toBe(false);
    }
  });

  it("order-list totals: all 17 orders", () => {
    const t = sumOrders(demoEntries());
    expect(t).toEqual({ orderCount: 17, errorCount: 0, totalQty: 153, totalAmount: 181724380, giftQty: 26, giftValue: 18430000 }); // 16.780.000 + 11 strings × 150.000
    expectSummaryMatches(summarizeOrders(demoEntries()), reference(demoEntries()), demo.orders);
  });

  it("report «KM tháng 11/2026»: all vs confirmed-only", () => {
    const all = summarizeOrders(demoEntries(KM11), salesNames(demo.orders));
    const conf = summarizeOrders(demoEntries(KM11, true), salesNames(demo.orders));
    expect(pick(all)).toEqual([8, 83, 96816118, 5, 6000000, 0]);
    expect(pick(conf)).toEqual([6, 62, 72445426, 4, 4800000, 0]);
    expect(salesRows(all)).toEqual([
      ["Lê Hoàng Cường", 3, 27, 33511423, 2400000],
      ["Trần Thị Bình", 2, 22, 27944512, 1200000],
      ["Nguyễn Văn An", 2, 22, 24123273, 1200000],
      ["Phạm Thu Dung", 1, 12, 11236910, 1200000],
    ]);
    expect(salesRows(conf)).toEqual([
      ["Lê Hoàng Cường", 3, 27, 33511423, 2400000],
      ["Trần Thị Bình", 1, 15, 19381092, 1200000],
      ["Phạm Thu Dung", 1, 12, 11236910, 1200000],
      ["Nguyễn Văn An", 1, 8, 8316001, 0],
    ]);
    expect(all.items).toHaveLength(21);
    expect(conf.items).toHaveLength(17);
    expect(skuRows(all.items).slice(0, 4)).toEqual([
      ["P-AYPT413-3", 8, 12645816],
      ["P-AYPU039-5", 7, 4810911],
      ["P-AYPT417-5", 6, 9896730],
      ["P-AYPU051-5", 6, 8659638],
    ]);
    expect(skuRows(all.gifts)).toEqual([
      ["P-AYPT455-4", 2, 2400000],
      ["P-AYPT457-4", 2, 2400000],
      ["P-AYPT399-4", 1, 1200000],
    ]);
    expect(skuRows(conf.gifts)).toEqual([
      ["P-AYPT457-4", 2, 2400000],
      ["P-AYPT399-4", 1, 1200000],
      ["P-AYPT455-4", 1, 1200000],
    ]);
  });

  it("report «Bảng giá sỉ sau chiết khấu»: Ashaway buy-1-get-1 gifts valued at wholesale", () => {
    const all = summarizeOrders(demoEntries(BG), salesNames(demo.orders));
    const conf = summarizeOrders(demoEntries(BG, true), salesNames(demo.orders));
    expect(pick(all)).toEqual([5, 36, 50889241, 10, 10780000, 0]);
    expect(pick(conf)).toEqual([4, 30, 44762078, 7, 7560000, 0]);
    expect(all.items).toHaveLength(18);
    expect(skuRows(all.gifts)).toEqual([
      ["AV7000SQ", 3, 2760000],
      ["AV5000", 2, 2900000],
      ["AV1F", 2, 2300000],
      ["AVQ11", 2, 1900000],
      ["AV9000SQ", 1, 920000],
    ]);
    expect(salesRows(conf)).toEqual([
      ["Lê Hoàng Cường", 2, 15, 22450365, 2760000],
      ["Nguyễn Văn An", 1, 8, 13123166, 1900000],
      ["Trần Thị Bình", 1, 7, 9188547, 2900000],
    ]);
  });

  it("report «Khuyến mại Hè 2026»: text gift (Cước N65) aggregated by name at 150.000 đ each", () => {
    const all = summarizeOrders(demoEntries(HE), salesNames(demo.orders));
    expect(pick(all)).toEqual([4, 34, 34019021, 11, 1650000, 0]); // 11 strings × 150.000
    expect(all.gifts).toEqual([{ sku: "", name: "Cước cầu lông LiNing N65", qty: 11, value: 1650000 }]);
    expect(all.items).toHaveLength(19);
    expect(salesRows(all)).toEqual([
      ["Trần Thị Bình", 2, 17, 17524475, 900000],
      ["Nguyễn Văn An", 1, 10, 9361637, 300000],
      ["Lê Hoàng Cường", 1, 7, 7132909, 450000],
    ]);
  });

  it("per-salesperson across all programs", () => {
    expect(salesRows(summarizeOrders(demoEntries()))).toEqual([
      ["Lê Hoàng Cường", 6, 49, 63094697, 5610000], // + 3 strings
      ["Trần Thị Bình", 5, 46, 54657534, 5000000], // + 6 strings
      ["Nguyễn Văn An", 4, 40, 46608076, 3400000], // + 2 strings
      ["Phạm Thu Dung", 2, 18, 17364073, 4420000],
    ]);
  });

  it("all program reports match the reference, both toggle states", () => {
    for (const pid of [KM11, BG, HE])
      for (const conf of [false, true])
        expectSummaryMatches(summarizeOrders(demoEntries(pid, conf), salesNames(demo.orders)), reference(demoEntries(pid, conf)), demo.orders);
  });

  it("rendered ProgramReport shows the same numbers (all + confirmed only)", () => {
    for (const pid of [KM11, BG, HE]) for (const inc of [true, false]) checkProgramReportRender(demo, pid, inc);
    // Spot-check literal formatting once.
    h.store = storeOf(demo);
    const html = renderToStaticMarkup(createElement(ProgramReport, { programId: KM11 }));
    expect(text(html)).toContain("Doanh thu96.816.118 đ");
  });

  it("rendered OrdersPage footer = Σ of all orders (not only the visible page); program filter in URL", () => {
    h.store = storeOf(demo);
    let html = renderToStaticMarkup(createElement(OrdersPage));
    let rows = tableRows(/<table[\s\S]*?<\/table>/.exec(html)![0]);
    let foot = rows.at(-1)!;
    expect(foot[0]).toBe("Tổng: 17 đơn");
    expect(foot.slice(1, 3).map(num)).toEqual([153, 181724380]);
    expect(foot[3]).toBe(`${formatVND(18430000)}SL: 26`);

    h.route = { path: "/orders", parts: ["orders"], query: new URLSearchParams(`program=${KM11}`) };
    html = renderToStaticMarkup(createElement(OrdersPage));
    rows = tableRows(/<table[\s\S]*?<\/table>/.exec(html)![0]);
    foot = rows.at(-1)!;
    expect(foot[0]).toBe("Tổng: 8 đơn (đang lọc trong 17 đơn)");
    expect(foot.slice(1, 3).map(num)).toEqual([83, 96816118]);
    // Body rows sum to the footer here (single page).
    const body = rows.slice(1, -1);
    expect(body).toHaveLength(8);
    expect(body.reduce((s, r) => s + num(r[5]), 0)).toBe(96816118);
  });

  it("Excel: order list and each program report read back from real .xlsx bytes", async () => {
    const rows: OrderRow[] = demoEntries().map((e) => ({ ...e, program: progById.get(e.order.programId) }));
    await checkOrderListExcel(rows);
    for (const pid of [KM11, BG, HE]) for (const inc of [true, false]) await checkReportExcel(demo, pid, inc);
  });

  it("copy text, single-order Excel and print view carry calculateOrder's numbers for every demo order", () => {
    for (const order of demo.orders) checkOrderDocument(makeDoc(order, progById.get(order.programId) ?? null));
  });

  it("single-order Excel via exportTableXlsx round-trips with numbers intact", async () => {
    const order = demo.orders.find((o) => o.id === "demo-o17")!;
    const doc = makeDoc(order, progById.get(order.programId)!);
    const book = await capture(() => exportTableXlsx("x", [buildOrderSheet(doc)]));
    const rows = [...book.values()][0];
    const pay = rows.find((r) => r[2] === "Thanh toán")!;
    expect(pay[7]).toBe(8680256);
    const disc = rows.find((r) => r[2] === "Giảm giá")!;
    expect(disc[7]).toBe(-doc.calc.discountAmount);
    expect(doc.calc.discountAmount).toBeGreaterThan(0);
  });
});

// ───────────────────────── (b) Seeded randomized datasets ─────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SALES_VARIANTS = [
  ["Nguyễn Văn An", "nguyễn văn an", "Nguyen Van An", "  Nguyễn   Văn An ", "NGUYỄN VĂN AN", "Nguyễn Văn An".normalize("NFD"), "Nguyễn Văn An"],
  ["Trần Thị Bình", "tran thi binh", "Trần Thị  Bình", "TRẦN THỊ BÌNH"],
  ["Đỗ Minh Đức", "do minh duc", "ĐỖ MINH ĐỨC", "Đỗ Minh Đức\t"],
  ["Phạm Thu Dung"],
  ["", "   ", "\t"],
];
const DEALERS = ["Shop Vợt Hà Nội", "shop vợt hà nội", "  Shop Vợt  Hà Nội", "SHOP VỢT HÀ NỘI", "Đại lý Bình An", "", "  ", "Cầu lông Sài Gòn Pro"];

function generate(seed: number, nOrders: number): DB {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const chance = (p: number) => rnd() < p;
  const skuPool = Array.from({ length: 40 }, (_, i) => `SK-${String(i + 1).padStart(3, "0")}`);

  const programs: Program[] = [];
  for (let p = 0; p < 6; p++) {
    const groups = Array.from({ length: int(2, 4) }, (_, g) => {
      const skus = new Set<string>();
      const n = int(3, 8);
      while (skus.size < n) skus.add(pick(skuPool));
      return {
        id: `p${p}-g${g}`,
        name: `Nhóm ${g}`,
        items: [...skus].map((sku) => {
          const retail = int(100, 5000) * 1000 + (chance(0.2) ? int(1, 999) : 0);
          return {
            sku,
            name: chance(0.2) ? `${sku} (nhóm ${g})` : `Hàng ${sku}`,
            retailPrice: retail,
            wholesalePrice: chance(0.05) ? 0 : Math.round(retail * pick([0.7, 0.65, 0.8])),
          };
        }),
      };
    });
    const gid = groups.map((g) => g.id);
    const last = gid[gid.length - 1];
    const rules: Rule[] = [];
    const nr = int(1, 4);
    for (let i = 0; i < nr; i++) {
      const kind = pick(["discount", "tier_gift", "same", "group", "text"] as const);
      const id = `p${p}-r${i}`;
      if (kind === "discount") {
        rules.push({
          id, type: "discount", name: `Giảm ${i}`, targetGroupIds: [gid[0]],
          discountPercent: pick([10, 12.5, 33.333, 45, 55, 100, 2.35]),
          discountBasis: pick(["retail", "wholesale"] as const),
          minQty: pick([null, 1, 2]), maxQty: pick([null, 4, 10]),
          requireGroupIds: chance(0.4) ? [gid[1]] : [], requireMinQty: pick([0, 1]),
        });
      } else if (kind === "tier_gift") {
        rules.push({
          id, type: "tier_gift", name: `Bậc ${i}`, sourceGroupIds: chance(0.5) ? [gid[0]] : [gid[0], gid[1]],
          giftGroupId: chance(0.95) ? last : null, giftPriceBasis: pick(["retail", "wholesale"] as const),
          tiers: [1_000_000, 5_000_000, 20_000_000].slice(0, int(1, 3)).map((min, t) => {
            const pct = chance(0.5);
            return {
              id: `${id}-t${t}`, min, limitType: pct ? "percent" : "amount",
              limitValue: pct ? pick([2.3, 15, 7.77, 10]) : pick([500_000, 1_200_000, 3_190_000]),
              maxQty: pick([null, 1, 3]),
              allowedSkus: chance(0.3) ? groups[groups.length - 1].items.slice(0, 2).map((x) => x.sku) : null,
            };
          }),
        });
      } else {
        rules.push({
          id, type: "buy_x_get_y", name: `Mua tặng ${i}`, sourceGroupIds: [pick(gid)],
          buyQty: pick([1, 2, 3]), getQty: pick([1, 2]), giftMode: kind,
          giftGroupId: kind === "group" ? last : null, giftText: kind === "text" ? pick(["Cước N65", "Áo thun", " "]) : "",
        });
      }
    }
    programs.push({
      id: `p${p}`, name: `Chương trình ${p}`, brand: "X", startDate: null, endDate: null, note: "",
      groups, rules, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }

  const orders: Order[] = [];
  for (let i = 0; i < nOrders; i++) {
    const deleted = chance(0.06);
    const program = pick(programs);
    const lines: OrderLine[] = [];
    const used = new Set<string>();
    const nl = chance(0.05) ? 0 : int(1, 7);
    for (let k = 0; k < nl; k++) {
      const g = pick(program.groups);
      const item = pick(g.items);
      if (used.has(`${g.id}|${item.sku}`)) continue;
      used.add(`${g.id}|${item.sku}`);
      lines.push({
        groupId: chance(0.03) ? "gone-group" : g.id,
        sku: chance(0.05) ? item.sku.toLowerCase() : item.sku,
        name: item.name,
        retailPrice: chance(0.05) ? item.retailPrice + 0.6 : item.retailPrice,
        wholesalePrice: chance(0.05) ? item.wholesalePrice + 0.4 : chance(0.05) ? item.wholesalePrice + 1000 : item.wholesalePrice,
        qty: chance(0.06) ? pick([0, -2, 2.7]) : int(1, 9),
      });
    }
    const gifts: OrderGift[] = [];
    for (const rule of program.rules) {
      const accepts = rule.type === "tier_gift" || (rule.type === "buy_x_get_y" && rule.giftMode === "group");
      if (!accepts || !chance(0.5)) continue;
      const giftGroup = chance(0.9) ? program.groups[program.groups.length - 1] : program.groups[0];
      const n = int(1, 2);
      const seen = new Set<string>();
      for (let k = 0; k < n; k++) {
        const item = pick(giftGroup.items);
        if (seen.has(item.sku)) continue;
        seen.add(item.sku);
        gifts.push({ ruleId: rule.id, groupId: giftGroup.id, ...item, qty: chance(0.05) ? 0 : int(1, 3) });
      }
    }
    if (chance(0.04)) {
      const item = pick(program.groups[0].items);
      gifts.push({ ruleId: "r-gone", groupId: program.groups[0].id, ...item, qty: 1 });
    }
    const status = chance(0.6) ? "confirmed" : "draft";
    let frozenRules: Rule[] | undefined;
    if ((status === "confirmed" && chance(0.7)) || chance(0.03)) {
      frozenRules = JSON.parse(JSON.stringify(program.rules)) as Rule[];
      if (chance(0.3))
        for (const r of frozenRules) {
          if (r.type === "discount") r.discountPercent = pick([5, 20, 50]);
          if (r.type === "tier_gift") r.tiers.forEach((t) => (t.limitValue = t.limitType === "percent" ? 25 : 9_000_000));
        }
    }
    const day = int(1, 330);
    const created = new Date(Date.UTC(2026, 0, 1) + day * 86400000 + int(0, 86399) * 1000).toISOString();
    orders.push({
      id: `o${i}`, code: `DH${String(i).padStart(5, "0")}`, programId: deleted ? "p-deleted" : program.id,
      customerName: pick(DEALERS), customerPhone: "", salesperson: pick(pick(SALES_VARIANTS)), salespersonPhone: "",
      note: "", status, lines, gifts, ...(frozenRules ? { frozenRules } : {}), createdAt: created, updatedAt: created,
    });
  }
  return { version: 1, programs, orders, settings: demo.settings, stock: { bySku: {}, updatedAt: null } };
}

describe("randomized datasets", () => {
  for (const seed of [1, 7, 2026]) {
    const db = generate(seed, 3000);
    const byId = new Map(db.programs.map((p) => [p.id, p]));
    const rows: OrderRow[] = [...db.orders]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((order) => {
        const program = byId.get(order.programId);
        return { order, program, calc: calculateOrder(program, order) };
      });

    it(`seed ${seed}: dataset exercises errors, drafts, frozen rules, deleted programs, empty orders`, () => {
      expect(rows.some((r) => r.calc.hasError)).toBe(true);
      expect(rows.some((r) => !r.program)).toBe(true);
      expect(rows.some((r) => r.order.lines.length === 0)).toBe(true);
      expect(rows.some((r) => r.order.frozenRules)).toBe(true);
      expect(rows.some((r) => r.calc.gifts.some((g) => g.auto && !g.sku))).toBe(true);
      expect(rows.some((r) => r.calc.discountAmount > 0)).toBe(true);
    });

    it(`seed ${seed}: order-list totals = reference; filters partition the total; integer VND`, () => {
      const total = sumOrders(rows);
      const r = reference(rows);
      expect(total).toEqual({
        orderCount: r.count, errorCount: r.errors, totalQty: r.qty, totalAmount: r.amount, giftQty: r.giftQty, giftValue: r.giftValue,
      });
      for (const v of Object.values(total)) expect(Number.isSafeInteger(v)).toBe(true);
      const add = (a: ReturnType<typeof sumOrders>, b: ReturnType<typeof sumOrders>) =>
        Object.fromEntries(Object.keys(a).map((k) => [k, (a as any)[k] + (b as any)[k]]));
      // Partition by program, status, sale key (as the OrdersPage filters do)
      const partitions: Array<(o: Order) => string> = [(o) => o.programId, (o) => o.status, (o) => salesKey(o.salesperson)];
      for (const keyOf of partitions) {
        const groups = new Map<string, OrderRow[]>();
        for (const row of rows) groups.set(keyOf(row.order), [...(groups.get(keyOf(row.order)) ?? []), row]);
        let acc = sumOrders([]);
        for (const g of groups.values()) acc = add(acc, sumOrders(g)) as typeof acc;
        expect(acc).toEqual(total);
      }
      // Sale filter: the app's key groups exactly the spellings of one person.
      expect(new Set(rows.map((x) => salesKey(x.order.salesperson))).size).toBe(SALES_VARIANTS.length);
      // Combined filter (program × status × sale) totals = reference on that subset.
      const sub = rows.filter((x) => x.order.programId === "p0" && x.order.status === "confirmed" && myNameKey(x.order.salesperson) === "nguyen van an");
      const rs = reference(sub);
      expect(pick(summarizeOrders(sub))).toEqual([rs.count, rs.qty, rs.amount, rs.giftQty, rs.giftValue, rs.errors]);
    });

    it(`seed ${seed}: summarizeOrders = reference for every program, all and confirmed-only`, () => {
      const names = salesNames(db.orders);
      for (const p of db.programs) {
        const entries = rows.filter((x) => x.order.programId === p.id);
        for (const conf of [false, true]) {
          const sel = conf ? entries.filter((x) => x.order.status === "confirmed") : entries;
          expectSummaryMatches(summarizeOrders(sel, names), reference(sel), db.orders);
        }
        // confirmed + drafts = all
        const a = sumOrders(entries);
        const c = sumOrders(entries.filter((x) => x.order.status === "confirmed"));
        const d = sumOrders(entries.filter((x) => x.order.status === "draft"));
        expect(a.totalAmount).toBe(c.totalAmount + d.totalAmount);
        expect(a.giftValue).toBe(c.giftValue + d.giftValue);
        expect(a.orderCount).toBe(c.orderCount + d.orderCount);
      }
      // Whole dataset (incl. deleted-program orders), names from the same orders.
      expectSummaryMatches(summarizeOrders(rows), reference(rows), db.orders);
    });

    it(`seed ${seed}: order list Excel read back = on-screen totals`, async () => {
      await checkOrderListExcel(rows);
      // A filtered export (status = draft) too.
      await checkOrderListExcel(rows.filter((x) => x.order.status === "draft"));
    });

    it(`seed ${seed}: report Excel + rendered report = reference`, async () => {
      for (const p of db.programs.slice(0, 3)) {
        for (const inc of [true, false]) {
          await checkReportExcel(db, p.id, inc);
          checkProgramReportRender(db, p.id, inc);
        }
      }
    });

    it(`seed ${seed}: OrdersTable footer (paged) shows totals of every filtered order`, () => {
      const visible = rows.filter((x) => x.order.programId === "p1");
      const totals = sumOrders(visible);
      const html = renderToStaticMarkup(
        createElement(OrdersTable, { rows: visible.slice(0, 25), totals, allCount: rows.length, onDuplicate: () => {}, onDelete: () => {} }),
      );
      const foot = tableRows(html).at(-1)!;
      const r = reference(visible);
      expect(foot[0]).toBe(`Tổng: ${formatNumber(r.count)} đơn (đang lọc trong ${formatNumber(rows.length)} đơn)`);
      expect(num(foot[1])).toBe(r.qty);
      expect(num(foot[2])).toBe(r.amount);
      expect(foot[3]).toBe(r.giftQty === 0 ? "—" : `${formatVND(r.giftValue)}SL: ${formatNumber(r.giftQty)}`);
    });

    it(`seed ${seed}: copy text / order Excel / print agree with calculateOrder (400 orders)`, () => {
      for (const row of rows.slice(0, 400)) checkOrderDocument(makeDoc(row.order, row.program ?? null));
    });
  }
});

// ───────────────────────── (c) Targeted edge cases ─────────────────────────

const he = progById.get(HE)!;
const km11 = progById.get(KM11)!;
function mk(fields: Partial<Order>): Order {
  return {
    id: Math.random().toString(36).slice(2), code: "DH", programId: KM11, customerName: "", customerPhone: "", salesperson: "",
    salespersonPhone: "", note: "", status: "confirmed", lines: [], gifts: [],
    createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", ...fields,
  };
}
const kmLine = (sku: string, qty: number, groupId = "g-km11-apply"): OrderLine => {
  const item = km11.groups.find((g) => g.id === groupId)!.items.find((i) => i.sku === sku)!;
  return { groupId, sku, name: item.name, retailPrice: item.retailPrice, wholesalePrice: item.wholesalePrice, qty };
};
const calcOf = (o: Order, p: Program | undefined = progById.get(o.programId)): OrderCalc => ({ order: o, calc: calculateOrder(p, o) });

describe("edge cases", () => {
  it("salesperson variants (case, diacritics, NFD, NBSP, extra spaces) → one row; blank → «Chưa ghi sale»", () => {
    const base = kmLine("P-AYPR285-3", 1);
    const variants = SALES_VARIANTS[0];
    const entries = [
      ...variants.map((s, i) => calcOf(mk({ salesperson: s, lines: [base], createdAt: `2026-11-1${i}T00:00:00.000Z` }))),
      calcOf(mk({ salesperson: "   ", lines: [base] })),
      calcOf(mk({ salesperson: "", lines: [base] })),
    ];
    const s = summarizeOrders(entries);
    expect(s.sales.map((x) => [x.name, x.orderCount])).toEqual([
      ["Nguyễn Văn An", variants.length],
      ["", 2],
    ]);
    expect(s.sales[0].totalAmount).toBe(1415782 * variants.length);
  });

  it("same SKU in several lines/groups and with lower-case spelling merges into one item row", () => {
    // Bảng giá: P-AYPT417-5 exists in g-bg-thuong; put it in two groups of one order + a lower-case spelling in another.
    const bg = progById.get(BG)!;
    const it417 = bg.groups.flatMap((g) => g.items).find((i) => i.sku === "P-AYPT417-5")!;
    const l = (groupId: string, sku: string, qty: number): OrderLine => ({ groupId, sku, name: it417.name, retailPrice: it417.retailPrice, wholesalePrice: it417.wholesalePrice, qty });
    const entries = [
      calcOf(mk({ programId: BG, lines: [l("g-bg-thuong", "P-AYPT417-5", 2), l("g-bg-kem", "P-AYPT417-5", 3)] })),
      calcOf(mk({ programId: BG, lines: [l("g-bg-thuong", "p-aypt417-5 ", 4)] })),
    ];
    const s = summarizeOrders(entries);
    expect(s.items).toEqual([{ sku: "P-AYPT417-5", name: it417.name, qty: 9, value: 9 * it417.wholesalePrice }]);
  });

  it("auto (same-mode) gifts and chosen gifts of one SKU merge; text gifts are valued at the rule's giftTextValue", () => {
    const o = mk({
      programId: HE,
      lines: [
        { groupId: "g-he-dm01", sku: "P-AYPT357-4", name: "x", retailPrice: 1227273, wholesalePrice: 859091, qty: 3 },
        { groupId: "g-he-dm03", sku: "P-AYPT317-2", name: "y", retailPrice: 471273, wholesalePrice: 329891, qty: 1 },
      ],
    });
    const s = summarizeOrders([calcOf(o), calcOf({ ...o, id: "b" })]);
    expect(s.gifts).toEqual([{ sku: "", name: "Cước cầu lông LiNing N65", qty: 6, value: 900_000 }]); // 2 × 3 strings × 150.000
    expect(s.giftValue).toBe(900_000);
    void he;
  });

  it("orders with errors are still summed and counted", () => {
    // Gift above budget: revenue < 10M with a chosen gift.
    const o = mk({
      lines: [kmLine("P-AYPR285-3", 1)],
      gifts: [{ ruleId: "r-km11-tier", groupId: "g-km11-gift", sku: "P-AYPT455-4", name: "g", retailPrice: 1200000, wholesalePrice: 840000, qty: 1 }],
    });
    const t = sumOrders([calcOf(o), calcOf(mk({ lines: [kmLine("P-AYPR285-3", 1)] }))]);
    expect(t).toEqual({ orderCount: 2, errorCount: 1, totalQty: 2, totalAmount: 2 * 1415782, giftQty: 1, giftValue: 1200000 });
  });

  it("empty order list and empty orders give zeros everywhere", () => {
    const s = summarizeOrders([calcOf(mk({}))]);
    expect(pick(s)).toEqual([1, 0, 0, 0, 0, 0]);
    expect(s.items).toEqual([]);
    expect(s.gifts).toEqual([]);
    expect(s.sales).toEqual([{ name: "", orderCount: 1, totalQty: 0, totalAmount: 0, giftValue: 0 }]);
    expect(sumOrders([])).toEqual({ orderCount: 0, errorCount: 0, totalQty: 0, totalAmount: 0, giftQty: 0, giftValue: 0 });
  });

  it("fractional prices / quantities in stored orders never produce non-integer sums", () => {
    const o = mk({ lines: [{ ...kmLine("P-AYPR285-3", 1), wholesalePrice: 1415782.4, retailPrice: 0.5, qty: 2.9 }] });
    const s = summarizeOrders([calcOf(o)]);
    expect(s.totalAmount).toBe(2 * 1415782);
    expect(s.totalQty).toBe(2);
  });

  it("report display name of a sale = the spelling used most across ALL orders (same as the list filter)", () => {
    const orders = [
      mk({ salesperson: "nguyen van an", programId: HE }),
      mk({ salesperson: "nguyen van an", programId: HE }),
      mk({ salesperson: "Nguyễn Văn An", programId: KM11, lines: [kmLine("P-AYPR285-3", 1)] }),
    ];
    const names = salesNames(orders);
    const s = summarizeOrders(orders.filter((o) => o.programId === KM11).map((o) => calcOf(o)), names);
    expect(s.sales[0].name).toBe("nguyen van an");
  });

  // ── Suspected issues / ambiguities (kept as it.fails so the file stays green) ──

  // UNCLEAR INTENT / probable bug (low): dealers are grouped by case + whitespace only, but the SAME visible name typed
  // in NFD (e.g. pasted from macOS / some Excel exports) is a different JS string → two «Theo đại lý» rows that look
  // identical. Sales names are NFD-normalised by salesKey, dealers are not.
  it("[fixed] dealer grouping: NFC and NFD spellings of the same dealer are one row", () => {
    const line = [kmLine("P-AYPR285-3", 1)];
    const s = summarizeOrders([
      calcOf(mk({ customerName: "Đại lý Bình An", lines: line })),
      calcOf(mk({ customerName: "Đại lý Bình An".normalize("NFD"), lines: line })),
    ]);
    expect(s.dealers).toHaveLength(1); // actual: 2 rows, both rendered «Đại lý Bình An», 1 order each
  });

  // UNCLEAR INTENT: sales merge «Shop Vợt Hà Nội» with «Shop Vot Ha Noi» (diacritic-insensitive) but dealers do not.
  it.fails("dealer grouping: diacritic-less spelling merges like salesperson names do", () => {
    const line = [kmLine("P-AYPR285-3", 1)];
    const s = summarizeOrders([
      calcOf(mk({ customerName: "Shop Vợt Hà Nội", lines: line })),
      calcOf(mk({ customerName: "Shop Vot Ha Noi", lines: line })),
    ]);
    expect(s.dealers).toHaveLength(1); // actual: 2
  });

  // UNCLEAR INTENT (cosmetic): dealer display name = first-seen spelling, so it depends on order of the store's list,
  // whereas sales use the most-used spelling.
  it.fails("dealer display name does not depend on the order of the orders", () => {
    const line = [kmLine("P-AYPR285-3", 1)];
    const a = calcOf(mk({ customerName: "shop vợt hà nội", lines: line }));
    const b = calcOf(mk({ customerName: "Shop Vợt Hà Nội", lines: line }));
    const c = calcOf(mk({ customerName: "Shop Vợt Hà Nội", lines: line }));
    expect(summarizeOrders([a, b, c]).dealers[0].name).toBe(summarizeOrders([b, c, a]).dealers[0].name);
  });

  // UNCLEAR INTENT (low): text gifts are merged by exact name, so the same gift text frozen in an old order with a
  // different case/spacing (rule text later edited) shows as two «Quà tặng theo mã» rows.
  it.fails("text gifts differing only by case/spacing merge into one row", () => {
    const rule = he.rules.find((r) => r.id === "r-he-b1")! as Extract<Rule, { type: "buy_x_get_y" }>;
    const lines: OrderLine[] = [{ groupId: "g-he-dm01", sku: "P-AYPT357-4", name: "x", retailPrice: 1227273, wholesalePrice: 859091, qty: 1 }];
    const s = summarizeOrders([
      calcOf(mk({ programId: HE, lines })),
      calcOf(mk({ programId: HE, lines, frozenRules: he.rules.map((r) => (r.id === rule.id ? { ...rule, giftText: "cước cầu lông  LiNing N65" } : r)) })),
    ]);
    expect(s.gifts).toHaveLength(1); // actual: 2
  });

  // UNCLEAR INTENT (cosmetic): the gift table footer says «Tổng: N mã» but counts text gifts, which have no mã.
  it.fails("report gift footer counts only rows that have a SKU", () => {
    h.store = storeOf(demo);
    const html = renderToStaticMarkup(createElement(ProgramReport, { programId: HE }));
    const foot = sections(html).get("Quà tặng theo mã")!.at(-1)!;
    expect(foot[0]).toBe("Tổng: 0 mã"); // actual: «Tổng: 1 mã» for the single text gift «Cước cầu lông LiNing N65»
  });
});
