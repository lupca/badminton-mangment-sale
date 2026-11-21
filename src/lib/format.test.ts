// Tests for the formatting / parsing helpers.
// Dates are built from local-time components, so the expectations hold in any time zone.
import { afterEach, describe, expect, it, vi } from "vitest";
import seed from "../seed/seed.json";
import type { DB } from "../types";
import {
  PROGRAM_STATUS_LABEL,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPeriod,
  formatQty,
  formatVND,
  matchesSearch,
  newId,
  normalizeSku,
  parseDecimal,
  parseInteger,
  programStatus,
  searchKey,
  todayISO,
  parseDateVN,
} from "./format";

const db = seed as unknown as DB;
const NBSP = " ";

afterEach(() => {
  vi.useRealTimers();
});

// ───────────────────────── Numbers ─────────────────────────

describe("formatQty", () => {
  it("groups thousands with a dot and keeps up to 3 decimals with a comma", () => {
    expect(formatQty(0)).toBe("0");
    expect(formatQty(24)).toBe("24");
    expect(formatQty(1250)).toBe("1.250");
    expect(formatQty(2.5)).toBe("2,5");
    expect(formatQty(1234.5678)).toBe("1.234,568");
  });

  it("shows negative stock with a minus sign and treats non-numbers as 0", () => {
    expect(formatQty(-3)).toBe("-3");
    expect(formatQty(Number.NaN)).toBe("0");
    expect(formatQty(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatNumber / formatVND", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1.000"],
    [1_415_782, "1.415.782"],
    [72_400_000, "72.400.000"],
    [2_128_414_455_000, "2.128.414.455.000"],
    [-410_000, "-410.000"],
  ])("formatNumber(%d) = %s", (n, text) => {
    expect(formatNumber(n)).toBe(text);
  });

  it("rounds to a whole number and treats NaN / Infinity as 0", () => {
    expect(formatNumber(1234.5)).toBe("1.235");
    expect(formatNumber(1234.4)).toBe("1.234");
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatNumber(undefined as unknown as number)).toBe("0");
  });

  it("formatVND appends “ đ” after an ordinary space", () => {
    expect(formatVND(1_415_782)).toBe("1.415.782 đ");
    expect(formatVND(0)).toBe("0 đ");
    expect(formatVND(-410_000)).toBe("-410.000 đ");
  });
});

describe("parseInteger — whole numbers typed by the user", () => {
  it.each([
    ["1.200.000", 1_200_000],
    ["1,200,000 đ", 1_200_000],
    ["1200000", 1_200_000],
    ["1 200 000", 1_200_000],
    [`1${NBSP}200${NBSP}000`, 1_200_000],
    ["1.200.000 VND", 1_200_000],
    ["  72.400.000  ", 72_400_000],
    ["000123", 123],
    ["0", 0],
    ["", 0],
    ["   ", 0],
    ["abc", 0],
    ["đ", 0],
    ["-5", -5],
    ["  -1.000", -1000],
    ["-", 0],
  ])("parseInteger(%j) = %d", (text, expected) => {
    expect(parseInteger(text)).toBe(expected);
  });

  it("is the inverse of formatNumber", () => {
    for (const n of [0, 7, 999, 1000, 1_415_782, 21_236_730, 72_400_000, 2_128_414_455_000]) {
      expect(parseInteger(formatNumber(n))).toBe(n);
      expect(parseInteger(formatVND(n))).toBe(n);
    }
  });

  it("keeps the money field usable while typing: a digit added to a formatted value is simply appended", () => {
    // The field shows "1.250"; the user types one more 0 → "1.2500" must read 12.500.
    expect(parseInteger("1.2500")).toBe(12_500);
    expect(parseInteger("12.50")).toBe(1250);
  });

  it("only keeps digits — so it must NOT be fed pasted values that carry decimals", () => {
    // Documented limitation: there is no way to tell "1.5" (decimal) from "1.500" (thousands) while typing.
    // A price cell copied from Excel as "1415781.5" would come out ten times too large.
    expect(parseInteger("1415781.5")).toBe(14_157_815);
    expect(parseInteger("2022545,00")).toBe(202_254_500);
  });
});

