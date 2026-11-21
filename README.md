# Quản lý chương trình khuyến mãi

Công cụ cho sale của hãng (Li-Ning, Yonex, Ashaway…) bán hàng cho đại lý / nhà phân phối:

- **Chương trình**: tạo và sửa chương trình khuyến mãi — danh mục hàng (nhập từ Excel) và quy tắc khuyến mãi.
- **Đơn hàng**: nhập số lượng, hệ thống tính ngay tiền phải trả, mức khuyến mãi đạt được, còn thiếu bao nhiêu để lên mức kế tiếp và quà được chọn.
- **Tổng hợp**: theo từng chương trình — hàng bán theo mã, quà tặng theo mã, doanh số theo đại lý.
- **Sản phẩm**: mỗi mã hàng một dòng, kèm hãng, loại hàng, giá lẻ và tồn kho; tìm, lọc (hãng, loại hàng, mức giá, tình trạng tồn kho), sắp xếp theo cột, phân trang, xuất Excel. Bấm vào một mã để xem các chương trình khuyến mại có mã đó (giá lẻ, giá sỉ ở từng nơi). Hãng lấy từ chương trình (chương trình ghi nhiều hãng thì xem tên danh mục / tên hàng); loại hàng nhận ra từ tên hàng — file Excel không có cột hãng hay loại hàng.
- **Vai trò**: Quản lý (tạo, sửa chương trình, cập nhật tồn kho, quản trị dữ liệu, tạo đơn) và Sale (xem chương trình, tạo đơn).
- **Tài khoản** (khi chạy với máy chủ): mỗi người đăng nhập bằng tài khoản riêng, quyền gắn với tài khoản, cả nhóm dùng chung một bộ dữ liệu.

## Chạy

Cần Node.js 20 trở lên.

```bash
npm install
npm run dev      # mở http://localhost:3000
```

Lệnh khác: `npm run build` (bản chạy thật trong `dist/`), `npm test` (kiểm thử phần tính toán và phần đồng bộ), `npm run lint` (kiểm tra kiểu), `npm run db:setup` và `npm run test:db` (khi dùng máy chủ — xem dưới).

## Dữ liệu nằm ở đâu: hai chế độ

Ứng dụng chạy ở một trong hai chế độ, quyết định lúc build bằng một biến môi trường, `DATABASE_URL` (xem `.env.example`):

| | Có máy chủ (lúc build có `DATABASE_URL`) | Không có máy chủ (không đặt) |
|---|---|---|
| Dữ liệu | Trong database PostgreSQL của bạn, cả nhóm dùng chung | Trong trình duyệt (localStorage) của từng máy |
| Đăng nhập | Mỗi người một tài khoản (email + mật khẩu) | Không có |
| Vai trò | Gắn với tài khoản, do quản lý đặt; máy chủ kiểm tra quyền | Thiết lập của từng máy, ai cũng đổi được |
| Đơn hàng | Sale thấy đơn của mình, quản lý thấy đơn của mọi sale; mã đơn do máy chủ cấp, không trùng | Mỗi máy một bộ đơn riêng, chuyển cho nhau bằng file `.json` |
| Cần mạng | Có | Không |

Chế độ không có máy chủ dùng để thử nhanh hoặc chạy một mình: lần chạy đầu nạp dữ liệu mẫu trong `src/seed/seed.json`; sao lưu / chuyển máy ở mục **Dữ liệu** → xuất file `.json`, rồi nhập ở máy kia.

## Bật máy chủ (PostgreSQL của riêng mình)

Trình duyệt không nối thẳng vào database được, nên ở giữa có một lớp API nhỏ nằm ngay trong dự án này:

```
Trình duyệt  ──https──▶  /api  (api/index.js — một Vercel Function)  ──TLS──▶  PostgreSQL của bạn
```

Lớp API chỉ chuyển từng yêu cầu thành một lệnh gọi hàm trong database; **ai được làm gì là do database quyết định** (các hàm trong [`server/schema.sql`](server/schema.sql)). Địa chỉ và mật khẩu database chỉ nằm ở nơi chạy lớp API — không bao giờ nằm trong mã nguồn hay trong mã gửi xuống trình duyệt.

Làm một lần:

