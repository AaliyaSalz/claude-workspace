-- Chat usage limits (issue #9)
--
-- Every Claude reply costs money, so /api/chat asks this function for
-- permission first. Counting happens in the database because Vercel runs many
-- short-lived copies of the server, and they would not share a counter in memory.
--
-- Run it once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again. To change a limit, edit the numbers in
-- consume_chat_quota() below and run the file again.

create table if not exists public.chat_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  day_requests integer not null default 0,
  minute timestamptz not null default date_trunc('minute', now()),
  minute_requests integer not null default 0,
  primary key (user_id, day)
);

-- App-wide totals. New guest accounts are free to create, so a per-person limit
-- alone could be dodged by signing in as a new guest again and again.
create table if not exists public.chat_usage_daily (
  day date primary key,
  total_requests integer not null default 0,
  guest_requests integer not null default 0
);

-- RLS with no policies, and no table access: only the function below can touch these.
alter table public.chat_usage enable row level security;
alter table public.chat_usage_daily enable row level security;
revoke all on public.chat_usage from anon, authenticated;
revoke all on public.chat_usage_daily from anon, authenticated;

create or replace function public.consume_chat_quota()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The limits. Guests get less because their accounts are free to create.
  guest_per_minute constant integer := 5;
  guest_per_day constant integer := 20;
  account_per_minute constant integer := 10;
  account_per_day constant integer := 100;
  all_guests_per_day constant integer := 150;
  everyone_per_day constant integer := 400;

  uid uuid := (select auth.uid());
  is_guest boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  today date := (now() at time zone 'utc')::date;
  this_minute timestamptz := date_trunc('minute', now());
  seconds_to_next_minute integer := greatest(1, ceil(extract(epoch from (this_minute + interval '1 minute' - now())))::integer);
  seconds_to_tomorrow integer := greatest(1, ceil(extract(epoch from ((today + 1)::timestamp - (now() at time zone 'utc'))))::integer);
  person public.chat_usage;
  app public.chat_usage_daily;
  used_this_minute integer;
begin
  if uid is null then
    raise exception 'Sign in to chat' using errcode = '42501';
  end if;

  insert into public.chat_usage_daily (day) values (today) on conflict do nothing;
  insert into public.chat_usage (user_id, day, minute) values (uid, today, this_minute) on conflict do nothing;

  -- Lock both rows so two requests at once can't both take the last slot.
  select * into app from public.chat_usage_daily where day = today for update;
  select * into person from public.chat_usage where user_id = uid and day = today for update;

  used_this_minute := case when person.minute = this_minute then person.minute_requests else 0 end;

  if used_this_minute >= case when is_guest then guest_per_minute else account_per_minute end then
    return jsonb_build_object('allowed', false, 'reason', 'minute', 'retry_after', seconds_to_next_minute);
  end if;
  if person.day_requests >= case when is_guest then guest_per_day else account_per_day end then
    return jsonb_build_object('allowed', false, 'reason', case when is_guest then 'guest_day' else 'day' end, 'retry_after', seconds_to_tomorrow);
  end if;
  if app.total_requests >= everyone_per_day or (is_guest and app.guest_requests >= all_guests_per_day) then
    return jsonb_build_object('allowed', false, 'reason', 'app_day', 'retry_after', seconds_to_tomorrow);
  end if;

  update public.chat_usage
  set day_requests = day_requests + 1, minute = this_minute, minute_requests = used_this_minute + 1
  where user_id = uid and day = today;

  update public.chat_usage_daily
  set total_requests = total_requests + 1,
      guest_requests = guest_requests + case when is_guest then 1 else 0 end
  where day = today;

  return jsonb_build_object('allowed', true);
end;
$$;

revoke execute on function public.consume_chat_quota() from public, anon;
grant execute on function public.consume_chat_quota() to authenticated;
