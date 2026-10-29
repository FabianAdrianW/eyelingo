-- Test RLS/RPC trybu nauczyciela na LOKALNYM Postgresie (NIE na produkcji: tworzy schemat auth i role).
-- Uruchom z katalogu repo: psql -v ON_ERROR_STOP=1 -f tests/tutor-mode.sql <pusta_lokalna_baza>
\set ON_ERROR_STOP on
create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;

create table public.profiles(user_id uuid primary key references auth.users, is_premium boolean not null default false, premium_until timestamptz, username varchar);
create table public.user_sets(id serial primary key, user_id uuid not null references auth.users, name varchar not null, created_at timestamptz default now(), is_public boolean default false, likes_count int default 0, source text, lang text);
create table public.user_set_cards(id serial primary key, set_id int not null references public.user_sets on delete cascade, word varchar not null, translation varchar not null, sort_order int not null default 0);
alter table public.user_sets enable row level security; alter table public.user_set_cards enable row level security;
create policy "Public sets are viewable by everyone" on public.user_sets for select using (is_public=true or auth.uid()=user_id);
create policy "user all user_sets" on public.user_sets for all using (auth.uid()=user_id);
create policy "Cards visible with public set" on public.user_set_cards for select using (exists(select 1 from user_sets where user_sets.id=user_set_cards.set_id and (user_sets.is_public=true or user_sets.user_id=auth.uid())));
create policy "user all user_set_cards" on public.user_set_cards for all using (set_id in (select id from user_sets where user_id=auth.uid()));
grant usage on schema public, auth, extensions to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

\i 20261021_tutor_mode.sql
grant select, insert, update, delete on all tables in schema public to authenticated;

-- A=nauczyciel PRO, B=nauczyciel FREE, C=uczen, D=obcy
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d');
insert into public.profiles values
 ('00000000-0000-0000-0000-00000000000a', true, null, 'Pani Ania'),
 ('00000000-0000-0000-0000-00000000000b', false, null, 'Free'),
 ('00000000-0000-0000-0000-00000000000c', false, null, 'Kasia'),
 ('00000000-0000-0000-0000-00000000000d', false, null, 'Obcy');
insert into public.user_sets(user_id,name,source) values ('00000000-0000-0000-0000-00000000000a','Zestaw dla Kasi','tutor');
insert into public.user_set_cards(set_id,word,translation) values (1,'dog','pies'),(1,'cat','kot');
insert into public.user_sets(user_id,name) values ('00000000-0000-0000-0000-00000000000d','Prywatny obcego');
insert into public.user_set_cards(set_id,word,translation) values (2,'secret','sekret');

create or replace function t(label text, ok boolean) returns void language plpgsql as $$ begin
  if ok then raise notice 'PASS  %', label; else raise exception 'FAIL  %', label; end if; end $$;
create or replace function expect_err(label text, q text, msg text) returns void language plpgsql as $$
begin
  begin execute q; raise exception 'FAIL  % (brak bledu)', label;
  exception when others then
    if sqlerrm like '%'||msg||'%' then raise notice 'PASS  % [%]', label, sqlerrm; else raise exception 'FAIL  % (inny blad: %)', label, sqlerrm; end if;
  end;
end $$;
grant execute on function t(text,boolean), expect_err(text,text,text) to authenticated;

-- ===== 1. nauczyciel FREE =====
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select expect_err('FREE: nie wygeneruje kodu', $q$select public.tutor_create_link_code()$q$, 'pro_required');
select expect_err('FREE: nie wylistuje uczniow', $q$select * from public.tutor_list_students()$q$, 'pro_required');