1. **Chuẩn bị database**: một PostgreSQL 14 trở lên mà Vercel nối tới được qua Internet, cùng một tài khoản được tạo schema trong đó. Ứng dụng chỉ dùng schema `km`, không đụng tới thứ khác trong database.
2. **Cài lược đồ** (bảng, quyền, cấp mã đơn): tạo file `.env.local` ở thư mục gốc với một dòng `DATABASE_URL=postgres://<user>:<mật khẩu>@<máy chủ>:<cổng>/<database>`, rồi chạy `npm run db:setup`. Chạy lại nhiều lần cũng không sao; dữ liệu giữ nguyên.
3. **Đặt biến môi trường trên Vercel**: project → **Settings** → **Environment Variables** → thêm `DATABASE_URL` với cùng giá trị (chọn môi trường Production) → **Redeploy**. Từ lần build này trang web chuyển sang chế độ có máy chủ. Nếu database chưa nối được hoặc chưa cài lược đồ thì build dừng và bản đang chạy giữ nguyên — không có chuyện trang đòi máy chủ mà máy chủ chưa dùng được.
4. **Kiểm tra**: mở `https://<địa-chỉ-trang>/api` — phải thấy `"database":"ok"`.
5. **Đăng ký tài khoản đầu tiên** ngay sau đó: tài khoản đầu tiên của hệ thống tự động là **Quản lý**. Các tài khoản đăng ký sau ở trạng thái «chờ duyệt» cho tới khi một quản lý duyệt ở mục **Tài khoản**.
6. **Đưa dữ liệu lên**: quản lý vào mục **Dữ liệu** → «Dữ liệu ban đầu» để đưa dữ liệu cũ của trình duyệt đó lên máy chủ, hoặc nạp chương trình mẫu.

Cần biết khi vận hành:

- **Sao lưu là việc của bạn**: toàn bộ dữ liệu nằm trong schema `km` của database (`pg_dump -n km …`). Trong ứng dụng, quản lý cũng xuất được toàn bộ ra file `.json` ở mục **Dữ liệu**.
- **Lỡ tài khoản đầu tiên không phải của mình, hoặc không còn quản lý nào**: nối vào database và chạy `update km.accounts set role = 'manager' where email = 'email-cua-ban';`.
- **Đổi mật khẩu database**: sửa `DATABASE_URL` trên Vercel rồi Redeploy.
- **Kết nối tới database** luôn được mã hóa (TLS). Mặc định lớp API không kiểm tra chứng chỉ của database (database tự dựng thường dùng chứng chỉ tự ký); muốn kiểm tra thì đặt thêm biến `DATABASE_CA` là chứng chỉ CA dạng PEM.
- **Hạn mức của Vercel**: mỗi tab đang mở hỏi máy chủ khoảng 15 giây một lần lúc đang làm việc (1 phút một lần khi để yên, không hỏi khi tab bị ẩn). Gói Hobby cho 1 triệu lượt gọi mỗi tháng — đủ cho khoảng hai chục người mở trang suốt giờ làm việc. Vượt hạn mức thì Vercel tạm dừng cả trang cho tới kỳ sau, nên đội đông hơn thế cần gói trả tiền.
- Lớp API đặt ở vùng Singapore (`vercel.json`) cho gần Việt Nam; database ở nơi khác thì đổi `regions` cho gần database.

### Tài khoản và quyền khi có máy chủ

| Vai trò | Làm được |
|---|---|
| Quản lý | Mọi thứ: tạo / sửa / xóa chương trình, nhập sản phẩm, cập nhật tồn kho, đặt ngưỡng cảnh báo, xem và sửa đơn của mọi sale, nhập dữ liệu từ file; duyệt tài khoản, đổi vai trò, khóa tài khoản, đặt lại mật khẩu cho người khác |
| Sale | Xem chương trình (chỉ đọc), sản phẩm, tồn kho và cảnh báo; tạo, sửa, chốt, xóa **đơn của mình**; xuất dữ liệu mình thấy ra file |
| Chờ duyệt / Đã khóa | Đăng nhập được nhưng không thấy dữ liệu nào |

