// Kiểm tra việc mời lưu thông tin sale của đơn làm thông tin sale của máy.
import { describe, expect, it } from "vitest";
import { saleProfileToOffer } from "./orderOps";

const NO_PROFILE = { salesperson: "" };

describe("saleProfileToOffer", () => {
  it("máy chưa lưu tên sale và đơn nháp đã có tên sale: mời lưu tên + số điện thoại đã bỏ khoảng trắng thừa", () => {
    expect(
      saleProfileToOffer(NO_PROFILE, { status: "draft", salesperson: "  Nguyễn Văn Tùng ", salespersonPhone: " 0912 345 678 " }),
    ).toEqual({ salesperson: "Nguyễn Văn Tùng", salespersonPhone: "0912 345 678" });
  });

  it("chưa gõ số điện thoại thì vẫn mời, số điện thoại để trống", () => {
    expect(saleProfileToOffer(NO_PROFILE, { status: "draft", salesperson: "Tùng", salespersonPhone: "" })).toEqual({
      salesperson: "Tùng",
      salespersonPhone: "",
    });
  });

  it("tên sale đã lưu chỉ toàn khoảng trắng cũng coi là chưa lưu", () => {
    expect(saleProfileToOffer({ salesperson: "   " }, { status: "draft", salesperson: "Tùng", salespersonPhone: "" })).not.toBeNull();
  });

  it("máy đã lưu tên sale thì không mời nữa, kể cả khi đơn ghi tên khác", () => {
    expect(saleProfileToOffer({ salesperson: "Lan" }, { status: "draft", salesperson: "Tùng", salespersonPhone: "0912" })).toBeNull();
  });

  it("đơn chưa có tên sale thì không mời, dù đã có số điện thoại", () => {
    expect(saleProfileToOffer(NO_PROFILE, { status: "draft", salesperson: "", salespersonPhone: "0912 345 678" })).toBeNull();
    expect(saleProfileToOffer(NO_PROFILE, { status: "draft", salesperson: "   ", salespersonPhone: "" })).toBeNull();
  });

  it("đơn đã chốt chỉ để xem nên không mời", () => {
    expect(saleProfileToOffer(NO_PROFILE, { status: "confirmed", salesperson: "Tùng", salespersonPhone: "0912" })).toBeNull();
  });
});
