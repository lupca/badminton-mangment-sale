# Quản lý chương trình khuyến mãi

Công cụ cho sale của hãng (Li-Ning, Yonex, Ashaway…) bán hàng cho đại lý / nhà phân phối:

- **Chương trình**: tạo và sửa chương trình khuyến mãi — danh mục hàng (nhập từ Excel) và quy tắc khuyến mãi.
- **Đơn hàng**: nhập số lượng, hệ thống tính ngay tiền phải trả, mức khuyến mãi đạt được, còn thiếu bao nhiêu để lên mức kế tiếp và quà được chọn.
- **Tổng hợp**: theo từng chương trình — hàng bán theo mã, quà tặng theo mã, doanh số theo đại lý.
- **Sản phẩm**: toàn bộ sản phẩm của các chương trình theo từng danh mục, kèm giá lẻ và tồn kho, và cảnh báo các mã hết hàng / sắp hết.
- **Vai trò**: Quản lý (tạo, sửa chương trình, cập nhật tồn kho, quản trị dữ liệu, tạo đơn) và Sale (xem chương trình, tạo đơn).
- **Tài khoản** (khi chạy với máy chủ): mỗi người đăng nhập bằng tài khoản riêng, quyền gắn với tài khoản, cả nhóm dùng chung một bộ dữ liệu.

## Chạy

Cần Node.js 20 trở lên.

```bash
npm install
npm run dev      # mở http://localhost:3000
```

Lệnh khác: `npm run build` (bản chạy thật trong `dist/`), `npm test` (kiểm thử phần tính toán và phần đồng bộ), `npm run lint` (kiểm tra kiểu).

## Dữ liệu nằm ở đâu: hai chế độ

Ứng dụng chạy ở một trong hai chế độ, quyết định lúc build bằng hai biến môi trường `VITE_SUPABASE_URL` và `VITE_SUPABASE_KEY` (xem `.env.example`):

| | Có máy chủ (đặt hai biến) | Không có máy chủ (để trống) |
|---|---|---|
| Dữ liệu | Trên Supabase, cả nhóm dùng chung | Trong trình duyệt (localStorage) của từng máy |
| Đăng nhập | Mỗi người một tài khoản (email + mật khẩu) | Không có |
| Vai trò | Gắn với tài khoản, do quản lý đặt; máy chủ kiểm tra quyền | Thiết lập của từng máy, ai cũng đổi được |
| Đơn hàng | Sale thấy đơn của mình, quản lý thấy đơn của mọi sale; mã đơn do máy chủ cấp, không trùng | Mỗi máy một bộ đơn riêng, chuyển cho nhau bằng file `.json` |
| Cần mạng | Có | Không |

Chế độ không có máy chủ dùng để thử nhanh hoặc chạy một mình: lần chạy đầu nạp dữ liệu mẫu trong `src/seed/seed.json`; sao lưu / chuyển máy ở mục **Dữ liệu** → xuất file `.json`, rồi nhập ở máy kia.

## Bật máy chủ (Supabase)

Làm một lần, khoảng 10 phút. Gói miễn phí của Supabase là đủ để bắt đầu (500 MB dữ liệu, tức hàng chục nghìn đơn). Lưu ý của gói miễn phí: project tự tạm dừng nếu một tuần liền không ai dùng; khi đó vào trang quản trị Supabase bấm khôi phục là chạy lại, dữ liệu còn nguyên.

