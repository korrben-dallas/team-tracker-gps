-- Team Tracker GPS — схема базы для Supabase.
-- Откройте проект Supabase → SQL Editor → New query, вставьте ВЕСЬ файл и нажмите Run.
-- Скрипт можно запускать повторно (после каждого обновления приложения) — данные сохраняются.
--
-- Устройство:
--  * Данные разделены по группам. Три встроенные группы-профиля: mushroom (грибники),
--    search (волонтёры-поисковики), hike (пешие туристы). Остальные группы создают пользователи.
--  * Прямого доступа к таблицам у приложения нет. Всё чтение и запись — через функции ниже.
--    Запись проверяет секретный ключ аккаунта (хранится только в телефоне, в базе — его хеш),
--    поэтому менять и удалять свои треки, метки, группы может только их автор.

-- ===================== Таблицы =====================

create table if not exists public.users (
  id          uuid   primary key,
  nick        text   not null,
  photo       text,
  updated_at  bigint not null default 0
);
alter table public.users add column if not exists secret_hash text;

create table if not exists public.groups (
  id          text   primary key,              -- код группы (он же код приглашения)
  name        text   not null,
  description text,
  avatar      text,                             -- картинка data:image/... (до ~60 КБ)
  kind        text   not null default 'other',  -- mushroom | search | hike | other: набор видов меток
  owner_id    uuid,                             -- создатель; null — встроенная группа
  settings    jsonb  not null default '{}'::jsonb,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists public.members (
  group_id   text not null,
  user_id    uuid not null,
  joined_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (group_id, user_id)
);

create table if not exists public.points (
  id          bigserial primary key,
  user_id     uuid   not null,
  track_id    uuid   not null,
  lat         double precision not null,
  lon         double precision not null,
  t           bigint not null,          -- время точки, мс с 1970 (UTC)
  unique (track_id, t)
);
alter table public.points add column if not exists group_id text not null default 'mushroom';
create index if not exists points_group_id_idx on public.points (group_id, id);
create index if not exists points_t_idx on public.points (t);

create sequence if not exists public.marks_rev_seq;
create table if not exists public.marks (
  id          uuid   primary key,
  user_id     uuid   not null,
  lat         double precision not null,
  lon         double precision not null,
  t           bigint not null,
  kind        text   not null default 'mushroom',
  text        text,
  photo       text,
  deleted     boolean not null default false,
  updated_at  bigint not null default 0,
  rev         bigint not null default nextval('public.marks_rev_seq')
);
alter table public.marks add column if not exists group_id text not null default 'mushroom';
create index if not exists marks_group_rev_idx on public.marks (group_id, rev);

create or replace function public.marks_bump_rev() returns trigger language plpgsql as $$
begin
  new.rev := nextval('public.marks_rev_seq');
  return new;
end $$;
drop trigger if exists marks_rev on public.marks;
create trigger marks_rev before insert or update on public.marks
  for each row execute function public.marks_bump_rev();

create table if not exists public.reports (
  id          bigserial primary key,
  reporter_id uuid,
  target_user uuid,
  mark_id     uuid,
  reason      text,
  t           bigint not null default (extract(epoch from now()) * 1000)::bigint,
  resolved    boolean not null default false
);
alter table public.reports add column if not exists group_id text;

-- Встроенные группы-профили (настройки фиксированные)
insert into public.groups (id, name, description, kind, settings) values
  ('mushroom', 'Грибники', 'Общая карта грибников', 'mushroom',
   '{"widthM":7,"greenDays":3,"hideDays":3,"minAccuracy":30,"maxSpeed":7,"fadeOld":false}'),
  ('search', 'Волонтёры-поисковики', 'Общая карта поисковых отрядов', 'search',
   '{"widthM":30,"greenDays":1,"hideDays":14,"minAccuracy":20,"maxSpeed":7,"fadeOld":true}'),
  ('hike', 'Пешие туристы', 'Общая карта пеших туристов', 'hike',
   '{"widthM":5,"greenDays":30,"hideDays":90,"minAccuracy":20,"maxSpeed":9,"fadeOld":false}')
on conflict (id) do update set settings = excluded.settings, kind = excluded.kind;

-- ===================== Доступ =====================
-- Никакого прямого доступа к таблицам: только функции.
alter table public.users   enable row level security;
alter table public.groups  enable row level security;
alter table public.members enable row level security;
alter table public.points  enable row level security;
alter table public.marks   enable row level security;
alter table public.reports enable row level security;
revoke all on public.users, public.groups, public.members, public.points, public.marks, public.reports from anon, authenticated;
drop view if exists public.ratings;
drop function if exists public.claim_account(uuid, text);

-- ===================== Служебные функции (не доступны приложению) =====================

create or replace function public._hash(p_secret text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex') $$;

create or replace function public._auth(p_id uuid, p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = p_id and secret_hash = _hash(p_secret))
$$;

create or replace function public._group_exists(p_group text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from groups where id = p_group)
$$;

-- приводит настройки группы к допустимым значениям
create or replace function public._clean_settings(s jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'widthM',      least(greatest(coalesce((s->>'widthM')::numeric, 10), 2), 100),
    'greenDays',   least(greatest(coalesce((s->>'greenDays')::numeric, 7), 1), 90),
    'hideDays',    least(greatest(coalesce((s->>'hideDays')::numeric, 30), 1), 365),
    'minAccuracy', least(greatest(coalesce((s->>'minAccuracy')::numeric, 20), 5), 100),
    'maxSpeed',    least(greatest(coalesce((s->>'maxSpeed')::numeric, 7), 3), 150),
    'fadeOld',     coalesce((s->>'fadeOld')::boolean, false)
  )
$$;

-- ===================== Аккаунт =====================

-- Создать/обновить профиль. Первый вызов привязывает секрет к аккаунту.
create or replace function public.save_profile(p_id uuid, p_secret text, p_nick text, p_photo text, p_updated bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare h text;
begin
  if p_secret is null or char_length(p_secret) < 32 then return false; end if;
  if char_length(coalesce(p_nick, '')) not between 1 and 24 then return false; end if;
  if p_photo is not null and (p_photo not like 'data:image/%' or char_length(p_photo) > 60000) then return false; end if;
  select secret_hash into h from users where id = p_id;
  if not found then
    insert into users (id, nick, photo, updated_at, secret_hash) values (p_id, p_nick, p_photo, p_updated, _hash(p_secret));
    return true;
  end if;
  if h is not null and h <> _hash(p_secret) then return false; end if;
  update users set nick = p_nick, photo = p_photo, updated_at = greatest(updated_at, p_updated),
                   secret_hash = coalesce(secret_hash, _hash(p_secret))
   where id = p_id;
  return true;
end $$;

create or replace function public.delete_account(p_id uuid, p_secret text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not _auth(p_id, p_secret) then return false; end if;
  delete from points  where user_id = p_id;
  delete from marks   where user_id = p_id;
  delete from members where user_id = p_id;
  delete from reports where reporter_id = p_id;
  update groups set owner_id = null where owner_id = p_id;
  delete from users   where id = p_id;
  return true;
end $$;

-- ===================== Группы =====================

create or replace function public.get_group(p_group text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'name', name, 'description', description, 'avatar', avatar,
                            'kind', kind, 'owner_id', owner_id, 'settings', settings, 'updated_at', updated_at)
    from groups where id = p_group
$$;

create or replace function public.create_group(p_id uuid, p_secret text, p_name text, p_description text,
                                               p_avatar text, p_kind text, p_settings jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare gid text;
begin
  if not _auth(p_id, p_secret) then raise exception 'not authorized'; end if;
  if char_length(coalesce(p_name, '')) not between 1 and 40 then raise exception 'bad name'; end if;
  if char_length(coalesce(p_description, '')) > 500 then raise exception 'bad description'; end if;
  if p_avatar is not null and (p_avatar not like 'data:image/%' or char_length(p_avatar) > 80000) then raise exception 'bad avatar'; end if;
  if (select count(*) from groups where owner_id = p_id) >= 20 then raise exception 'too many groups'; end if;
  loop
    gid := substr(encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), 1, 10);
    exit when not exists (select 1 from groups where id = gid);
  end loop;
  insert into groups (id, name, description, avatar, kind, owner_id, settings)
  values (gid, p_name, p_description, p_avatar,
          case when p_kind in ('mushroom', 'search', 'hike') then p_kind else 'other' end,
          p_id, _clean_settings(p_settings));
  insert into members (group_id, user_id) values (gid, p_id) on conflict do nothing;
  return gid;
end $$;

create or replace function public.update_group(p_id uuid, p_secret text, p_group text, p_name text, p_description text,
                                               p_avatar text, p_kind text, p_settings jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _auth(p_id, p_secret) then return false; end if;
  if not exists (select 1 from groups where id = p_group and owner_id = p_id) then return false; end if;
  if char_length(coalesce(p_name, '')) not between 1 and 40 or char_length(coalesce(p_description, '')) > 500 then return false; end if;
  if p_avatar is not null and (p_avatar not like 'data:image/%' or char_length(p_avatar) > 80000) then return false; end if;
  update groups set name = p_name, description = p_description, avatar = p_avatar,
         kind = case when p_kind in ('mushroom', 'search', 'hike') then p_kind else 'other' end,
         settings = _clean_settings(p_settings),
         updated_at = (extract(epoch from now()) * 1000)::bigint
   where id = p_group;
  return true;
end $$;

create or replace function public.join_group(p_id uuid, p_secret text, p_group text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not _auth(p_id, p_secret) or not _group_exists(p_group) then return false; end if;
  insert into members (group_id, user_id) values (p_group, p_id) on conflict do nothing;
  return true;
end $$;

create or replace function public.leave_group(p_id uuid, p_secret text, p_group text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not _auth(p_id, p_secret) then return false; end if;
  delete from members where group_id = p_group and user_id = p_id;
  return true;
end $$;

create or replace function public.group_members(p_group text)
returns table (id uuid, nick text, photo text, updated_at bigint)
language sql stable security definer set search_path = public as $$
  select u.id, u.nick, u.photo, u.updated_at
    from users u
   where u.id in (select user_id from members where group_id = p_group)
$$;

-- ===================== Треки =====================

create or replace function public.push_points(p_id uuid, p_secret text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not _auth(p_id, p_secret) then raise exception 'not authorized'; end if;
  insert into points (user_id, track_id, group_id, lat, lon, t)
  select p_id, x.track_id, x.group_id, x.lat, x.lon, x.t
    from jsonb_to_recordset(p_rows) as x(track_id uuid, group_id text, lat double precision, lon double precision, t bigint)
   where x.lat between -90 and 90 and x.lon between -180 and 180
     and x.t between 1600000000000 and (extract(epoch from now()) * 1000 + 86400000)::bigint
     and _group_exists(x.group_id)
  on conflict (track_id, t) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.pull_points(p_group text, p_after bigint, p_min_t bigint)
returns table (id bigint, user_id uuid, track_id uuid, lat double precision, lon double precision, t bigint)
language sql stable security definer set search_path = public as $$
  select id, user_id, track_id, lat, lon, t from points
   where group_id = p_group and id > p_after and t > p_min_t
   order by id limit 1000
$$;

-- ===================== Метки =====================

create or replace function public.push_marks(p_id uuid, p_secret text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not _auth(p_id, p_secret) then raise exception 'not authorized'; end if;
  insert into marks (id, user_id, group_id, lat, lon, t, kind, text, photo, deleted, updated_at)
  select x.id, p_id, x.group_id, x.lat, x.lon, x.t, x.kind, x."text", x.photo, coalesce(x.deleted, false), x.updated_at
    from jsonb_to_recordset(p_rows) as x(id uuid, group_id text, lat double precision, lon double precision, t bigint,
                                         kind text, "text" text, photo text, deleted boolean, updated_at bigint)
   where x.lat between -90 and 90 and x.lon between -180 and 180 and char_length(x.kind) <= 20
     and (x."text" is null or char_length(x."text") <= 1000)
     and (x.photo is null or (x.photo like 'data:image/%' and char_length(x.photo) < 600000))
     and _group_exists(x.group_id)
  on conflict (id) do update
     set lat = excluded.lat, lon = excluded.lon, kind = excluded.kind, text = excluded.text,
         photo = excluded.photo, deleted = excluded.deleted, updated_at = excluded.updated_at
   where marks.user_id = excluded.user_id            -- менять можно только свои метки
     and excluded.updated_at >= marks.updated_at;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.pull_marks(p_group text, p_after bigint)
returns table (id uuid, user_id uuid, lat double precision, lon double precision, t bigint, kind text,
               text text, photo text, deleted boolean, updated_at bigint, rev bigint)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, m.lat, m.lon, m.t, m.kind, m.text, m.photo, m.deleted, m.updated_at, m.rev
    from marks m where m.group_id = p_group and m.rev > p_after
   order by m.rev limit 100
$$;

-- ===================== Рейтинг =====================
-- 1 балл за 1 км (только участки не быстрее порога скорости группы) + 1 балл за общую метку.
create or replace function public.group_ratings(p_group text)
returns table (user_id uuid, km double precision, marks integer)
language sql stable security definer set search_path = public as $$
  with lim as (
    select coalesce((settings->>'maxSpeed')::double precision, 7) / 3.6 as vmax from groups where id = p_group
  ), seg as (
    select user_id,
           t - lag(t) over w as dt,
           2 * 6371000 * asin(sqrt(
             power(sin(radians(lat - lag(lat) over w) / 2), 2) +
             cos(radians(lat)) * cos(radians(lag(lat) over w)) *
             power(sin(radians(lon - lag(lon) over w) / 2), 2))) as d
      from points where group_id = p_group
    window w as (partition by track_id order by t)
  ), km as (
    select seg.user_id, sum(d) / 1000.0 as km
      from seg, lim
     where dt > 0 and dt <= 600000 and d <= 300 and d <= lim.vmax * (dt / 1000.0)
     group by seg.user_id
  ), mk as (
    select m.user_id, count(*)::int as marks from marks m where m.group_id = p_group and not m.deleted group by m.user_id
  )
  select coalesce(km.user_id, mk.user_id), coalesce(km.km, 0)::double precision, coalesce(mk.marks, 0)
    from km full join mk on mk.user_id = km.user_id
$$;

-- ===================== Жалобы =====================

create or replace function public.push_reports(p_id uuid, p_secret text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not _auth(p_id, p_secret) then raise exception 'not authorized'; end if;
  insert into reports (reporter_id, target_user, mark_id, group_id, reason, t)
  select p_id, x.target_user, x.mark_id, x.group_id, left(coalesce(x.reason, ''), 500), coalesce(x.t, (extract(epoch from now()) * 1000)::bigint)
    from jsonb_to_recordset(p_rows) as x(target_user uuid, mark_id uuid, group_id text, reason text, t bigint)
   where x.target_user is not null or x.mark_id is not null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ===================== Права на функции =====================
do $$
declare f text;
begin
  -- служебные функции закрыты
  foreach f in array array['_hash(text)', '_auth(uuid,text)', '_group_exists(text)', '_clean_settings(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- функции для приложения
  foreach f in array array[
    'save_profile(uuid,text,text,text,bigint)', 'delete_account(uuid,text)',
    'get_group(text)', 'create_group(uuid,text,text,text,text,text,jsonb)',
    'update_group(uuid,text,text,text,text,text,text,jsonb)', 'join_group(uuid,text,text)',
    'leave_group(uuid,text,text)', 'group_members(text)',
    'push_points(uuid,text,jsonb)', 'pull_points(text,bigint,bigint)',
    'push_marks(uuid,text,jsonb)', 'pull_marks(text,bigint)',
    'group_ratings(text)', 'push_reports(uuid,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;

-- ===================== Модерация (выполнять вручную в SQL Editor) =====================
-- Новые жалобы:            select * from reports where not resolved order by t desc;
-- Скрыть метку:            update marks set deleted = true, photo = null, text = null where id = '...';
-- Сменить ник/фото:        update users set nick = 'Участник', photo = null where id = '...';
-- Удалить контент автора:  delete from points where user_id = '...'; delete from marks where user_id = '...';
-- Закрыть жалобу:          update reports set resolved = true where id = ...;
-- Список групп:            select id, name, owner_id, settings from groups order by created_at desc;
--
-- Необязательно, раз в сезон: удалить старые точки (у грибников они и так не показываются старше 3 дней)
-- delete from points where group_id = 'mushroom' and t < (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