describe("parseDecimal — the percent fields", () => {
  it.each([
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["45", 45],
    [" 45 ", 45],
    ["0,5", 0.5],
    [",5", 0.5],
    ["12,", 12],
    ["1 2,5", 12.5],
    ["100", 100],
    ["-3", -3],
    ["", 0],
    ["   ", 0],
    ["abc", 0],
    ["12,5,5", 0],
    ["1.234,5", 0],
    ["Infinity", 0],
    ["NaN", 0],
  ])("parseDecimal(%j) = %s", (text, expected) => {
    expect(parseDecimal(text)).toBe(expected);
  });
});

// ───────────────────────── Dates ─────────────────────────

describe("todayISO", () => {
  it("is the local calendar date, also just after midnight and just before it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 0, 1, 0));
    expect(todayISO()).toBe("2026-01-05");
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59, 0));
    expect(todayISO()).toBe("2026-01-05");
    vi.setSystemTime(new Date(2026, 10, 20, 12, 0, 0));
    expect(todayISO()).toBe("2026-11-20");
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
    expect(todayISO()).toBe("2026-12-31");
  });
});

describe("formatDate / formatDateTime", () => {
  it("turns YYYY-MM-DD into DD/MM/YYYY without any time-zone shift", () => {
    expect(formatDate("2026-11-05")).toBe("05/11/2026");
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
  });

  it("shows a full ISO timestamp as the local date", () => {
    expect(formatDate(new Date(2026, 10, 20, 21, 5).toISOString())).toBe("20/11/2026");
    expect(formatDate(new Date(2026, 10, 20, 0, 1).toISOString())).toBe("20/11/2026");
    expect(formatDate(new Date(2026, 10, 20, 23, 59).toISOString())).toBe("20/11/2026");
    expect(formatDate(new Date(2026, 0, 3, 8, 0).toISOString())).toBe("03/01/2026");
  });

  it("gives an empty string for nothing or for something that is not a date", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("không phải ngày")).toBe("");
  });

  it("formatDateTime adds the local hour and minute, zero-padded", () => {
    expect(formatDateTime(new Date(2026, 10, 20, 21, 5).toISOString())).toBe("20/11/2026 21:05");
    expect(formatDateTime(new Date(2026, 0, 3, 8, 9).toISOString())).toBe("03/01/2026 08:09");
    expect(formatDateTime(new Date(2026, 5, 10, 0, 0).toISOString())).toBe("10/06/2026 00:00");
  });

  it("formatDateTime gives an empty string for nothing or for something that is not a date", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime(undefined)).toBe("");
    expect(formatDateTime("")).toBe("");
    expect(formatDateTime("abc")).toBe("");
  });
});

describe("formatPeriod", () => {
  it("covers the four combinations of start and end", () => {
    expect(formatPeriod("2026-11-05", "2026-11-30")).toBe("05/11/2026 – 30/11/2026");
    expect(formatPeriod("2026-11-05", null)).toBe("Từ 05/11/2026");
    expect(formatPeriod(null, "2026-11-30")).toBe("Đến 30/11/2026");
    expect(formatPeriod(null, null)).toBe("Không thời hạn");
  });

  it("the seed programs", () => {
    const period = (id: string) => {
      const p = db.programs.find((x) => x.id === id)!;
      return formatPeriod(p.startDate, p.endDate);
    };
    expect(period("seed-km-2026-11")).toBe("05/11/2026 – 30/11/2026");
    expect(period("seed-km-2026-he")).toBe("20/05/2026 – 10/06/2026");
    expect(period("seed-bang-gia-sau-ck")).toBe("Không thời hạn");
  });
});

