-- Eyelingo — Tryb nauczyciela v2 (migracja addytywna)
-- Dwa istniejące konta łączą się kodem; jedno występuje jako nauczyciel (PRO).
-- Nowe: tutor_links, tutor_link_sets, tutor_link_codes, tutor_redeem_attempts
-- Istniejące tabele NIE są zmieniane — dochodzą tylko 2 policy SELECT (user_sets, user_set_cards).

create table if not exists public.tutor_links (
  id         uuid primary key default gen_random_uuid(),
  tutor_id   uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  label      text check (label is null or char_length(label) <= 80),   -- opcjonalny przydomek nadany przez nauczyciela
  created_at timestamptz not null default now(),
  check (tutor_id <> student_id),
  unique (tutor_id, student_id)
);
create index if not exists tutor_links_student_idx on public.tutor_links(student_id);

create table if not exists public.tutor_link_sets (
  link_id    uuid    not null references public.tutor_links(id) on delete cascade,
  set_id     integer not null references public.user_sets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (link_id, set_id)
);
create index if not exists tutor_link_sets_set_idx on public.tutor_link_sets(set_id);

create table if not exists public.tutor_link_codes (
  code       text primary key,
  tutor_id   uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists tutor_link_codes_tutor_idx on public.tutor_link_codes(tutor_id);

create table if not exists public.tutor_redeem_attempts (
  id      bigserial primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists tutor_redeem_attempts_idx on public.tutor_redeem_attempts(user_id, at);

alter table public.tutor_links           enable row level security;
alter table public.tutor_link_sets       enable row level security;
alter table public.tutor_link_codes      enable row level security;
alter table public.tutor_redeem_attempts enable row level security;
-- tutor_link_codes i tutor_redeem_attempts: brak policy = brak dostępu klientów; tylko RPC (security definer)
-- tutor_links: brak policy INSERT — powiązanie powstaje wyłącznie przez tutor_redeem_code (zgoda ucznia)

-- ───────────── Funkcje pomocnicze (security definer — bez rekurencji policy) ─────────────
create or replace function public.tutor_is_pro(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_premium and (premium_until is null or premium_until > now())
                   from public.profiles where user_id = p), false)
$$;

create or replace function public.tutor_owns_link(p_link uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.tutor_links l where l.id = p_link and l.tutor_id = auth.uid())
$$;

create or replace function public.tutor_owns_set(p_set integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_sets u where u.id = p_set and u.user_id = auth.uid())
$$;

create or replace function public.tutor_set_shared_with_me(p_set integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.tutor_link_sets ls
                join public.tutor_links l on l.id = ls.link_id
                where ls.set_id = p_set and l.student_id = auth.uid())
$$;

-- ───────────── Policy ─────────────
drop policy if exists tutor_links_tutor_select on public.tutor_links;
create policy tutor_links_tutor_select on public.tutor_links
  for select to authenticated using (tutor_id = auth.uid() and public.tutor_is_pro(auth.uid()));
drop policy if exists tutor_links_tutor_update on public.tutor_links;
create policy tutor_links_tutor_update on public.tutor_links
  for update to authenticated
  using (tutor_id = auth.uid() and public.tutor_is_pro(auth.uid()))
  with check (tutor_id = auth.uid() and public.tutor_is_pro(auth.uid()));
drop policy if exists tutor_links_student_select on public.tutor_links;
create policy tutor_links_student_select on public.tutor_links
  for select to authenticated using (student_id = auth.uid());

drop policy if exists tutor_link_sets_tutor on public.tutor_link_sets;
create policy tutor_link_sets_tutor on public.tutor_link_sets
  for all to authenticated
  using (public.tutor_owns_link(link_id) and public.tutor_is_pro(auth.uid()))
  with check (public.tutor_owns_link(link_id) and public.tutor_owns_set(set_id) and public.tutor_is_pro(auth.uid()));
drop policy if exists tutor_link_sets_student_select on public.tutor_link_sets;
create policy tutor_link_sets_student_select on public.tutor_link_sets
  for select to authenticated
  using (exists(select 1 from public.tutor_links l where l.id = link_id and l.student_id = auth.uid()));

drop policy if exists user_sets_tutor_shared_read on public.user_sets;
create policy user_sets_tutor_shared_read on public.user_sets
  for select to authenticated using (public.tutor_set_shared_with_me(id));
drop policy if exists user_set_cards_tutor_shared_read on public.user_set_cards;
create policy user_set_cards_tutor_shared_read on public.user_set_cards
  for select to authenticated using (public.tutor_set_shared_with_me(set_id));

-- ───────────── RPC ─────────────
-- Nauczyciel: nowy kod zaproszenia (8 znaków bez 0/O/1/I, ważny 24 h, jednorazowy, max 20 aktywnych)
create or replace function public.tutor_create_link_code() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text; v_bytes bytea; i int; v_try int := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.tutor_is_pro(auth.uid()) then raise exception 'pro_required'; end if;
  delete from public.tutor_link_codes where tutor_id = auth.uid() and (expires_at < now() or used_at is not null);
  if (select count(*) from public.tutor_link_codes where tutor_id = auth.uid()) >= 20 then
    raise exception 'too_many_codes';
  end if;
  loop
    v_bytes := gen_random_bytes(8); v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.tutor_link_codes(code, tutor_id, expires_at)
      values (v_code, auth.uid(), now() + interval '24 hours');
      return v_code;
    exception when unique_violation then
      v_try := v_try + 1; if v_try > 5 then raise; end if;
    end;
  end loop;
end $$;

-- Limit błędnych prób (5 / 10 min)
create or replace function public._tutor_check_attempts() returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.tutor_redeem_attempts
      where user_id = auth.uid() and at > now() - interval '10 minutes') >= 5 then
    raise exception 'too_many_attempts';
  end if;