1. **Tạo project** ở [supabase.com](https://supabase.com) → New project. Chọn vùng gần Việt Nam (Southeast Asia – Singapore). Mật khẩu database tự đặt và cất đi (ứng dụng không dùng tới).
2. **Tạo bảng và quyền**: mở **SQL Editor** → New query → dán toàn bộ nội dung file [`supabase/migrations/20261121000000_init.sql`](supabase/migrations/20261121000000_init.sql) → **Run**. Chạy lại nhiều lần cũng không sao.
3. **Tắt xác nhận email** — làm *trước khi* có người đăng ký: **Authentication** → **Sign In / Providers** → **Email** → tắt **Confirm email** → Save. Hệ thống không gửi email (email mặc định của Supabase chỉ gửi được cho thành viên của project); thay vào đó mỗi tài khoản mới phải được quản lý duyệt.
4. **Lấy địa chỉ và khóa**: bấm **Connect** ở đầu trang project (hoặc **Project Settings** → **API Keys**) → chép **Project URL** và **Publishable key** (`sb_publishable_…`). Đây là khóa công khai, được phép nằm trong trình duyệt; mọi quyền do máy chủ kiểm tra. *Không bao giờ* dùng Secret key (`sb_secret_…`) cho ứng dụng này.
5. **Đặt hai biến môi trường rồi build lại**: `VITE_SUPABASE_URL` = Project URL, `VITE_SUPABASE_KEY` = Publishable key. Trên Vercel: **Settings** → **Environment Variables**, rồi Redeploy. Chạy ở máy mình: ghi vào file `.env.local`.
6. **Đăng ký tài khoản đầu tiên** ngay sau khi trang chạy lại: tài khoản đầu tiên của hệ thống tự động là **Quản lý**. Các tài khoản đăng ký sau ở trạng thái «chờ duyệt» cho tới khi một quản lý duyệt ở mục **Tài khoản**.
7. **Đưa dữ liệu lên**: quản lý vào mục **Dữ liệu** → «Dữ liệu ban đầu» để đưa dữ liệu cũ của trình duyệt đó lên máy chủ, hoặc nạp chương trình mẫu.

Nếu lỡ có người đăng ký trước khi tắt «Confirm email» và không đăng nhập được: vào **Authentication** → **Users**, xóa tài khoản đó rồi đăng ký lại.

Muốn chắc file SQL đã chạy đủ (không bắt buộc), dán câu dưới vào SQL Editor — cả năm cột phải là `true`:

```sql
select
  (select count(*) = 5 from pg_tables where schemaname = 'public'
     and tablename in ('profiles', 'programs', 'orders', 'app_state', 'order_counters') and rowsecurity)       as bang_va_quyen,
  exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal)              as tu_tao_ho_so,
  has_table_privilege('postgres', 'auth.users', 'UPDATE')                                                    as dat_lai_mat_khau,
  has_table_privilege('postgres', 'auth.sessions', 'DELETE')                                                 as dang_xuat_khi_dat_lai,
  (select count(*) = 4 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public') as bao_thay_doi_ngay;
```

`bao_thay_doi_ngay` là `false` thì hệ thống vẫn chạy, chỉ là thay đổi của người khác hiện chậm hơn (tới nửa phút). Hai cột về mật khẩu là `false` thì việc quản lý đặt lại mật khẩu trong ứng dụng không dùng được — khi đó đặt lại ở **Authentication** → **Users** của Supabase.

Lỡ tài khoản đầu tiên không phải của mình, hoặc không còn quản lý nào: mở SQL Editor và chạy `update public.profiles set role = 'manager' where email = 'email-cua-ban';`.

### Tài khoản và quyền khi có máy chủ

| Vai trò | Làm được |
|---|---|
| Quản lý | Mọi thứ: tạo / sửa / xóa chương trình, nhập sản phẩm, cập nhật tồn kho, đặt ngưỡng cảnh báo, xem và sửa đơn của mọi sale, nhập dữ liệu từ file; duyệt tài khoản, đổi vai trò, khóa tài khoản, đặt lại mật khẩu cho người khác |
| Sale | Xem chương trình (chỉ đọc), sản phẩm, tồn kho và cảnh báo; tạo, sửa, chốt, xóa **đơn của mình**; xuất dữ liệu mình thấy ra file |
| Chờ duyệt / Đã khóa | Đăng nhập được nhưng không thấy dữ liệu nào |

- Quyền được máy chủ kiểm tra bằng Row Level Security (trong file SQL), nên sửa mã trên trình duyệt cũng không vượt quyền được.
- Không ai tự đổi vai trò của chính mình, nên hệ thống luôn còn ít nhất một quản lý.
- Quên mật khẩu: nhờ quản lý đặt lại ở mục **Tài khoản** (hệ thống không gửi email khôi phục).
- Tên và số điện thoại của tài khoản được tự ghi vào mỗi đơn mới (sửa ở mục **Dữ liệu** → «Tài khoản»). Danh sách đơn lọc được theo sale; tab «Tổng hợp» có bảng doanh số theo sale — sale chỉ thấy số của mình.
- Mọi thay đổi tự lưu lên máy chủ sau khoảng một giây. Mất mạng thì thay đổi được giữ trên trang và tự gửi lại khi có mạng (đừng đóng trang lúc đang có dòng «Chưa lưu được»). Tạo đơn mới thì cần mạng, vì mã đơn do máy chủ cấp.
- Thay đổi của người khác hiện ra sau khoảng một giây (Supabase Realtime), chậm nhất là sau nửa phút. Hai người sửa cùng một bản ghi cùng lúc: người lưu sau được báo và nhận bản mới nhất, không ai bị ghi đè âm thầm.
- Giới hạn hiện tại: trình duyệt tải toàn bộ đơn hàng mà tài khoản được thấy, nên hợp với quy mô vài nghìn đơn.

Máy chủ bảo đảm những gì, và không bảo đảm những gì:

- Bảo đảm: ai được đọc / ghi bản ghi nào (bảng ở trên); đơn của ai thuộc về người đó; mã đơn của sale do máy chủ cấp, không trùng, không sửa được; không xóa được chương trình còn đơn; không ai tự nâng quyền cho mình.
- Không bảo đảm: nội dung bên trong một đơn (tên sale, số lượng, số tiền) là do trình duyệt của người lập đơn ghi — máy chủ lưu lại chứ không tính lại. Một sale cố tình gọi thẳng máy chủ có thể ghi số liệu sai vào **đơn của chính mình**, nhưng không đụng được đơn của người khác hay chương trình.
- Ai biết địa chỉ trang cũng bấm «Đăng ký» được, nhưng tài khoản chưa duyệt không đọc, không ghi được dữ liệu nào.
- «Khóa» có hiệu lực ngay. «Đặt lại mật khẩu» thì trình duyệt đang đăng nhập sẵn của người đó còn dùng được tới khi phiên hết hạn (tối đa một giờ) — cần chặn ngay thì bấm «Khóa».
- Kênh báo thay đổi (Realtime) không gửi nội dung cho người không có quyền, nhưng mã nội bộ của một bản ghi vừa bị xóa thì mọi tài khoản đã đăng nhập đều có thể nhận được.

### Chạy Supabase ở máy mình (để phát triển, kiểm thử)

Cần Docker. Thư mục `supabase/` là cấu hình cho [Supabase CLI](https://supabase.com/docs/guides/local-development):

```bash
npx supabase start        # dựng Postgres + Auth + Realtime cục bộ, tự chạy file SQL trong supabase/migrations
npx supabase status       # in ra API URL và Publishable key của bản cục bộ → ghi vào .env.local
npm run dev
npm run test:db           # kiểm thử quyền (RLS) và kiểm thử đồng bộ hai máy với bản cục bộ
npx supabase stop
```

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
  lib/store.tsx       kho dữ liệu (các thao tác dùng chung) + lưu localStorage khi không có máy chủ + nhập/xuất JSON
  lib/cloud/          khi có máy chủ: đăng nhập (auth), đọc/ghi Supabase (remote), bộ đồng bộ (sync), kho dữ liệu (CloudStore)
  lib/excel.ts        đọc file Excel / dữ liệu dán thành danh sách sản phẩm và số lượng tồn
  lib/stock.ts        tồn kho theo mã hàng, mức tồn và cảnh báo, danh sách sản phẩm theo danh mục
  lib/roles.ts        vai trò (Quản lý / Sale) và quyền
  lib/programOps.ts   thao tác trên chương trình và quy tắc
  pages/              các màn hình
  components/         hộp thoại nhập Excel, bảng tổng hợp, các phần của màn hình
  seed/seed.json      dữ liệu mẫu
supabase/
  migrations/         lược đồ máy chủ: bảng, quyền (RLS), cấp mã đơn, duyệt tài khoản — dán vào SQL Editor của Supabase
  tests/              kiểm thử cần một Supabase đang chạy: quyền truy cập, đồng bộ hai máy
```