describe("programStatus", () => {
  it("no dates at all → open, whatever the day", () => {
    expect(programStatus({ startDate: null, endDate: null }, "2026-11-20")).toBe("open");
    expect(programStatus({ startDate: null, endDate: null }, "1999-01-01")).toBe("open");
  });

  it.each([
    ["2026-11-04", "upcoming"],
    ["2026-11-05", "running"], // first day counts
    ["2026-11-20", "running"],
    ["2026-11-30", "running"], // last day counts
    ["2026-12-01", "ended"],
    ["2025-12-31", "upcoming"],
    ["2027-01-01", "ended"],
  ])("05/11/2026 – 30/11/2026 on %s → %s", (today, status) => {
    expect(programStatus({ startDate: "2026-11-05", endDate: "2026-11-30" }, today)).toBe(status);
  });

  it("only a start date: upcoming before it, running from that day on, never ended", () => {
    const p = { startDate: "2026-11-05", endDate: null };
    expect(programStatus(p, "2026-11-04")).toBe("upcoming");
    expect(programStatus(p, "2026-11-05")).toBe("running");
    expect(programStatus(p, "2099-01-01")).toBe("running");
  });

  it("only an end date: running up to and including that day, ended after", () => {
    const p = { startDate: null, endDate: "2026-11-30" };
    expect(programStatus(p, "2000-01-01")).toBe("running");
    expect(programStatus(p, "2026-11-30")).toBe("running");
    expect(programStatus(p, "2026-12-01")).toBe("ended");
  });

  it("a one-day program runs on that day only", () => {
    const p = { startDate: "2026-11-20", endDate: "2026-11-20" };
    expect(programStatus(p, "2026-11-19")).toBe("upcoming");
    expect(programStatus(p, "2026-11-20")).toBe("running");
    expect(programStatus(p, "2026-11-21")).toBe("ended");
  });

  it("uses today's local date when no day is given", () => {
    vi.useFakeTimers();
    const p = { startDate: "2026-11-05", endDate: "2026-11-30" };
    vi.setSystemTime(new Date(2026, 10, 4, 23, 59));
    expect(programStatus(p)).toBe("upcoming");
    vi.setSystemTime(new Date(2026, 10, 5, 0, 1));
    expect(programStatus(p)).toBe("running");
    vi.setSystemTime(new Date(2026, 10, 30, 23, 59));
    expect(programStatus(p)).toBe("running");
    vi.setSystemTime(new Date(2026, 11, 1, 0, 1));
    expect(programStatus(p)).toBe("ended");
  });

  it("the seed programs on 20/11/2026", () => {
    const status = (id: string) => programStatus(db.programs.find((p) => p.id === id)!, "2026-11-20");
    expect(status("seed-km-2026-11")).toBe("running");
    expect(status("seed-km-2026-he")).toBe("ended");
    expect(status("seed-bang-gia-sau-ck")).toBe("open");
  });

  it("every status has a Vietnamese label", () => {
    expect(PROGRAM_STATUS_LABEL).toEqual({
      upcoming: "Sắp diễn ra",
      running: "Đang chạy",
      ended: "Đã kết thúc",
      open: "Không thời hạn",
    });
  });
});

// ───────────────────────── SKU & search ─────────────────────────

describe("normalizeSku", () => {
  it.each([
    ["P-AYPR285-3", "P-AYPR285-3"],
    ["  p-aypr285-3  ", "P-AYPR285-3"],
    ["p-aypr 285-3", "P-AYPR285-3"],
    [`${NBSP}P-AYPR285-3${NBSP}`, "P-AYPR285-3"],
    [`P-AYPR${NBSP}285-3`, "P-AYPR285-3"],
    ["\tP-AYPR285-3\r\n", "P-AYPR285-3"],
    ["av1f", "AV1F"],
    ["", ""],
    ["   ", ""],
    [NBSP, ""],
  ])("normalizeSku(%j) = %j", (value, expected) => {
    expect(normalizeSku(value)).toBe(expected);
  });

  it("accepts anything: null, undefined and numbers (an Excel cell may hold a number)", () => {
    expect(normalizeSku(null)).toBe("");
    expect(normalizeSku(undefined)).toBe("");
    expect(normalizeSku(12345)).toBe("12345");
    expect(normalizeSku(0)).toBe("0");
  });

  it("leaves every SKU of the seed catalogue unchanged, and is idempotent", () => {
    for (const program of db.programs) {
      for (const group of program.groups) {
        for (const item of group.items) expect(normalizeSku(item.sku), item.sku).toBe(item.sku);
      }
    }
    expect(normalizeSku(normalizeSku("  p-aypr 285-3 "))).toBe("P-AYPR285-3");
  });
});

