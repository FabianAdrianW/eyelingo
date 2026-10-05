-- user_signup zapisywany przez bazę przy każdym nowym koncie (niezależnie od sesji,
-- potwierdzenia maila i przekierowania na telefon). Bezpieczne do ponownego uruchomienia.

create or replace function public.eyl_track_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  s text  := case when m->>'signup_surface' in ('web','mobile','desktop') then m->>'signup_surface' else 'web' end;
begin
  begin
    insert into public.analytics_events (user_id, surface, event_name, props, ts)
    values (
      new.id, s, 'user_signup',
      jsonb_strip_nulls(jsonb_build_object(
        'surface',      s,
        'source',       'db_trigger',
        'utm_source',   left(nullif(m->>'utm_source',''), 80),
        'utm_medium',   left(nullif(m->>'utm_medium',''), 80),
        'utm_campaign', left(nullif(m->>'utm_campaign',''), 80),
        'referrer',     left(nullif(m->>'signup_referrer',''), 120),
        'landing',      left(nullif(m->>'signup_landing',''), 120)
      )),
      coalesce(new.created_at, now())
    );
  exception when others then
    -- analityka nigdy nie może zablokować rejestracji
    raise warning 'eyl_track_signup: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.eyl_track_signup() from public, anon, authenticated;

drop trigger if exists eyl_track_signup_trg on auth.users;
create trigger eyl_track_signup_trg
  after insert on auth.users
  for each row execute function public.eyl_track_signup();

-- Uzupełnienie wstecz: konta bez zdarzenia user_signup (data = data założenia konta)
insert into public.analytics_events (user_id, surface, event_name, props, ts)
select u.id, 'web', 'user_signup',
       jsonb_build_object('surface','web','source','backfill'),
       u.created_at
from auth.users u
where not exists (
  select 1 from public.analytics_events e
  where e.event_name = 'user_signup' and e.user_id = u.id
);