end $$;

-- Uczeń: podgląd kodu przed potwierdzeniem (nie zużywa kodu)
create or replace function public.tutor_preview_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')); r record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform public._tutor_check_attempts();
  select c.code, c.tutor_id, coalesce(nullif(p.username,''), 'Nauczyciel') as tutor_name into r
    from public.tutor_link_codes c
    left join public.profiles p on p.user_id = c.tutor_id
   where c.code = v_code and c.used_at is null and c.expires_at > now() and c.tutor_id <> auth.uid();
  if not found then
    insert into public.tutor_redeem_attempts(user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'invalid_code');  -- zwrot zamiast wyjątku: wpis o próbie nie może się cofnąć
  end if;
  if exists(select 1 from public.tutor_links where tutor_id = r.tutor_id and student_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'already_linked');
  end if;
  return jsonb_build_object('ok', true, 'tutor_name', r.tutor_name);
end $$;

-- Uczeń: zużycie kodu = połączenie kont
create or replace function public.tutor_redeem_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')); r record; v_link uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform public._tutor_check_attempts();
  select c.code, c.tutor_id into r
    from public.tutor_link_codes c
   where c.code = v_code and c.used_at is null and c.expires_at > now() and c.tutor_id <> auth.uid()
   for update;
  if not found then
    insert into public.tutor_redeem_attempts(user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  insert into public.tutor_links(tutor_id, student_id) values (r.tutor_id, auth.uid())
    on conflict (tutor_id, student_id) do nothing returning id into v_link;
  if v_link is null then
    return jsonb_build_object('ok', false, 'error', 'already_linked');
  end if;
  update public.tutor_link_codes set used_at = now() where code = r.code;
  return jsonb_build_object('ok', true, 'link_id', v_link,
    'tutor_name', coalesce((select nullif(username,'') from public.profiles where user_id = r.tutor_id), 'Nauczyciel'));
end $$;

-- Nauczyciel: lista połączonych uczniów (nazwa z profilu ucznia lub przydomek)
create or replace function public.tutor_list_students()
returns table(link_id uuid, student_id uuid, label text, student_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.tutor_is_pro(auth.uid()) then raise exception 'pro_required'; end if;
  return query
    select l.id, l.student_id, l.label, coalesce(nullif(p.username,''), 'Uczeń')::text, l.created_at
      from public.tutor_links l left join public.profiles p on p.user_id = l.student_id
     where l.tutor_id = auth.uid() order by l.created_at desc;
end $$;

-- Uczeń: lista swoich nauczycieli
create or replace function public.tutor_my_tutors()
returns table(link_id uuid, tutor_id uuid, tutor_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select l.id, l.tutor_id, coalesce(nullif(p.username,''), 'Nauczyciel')::text, l.created_at
      from public.tutor_links l left join public.profiles p on p.user_id = l.tutor_id
     where l.student_id = auth.uid() order by l.created_at desc;
end $$;

-- Uczeń lub nauczyciel: rozłączenie (uczeń zachowuje własny postęp SRS)
create or replace function public.tutor_unlink(p_link uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.tutor_links where id = p_link and (tutor_id = auth.uid() or student_id = auth.uid());
  if not found then raise exception 'not_found'; end if;
end $$;

revoke all on function public.tutor_is_pro(uuid), public.tutor_owns_link(uuid), public.tutor_owns_set(integer),
  public.tutor_set_shared_with_me(integer), public.tutor_create_link_code(), public._tutor_check_attempts(),
  public.tutor_preview_code(text), public.tutor_redeem_code(text), public.tutor_list_students(),
  public.tutor_my_tutors(), public.tutor_unlink(uuid) from public, anon;
grant execute on function public.tutor_is_pro(uuid), public.tutor_owns_link(uuid), public.tutor_owns_set(integer),
  public.tutor_set_shared_with_me(integer), public.tutor_create_link_code(),
  public.tutor_preview_code(text), public.tutor_redeem_code(text), public.tutor_list_students(),
  public.tutor_my_tutors(), public.tutor_unlink(uuid) to authenticated;
