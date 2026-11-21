-- Quản lý khuyến mãi — cơ sở dữ liệu trên máy chủ (PostgreSQL 14 trở lên).
--
-- Cài đặt / nâng cấp:  npm run db:setup   (đọc biến môi trường DATABASE_URL). Chạy lại nhiều lần cũng không sao.
--
-- Mọi thứ nằm trong schema «km». Chỉ lớp API (api/index.js) nối vào database này; trình duyệt không bao giờ nối thẳng.
-- Lớp API chỉ làm hai việc: băm mật khẩu, và chuyển từng yêu cầu thành MỘT lệnh gọi hàm dưới đây. Ai được làm gì là do
-- các hàm này quyết định (km.call), nên lớp API có sơ suất cũng không mở thêm quyền.
--
--   • km.accounts    tài khoản: email, mật khẩu (đã băm), họ tên, điện thoại, vai trò (pending / sale / manager / locked)
--   • km.sessions    phiên đăng nhập (chỉ lưu mã băm của khóa phiên)
--   • km.programs    chương trình khuyến mãi (cả chương trình là một tài liệu JSON)       — quản lý ghi, mọi thành viên đọc
--   • km.orders      đơn hàng (JSON), mỗi đơn thuộc về tài khoản tạo ra nó               — sale thấy đơn của mình, quản lý thấy hết
--   • km.app_state   hai dòng dùng chung: tồn kho và thiết lập (ngưỡng «sắp hết hàng»)   — quản lý ghi, mọi thành viên đọc
--
-- Tài khoản đăng ký ĐẦU TIÊN tự động là Quản lý; các tài khoản sau ở trạng thái «chờ duyệt» cho tới khi một quản lý duyệt.
--
-- Mã lỗi: các hàm báo lỗi bằng SQLSTATE «KMxxx», lớp API đổi thành mã HTTP xxx kèm lời báo tiếng Việt:
--   KM400 yêu cầu sai · KM401 chưa đăng nhập / phiên hết hạn · KM403 không có quyền · KM404 không tìm thấy
--   KM409 đã tồn tại · KM422 dữ liệu bị từ chối · KM429 thử quá nhiều lần

create schema if not exists km;

-- ───────────────────────── Bảng ─────────────────────────

create table if not exists km.meta (
  key    text primary key,
  value  text not null
);