describe("searchKey / matchesSearch", () => {
  it("searchKey removes Vietnamese diacritics and lower-cases", () => {
    expect(searchKey("Khung vợt cầu lông")).toBe("khung vot cau long");
    expect(searchKey("Đại lý Đông Đô")).toBe("dai ly dong do");
    expect(searchKey("ĂÂÊÔƠƯ ăâêôơư")).toBe("aaeoou aaeoou");
    expect(searchKey("P-AYPR285-3")).toBe("p-aypr285-3");
    expect(searchKey("")).toBe("");
  });

  it("searchKey treats precomposed and decomposed text alike", () => {
    expect(searchKey("vợt".normalize("NFD"))).toBe(searchKey("vợt".normalize("NFC")));
    expect(searchKey("vợt".normalize("NFD"))).toBe("vot");
  });

  it("matches without diacritics and without regard to case", () => {
    const name = "Khung vợt cầu lông Aeronaut 6000 Speed";
    expect(matchesSearch(name, "vot cau long")).toBe(true);
    expect(matchesSearch(name, "VỢT")).toBe(true);
    expect(matchesSearch(name, "aeronaut")).toBe(true);
    expect(matchesSearch("khung vot cau long", "vợt cầu lông")).toBe(true);
    expect(matchesSearch("Đại lý Đông Đô", "dai ly dong do")).toBe(true);
    expect(matchesSearch("Dai ly Dong Do", "đại lý")).toBe(true);
  });

  it("every word of the query must appear, in any order, anywhere", () => {
    const name = "P-AYPR285-3 Khung vợt cầu lông Aeronaut 6000 Speed";
    expect(matchesSearch(name, "speed 6000")).toBe(true);
    expect(matchesSearch(name, "aypr285 vot")).toBe(true);
    expect(matchesSearch(name, "  speed   khung ")).toBe(true);
    expect(matchesSearch(name, "speed 7000")).toBe(false);
    expect(matchesSearch(name, "yonex")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesSearch("bất kỳ", "")).toBe(true);
    expect(matchesSearch("bất kỳ", "   ")).toBe(true);
    expect(matchesSearch("", "")).toBe(true);
    expect(matchesSearch("", "a")).toBe(false);
  });

  it("finds seed products by an unaccented fragment of their name", () => {
    const items = db.programs.flatMap((p) => p.groups.flatMap((g) => g.items));
    const hits = items.filter((i) => matchesSearch(`${i.sku} ${i.name}`, "khung vot aeronaut 6000 speed"));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((i) => i.name.includes("Aeronaut 6000 Speed"))).toBe(true);
  });
});

// ───────────────────────── Ids ─────────────────────────

describe("newId", () => {
  it("starts with the prefix and does not repeat", () => {
    expect(newId("g")).toMatch(/^g[0-9a-z]+$/);
    expect(newId()).toMatch(/^[0-9a-z]+$/);
    const ids = new Set(Array.from({ length: 100 }, () => newId("o")));
    expect(ids.size).toBe(100);
  });
});

describe("parseDateVN", () => {
  it("đọc ngày/tháng/năm kiểu Việt Nam và dạng 2026-11-05", () => {
    expect(parseDateVN("05/11/2026")).toBe("2026-11-05");
    expect(parseDateVN("5/11/2026")).toBe("2026-11-05");
    expect(parseDateVN(" 5-11-26 ")).toBe("2026-11-05");
    expect(parseDateVN("5.11.2026")).toBe("2026-11-05");
    expect(parseDateVN("2026-11-05")).toBe("2026-11-05");
    expect(parseDateVN("29/02/2028")).toBe("2028-02-29");
  });
  it("từ chối ngày không có thật hoặc chưa gõ xong", () => {
    for (const t of ["31/02/2026", "29/02/2026", "00/11/2026", "05/13/2026", "05/11", "05/11/202", "abc", ""]) expect(parseDateVN(t)).toBeNull();
  });
});
