// Tests for the client-side checks of the account forms.
import { describe, expect, it } from "vitest";
import { emailProblem, fullNameProblem, newPasswordProblem, phoneProblem } from "./validation";

describe("emailProblem", () => {
  it("accepts ordinary addresses, ignoring spaces around them", () => {
    for (const email of ["lan@example.com", "  lan@example.com  ", "tran.thi-lan+sale@cong-ty.com.vn", "A@B.VN"]) {
      expect(emailProblem(email)).toBeNull();
    }
  });

  it("asks for an email when the box is empty", () => {
    expect(emailProblem("")).toBe("Hãy nhập email.");
    expect(emailProblem("   ")).toBe("Hãy nhập email.");
  });

  it("rejects malformed addresses (the auth server would accept some of them, e.g. «a@b»)", () => {
    for (const email of ["lan", "lan@", "@example.com", "lan@example", "a@b", "lan lan@example.com", "lan@exa mple.com", "lan@@example.com"]) {
      expect(emailProblem(email)).toBe("Email không hợp lệ (ví dụ: ten@gmail.com).");
    }
    expect(emailProblem(`${"a".repeat(250)}@example.com`)).toBe("Email không hợp lệ (ví dụ: ten@gmail.com).");
  });
});

describe("fullNameProblem", () => {
  it("requires something other than spaces", () => {
    expect(fullNameProblem("Trần Thị Lan")).toBeNull();
    expect(fullNameProblem(" L ")).toBeNull();
    expect(fullNameProblem("")).toBe("Hãy nhập họ tên.");
    expect(fullNameProblem("   ")).toBe("Hãy nhập họ tên.");
  });
});

describe("phoneProblem", () => {
  it("accepts the usual ways of writing a phone number", () => {
    for (const phone of ["0903555777", "0903 555 777", "0903.555.777", "090-355-5777", "+84 903 555 777", "(028) 3822 1234", " 0903555777 "]) {
      expect(phoneProblem(phone)).toBeNull();
    }
  });

  it("asks for a number when the box is empty", () => {
    expect(phoneProblem("")).toBe("Hãy nhập số điện thoại.");
    expect(phoneProblem("  ")).toBe("Hãy nhập số điện thoại.");
  });

  it("rejects letters, too few and too many digits", () => {
    for (const phone of ["0903 abc 777", "zalo 0903555777", "1234567", "0903", "+", "1234567890123456"]) {
      expect(phoneProblem(phone)).toBe("Số điện thoại không hợp lệ (ví dụ: 0903 555 777).");
    }
  });

  it("the limits are 8 and 15 digits inclusive", () => {
    expect(phoneProblem("12345678")).toBeNull();
    expect(phoneProblem("123456789012345")).toBeNull();
  });
});

describe("newPasswordProblem", () => {
  it("accepts 6 to 72 characters", () => {
    expect(newPasswordProblem("123456")).toBeNull();
    expect(newPasswordProblem("mật khẩu có dấu cách ở giữa")).toBeNull();
    expect(newPasswordProblem("x".repeat(72))).toBeNull();
  });

  it("empty, too short, too long", () => {
    expect(newPasswordProblem("")).toBe("Hãy nhập mật khẩu.");
    expect(newPasswordProblem("12345")).toBe("Mật khẩu phải có ít nhất 6 ký tự.");
    expect(newPasswordProblem("x".repeat(73))).toBe("Mật khẩu dài tối đa 72 ký tự.");
  });

  it("refuses invisible spaces at either end", () => {
    expect(newPasswordProblem("matkhau1 ")).toBe("Mật khẩu không được bắt đầu hoặc kết thúc bằng dấu cách.");
    expect(newPasswordProblem(" matkhau1")).toBe("Mật khẩu không được bắt đầu hoặc kết thúc bằng dấu cách.");
    // Too short still wins: that is the first thing to fix.
    expect(newPasswordProblem("abc  ")).toBe("Mật khẩu phải có ít nhất 6 ký tự.");
  });
});