- Quyền được kiểm tra trong database, ở từng lệnh, theo vai trò hiện tại của tài khoản — nên sửa mã trên trình duyệt hay gọi thẳng lớp API cũng không vượt quyền được.
- Không ai tự đổi vai trò của chính mình, nên hệ thống luôn còn ít nhất một quản lý.
- Quên mật khẩu: nhờ quản lý đặt lại ở mục **Tài khoản** (hệ thống không gửi email). Đặt lại xong thì mọi máy đang đăng nhập bằng tài khoản đó bị đăng xuất ngay.
- Đăng nhập sai 10 lần liên tiếp trong 15 phút thì email đó bị tạm chặn 15 phút. Một lần đăng nhập giữ được 30 ngày kể từ lần dùng gần nhất.
- Tên và số điện thoại của tài khoản được tự ghi vào mỗi đơn mới (sửa ở mục **Dữ liệu** → «Tài khoản»). Danh sách đơn lọc được theo sale; tab «Tổng hợp» có bảng doanh số theo sale — sale chỉ thấy số của mình.
- Mọi thay đổi tự lưu lên máy chủ sau khoảng một giây. Mất mạng thì thay đổi được giữ trên trang và tự gửi lại khi có mạng (đừng đóng trang lúc đang có dòng «Chưa lưu được»). Tạo đơn mới thì cần mạng, vì mã đơn do máy chủ cấp.
- Thay đổi của người khác hiện ra sau tối đa khoảng 15 giây (trang tự hỏi máy chủ định kỳ), hoặc ngay khi quay lại tab. Hai người sửa cùng một bản ghi cùng lúc: người lưu sau được báo và nhận bản mới nhất, không ai bị ghi đè âm thầm.
- Giới hạn hiện tại: trình duyệt tải toàn bộ đơn hàng mà tài khoản được thấy, nên hợp với quy mô vài nghìn đơn; mỗi bản ghi (một chương trình, bảng tồn kho) tối đa khoảng 4 MB.

Máy chủ bảo đảm những gì, và không bảo đảm những gì:

- Bảo đảm: ai được đọc / ghi bản ghi nào (bảng ở trên); đơn của ai thuộc về người đó; mã đơn của sale do máy chủ cấp, không trùng, không sửa được; không xóa được chương trình còn đơn; không ai tự nâng quyền cho mình; «Khóa» và «Đặt lại mật khẩu» có hiệu lực ngay.
- Không bảo đảm: nội dung bên trong một đơn (tên sale, số lượng, số tiền) là do trình duyệt của người lập đơn ghi — máy chủ lưu lại chứ không tính lại. Một sale cố tình gọi thẳng lớp API có thể ghi số liệu sai vào **đơn của chính mình**, nhưng không đụng được đơn của người khác hay chương trình.
- Ai biết địa chỉ trang cũng bấm «Đăng ký» được (mỗi địa chỉ mạng tối đa 20 tài khoản mỗi giờ), nhưng tài khoản chưa duyệt không đọc, không ghi được dữ liệu nào.
- Mật khẩu được băm (scrypt) ở lớp API trước khi lưu; database không bao giờ nhận mật khẩu gốc. Phiên đăng nhập là một khóa ngẫu nhiên, database chỉ lưu mã băm của nó.
- Ai có `DATABASE_URL` thì có toàn quyền với dữ liệu: chỉ đặt nó ở Vercel và trong `.env.local` của máy mình.

### Chạy với máy chủ ở máy mình (để phát triển, kiểm thử)

Cần Docker.

```bash
docker run -d --name km-pg -e POSTGRES_PASSWORD=dev -p 127.0.0.1:5432:5432 postgres:17-alpine
echo 'DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres?sslmode=disable' > .env.local
npm run db:setup          # cài lược đồ vào database vừa dựng
npm run dev               # trang web + lớp API cùng ở http://localhost:3000 (lớp API tại /api)
npm run test:db           # kiểm thử máy chủ: tự dựng một PostgreSQL tạm khác, không đụng tới database ở trên
```

`npm run test:db` kiểm thử quyền của từng vai trò ở từng lệnh, cấp mã đơn, đăng nhập / phiên, và hai «trình duyệt» đồng bộ với nhau qua lớp API thật. Các bài này xóa sạch dữ liệu của database chúng dùng, nên chỉ chạy với database trên chính máy mình.

## Vai trò khi không có máy chủ

