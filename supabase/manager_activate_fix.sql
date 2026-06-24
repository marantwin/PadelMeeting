-- ============================================================
-- Fix: il responsabile del circolo non riusciva ad attivare i giocatori
-- ("Errore: Not authorized")
--
-- Causa: la RPC pm_set_profile_status autorizzava solo gli ADMIN.
-- Soluzione: consentire anche al MANAGER di cambiare lo stato dei profili
-- del PROPRIO circolo (es. attivare un nuovo iscritto a PR 35).
--
-- Esegui in Supabase -> SQL Editor.
-- ============================================================

drop function if exists pm_set_profile_status(uuid, text);

create function pm_set_profile_status(profile_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_club text;
  target_club text;
begin
  select role, club into caller_role, caller_club from pm_profiles where id = auth.uid();
  select club into target_club from pm_profiles where id = profile_id;

  if caller_role = 'admin'
     or (caller_role = 'manager' and caller_club is not null and target_club = caller_club) then
    update pm_profiles
      set status = new_status,
          -- alla prima attivazione il PR parte da 35 (regola del regolamento)
          rating = case when new_status = 'active' then coalesce(rating, 35) else rating end
      where id = profile_id;
  else
    raise exception 'Not authorized';
  end if;
end;
$$;

grant execute on function pm_set_profile_status(uuid, text) to authenticated;
