# Quản lý chương trình khuyến mãi

Công cụ cho sale của hãng (Li-Ning, Yonex, Ashaway…) bán hàng cho đại lý / nhà phân phối:

- **Chương trình**: tạo và sửa chương trình khuyến mãi — danh mục hàng (nhập từ Excel) và quy tắc khuyến mãi.
- **Đơn hàng**: nhập số lượng, hệ thống tính ngay tiền phải trả, mức khuyến mãi đạt được, còn thiếu bao nhiêu để lên mức kế tiếp và quà được chọn.
- **Tổng hợp**: theo từng chương trình — hàng bán theo mã, quà tặng theo mã, doanh số theo đại lý.
- **Sản phẩm**: toàn bộ sản phẩm của các chương trình theo từng danh mục, kèm giá lẻ và tồn kho, và cảnh báo các mã hết hàng / sắp hết.
- **Vai trò**: Quản lý (tạo, sửa chương trình, cập nhật tồn kho, quản trị dữ liệu, tạo đơn) và Sale (xem chương trình, tạo đơn).

## Chạy

Cần Node.js 20 trở lên.

```bash
npm install
npm run dev      # mở http://localhost:3000
```

Lệnh khác: `npm run build` (bản chạy thật trong `dist/`), `npm test` (kiểm thử phần tính toán), `npm run lint` (kiểm tra kiểu).

## Dữ liệu nằm ở đâu

Chưa có backend. Dữ liệu lưu trong trình duyệt (localStorage) của từng máy và tự lưu sau mỗi thay đổi.

- Sao lưu / chuyển máy / gửi cho đồng nghiệp: mục **Dữ liệu** → xuất file `.json`, rồi nhập ở máy kia.
- Lần chạy đầu tiên nạp dữ liệu mẫu trong `src/seed/seed.json`.
- Muốn nhiều người dùng chung một bộ dữ liệu thì cần thêm backend: chỉ phải thay hai hàm `readStorage` / `writeStorage` trong `src/lib/store.tsx`.

## Vai trò: Quản lý và Sale

| Vai trò | Làm được |
|---|---|
| Quản lý | Mọi thứ: tạo / sửa / xóa chương trình, nhập sản phẩm, cập nhật tồn kho, đặt ngưỡng cảnh báo, khôi phục dữ liệu mẫu, tạo đơn |
| Sale | Xem chương trình (chỉ đọc), sản phẩm, tồn kho và cảnh báo; tạo, sửa, chốt đơn; sao lưu và nhập dữ liệu |

Chưa có đăng nhập nên vai trò là **thiết lập của từng máy** (mục **Dữ liệu** → «Vai trò trên máy này»): ai dùng máy đó cũng đổi được, và dữ liệu vẫn nằm riêng trên từng máy. Máy mở ứng dụng lần đầu ở vai trò Sale. Đây là chế độ làm việc, chưa phải bảo mật — muốn mỗi người một tài khoản, quyền gắn với tài khoản và mọi người dùng chung dữ liệu thì cần backend. Mọi chỗ kiểm tra quyền đều đi qua `canManage` trong `src/lib/roles.ts`, nên khi có đăng nhập chỉ phải đổi nguồn của vai trò.

Mỗi đơn ghi tên và số điện thoại của sale (lấy từ mục **Dữ liệu** → «Thông tin sale» của máy tạo đơn). Danh sách đơn lọc được theo sale; tab «Tổng hợp» của chương trình có bảng doanh số theo sale.

## Sản phẩm và tồn kho

Sản phẩm và giá được nhập từ Excel vào danh mục của từng chương trình. Tồn kho được ghi theo mã hàng, dùng chung cho mọi chương trình, và có hai cách đưa vào:

- Màn hình **Sản phẩm** → «Cập nhật tồn kho»: chọn file tồn kho xuất từ phần mềm kho (hoặc dán từ Excel). File chỉ cần cột mã hàng và cột số lượng tồn; mã nằm ở nhiều dòng (mỗi kho một dòng) thì cộng dồn.
- Khi nhập sản phẩm vào danh mục: nếu file có cột «Tồn kho» thì số tồn được ghi luôn.

Mã chưa có số liệu hiện dấu «—», tồn bằng 0 hiện «Hết hàng». Hệ thống không tự trừ tồn kho khi chốt đơn — số tồn chỉ đổi khi nhập file mới.

Cảnh báo tồn kho: mã hết hàng luôn được báo; mã có tồn từ 1 đến ngưỡng (mặc định 5, người quản lý đổi ở mục **Dữ liệu**) được báo «Sắp hết». Các mã cần chú ý của những chương trình chưa kết thúc hiện ở đầu màn hình **Sản phẩm** (mục này có chấm đỏ trên thanh điều hướng), và khi nhập đơn mỗi sản phẩm hiện số tồn, đặt quá số tồn thì có cảnh báo (không chặn chốt đơn, vì số tồn có thể đã cũ).

## Ba loại quy tắc khuyến mãi

| Loại | Ví dụ |
|---|---|
| Đạt doanh số → tặng hàng | Đơn từ 20 triệu đến dưới 50 triệu: chọn quà tổng giá trị không quá 3.190.000 đ |
| Giảm giá theo số lượng | Mua 2–4 vợt Danh mục 01 kèm 1 sản phẩm Danh mục 03: giảm 45% |
| Mua X tặng Y | Mua 1 tặng 1 cùng loại; mỗi khung vợt tặng 1 sợi cước |

Một chương trình có thể có nhiều quy tắc. Mỗi quy tắc gắn với các danh mục hàng của chương trình.

## Cấu trúc mã nguồn

```
src/
  types.ts            mô hình dữ liệu
  lib/engine.ts       tính đơn theo quy tắc (hàm thuần, có kiểm thử)
  lib/store.tsx       kho dữ liệu + lưu localStorage + nhập/xuất JSON
  lib/excel.ts        đọc file Excel / dữ liệu dán thành danh sách sản phẩm và số lượng tồn
  lib/stock.ts        tồn kho theo mã hàng, mức tồn và cảnh báo, danh sách sản phẩm theo danh mục
  lib/roles.ts        vai trò (Quản lý / Sale) và quyền
  lib/programOps.ts   thao tác trên chương trình và quy tắc
  pages/              các màn hình
  components/         hộp thoại nhập Excel, bảng tổng hợp, các phần của màn hình
  seed/seed.json      dữ liệu mẫu
```