| Vai trò | Làm được |
|---|---|
| Quản lý | Mọi thứ: tạo / sửa / xóa chương trình, nhập sản phẩm, cập nhật tồn kho, đặt ngưỡng cảnh báo, khôi phục dữ liệu mẫu, tạo đơn |
| Sale | Xem chương trình (chỉ đọc), sản phẩm, tồn kho và cảnh báo; tạo, sửa, chốt đơn; sao lưu và nhập dữ liệu |

Không có đăng nhập nên vai trò là **thiết lập của từng máy** (mục **Dữ liệu** → «Vai trò trên máy này»): ai dùng máy đó cũng đổi được, và dữ liệu nằm riêng trên từng máy. Máy mở ứng dụng lần đầu ở vai trò Sale. Đây là chế độ làm việc, không phải bảo mật. Mỗi đơn ghi tên và số điện thoại của sale lấy từ mục **Dữ liệu** → «Thông tin sale» của máy tạo đơn.

Ở cả hai chế độ, mọi chỗ kiểm tra quyền trên màn hình đều đi qua `canManage` trong `src/lib/roles.ts`.

## Sản phẩm và tồn kho

Sản phẩm và giá được nhập từ Excel vào danh mục của từng chương trình. Tồn kho được ghi theo mã hàng, dùng chung cho mọi chương trình, và có hai cách đưa vào:

- Màn hình **Sản phẩm** → «Cập nhật tồn kho»: chọn file tồn kho xuất từ phần mềm kho (hoặc dán từ Excel). File chỉ cần cột mã hàng và cột số lượng tồn; mã nằm ở nhiều dòng (mỗi kho một dòng) thì cộng dồn.
- Khi nhập sản phẩm vào danh mục: nếu file có cột «Tồn kho» thì số tồn được ghi luôn.

Mã chưa có số liệu hiện dấu «—», tồn bằng 0 hiện «Hết hàng». Hệ thống không tự trừ tồn kho khi chốt đơn — số tồn chỉ đổi khi nhập file mới.

Cảnh báo tồn kho: mã hết hàng luôn được báo; mã có tồn từ 1 đến ngưỡng (mặc định 5, người quản lý đổi ở mục **Dữ liệu**) được báo «Sắp hết». Số mã cần chú ý của những chương trình chưa kết thúc hiện ở đầu màn hình **Sản phẩm** (bấm «Xem các mã cần chú ý» để lọc ra) (mục này có chấm đỏ trên thanh điều hướng), và khi nhập đơn mỗi sản phẩm hiện số tồn, đặt quá số tồn thì có cảnh báo (không chặn chốt đơn, vì số tồn có thể đã cũ).

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
  lib/store.tsx       kho dữ liệu (các thao tác dùng chung) + lưu localStorage khi không có máy chủ + nhập/xuất JSON
  lib/cloud/          khi có máy chủ: gọi lớp API (api), đăng nhập (auth), đọc/ghi dữ liệu (remote), bộ đồng bộ (sync), kho dữ liệu (CloudStore)
  lib/excel.ts        đọc file Excel / dữ liệu dán thành danh sách sản phẩm và số lượng tồn
  lib/stock.ts        tồn kho theo mã hàng, mức tồn và cảnh báo, danh sách sản phẩm theo danh mục
  lib/roles.ts        vai trò (Quản lý / Sale) và quyền
  lib/programOps.ts   thao tác trên chương trình và quy tắc
  pages/              các màn hình
  components/         hộp thoại nhập Excel, bảng tổng hợp, các phần của màn hình
  seed/seed.json      dữ liệu mẫu
api/index.js          cửa vào của lớp API trên Vercel (một Vercel Function tại /api)
server/
  app.js              lớp API: giao thức, băm mật khẩu, gọi hàm trong database
  schema.sql          lược đồ database: bảng, quyền của từng vai trò, cấp mã đơn, tài khoản và phiên đăng nhập
  setup.mjs           `npm run db:setup` — cài / nâng cấp lược đồ; `npm run build` dùng nó để kiểm tra database trước khi build
  node.js             nối lớp API vào máy chủ của Vite khi chạy ở máy mình
  tests/              `npm run test:db` — kiểm thử cần một PostgreSQL thật (tự dựng bằng Docker)
vercel.json           vùng chạy và thời gian tối đa của lớp API
```
