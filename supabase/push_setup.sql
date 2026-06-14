-- ============================================================
-- Web Push — tabella subscriptions + RLS
-- Esegui in Supabase → SQL Editor
-- ============================================================

create table if not exists pm_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references pm_profiles(id) on delete cascade,
  endpoint     text not null unique,
  subscription jsonb not null,
  created_at   timestamptz default now()
);

create index if not exists pm_push_subscriptions_user_idx
  on pm_push_subscriptions(user_id);

alter table pm_push_subscriptions enable row level security;

-- Ogni utente gestisce solo le proprie subscription.
-- La Edge Function usa la service_role key e bypassa la RLS per leggere
-- le subscription dei giocatori da notificare.
drop policy if exists "own subs select" on pm_push_subscriptions;
drop policy if exists "own subs insert" on pm_push_subscriptions;
drop policy if exists "own subs update" on pm_push_subscriptions;
drop policy if exists "own subs delete" on pm_push_subscriptions;

create policy "own subs select" on pm_push_subscriptions
  for select using (auth.uid() = user_id);
create policy "own subs insert" on pm_push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "own subs update" on pm_push_subscriptions
  for update using (auth.uid() = user_id);
create policy "own subs delete" on pm_push_subscriptions
  for delete using (auth.uid() = user_id);