create table if not exists km.accounts (
  id             uuid primary key default gen_random_uuid(),
  -- Chữ thường, đã gọn khoảng trắng.
  email          text not null,
  -- Mật khẩu do lớp API băm (scrypt); database không bao giờ nhận mật khẩu gốc.
  password_hash  text not null check (password_hash <> ''),
  full_name      text not null default '',
  phone          text not null default '',
  role           text not null default 'pending' check (role in ('pending', 'sale', 'manager', 'locked')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists accounts_email_key on km.accounts (email);

create table if not exists km.sessions (
  -- SHA-256 của khóa phiên. Khóa gốc chỉ nằm trong trình duyệt của người dùng.
  token_hash  bytea primary key,
  account_id  uuid not null references km.accounts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_account_idx on km.sessions (account_id);

-- Nhật ký để chặn thử quá nhiều lần: đăng nhập sai (theo email và theo địa chỉ mạng), đăng ký (theo địa chỉ mạng).
-- Một lần đăng nhập được ghi là «sai» ngay từ lúc bắt đầu thử và được gỡ đi khi mật khẩu đúng (xem km.sign_in_begin).
create table if not exists km.auth_events (
  id    bigint generated always as identity primary key,
  kind  text not null check (kind in ('signin_fail', 'signup', 'signup_fail')),
  key   text not null,
  at    timestamptz not null default now()
);
create index if not exists auth_events_lookup_idx on km.auth_events (kind, key, at);
-- 'signup_fail' (lượt đăng ký trùng email) có từ lược đồ phiên bản 3; cài lại trên database cũ thì nới điều kiện.
alter table km.auth_events drop constraint if exists auth_events_kind_check;
alter table km.auth_events add constraint auth_events_kind_check check (kind in ('signin_fail', 'signup', 'signup_fail'));

-- id xếp theo thứ tự byte (collate "C"): trùng với cách trình duyệt xếp khi tính «dấu vân tay» để so dữ liệu.
create table if not exists km.programs (
  id          text collate "C" primary key check (id <> '' and length(id) <= 200),
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  -- Số lần ghi. Trình duyệt gửi kèm số nó đang biết khi sửa; lệch nghĩa là người khác vừa sửa → không ghi đè.
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references km.accounts (id) on delete set null
);

create table if not exists km.orders (
  id          text collate "C" primary key check (id <> '' and length(id) <= 200),
  -- Tài khoản tạo đơn. Xóa tài khoản thì đơn vẫn còn (chỉ quản lý thấy).
  owner_id    uuid references km.accounts (id) on delete set null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  rev         integer not null default 1,
  program_id  text generated always as (data ->> 'programId') stored not null,
  code        text generated always as (data ->> 'code') stored not null,
  status      text generated always as (data ->> 'status') stored not null check (status in ('draft', 'confirmed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists orders_owner_idx on km.orders (owner_id);
create index if not exists orders_program_idx on km.orders (program_id);
create index if not exists orders_code_idx on km.orders (code text_pattern_ops);

create table if not exists km.app_state (
  key         text collate "C" primary key check (key in ('stock', 'settings')),
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references km.accounts (id) on delete set null
);

insert into km.app_state (key, data) values
  ('stock', '{"bySku": {}, "updatedAt": null}'::jsonb),
  ('settings', '{"lowStockThreshold": 5}'::jsonb)
on conflict (key) do nothing;

-- Số thứ tự đơn trong ngày đã cấp, để mã đơn không lặp lại kể cả khi đơn bị xóa.
create table if not exists km.order_counters (
  day   date primary key,
  last  integer not null
);

-- ───────────────────────── Ai đang gọi ─────────────────────────

-- km.call ghi tài khoản đang gọi vào đây cho tới hết giao dịch; các trigger đọc lại. NULL = không qua lớp API
-- (người quản trị database tự chạy lệnh SQL).
create or replace function km.actor()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('km.actor', true), '')::uuid;
$$;

create or replace function km.actor_is_manager()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select role = 'manager' from km.accounts where id = km.actor()), false);
$$;

create or replace function km.profile_json(a km.accounts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'email', a.email,
    'fullName', a.full_name,
    'phone', a.phone,
    'role', a.role,
    'createdAt', a.created_at
  );
$$;

create or replace function km.require_member(me km.accounts)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if me.role is null or me.role not in ('sale', 'manager') then
    raise exception 'Tài khoản của bạn chưa được duyệt hoặc đã bị khóa.' using errcode = 'KM403';
  end if;
end;
$$;

create or replace function km.require_manager(me km.accounts, what text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if me.role is distinct from 'manager' then
    raise exception 'Chỉ người quản lý mới %.', what using errcode = 'KM403';
  end if;
end;
$$;

-- ───────────────────────── Ghi chương trình / tồn kho / thiết lập ─────────────────────────

create or replace function km.touch_doc()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.rev := old.rev + 1;
  else
    new.rev := 1;
  end if;
  new.updated_at := now();
  new.updated_by := km.actor();
  return new;
end;
$$;

drop trigger if exists programs_touch on km.programs;
create trigger programs_touch
  before insert or update on km.programs
  for each row execute function km.touch_doc();

drop trigger if exists app_state_touch on km.app_state;
create trigger app_state_touch
  before insert or update on km.app_state
  for each row execute function km.touch_doc();

-- Không xóa chương trình khi còn đơn hàng thuộc về nó (kể cả đơn của sale mà máy đang xóa chưa kịp thấy).
create or replace function km.programs_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_count integer;
begin
  -- Chờ các đơn đang được ghi dở vào một chương trình (orders_before_write giữ khóa này ở chế độ dùng chung) rồi mới đếm,
  -- để một đơn được tạo đúng lúc đang xóa không lọt qua và thành đơn của chương trình không còn tồn tại.
  perform pg_advisory_xact_lock(hashtext('km.program_orders'));
  select count(*) into order_count from km.orders where program_id = old.id;
  if order_count > 0 then
    raise exception 'Không xóa được: còn % đơn hàng thuộc chương trình này.', order_count using errcode = 'KM422';
  end if;
  return old;
end;
$$;

drop trigger if exists programs_before_delete on km.programs;
create trigger programs_before_delete
  before delete on km.programs
  for each row execute function km.programs_before_delete();

-- ───────────────────────── Ghi đơn hàng ─────────────────────────

-- Đơn mới: gắn với tài khoản tạo ra nó và được cấp mã DHyymmdd-NNN (số thứ tự trong ngày, dùng chung cho mọi sale).
-- Đơn sửa: giữ nguyên mã, chủ đơn và ngày tạo.
-- Đơn mới (hoặc đơn chuyển sang chương trình khác) phải thuộc một chương trình đang có trên máy chủ.
create or replace function km.orders_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := km.actor();
  today date;
  prefix text;
  seq integer;
  new_code text;
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
    new.created_at := now();
    -- Ai tạo đơn qua ứng dụng thì là chủ đơn đó.
    if uid is not null then
      new.owner_id := uid;
    end if;
    -- Mã đơn do máy chủ cấp. Chỉ quản lý được gửi kèm mã có sẵn (khi đưa đơn cũ từ máy mình lên); mã sale gửi lên bị thay.
    if coalesce(btrim(new.data ->> 'code'), '') = '' or (uid is not null and not km.actor_is_manager()) then
      today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
      prefix := 'DH' || to_char(today, 'YYMMDD') || '-';
      -- Mỗi lúc chỉ một giao dịch được cấp số, để hai sale tạo đơn cùng lúc không trùng mã.
      perform pg_advisory_xact_lock(hashtext('km.order_code'));
      -- Số kế tiếp chỉ tính từ bộ đếm của ngày, không tính từ «mã lớn nhất đang có»: một đơn gửi lên kèm mã tự đặt
      -- (vd «DH261121-999999999», hoặc mã của một ngày sắp tới) không đẩy được cả dãy số của mọi người.
      insert into km.order_counters as c (day, last)
      values (today, 1)
      on conflict (day) do update set last = c.last + 1
      returning c.last into seq;
      -- Số nào đã có đơn mang mã đó rồi (đơn cũ đưa lên kèm mã) thì bỏ qua, lấy số sau.
      loop
        -- Từ đơn thứ 1000 trong ngày mã dài thêm một chữ số (lpad(…, 3) sẽ cắt «1000» thành «100» và làm trùng mã).
        new_code := prefix || case when seq < 1000 then lpad(seq::text, 3, '0') else seq::text end;
        exit when not exists (select 1 from km.orders o where o.code = new_code);
        seq := seq + 1;
      end loop;
      update km.order_counters c set last = seq where c.day = today and c.last < seq;
      new.data := jsonb_set(new.data, '{code}', to_jsonb(new_code));
    end if;
  else
    new.rev := old.rev + 1;
    new.created_at := old.created_at;
    -- Qua ứng dụng thì không ai đổi được chủ đơn. Không có người gọi (uid null) là người quản trị database tự làm, hoặc
    -- khóa ngoại đặt owner_id về NULL khi một tài khoản bị xóa — phải để nguyên.
    if uid is not null then
      new.owner_id := old.owner_id;
    end if;
    if old.data ? 'code' then
      new.data := jsonb_set(new.data, '{code}', old.data -> 'code');
    end if;
  end if;
  -- Đơn bắt đầu thuộc về một chương trình (đơn mới, hoặc đơn chuyển sang chương trình khác): giữ khóa dùng chung tới hết
  -- giao dịch, để việc xóa chương trình (programs_before_delete) phải chờ đơn này ghi xong rồi mới đếm.
  if tg_op = 'INSERT' or (new.data ->> 'programId') is distinct from (old.data ->> 'programId') then
    perform pg_advisory_xact_lock_shared(hashtext('km.program_orders'));
    -- Chiều ngược lại: có khóa rồi mới xem chương trình có trên máy chủ không. Nếu một lệnh xóa vừa xong ngay trước đó (đơn
    -- này đã phải đứng chờ nó) mà vẫn ghi tiếp thì thành đơn của một chương trình không còn tồn tại.
    -- Chỉ xét yêu cầu đi qua ứng dụng; người quản trị database tự chạy SQL (vd khôi phục dữ liệu cũ) thì không bị chặn.
    if uid is not null
       and (new.data ->> 'programId') is not null
       and not exists (select 1 from km.programs p where p.id = new.data ->> 'programId') then
      raise exception 'Chương trình của đơn này không có trên máy chủ: có thể vừa bị xóa, hoặc chưa kịp lưu lên. Hãy thử lại sau giây lát.'
        using errcode = 'KM422';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_before_write on km.orders;
create trigger orders_before_write
  before insert or update on km.orders
  for each row execute function km.orders_before_write();

-- ───────────────────────── Đăng ký, đăng nhập ─────────────────────────

-- Đăng ký: tạo tài khoản và phiên đăng nhập đầu tiên của nó. Tài khoản đầu tiên của hệ thống là Quản lý.
create or replace function km.sign_up(
  p_email text,
  p_password_hash text,
  p_full_name text,
  p_phone text,
  p_token_hash bytea,
  p_ip text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ip text := coalesce(nullif(btrim(p_ip), ''), '?');
  v_first boolean;
  v_account km.accounts;
begin
  if coalesce(p_password_hash, '') = '' or p_token_hash is null then
    raise exception 'Yêu cầu đăng ký thiếu thông tin.' using errcode = 'KM400';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email không hợp lệ. Hãy kiểm tra lại (ví dụ: ten@gmail.com).' using errcode = 'KM422';
  end if;
  -- Khóa để hai người đăng ký cùng lúc không cùng thành «tài khoản đầu tiên». Có khóa rồi mới đếm số lượt đăng ký: đếm
  -- trước thì nhiều lượt gửi cùng một lúc đều thấy «chưa tới giới hạn» và cùng lọt qua.
  perform pg_advisory_xact_lock(hashtext('km.first_account'));
  if (select count(*) from km.auth_events e where e.kind = 'signup' and e.key = v_ip and e.at > now() - interval '1 hour') >= 20 then
    raise exception 'Có quá nhiều lượt đăng ký từ mạng này. Hãy thử lại sau một giờ.' using errcode = 'KM429';
  end if;
  v_first := not exists (select 1 from km.accounts);
  begin
    insert into km.accounts (email, password_hash, full_name, phone, role)
    values (
      v_email,
      p_password_hash,
      left(btrim(coalesce(p_full_name, '')), 120),
      left(btrim(coalesce(p_phone, '')), 40),
      case when v_first then 'manager' else 'pending' end
    )
    returning * into v_account;
  exception when unique_violation then
    raise exception 'Email này đã được đăng ký. Hãy đăng nhập; nếu quên mật khẩu, nhờ người quản lý đặt lại.' using errcode = 'KM409';
  end;
  insert into km.auth_events (kind, key) values ('signup', v_ip);
  insert into km.sessions (token_hash, account_id, expires_at) values (p_token_hash, v_account.id, now() + interval '30 days');
  return km.profile_json(v_account);
end;
$$;

-- Kiểm tra trước khi đăng ký, để lớp API khỏi tốn công băm mật khẩu cho một yêu cầu chắc chắn bị từ chối:
-- email sai dạng, quá nhiều lượt từ cùng địa chỉ mạng, hoặc email đã có tài khoản. Lượt trùng email được ghi lại
-- ('signup_fail', lớp API trả 409) và tính chung vào giới hạn 20 lượt mỗi giờ, để không ai dò hàng loạt xem email nào đã đăng ký.
-- km.sign_up vẫn tự kiểm tra lại tất cả dưới khóa (nhiều yêu cầu cùng lúc có thể cùng qua được bước này).
drop function if exists km.sign_up_check(text, text);
create or replace function km.sign_up_check(p_email text, p_ip text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ip text := coalesce(nullif(btrim(p_ip), ''), '?');
begin
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email không hợp lệ. Hãy kiểm tra lại (ví dụ: ten@gmail.com).' using errcode = 'KM422';
  end if;
  if (select count(*) from km.auth_events e
       where e.kind in ('signup', 'signup_fail') and e.key = v_ip and e.at > now() - interval '1 hour') >= 20 then
    raise exception 'Có quá nhiều lượt đăng ký từ mạng này. Hãy thử lại sau một giờ.' using errcode = 'KM429';
  end if;
  -- Trả về 'exists' thay vì báo lỗi: báo lỗi thì dòng ghi lượt trùng bị hủy theo.
  if exists (select 1 from km.accounts a where a.email = v_email) then
    insert into km.auth_events (kind, key) values ('signup_fail', v_ip);
    return 'exists';
  end if;
  return null;
end;
$$;

-- Đăng nhập, bước 1: lớp API lấy mã băm mật khẩu về để tự so (database không nhận mật khẩu gốc).
-- Trả về NULL nếu không có tài khoản nào dùng email này.
-- Lần thử được ghi vào nhật ký NGAY ở bước này, như một lần sai; bước 2 gỡ đi nếu mật khẩu đúng. Nếu đợi so xong mật khẩu
-- mới ghi thì hàng trăm lần thử gửi cùng một lúc đều qua được phép đếm trước khi lần sai đầu tiên kịp ghi lại.
create or replace function km.sign_in_begin(p_email text, p_ip text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ip text := coalesce(nullif(btrim(p_ip), ''), '?');
  v_account km.accounts;
begin
  -- Đếm rồi ghi phải liền một mạch cho từng email và từng địa chỉ mạng: giữ khóa tới hết giao dịch. Lúc nào cũng lấy khóa
  -- của email trước, của địa chỉ mạng sau, nên hai lần đăng nhập không bao giờ đứng chờ lẫn nhau.
  perform pg_advisory_xact_lock(hashtext('km.signin.email'), hashtext(v_email));
  perform pg_advisory_xact_lock(hashtext('km.signin.ip'), hashtext(v_ip));
  if (select count(*) from km.auth_events e where e.kind = 'signin_fail' and e.key = 'e:' || v_email and e.at > now() - interval '15 minutes') >= 10
     or (select count(*) from km.auth_events e where e.kind = 'signin_fail' and e.key = 'i:' || v_ip and e.at > now() - interval '15 minutes') >= 50 then
    raise exception 'Bạn thử quá nhiều lần. Hãy chờ 15 phút rồi thử lại.' using errcode = 'KM429';
  end if;
  insert into km.auth_events (kind, key) values ('signin_fail', 'e:' || v_email), ('signin_fail', 'i:' || v_ip);
  select * into v_account from km.accounts where email = v_email;
  if not found then
    return null;
  end if;
  return jsonb_build_object('id', v_account.id, 'hash', v_account.password_hash);
end;
$$;

-- Đăng nhập, bước 2: lớp API báo kết quả so mật khẩu. Đúng → mở phiên và trả về hồ sơ; sai → lần thử sai đã được ghi
-- ở bước 1, không phải làm gì thêm.
create or replace function km.sign_in_finish(p_account uuid, p_ok boolean, p_email text, p_ip text, p_token_hash bytea)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ip text := coalesce(nullif(btrim(p_ip), ''), '?');
  v_account km.accounts;
begin
  if coalesce(p_ok, false) and p_account is not null and p_token_hash is not null then
    select * into v_account from km.accounts where id = p_account;
  end if;
  if v_account.id is null then
    return null;
  end if;
  -- Đúng mật khẩu: xóa bộ đếm của email này, và gỡ một lượt của địa chỉ mạng này — lượt bước 1 vừa ghi trước cho chính
  -- lần đăng nhập này (các lần sai khác từ cùng địa chỉ vẫn tính). «skip locked»: hai người cùng mạng đăng nhập đúng
  -- cùng lúc thì mỗi người gỡ một dòng khác nhau.
  delete from km.auth_events where kind = 'signin_fail' and key = 'e:' || v_account.email;
  delete from km.auth_events
   where id = (select e.id from km.auth_events e
                where e.kind = 'signin_fail' and e.key = 'i:' || v_ip
                order by e.id desc
                limit 1
                for update skip locked);
  -- Dọn dẹp nhân tiện: nhật ký cũ và các phiên đã hết hạn.
  delete from km.auth_events where at < now() - interval '1 day';
  delete from km.sessions where expires_at < now();
  insert into km.sessions (token_hash, account_id, expires_at) values (p_token_hash, v_account.id, now() + interval '30 days');
  return km.profile_json(v_account);
end;
$$;

create or replace function km.sign_out(p_token_hash bytea)
returns void
language sql
set search_path = ''
as $$
  delete from km.sessions where token_hash = p_token_hash;
$$;

-- ───────────────────────── Hồ sơ của mình ─────────────────────────

create or replace function km.op_me_update(me km.accounts, args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result km.accounts;
begin
  update km.accounts
     set full_name = case when args ? 'fullName' then left(btrim(coalesce(args ->> 'fullName', '')), 120) else full_name end,
         phone = case when args ? 'phone' then left(btrim(coalesce(args ->> 'phone', '')), 40) else phone end,
         updated_at = now()
   where id = me.id
   returning * into result;
  return km.profile_json(result);
end;
$$;

-- Tự đổi mật khẩu: các phiên đăng nhập khác của tài khoản (máy khác, trình duyệt khác) bị đăng xuất.
create or replace function km.op_me_password(me km.accounts, args jsonb, p_token_hash bytea)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(args ->> 'passwordHash', '') = '' then
    raise exception 'Thiếu mật khẩu mới.' using errcode = 'KM400';
  end if;
  update km.accounts set password_hash = args ->> 'passwordHash', updated_at = now() where id = me.id;
  delete from km.sessions where account_id = me.id and token_hash <> p_token_hash;
  return 'true'::jsonb;
end;
$$;

-- ───────────────────────── Quản lý tài khoản (chỉ người quản lý) ─────────────────────────

create or replace function km.op_accounts_list(me km.accounts)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  perform km.require_manager(me, 'xem được danh sách tài khoản');
  return (select coalesce(jsonb_agg(km.profile_json(a) order by a.created_at, a.id), '[]'::jsonb) from km.accounts a);
end;
$$;

-- Duyệt / đổi vai trò / khóa một tài khoản khác. Không ai tự đổi vai trò của chính mình,
-- nên hệ thống không bao giờ rơi vào cảnh không còn quản lý nào.
create or replace function km.op_accounts_set_role(me km.accounts, args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_target uuid;
  v_role text := args ->> 'role';
  result km.accounts;
begin
  begin
    v_target := (args ->> 'id')::uuid;
  exception when others then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'KM404';
  end;
  -- Mỗi lúc chỉ một lần đổi vai trò. Nếu không, hai quản lý hạ quyền lẫn nhau cùng một lúc đều qua được bước kiểm tra
  -- (mỗi bên vẫn thấy mình còn là quản lý) và hệ thống hết quản lý. Lấy khóa xong mới đọc lại vai trò của người gọi.
  perform pg_advisory_xact_lock(hashtext('km.roles'));
  if not exists (select 1 from km.accounts where id = me.id and role = 'manager') then
    raise exception 'Chỉ người quản lý mới đổi được vai trò.' using errcode = 'KM403';
  end if;
  if v_role is null or v_role not in ('sale', 'manager', 'locked') then
    raise exception 'Vai trò không hợp lệ.' using errcode = 'KM422';
  end if;
  if v_target is null then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'KM404';
  end if;
  if v_target = me.id then
    raise exception 'Không tự đổi vai trò của chính mình. Hãy nhờ một quản lý khác.' using errcode = 'KM403';
  end if;
  update km.accounts set role = v_role, updated_at = now() where id = v_target returning * into result;
  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'KM404';
  end if;
  return km.profile_json(result);
end;
$$;

-- Đặt lại mật khẩu cho một tài khoản khác (hệ thống không gửi email khôi phục mật khẩu).
-- Mọi phiên đang mở của tài khoản đó bị đăng xuất ngay.
create or replace function km.op_accounts_set_password(me km.accounts, args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_target uuid;
  v_email text;
begin
  perform km.require_manager(me, 'đặt lại được mật khẩu');
  begin
    v_target := (args ->> 'id')::uuid;
  exception when others then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'KM404';
  end;
  if coalesce(args ->> 'passwordHash', '') = '' then
    raise exception 'Thiếu mật khẩu mới.' using errcode = 'KM400';
  end if;
  if v_target = me.id then
    raise exception 'Mật khẩu của chính mình thì đổi ở mục «Dữ liệu».' using errcode = 'KM403';
  end if;
  update km.accounts set password_hash = args ->> 'passwordHash', updated_at = now() where id = v_target returning email into v_email;
  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'KM404';
  end if;
  delete from km.sessions where account_id = v_target;
  delete from km.auth_events where kind = 'signin_fail' and key = 'e:' || v_email;
  return 'true'::jsonb;
end;
$$;

-- ───────────────────────── Đồng bộ dữ liệu ─────────────────────────

-- «Dấu vân tay» của những gì người gọi được thấy: với mỗi bảng, SHA-256 của chuỗi "id:rev,id:rev,…" (xếp theo id, thứ tự byte).
-- Trình duyệt tự tính chuỗi này từ dữ liệu nó đang giữ; hai bên bằng nhau nghĩa là không có gì mới để tải.
create or replace function km.fingerprints(me km.accounts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'programs', (select encode(sha256(convert_to(coalesce(string_agg(p.id || ':' || p.rev, ',' order by p.id), ''), 'UTF8')), 'hex') from km.programs p),
    'orders', (select encode(sha256(convert_to(coalesce(string_agg(o.id || ':' || o.rev, ',' order by o.id), ''), 'UTF8')), 'hex')
                 from km.orders o where me.role = 'manager' or o.owner_id = me.id),
    'app_state', (select encode(sha256(convert_to(coalesce(string_agg(s.key || ':' || s.rev, ',' order by s.key), ''), 'UTF8')), 'hex') from km.app_state s)
  );
$$;

-- Một lần hỏi định kỳ của trình duyệt: hồ sơ của mình (để biết ngay khi bị đổi vai trò / khóa), dấu vân tay dữ liệu,
-- và — với quản lý — số tài khoản đang chờ duyệt cùng một «dấu» đổi mỗi khi danh sách tài khoản có gì thay đổi.
create or replace function km.op_sync_poll(me km.accounts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'me', km.profile_json(me),
    'fingerprints', case when me.role in ('sale', 'manager') then km.fingerprints(me) end,
    'accounts', case when me.role = 'manager' then (
      select jsonb_build_object(
        'pending', count(*) filter (where a.role = 'pending'),
        'stamp', md5(coalesce(string_agg(a.id::text || ':' || extract(epoch from a.updated_at)::text, ',' order by a.id), ''))
      )
      from km.accounts a
    ) end
  );
$$;

-- Ba bảng tài liệu nhìn chung một kiểu: (bảng, id, rev, data, chủ). Các hàm đọc dưới đây dùng khung nhìn này.
create or replace view km.docs as
  select 'programs'::text as tbl, p.id, p.rev, p.data, null::uuid as owner_id from km.programs p
  union all
  select 'orders'::text, o.id, o.rev, o.data, o.owner_id from km.orders o
  union all
  select 'app_state'::text, s.key, s.rev, s.data, null::uuid from km.app_state s;

create or replace function km.sync_table(args jsonb)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_table text := args ->> 'table';
begin
  if v_table is null or v_table not in ('programs', 'orders', 'app_state') then
    raise exception 'Bảng không hợp lệ.' using errcode = 'KM400';
  end if;
  return v_table;
end;
$$;

-- id + rev của mọi dòng người gọi được thấy (sale: chương trình, tồn kho, thiết lập và đơn của chính mình).
create or replace function km.op_sync_heads(me km.accounts, args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_table text := km.sync_table(args);
begin
  perform km.require_member(me);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'rev', d.rev) order by d.id), '[]'::jsonb)
      from km.docs d
     where d.tbl = v_table
       and (d.tbl <> 'orders' or me.role = 'manager' or d.owner_id = me.id)
  );
end;
$$;

-- Tài liệu của các dòng người gọi được thấy: theo danh sách id, hoặc (không có danh sách) mọi dòng — từng trang, xếp theo id.
-- Trả về { rows: [{id, rev, data}], next }: «next» khác null nghĩa là còn nữa, hỏi tiếp với after = next (và cùng danh sách id).
create or replace function km.op_sync_load(me km.accounts, args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_table text := km.sync_table(args);
  v_ids text[];
  v_after text := args ->> 'after';
  v_limit integer := 200;
  -- Một trang không nặng quá chừng này (nơi chạy lớp API giới hạn mỗi câu trả lời 4,5 MB); trang nào cũng có ít nhất một dòng.
  v_budget constant bigint := 3000000;
  v_rows jsonb;
  v_kept integer;
  v_seen integer;
begin
  perform km.require_member(me);
  if jsonb_typeof(args -> 'ids') = 'array' then
    if jsonb_array_length(args -> 'ids') > 500 then
      raise exception 'Hỏi quá nhiều bản ghi trong một lần.' using errcode = 'KM400';
    end if;
    v_ids := array(select jsonb_array_elements_text(args -> 'ids'));
  elsif args ? 'ids' and jsonb_typeof(args -> 'ids') <> 'null' then
    raise exception 'Danh sách id không hợp lệ.' using errcode = 'KM400';
  end if;
  if jsonb_typeof(args -> 'limit') = 'number' then
    v_limit := least(greatest(trunc((args ->> 'limit')::numeric), 1), 500)::integer;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rev', s.rev, 'data', s.data) order by s.id) filter (where s.keep), '[]'::jsonb),
         count(*) filter (where s.keep),
         count(*)
    into v_rows, v_kept, v_seen
    from (
      select c.id, c.rev, c.data,
             -- Giữ dòng này nếu chưa quá số dòng của trang và tính CẢ nó thì trang vẫn chưa vượt dung lượng; riêng dòng đầu
             -- luôn được giữ (trang nào cũng phải có một dòng). Nếu chỉ xét các dòng đứng trước thì một tài liệu vài MB
             -- xếp sau gần 3 MB tài liệu khác sẽ đẩy cả trang vượt giới hạn 4,5 MB, và không máy nào tải nổi trang đó.
             (row_number() over (order by c.id) <= v_limit
               and (row_number() over (order by c.id) = 1
                    or sum(c.size) over (order by c.id rows between unbounded preceding and current row) <= v_budget)) as keep
        from (
          select d.id, d.rev, d.data, octet_length(d.data::text) as size
            from km.docs d
           where d.tbl = v_table
             and (d.tbl <> 'orders' or me.role = 'manager' or d.owner_id = me.id)
             and (v_ids is null or d.id = any(v_ids))
             and (v_after is null or d.id > v_after)
           order by d.id
           limit v_limit + 1
        ) c
    ) s;
  return jsonb_build_object(
    'rows', v_rows,
    'next', case when v_seen > v_kept then v_rows -> (v_kept - 1) -> 'id' else 'null'::jsonb end
  );
end;
$$;

create or replace function km.sync_doc(args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_data jsonb := args -> 'data';
begin
  if v_data is null or jsonb_typeof(v_data) <> 'object' then
    raise exception 'Dữ liệu gửi lên không hợp lệ.' using errcode = 'KM400';
  end if;
  return v_data;
end;
$$;

create or replace function km.sync_id(args jsonb)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id text := args ->> 'id';
begin
  if jsonb_typeof(args -> 'id') is distinct from 'string' or v_id = '' or length(v_id) > 200 then
    raise exception 'Mã bản ghi không hợp lệ.' using errcode = 'KM400';
  end if;
  return v_id;
end;
$$;

-- Thêm một chương trình (quản lý) hoặc một đơn hàng (thành viên; đơn thuộc về người thêm, mã đơn do máy chủ cấp).
create or replace function km.op_sync_insert(me km.accounts, args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_table text := km.sync_table(args);
  v_id text := km.sync_id(args);
  v_data jsonb := km.sync_doc(args);
  v_rev integer;
  v_code text;
begin
  perform km.require_member(me);
  if v_table = 'programs' then
    perform km.require_manager(me, 'tạo được chương trình');
    begin
      insert into km.programs (id, data) values (v_id, v_data) returning rev into v_rev;
    exception when unique_violation then
      raise exception 'Bản ghi này đã có trên máy chủ.' using errcode = 'KM409';
    end;
    return jsonb_build_object('id', v_id, 'rev', v_rev);
  elsif v_table = 'orders' then
    begin
      insert into km.orders (id, data) values (v_id, v_data) returning rev, code into v_rev, v_code;
    exception
      when unique_violation then
        raise exception 'Bản ghi này đã có trên máy chủ.' using errcode = 'KM409';
      when not_null_violation or check_violation then
        raise exception 'Đơn hàng thiếu thông tin bắt buộc (chương trình, trạng thái).' using errcode = 'KM422';
    end;
    return jsonb_build_object('id', v_id, 'rev', v_rev, 'code', v_code);
  end if;
  raise exception 'Không thêm được dòng vào bảng này.' using errcode = 'KM400';
end;
$$;

-- Sửa một dòng, chỉ khi rev trên máy chủ còn đúng bằng rev trình duyệt đang biết.
-- Trả về NULL nếu không sửa được dòng nào: người khác vừa sửa (rev đã khác), dòng không còn, hoặc đó là đơn của người khác.
create or replace function km.op_sync_update(me km.accounts, args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_table text := km.sync_table(args);
  v_id text := km.sync_id(args);
  v_data jsonb := km.sync_doc(args);
  v_rev integer;
  v_new integer;
begin
  perform km.require_member(me);
  if jsonb_typeof(args -> 'rev') is distinct from 'number' then
    raise exception 'Thiếu số lần ghi (rev).' using errcode = 'KM400';
  end if;
  -- rev phải là số nguyên: ép kiểu thẳng sẽ làm tròn (3.5 → 4) và có thể trúng nhầm đúng rev đang có trên máy chủ.
  if (args ->> 'rev')::numeric <> trunc((args ->> 'rev')::numeric) or (args ->> 'rev')::numeric not between 0 and 2147483647 then
    raise exception 'Số lần ghi (rev) không hợp lệ.' using errcode = 'KM400';
  end if;
  v_rev := (args ->> 'rev')::numeric::integer;
  if v_table = 'programs' then
    perform km.require_manager(me, 'sửa được chương trình');
    update km.programs set data = v_data where id = v_id and rev = v_rev returning rev into v_new;
  elsif v_table = 'orders' then
    begin
      update km.orders set data = v_data
       where id = v_id and rev = v_rev and (me.role = 'manager' or owner_id = me.id)
       returning rev into v_new;
    exception when not_null_violation or check_violation then
      raise exception 'Đơn hàng thiếu thông tin bắt buộc (chương trình, trạng thái).' using errcode = 'KM422';
    end;
  else
    perform km.require_manager(me, 'sửa được tồn kho và thiết lập chung');
    update km.app_state set data = v_data where key = v_id and rev = v_rev returning rev into v_new;
  end if;
  if v_new is null then
    return null;
  end if;
  return jsonb_build_object('id', v_id, 'rev', v_new);
end;
$$;

-- Xóa một chương trình (quản lý; không xóa được khi còn đơn) hoặc một đơn hàng (quản lý: mọi đơn; sale: đơn của mình).
-- Trả về false nếu không xóa được dòng nào (đã bị xóa từ trước, hoặc đó là đơn của người khác).
create or replace function km.op_sync_remove(me km.accounts, args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_table text := km.sync_table(args);
  v_id text := km.sync_id(args);
  v_found boolean;
begin
  perform km.require_member(me);
  if v_table = 'programs' then
    perform km.require_manager(me, 'xóa được chương trình');
    delete from km.programs where id = v_id;
    v_found := found;
  elsif v_table = 'orders' then
    delete from km.orders where id = v_id and (me.role = 'manager' or owner_id = me.id);
    v_found := found;
  else
    raise exception 'Không xóa được dòng của bảng này.' using errcode = 'KM400';
  end if;
  return to_jsonb(v_found);
end;
$$;

-- ───────────────────────── Cửa vào duy nhất cho mọi yêu cầu đã đăng nhập ─────────────────────────

create or replace function km.call(p_token_hash bytea, p_op text, p_args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  me km.accounts;
  args jsonb := coalesce(p_args, '{}'::jsonb);
begin
  select a.* into me
    from km.sessions s join km.accounts a on a.id = s.account_id
   where s.token_hash = p_token_hash and s.expires_at > now();
  if not found then
    raise exception 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' using errcode = 'KM401';
  end if;
  if jsonb_typeof(args) <> 'object' then
    raise exception 'Yêu cầu không hợp lệ.' using errcode = 'KM400';
  end if;
  -- Phiên còn dùng thì tự gia hạn (ghi nhiều nhất mỗi giờ một lần).
  update km.sessions set seen_at = now(), expires_at = now() + interval '30 days'
   where token_hash = p_token_hash and seen_at < now() - interval '1 hour';
  perform set_config('km.actor', me.id::text, true);

  case p_op
    when 'me' then return km.profile_json(me);
    when 'me.update' then return km.op_me_update(me, args);
    when 'me.password' then return km.op_me_password(me, args, p_token_hash);
    when 'accounts.list' then return km.op_accounts_list(me);
    when 'accounts.setRole' then return km.op_accounts_set_role(me, args);
    when 'accounts.setPassword' then return km.op_accounts_set_password(me, args);
    when 'sync.poll' then return km.op_sync_poll(me);
    when 'sync.heads' then return km.op_sync_heads(me, args);
    when 'sync.load' then return km.op_sync_load(me, args);
    when 'sync.insert' then return km.op_sync_insert(me, args);
    when 'sync.update' then return km.op_sync_update(me, args);
    when 'sync.remove' then return km.op_sync_remove(me, args);
    else
      raise exception 'Lệnh không hợp lệ.' using errcode = 'KM400';
  end case;
end;
$$;

-- Lớp API hỏi để biết database đã cài đúng phiên bản lược đồ chưa.
create or replace function km.health()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('schema', (select value from km.meta where key = 'schema_version'));
$$;

-- Phiên bản lược đồ: đổi mỗi khi file này thay đổi theo cách mà mã nguồn trông cậy vào (server/app.js ghi số nó cần ở
-- SCHEMA_VERSION; lệch nhau thì `npm run db:setup -- --check` và `npm run build` báo phải chạy lại db:setup).
--   2: giới hạn đăng nhập / đăng ký đếm đúng cả khi nhiều yêu cầu tới cùng lúc; đơn mới phải thuộc một chương trình đang có;
--      mỗi trang của sync.load không nặng quá 3 MB; rev gửi lên phải là số nguyên.
insert into km.meta (key, value) values ('schema_version', '3')
on conflict (key) do update set value = excluded.value;
