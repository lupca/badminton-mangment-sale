// Kiểm tra thông tin sale trên bản chép và file Excel của đơn, bằng dữ liệu mẫu thật và engine thật.
import { describe, expect, it } from "vitest";
import { calculateOrder } from "../../lib/engine";
import seed from "../../seed/seed.json";
import type { DB, Order, Program } from "../../types";
import { buildOrderSheet, buildOrderText, contactLine, saleContact, type OrderDocument } from "./orderExport";
import { buildCatalog, linesInCatalogOrder } from "./orderOps";

const db = seed as unknown as DB;
const km11 = db.programs.find((p) => p.id === "seed-km-2026-11") as Program;
const speed = km11.groups[0].items.find((item) => item.sku === "P-AYPR285-3")!;

function doc(fields: Partial<Order>): OrderDocument {
  const order: Order = {
    id: "o",
    code: "DH261121-001",
    programId: km11.id,
    customerName: "Đại lý Minh Anh",
    customerPhone: "0903 111 222",
    salesperson: "",
    salespersonPhone: "",
    note: "",
    status: "draft",
    lines: [
      { groupId: "g-km11-apply", sku: speed.sku, name: speed.name, retailPrice: speed.retailPrice, wholesalePrice: speed.wholesalePrice, qty: 15 },
    ],
    gifts: [],
    createdAt: "2026-11-21T02:00:00.000Z",
    updatedAt: "2026-11-21T02:00:00.000Z",
    ...fields,
  };
  const calc = calculateOrder(km11, order);
  return { order, program: km11, calc, lines: linesInCatalogOrder(calc.lines, buildCatalog(km11)) };
}

/** Dòng bắt đầu bằng `label` trong bản chép; undefined nếu không có. */
const textLine = (document: OrderDocument, label: string) =>
  buildOrderText(document)
    .split("\n")
    .find((row) => row.startsWith(label));

/** Dòng có nhãn `label` ở cột đầu của sheet Excel. */
const sheetRow = (document: OrderDocument, label: string) => buildOrderSheet(document).rows.find((row) => row[0] === label);

describe("contactLine / saleContact", () => {
  it("ghi tên rồi tới số điện thoại, bỏ phần để trống", () => {
    expect(contactLine("Tùng", "0912 345 678")).toBe("Tùng — 0912 345 678");
    expect(contactLine("Tùng", "")).toBe("Tùng");
    expect(contactLine("", "0912 345 678")).toBe("0912 345 678");
    expect(contactLine("", "")).toBe("");
  });

  it("bỏ khoảng trắng thừa ở hai đầu", () => {
    expect(contactLine("  Tùng ", " 0912 345 678  ")).toBe("Tùng — 0912 345 678");
    expect(contactLine("   ", " 0912 345 678")).toBe("0912 345 678");
    expect(saleContact({ salesperson: " Nguyễn Văn Tùng ", salespersonPhone: "  " })).toBe("Nguyễn Văn Tùng");
  });
});

describe("buildOrderText — dòng Sale", () => {
  it("có tên và số điện thoại của sale", () => {
    const document = doc({ salesperson: "Nguyễn Văn Tùng", salespersonPhone: "0912 345 678" });
    expect(textLine(document, "Sale:")).toBe("Sale: Nguyễn Văn Tùng — 0912 345 678");
    // Dòng sale nằm ngay sau dòng đại lý, trước dòng chương trình.
    expect(buildOrderText(document).split("\n").slice(0, 5)).toEqual([
      "ĐƠN HÀNG DH261121-001",
      "Ngày: 21/11/2026",
      "Đại lý: Đại lý Minh Anh — 0903 111 222",
      "Sale: Nguyễn Văn Tùng — 0912 345 678",
      `Chương trình: ${km11.name}`,
    ]);
  });

  it("chỉ có tên, hoặc chỉ có số điện thoại", () => {
    expect(textLine(doc({ salesperson: " Tùng " }), "Sale:")).toBe("Sale: Tùng");
    expect(textLine(doc({ salespersonPhone: "0912 345 678" }), "Sale:")).toBe("Sale: 0912 345 678");
  });

  it("không có thông tin sale thì không có dòng Sale", () => {
    expect(textLine(doc({}), "Sale:")).toBeUndefined();
    expect(textLine(doc({ salesperson: "  ", salespersonPhone: " " }), "Sale:")).toBeUndefined();
  });

  it("điện thoại của đại lý vẫn nằm ở dòng đại lý, không lẫn với sale", () => {
    const document = doc({ customerPhone: "", salesperson: "Tùng", salespersonPhone: "0912 345 678" });
    expect(textLine(document, "Đại lý:")).toBe("Đại lý: Đại lý Minh Anh");
    expect(textLine(document, "Sale:")).toBe("Sale: Tùng — 0912 345 678");
  });
});

describe("buildOrderSheet — dòng Sale", () => {
  it("ghi tên và số điện thoại của sale vào cùng một ô", () => {
    const document = doc({ salesperson: "Nguyễn Văn Tùng", salespersonPhone: "0912 345 678" });
    expect(sheetRow(document, "Sale")).toEqual(["Sale", "Nguyễn Văn Tùng — 0912 345 678"]);
    expect(sheetRow(document, "Đại lý")).toEqual(["Đại lý", "Đại lý Minh Anh"]);
    expect(sheetRow(document, "Số điện thoại")).toEqual(["Số điện thoại", "0903 111 222"]);
  });

  it("bỏ phần để trống; không có thông tin sale thì ô để trống", () => {
    expect(sheetRow(doc({ salesperson: "Tùng" }), "Sale")).toEqual(["Sale", "Tùng"]);
    expect(sheetRow(doc({ salespersonPhone: "0912 345 678" }), "Sale")).toEqual(["Sale", "0912 345 678"]);
    expect(sheetRow(doc({}), "Sale")).toEqual(["Sale", ""]);
  });

  it("không làm xê dịch các dòng khác của sheet", () => {
    const rows = buildOrderSheet(doc({ salesperson: "Tùng", salespersonPhone: "0912 345 678" })).rows;
    expect(rows.slice(5, 9).map((row) => row[0])).toEqual(["Đại lý", "Số điện thoại", "Sale", "Ghi chú"]);
    expect(rows[10][0]).toBe("STT");
    expect(rows[11].slice(0, 4)).toEqual([1, "P-AYPR285-3", speed.name, 15]);
  });
});
