// Xuất dữ liệu ra file Excel (.xlsx). Thư viện xlsx chỉ được tải khi cần.

export type XlsxCell = string | number | null;

export interface XlsxSheet {
  name: string; // tên sheet (Excel giới hạn 31 ký tự, không chứa \ / ? * [ ] :)
  rows: XlsxCell[][];
  /** Độ rộng từng cột, tính bằng số ký tự. */
  colWidths?: number[];
}

/** Tạo file .xlsx từ các bảng dữ liệu và tải xuống máy người dùng. */
export async function exportTableXlsx(fileName: string, sheets: XlsxSheet[]): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet, i) => {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    if (sheet.colWidths) worksheet["!cols"] = sheet.colWidths.map((wch) => ({ wch }));
    const safeName = sheet.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Sheet${i + 1}`;
    XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
  });
  XLSX.writeFile(workbook, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

/** Tên file an toàn: bỏ ký tự cấm, gộp khoảng trắng. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "du-lieu";
}
