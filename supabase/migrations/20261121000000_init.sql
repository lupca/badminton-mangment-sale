-- Quản lý khuyến mãi — cơ sở dữ liệu trên máy chủ (Supabase / Postgres).
--
-- Cách dùng: mở Supabase → SQL Editor → dán toàn bộ file này → Run. Chạy lại nhiều lần cũng không sao.
--
-- Có gì trong này:
--   • profiles     mỗi tài khoản một dòng: họ tên, điện thoại, vai trò (pending / sale / manager / locked)
--   • programs     chương trình khuyến mãi (cả chương trình là một tài liệu JSON)       — quản lý ghi, mọi thành viên đọc
--   • orders       đơn hàng (JSON), mỗi đơn thuộc về tài khoản tạo ra nó               — sale thấy đơn của mình, quản lý thấy hết
--   • app_state    hai dòng dùng chung: tồn kho và thiết lập (ngưỡng «sắp hết hàng»)   — quản lý ghi, mọi thành viên đọc
--   • quyền truy cập đặt bằng Row Level Security, nên trình duyệt có bị sửa mã cũng không vượt quyền được.
--
-- Tài khoản đăng ký ĐẦU TIÊN tự động là Quản lý; các tài khoản sau ở trạng thái «chờ duyệt» cho tới khi một quản lý duyệt.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── Bảng ─────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null default '',
  full_name   text not null default '',
  phone       text not null default '',
  role        text not null default 'pending' check (role in ('pending', 'sale', 'manager', 'locked')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.programs (
  id          text primary key check (id <> ''),
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  -- Số lần ghi. Trình duyệt gửi kèm số nó đang biết khi sửa; lệch nghĩa là người khác vừa sửa → không ghi đè.
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create table if not exists public.orders (
  id          text primary key check (id <> ''),
  -- Tài khoản tạo đơn. Xóa tài khoản thì đơn vẫn còn (chỉ quản lý thấy).
  owner_id    uuid references auth.users (id) on delete set null,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  rev         integer not null default 1,
  program_id  text generated always as (data ->> 'programId') stored not null,
  code        text generated always as (data ->> 'code') stored not null,
  status      text generated always as (data ->> 'status') stored not null check (status in ('draft', 'confirmed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists orders_owner_idx on public.orders (owner_id);
create index if not exists orders_program_idx on public.orders (program_id);
create index if not exists orders_code_idx on public.orders (code text_pattern_ops);

create table if not exists public.app_state (
  key         text primary key check (key in ('stock', 'settings')),
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

insert into public.app_state (key, data) values
  ('stock', '{"bySku": {}, "updatedAt": null}'::jsonb),
  ('settings', '{"lowStockThreshold": 5}'::jsonb)
on conflict (key) do nothing;

-- Số thứ tự đơn trong ngày đã cấp, để mã đơn không lặp lại kể cả khi đơn bị xóa.
create table if not exists public.order_counters (
  day   date primary key,
  last  integer not null
);

-- ───────────────────────── Vai trò của người đang gọi ─────────────────────────

-- Thành viên = tài khoản đã được duyệt (sale hoặc quản lý).
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role in ('sale', 'manager') from public.profiles where id = (select auth.uid())), false);
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role = 'manager' from public.profiles where id = (select auth.uid())), false);
$$;

-- ───────────────────────── Hồ sơ tài khoản ─────────────────────────

-- Tạo dòng hồ sơ cho một tài khoản (nếu chưa có). Tài khoản đầu tiên của hệ thống là Quản lý.
create or replace function public.create_profile(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  account auth.users%rowtype;
  is_first boolean;
begin
  select * into account from auth.users where id = target;
  if not found then
    return;
  end if;
  -- Khóa để hai người đăng ký cùng lúc không cùng thành «tài khoản đầu tiên».
  perform pg_advisory_xact_lock(hashtext('kmdb.first_account'));
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    account.id,
    coalesce(account.email, ''),
    left(btrim(coalesce(account.raw_user_meta_data ->> 'full_name', '')), 120),
    left(btrim(coalesce(account.raw_user_meta_data ->> 'phone', '')), 40),
    case when is_first then 'manager' else 'pending' end
  )
  on conflict (id) do nothing;
end;
$$;

-- Chạy ngay khi có người đăng ký. Lỗi ở đây không được làm hỏng việc đăng ký: hồ sơ còn được tạo bù bằng ensure_profile().
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.create_profile(new.id);
  exception when others then
    raise warning 'kmdb: không tạo được hồ sơ cho tài khoản %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

do $$
begin
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
exception when others then
  raise notice 'kmdb: không gắn được trigger vào auth.users (%). Hồ sơ sẽ được tạo khi tài khoản đăng nhập lần đầu.', sqlerrm;
end;
$$;

-- Trình duyệt gọi sau khi đăng nhập: trả về hồ sơ của mình, tạo bù nếu chưa có (vd tài khoản tạo trước khi chạy file này).
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result public.profiles;
begin
  if uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '28000';
  end if;
  select * into result from public.profiles where id = uid;
  if not found then
    perform public.create_profile(uid);
    select * into result from public.profiles where id = uid;
  end if;
  return result;
end;
$$;

-- Sửa hồ sơ: gọn khoảng trắng, giới hạn độ dài, ghi thời điểm sửa.
create or replace function public.profiles_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := left(btrim(coalesce(new.full_name, '')), 120);
  new.phone := left(btrim(coalesce(new.phone, '')), 40);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- Người quản lý duyệt / đổi vai trò / khóa một tài khoản khác. Không ai tự đổi vai trò của chính mình,
-- nên hệ thống không bao giờ rơi vào cảnh không còn quản lý nào.
create or replace function public.admin_set_role(target uuid, new_role text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.profiles;
begin
  -- Mỗi lúc chỉ một lần đổi vai trò. Nếu không, hai quản lý hạ quyền lẫn nhau cùng một lúc đều qua được bước kiểm tra
  -- (mỗi bên vẫn thấy mình còn là quản lý) và hệ thống hết quản lý. Lấy khóa xong mới kiểm tra, nên bên đến sau thấy vai trò mới của mình.
  perform pg_advisory_xact_lock(hashtext('kmdb.roles'));
  if not public.is_manager() then
    raise exception 'Chỉ người quản lý mới đổi được vai trò.' using errcode = '42501';
  end if;
  if new_role is null or new_role not in ('sale', 'manager', 'locked') then
    raise exception 'Vai trò không hợp lệ.' using errcode = '22023';
  end if;
  if target = auth.uid() then
    raise exception 'Không tự đổi vai trò của chính mình. Hãy nhờ một quản lý khác.' using errcode = '42501';
  end if;
  update public.profiles set role = new_role where id = target returning * into result;
  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Người quản lý đặt lại mật khẩu cho một tài khoản (hệ thống không gửi email khôi phục mật khẩu).
create or replace function public.admin_set_password(target uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Chỉ người quản lý mới đặt lại được mật khẩu.' using errcode = '42501';
  end if;
  if new_password is null or length(new_password) < 6 then
    raise exception 'Mật khẩu phải có ít nhất 6 ký tự.' using errcode = '22023';
  end if;
  if length(new_password) > 72 then
    raise exception 'Mật khẩu dài tối đa 72 ký tự.' using errcode = '22023';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = target;
  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'P0002';
  end if;
  -- Đăng xuất các phiên đang mở của tài khoản đó (không làm được cũng không sao: mật khẩu cũ đã hết hiệu lực).
  begin
    delete from auth.sessions where user_id = target;
  exception when others then
    null;
  end;
end;
$$;

-- ───────────────────────── Ghi chương trình / tồn kho / thiết lập ─────────────────────────

create or replace function public.touch_doc()
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
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists programs_touch on public.programs;
create trigger programs_touch
  before insert or update on public.programs
  for each row execute function public.touch_doc();

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch
  before insert or update on public.app_state
  for each row execute function public.touch_doc();

-- Không xóa chương trình khi còn đơn hàng thuộc về nó (kể cả đơn của sale mà máy đang xóa chưa kịp thấy).
create or replace function public.programs_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_count integer;
begin
  -- Chờ các đơn đang được ghi dở vào một chương trình (orders_before_write giữ khóa này ở chế độ dùng chung) rồi mới đếm,
  -- để một đơn được tạo đúng lúc đang xóa không lọt qua và thành đơn của chương trình không còn tồn tại.
  perform pg_advisory_xact_lock(hashtext('kmdb.program_orders'));
  select count(*) into order_count from public.orders where program_id = old.id;
  if order_count > 0 then
    raise exception 'Không xóa được: còn % đơn hàng thuộc chương trình này.', order_count using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists programs_before_delete on public.programs;
create trigger programs_before_delete
  before delete on public.programs
  for each row execute function public.programs_before_delete();

-- ───────────────────────── Ghi đơn hàng ─────────────────────────

-- Đơn mới: gắn với tài khoản tạo ra nó và được cấp mã DHyymmdd-NNN (số thứ tự trong ngày, dùng chung cho mọi sale).
-- Đơn sửa: giữ nguyên mã, chủ đơn và ngày tạo.
create or replace function public.orders_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date;
  prefix text;
  seq integer;
  new_code text;
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
    new.created_at := now();
    -- Sale luôn là chủ đơn mình tạo. Quản lý mặc định cũng vậy.
    if uid is not null and (new.owner_id is null or not public.is_manager()) then
      new.owner_id := uid;
    end if;
    -- Mã đơn do máy chủ cấp. Chỉ quản lý mới được gửi kèm mã có sẵn (khi tải lên đơn cũ của một máy, vốn đã có mã);
    -- với tài khoản khác thì bỏ qua mã gửi lên. Không có người gọi (uid null: máy chủ / SQL Editor) thì giữ mã đã gửi.
    if coalesce(btrim(new.data ->> 'code'), '') = '' or (uid is not null and not public.is_manager()) then
      today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
      prefix := 'DH' || to_char(today, 'YYMMDD') || '-';
      -- Mỗi lúc chỉ một giao dịch được cấp số, để hai sale tạo đơn cùng lúc không trùng mã.
      perform pg_advisory_xact_lock(hashtext('kmdb.order_code'));
      -- Số kế tiếp chỉ tính từ bộ đếm của ngày, không tính từ «mã lớn nhất đang có»: một đơn được tải lên kèm mã có sẵn
      -- (vd «DH261121-999999999», hoặc mã của một ngày sắp tới) không đẩy được cả dãy số của mọi người.
      insert into public.order_counters as c (day, last)
      values (today, 1)
      on conflict (day) do update set last = c.last + 1
      returning c.last into seq;
      -- Số nào đã có đơn mang mã đó rồi (đơn gửi lên kèm mã) thì bỏ qua, lấy số sau.
      loop
        -- Từ đơn thứ 1000 trong ngày mã dài thêm một chữ số (lpad(…, 3) sẽ cắt «1000» thành «100» và làm trùng mã).
        new_code := prefix || case when seq < 1000 then lpad(seq::text, 3, '0') else seq::text end;
        exit when not exists (select 1 from public.orders o where o.code = new_code);
        seq := seq + 1;
      end loop;
      update public.order_counters c set last = seq where c.day = today and c.last < seq;
      new.data := jsonb_set(new.data, '{code}', to_jsonb(new_code));
    end if;
  else
    new.rev := old.rev + 1;
    new.created_at := old.created_at;
    -- Người dùng không phải quản lý không đổi được chủ đơn. Không có người gọi (uid null) là máy chủ tự làm — xóa một tài khoản
    -- thì khóa ngoại đặt owner_id về NULL, hoặc chủ dự án sửa trong SQL Editor — phải để nguyên: giữ lại giá trị cũ ở đây
    -- sẽ để owner_id trỏ vào một tài khoản không còn tồn tại.
    if uid is not null and not public.is_manager() then
      new.owner_id := old.owner_id;
    end if;
    if old.data ? 'code' then
      new.data := jsonb_set(new.data, '{code}', old.data -> 'code');
    end if;
  end if;
  -- Đơn bắt đầu thuộc về một chương trình (đơn mới, hoặc đơn chuyển sang chương trình khác): giữ khóa dùng chung tới hết
  -- giao dịch, để việc xóa chương trình (programs_before_delete) phải chờ đơn này ghi xong rồi mới đếm.
  if tg_op = 'INSERT' or (new.data ->> 'programId') is distinct from (old.data ->> 'programId') then
    perform pg_advisory_xact_lock_shared(hashtext('kmdb.program_orders'));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_before_write on public.orders;
create trigger orders_before_write
  before insert or update on public.orders
  for each row execute function public.orders_before_write();

-- ───────────────────────── Đồng bộ ─────────────────────────

-- Dấu vân tay của những gì người gọi được thấy: với mỗi bảng, SHA-256 của chuỗi "id:rev,id:rev,…" (xếp theo id, thứ tự byte).
-- Trình duyệt tự tính chuỗi này từ dữ liệu nó đang giữ; hai bên bằng nhau nghĩa là không có gì mới để tải.
-- Hàm chạy với quyền của người gọi (KHÔNG security definer), nên chỉ tính trên những dòng RLS cho người đó thấy.
create or replace function public.sync_fingerprint()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'programs', (select encode(sha256(convert_to(coalesce(string_agg(id || ':' || rev, ',' order by id collate "C"), ''), 'UTF8')), 'hex') from public.programs),
    'orders', (select encode(sha256(convert_to(coalesce(string_agg(id || ':' || rev, ',' order by id collate "C"), ''), 'UTF8')), 'hex') from public.orders),
    'app_state', (select encode(sha256(convert_to(coalesce(string_agg(key || ':' || rev, ',' order by key collate "C"), ''), 'UTF8')), 'hex') from public.app_state)
  );
$$;

-- ───────────────────────── Quyền truy cập (Row Level Security) ─────────────────────────

alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.orders enable row level security;
alter table public.app_state enable row level security;
alter table public.order_counters enable row level security;

-- Hồ sơ: ai cũng thấy hồ sơ của mình; quản lý thấy mọi hồ sơ. Tự sửa được họ tên và điện thoại của mình (không sửa được vai trò).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_manager()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Chương trình: thành viên đọc, quản lý ghi.
drop policy if exists programs_select on public.programs;
create policy programs_select on public.programs for select to authenticated
  using ((select public.is_member()));

drop policy if exists programs_insert on public.programs;
create policy programs_insert on public.programs for insert to authenticated
  with check ((select public.is_manager()));

drop policy if exists programs_update on public.programs;
create policy programs_update on public.programs for update to authenticated
  using ((select public.is_manager()))
  with check ((select public.is_manager()));

drop policy if exists programs_delete on public.programs;
create policy programs_delete on public.programs for delete to authenticated
  using ((select public.is_manager()));

-- Đơn hàng: quản lý thấy và sửa mọi đơn; sale chỉ thấy và sửa đơn của mình.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using ((select public.is_manager()) or ((select public.is_member()) and owner_id = (select auth.uid())));

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert to authenticated
  with check ((select public.is_manager()) or ((select public.is_member()) and owner_id = (select auth.uid())));

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update to authenticated
  using ((select public.is_manager()) or ((select public.is_member()) and owner_id = (select auth.uid())))
  with check ((select public.is_manager()) or ((select public.is_member()) and owner_id = (select auth.uid())));

drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders for delete to authenticated
  using ((select public.is_manager()) or ((select public.is_member()) and owner_id = (select auth.uid())));

-- Tồn kho và thiết lập dùng chung: thành viên đọc, quản lý ghi.
drop policy if exists app_state_select on public.app_state;
create policy app_state_select on public.app_state for select to authenticated
  using ((select public.is_member()));

drop policy if exists app_state_insert on public.app_state;
create policy app_state_insert on public.app_state for insert to authenticated
  with check ((select public.is_manager()));

drop policy if exists app_state_update on public.app_state;
create policy app_state_update on public.app_state for update to authenticated
  using ((select public.is_manager()))
  with check ((select public.is_manager()));

-- ───────────────────────── Quyền trên bảng và hàm ─────────────────────────
-- Người chưa đăng nhập (anon) không được gì. Người đã đăng nhập được đúng những thao tác dưới đây, rồi còn bị RLS lọc tiếp.
-- Quyền ghi cấp theo từng cột: trình duyệt chỉ gửi được đúng những gì ứng dụng gửi — thêm dòng với (id, data), sửa (data).
-- Các cột còn lại (rev, owner_id, created_at, updated_at, updated_by…) do trigger đặt; gửi kèm chúng, hoặc sửa id, là bị từ chối.

-- Thu hồi hết trước (kể cả quyền theo cột và quyền cả bảng của lần chạy trước) rồi mới cấp lại, nên chạy lại file vẫn ra đúng bộ quyền này.
revoke all on public.profiles, public.programs, public.orders, public.app_state, public.order_counters
  from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant select, delete on public.programs to authenticated;
grant insert (id, data), update (data) on public.programs to authenticated;
grant select, delete on public.orders to authenticated;
grant insert (id, data), update (data) on public.orders to authenticated;
grant select on public.app_state to authenticated;
grant insert (key, data), update (data) on public.app_state to authenticated;

grant select, insert, update, delete
  on public.profiles, public.programs, public.orders, public.app_state, public.order_counters
  to service_role;

revoke all on function
  public.is_member(),
  public.is_manager(),
  public.create_profile(uuid),
  public.ensure_profile(),
  public.admin_set_role(uuid, text),
  public.admin_set_password(uuid, text),
  public.sync_fingerprint()
  from public, anon, authenticated;

grant execute on function
  public.is_member(),
  public.is_manager(),
  public.ensure_profile(),
  public.admin_set_role(uuid, text),
  public.admin_set_password(uuid, text),
  public.sync_fingerprint()
  to authenticated;

-- ───────────────────────── Realtime ─────────────────────────
-- Để máy khác thấy thay đổi gần như ngay (không có cũng không sao: trình duyệt vẫn tự hỏi lại máy chủ định kỳ).

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles', 'programs', 'orders', 'app_state'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
exception when others then
  raise notice 'kmdb: chưa bật được Realtime (%). Hệ thống vẫn chạy, chỉ cập nhật chậm hơn vài chục giây.', sqlerrm;
end;
$$;
