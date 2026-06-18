-- ============================================================
-- Fix visibilità inviti per gli invitati
-- Esegui in Supabase → SQL Editor
--
-- Problema: la RLS di pm_notifications permette a ogni utente di leggere
-- SOLO le proprie notifiche o quelle di inviti che ha organizzato lui.
-- Di conseguenza un invitato vede solo il proprio stato, non quello degli
-- altri 2 giocatori, e l'esito resta bloccato su "In attesa di risposta".
--
-- Soluzione: una funzione SECURITY DEFINER che bypassa la RLS in modo
-- controllato — restituisce le righe di un invito SOLO se chi chiama è
-- partecipante di quell'invito (organizzatore o uno degli invitati).
-- ============================================================

create or replace function pm_get_invites(p_invite_ids text[])
returns table(user_id uuid, data jsonb, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select n.user_id, n.data, n.created_at
  from pm_notifications n
  where n.type = 'match_invite'
    and n.data->>'invite_id' = any(p_invite_ids)
    and exists (
      -- il chiamante deve essere partecipante dello stesso invito
      select 1
      from pm_notifications m
      where m.type = 'match_invite'
        and m.data->>'invite_id' = n.data->>'invite_id'
        and ( m.user_id = auth.uid()
              or (m.data->>'organizer')::uuid = auth.uid() )
    );
$$;

grant execute on function pm_get_invites(text[]) to authenticated;
