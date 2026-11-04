-- Społeczność: zestawy filtrowane po języku ojczystym autora (tłumaczenia są w jego języku).
-- DO ZASTOSOWANIA (czeka na zgodę: zawiera DROP starej sygnatury funkcji).
drop function if exists public.community_sets(text,text,text,text,int,int);
create or replace function public.community_sets(
  p_q text default null, p_lang text default null, p_level text default null,
  p_sort text default 'popular', p_limit int default 30, p_offset int default 0, p_native text default null)
returns table (id integer, name text, lang text, level text, book text, description text,
  cards_count int, likes_count int, author text, published_at timestamptz, liked boolean, is_mine boolean)
language sql stable security definer set search_path = public as $$
  with me as (
    select coalesce(nullif(p_native,''), (select native_lang from profiles where user_id = auth.uid()), 'pl') as nat
  )
  select s.id, s.name::text, s.lang::text, s.level, s.book, s.description,
    (select count(*)::int from user_set_cards c where c.set_id = s.id),
    coalesce(s.likes_count, 0)::int,
    coalesce(nullif(trim(p.username), ''), 'Użytkownik')::text,
    s.published_at,
    exists (select 1 from set_likes l where l.set_id = s.id and l.user_id = auth.uid()),
    (s.user_id = auth.uid())
  from user_sets s
  left join profiles p on p.user_id = s.user_id
  cross join me
  where s.is_public and not s.hidden
    and coalesce(p.native_lang, 'pl') = me.nat
    and (s.lang is null or s.lang <> me.nat)
    and (p_lang is null or p_lang = '' or s.lang = p_lang)
    and (p_level is null or p_level = '' or s.level = p_level)
    and (p_q is null or p_q = '' or
         (coalesce(s.name,'') || ' ' || coalesce(s.book,'') || ' ' || coalesce(s.description,'')) ilike '%' || p_q || '%')
    and exists (select 1 from user_set_cards c where c.set_id = s.id)
  order by case when p_sort = 'new' then extract(epoch from coalesce(s.published_at, s.created_at)) else coalesce(s.likes_count,0) end desc,
           s.published_at desc nulls last
  limit least(greatest(p_limit, 1), 60) offset greatest(p_offset, 0);
$$;
revoke all on function public.community_sets(text,text,text,text,int,int,text) from public;
grant execute on function public.community_sets(text,text,text,text,int,int,text) to anon, authenticated;
