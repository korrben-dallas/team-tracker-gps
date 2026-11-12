-- Смоук-тест Team Tracker GPS: проверяет весь путь записи через публичный ключ (роль anon).
-- Ничего не сохраняет: транзакция завершается rollback.
--
-- Как запускать: Supabase → SQL Editor → New query → вставить ВЕСЬ файл → Run.
-- Ожидаемый результат — 9 строк, все со значениями true / 2 / id, кроме пункта 9 (true — аккаунт удалён).
-- Если какая-то строка вернула false или скрипт упал с ошибкой — смотрите номер пункта.

begin;

-- имитируем приложение, которое ходит в базу с публичным ключом
set local role anon;

create temp table _r (step text, result text) on commit drop;

-- тестовые данные: секрет длиной 64 символа (app.js генерирует 48-символьный hex, схема требует ≥32)
insert into _r select '1. профиль создан', public.save_profile(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
  'Тест', null, 0)::text;

insert into _r select '2. своя группа создана', public.create_group(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
  'Тестовая группа', 'проверка', null, 'mushroom', '{"widthM":7}'::jsonb);

insert into _r select '3. вступление во встроенную группу', public.join_group(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
  'mushroom')::text;

insert into _r select '4. точки отправлены', public.push_points(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
  '[{"track_id":"11111111-1111-4111-8111-111111111111","group_id":"mushroom","lat":55.75,"lon":37.61,"t":1794482000000},
    {"track_id":"11111111-1111-4111-8111-111111111111","group_id":"mushroom","lat":55.751,"lon":37.611,"t":1794482060000}]'::jsonb)::text;

insert into _r select '5. точки прочитаны', count(*)::text from public.pull_points('mushroom', 0, 0);

insert into _r select '6. метка отправлена', public.push_marks(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
  '[{"id":"22222222-2222-4222-8222-222222222222","group_id":"mushroom","lat":55.75,"lon":37.61,"t":1794482000000,
     "kind":"mushroom","text":"тест","photo":null,"deleted":false,"updated_at":1794482100000}]'::jsonb)::text;

insert into _r select '7. метка прочитана', count(*)::text from public.pull_marks('mushroom', 0);

insert into _r select '8. рейтинг посчитан', count(*)::text from public.group_ratings('mushroom');

insert into _r select '9. аккаунт удалён', public.delete_account(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00')::text;

select step, result from _r order by step;

rollback;
