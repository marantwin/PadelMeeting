-- ============================================================
-- Plancia admin "Tutte le partite": l'admin deve poter leggere TUTTI gli
-- inviti-partita (match_invite), non solo i propri.
--
-- Oggi la RLS di pm_notifications consente a ciascuno di leggere solo le
-- proprie notifiche o quelle di inviti che ha organizzato. Aggiungiamo una
-- policy (additiva) che consente all'admin di leggere tutte le notifiche.
-- Le partite REGISTRATE l'admin le legge gia (policy su pm_matches).
--
-- Esegui in Supabase -> SQL Editor.
-- ============================================================

drop policy if exists "admin read all notifications" on pm_notifications;

create policy "admin read all notifications" on pm_notifications
for select
using (
  exists (select 1 from pm_profiles where id = auth.uid() and role = 'admin')
);