-- ===== 2. nauczyciel PRO: kod =====
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
create temp table kod as select public.tutor_create_link_code() as c;
grant all on kod to authenticated;
select t('kod ma 8 znakow z dozwolonego alfabetu', (select c ~ '^[A-HJ-NP-Z2-9]{8}$' from kod));
select t('klient nie czyta tutor_link_codes', (select count(*) from tutor_link_codes)=0);
select expect_err('klient nie moze sam wstawic powiazania (zgoda ucznia)', $q$insert into public.tutor_links(tutor_id,student_id) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000d')$q$, 'row-level security');
select t('PRO: brak uczniow przed polaczeniem', (select count(*) from tutor_list_students())=0);

-- ===== 3. obcy / uczen przed polaczeniem =====
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d';
select t('OBCY: nie widzi zestawu nauczyciela', (select count(*) from user_sets where id=1)=0);
select t('OBCY: nie widzi kart', (select count(*) from user_set_cards where set_id=1)=0);
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select t('UCZEN przed laczeniem: nie widzi zestawu', (select count(*) from user_sets where id=1)=0);
select t('zly kod 1', (select public.tutor_redeem_code('ZZZZZZZZ')->>'error')='invalid_code');
select t('zly kod 2', (select public.tutor_preview_code('AAAAAAAA')->>'error')='invalid_code');
select t('zly kod 3', (select public.tutor_redeem_code('BBBBBBBB')->>'error')='invalid_code');
select t('zly kod 4', (select public.tutor_redeem_code('CCCCCCCC')->>'error')='invalid_code');
select t('zly kod 5', (select public.tutor_redeem_code('DDDDDDDD')->>'error')='invalid_code');
select expect_err('limit: 6. proba zablokowana (nawet poprawny kod)', format('select public.tutor_redeem_code(%L)', (select c from kod)), 'too_many_attempts');
reset role; delete from tutor_redeem_attempts;

-- ===== 4. poprawny kod (mala litera + myslnik) =====
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select t('preview zwraca imie nauczyciela', (select public.tutor_preview_code(lower(substr((select c from kod),1,4)||'-'||substr((select c from kod),5)))->>'tutor_name')='Pani Ania');
create temp table lnk as select (public.tutor_redeem_code((select c from kod))->>'link_id')::uuid as id;
grant all on lnk to authenticated;
select t('redeem laczy konta', (select id is not null from lnk));
select t('kod jednorazowy: ponowne uzycie', (select public.tutor_redeem_code((select c from kod))->>'error')='invalid_code');
select t('UCZEN: widzi nauczyciela na liscie', (select tutor_name from tutor_my_tutors())='Pani Ania');

-- ===== 5. nauczyciel przypisuje zestaw =====
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select t('PRO: widzi ucznia z nazwa z profilu', (select student_name from tutor_list_students())='Kasia');
insert into public.tutor_link_sets select id,1 from lnk;
select t('PRO: przypisuje wlasny zestaw', (select count(*) from tutor_link_sets)=1);
select expect_err('PRO: NIE przypisze cudzego prywatnego zestawu', format('insert into public.tutor_link_sets values (%L,2)', (select id from lnk)), 'row-level security');
update tutor_links set label='Kasia z klasy 5' where id=(select id from lnk);
select t('PRO: moze nadac przydomek', (select label from tutor_list_students())='Kasia z klasy 5');

-- ===== 6. uczen widzi zywo =====
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select t('UCZEN: widzi zestaw nauczyciela', (select count(*) from user_sets where id=1)=1);
select t('UCZEN: widzi karty zestawu', (select count(*) from user_set_cards where set_id=1)=2);
select t('UCZEN: NIE widzi prywatnego zestawu obcego', (select count(*) from user_sets where id=2)=0);
do $$ declare n int; begin update public.user_set_cards set word='x' where set_id=1; get diagnostics n = row_count; perform t('UCZEN: update kart nauczyciela dotyka 0 wierszy', n=0); end $$;
do $$ declare n int; begin delete from public.user_sets where id=1; get diagnostics n = row_count; perform t('UCZEN: delete zestawu nauczyciela dotyka 0 wierszy', n=0); end $$;
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into user_set_cards(set_id,word,translation) values (1,'bird','ptak');
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select t('ZYWO: nowa karta nauczyciela od razu u ucznia', (select count(*) from user_set_cards where set_id=1)=3);

-- ===== 7. drugi kod: ten sam uczen =====
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
create temp table kod2 as select public.tutor_create_link_code() as c;
grant all on kod2 to authenticated;
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select t('ponowne laczenie z tym samym nauczycielem: already_linked', (select public.tutor_redeem_code((select c from kod2))->>'error')='already_linked');

-- ===== 8. wlasny kod nauczyciela =====
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select t('nauczyciel nie zuzyje wlasnego kodu', (select public.tutor_redeem_code((select c from kod2))->>'error')='invalid_code');

-- ===== 9. rozlaczenie =====
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d';
select expect_err('obcy nie rozlaczy cudzego powiazania', format('select public.tutor_unlink(%L)', (select id from lnk)), 'not_found');
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select public.tutor_unlink((select id from lnk));
select t('po rozlaczeniu uczen nie widzi zestawu', (select count(*) from user_sets where id=1)=0);

-- ===== 10. wygasniecie PRO =====
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
reset role; update profiles set premium_until = now() - interval '1 day' where user_id='00000000-0000-0000-0000-00000000000a';
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select expect_err('wygasle PRO: nie wygeneruje kodu', $q$select public.tutor_create_link_code()$q$, 'pro_required');
