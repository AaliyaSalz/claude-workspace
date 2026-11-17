-- Row-level security (issue #7)
--
-- Before this, the tables had no rules: the public Supabase key that ships to
-- every browser could read and change every conversation. After this:
--   * every conversation has an owner (the signed-in person who created it);
--   * conversation_members lists who may see each conversation; the owner is
--     added automatically, and opening a share link adds you;
--   * every table only lets members read or write their conversations.
--
-- Run it once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again.
--
-- Conversations created before this have no owner, so nobody can see them
-- any more (they were anonymous test chats).

-- 1. Who owns a conversation, and who sent a message ------------------------

alter table public.conversations
  add column if not exists owner_id uuid references auth.users (id) on delete cascade
  default auth.uid();

alter table public.messages
  add column if not exists user_id uuid references auth.users (id) on delete set null
  default auth.uid();

-- 2. Who may see a conversation -------------------------------------------------

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

-- The creator of a conversation becomes its first member.
create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null then
    insert into public.conversation_members (conversation_id, user_id)
    values (new.id, new.owner_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_add_owner on public.conversations;
create trigger conversations_add_owner
  after insert on public.conversations
  for each row execute function public.add_owner_as_member();

-- True when the signed-in person owns or has joined the conversation.
-- "security definer" lets the check read conversation_members without
-- tripping that table's own rules (which would loop forever).
create or replace function public.can_access_conversation(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv and c.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv and m.user_id = (select auth.uid())
  );
$$;

-- Opening a share link: look the conversation up by its token and add the
-- signed-in person as a member. This is the only way to join, so a token is
-- needed to see someone else's conversation.
create or replace function public.join_conversation(share text)
returns setof public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.conversations;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to open a shared conversation';
  end if;

  select * into conv from public.conversations where share_token = share;
  if not found then
    return;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (conv.id, (select auth.uid()))
  on conflict do nothing;

  return next conv;
end;
$$;

revoke execute on function public.can_access_conversation(uuid) from public, anon;
revoke execute on function public.join_conversation(text) from public, anon;
revoke execute on function public.add_owner_as_member() from public, anon, authenticated;
grant execute on function public.can_access_conversation(uuid) to authenticated;
grant execute on function public.join_conversation(text) to authenticated;

-- 3. Turn on row-level security ---------------------------------------------
-- With RLS on, a table returns nothing and accepts nothing unless a policy
-- below allows it. Guests are signed in too (anonymous sign-in), so every
-- policy is for the "authenticated" role; the public key alone sees nothing.

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.branches enable row level security;
alter table public.memories enable row level security;
alter table public.conversation_members enable row level security;

-- conversations
drop policy if exists "members read conversations" on public.conversations;
create policy "members read conversations" on public.conversations
  for select to authenticated
  using (public.can_access_conversation(id));

drop policy if exists "people create their own conversations" on public.conversations;
create policy "people create their own conversations" on public.conversations
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "members update conversations" on public.conversations;
create policy "members update conversations" on public.conversations
  for update to authenticated
  using (public.can_access_conversation(id))
  with check (public.can_access_conversation(id));

-- messages
drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated
  using (public.can_access_conversation(conversation_id));

drop policy if exists "members add messages as themselves" on public.messages;
create policy "members add messages as themselves" on public.messages
  for insert to authenticated
  with check (
    public.can_access_conversation(conversation_id)
    and user_id = (select auth.uid())
  );

drop policy if exists "members pin messages" on public.messages;
create policy "members pin messages" on public.messages
  for update to authenticated
  using (public.can_access_conversation(conversation_id))
  with check (public.can_access_conversation(conversation_id));

-- branches
drop policy if exists "members read branches" on public.branches;
create policy "members read branches" on public.branches
  for select to authenticated
  using (public.can_access_conversation(parent_conversation_id));

drop policy if exists "members create branches" on public.branches;
create policy "members create branches" on public.branches
  for insert to authenticated
  with check (public.can_access_conversation(parent_conversation_id));

-- memories
drop policy if exists "members read memories" on public.memories;
create policy "members read memories" on public.memories
  for select to authenticated
  using (public.can_access_conversation(conversation_id));

drop policy if exists "members add memories" on public.memories;
create policy "members add memories" on public.memories
  for insert to authenticated
  with check (public.can_access_conversation(conversation_id));

-- conversation_members: you can see which conversations you belong to.
-- Rows are only added by the trigger and join_conversation() above.
drop policy if exists "people read their memberships" on public.conversation_members;
create policy "people read their memberships" on public.conversation_members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 4. Column limits ------------------------------------------------------------
-- Policies decide which rows; grants decide which columns. Members may rename
-- a conversation or set its share link, and pin or unpin messages, but can't
-- rewrite anyone's message text or take over a conversation's ownership.

revoke update on public.conversations from anon, authenticated;
grant update (title, share_token) on public.conversations to authenticated;

revoke update on public.messages from anon, authenticated;
grant update (is_pinned) on public.messages to authenticated;
