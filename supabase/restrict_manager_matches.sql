-- ============================================================
-- Restringe l'accesso del responsabile alle partite del PROPRIO circolo.
--
-- Prima: "manager read all matches" / "manager update all matches"
-- permettevano a QUALSIASI manager di leggere/modificare le partite di
-- TUTTI i circoli. Ora un manager vede/approva solo le partite del suo club
-- (campo pm_matches.club). L'admin mantiene accesso completo.
-- I giocatori restano regolati dalle loro policy (partite proprie).
--
-- Esegui in Supabase -> SQL Editor.
-- ============================================================

drop policy if exists "manager read all matches"   on pm_matches;
drop policy if exists "manager update all matches"  on pm_matches;

-- Lettura: admin tutte, manager solo quelle del proprio circolo
create policy "manager read club matches" on pm_matches
for select
using (
  exists (
    select 1 from pm_profiles me
    where me.id = auth.uid()
      and ( me.role = 'admin'
            or (me.role = 'manager' and me.club = pm_matches.club) )
  )
);

-- Modifica: admin tutte, manager solo quelle del proprio circolo
create policy "manager update club matches" on pm_matches
for update
using (
  exists (
    select 1 from pm_profiles me
    where me.id = auth.uid()
      and ( me.role = 'admin'
            or (me.role = 'manager' and me.club = pm_matches.club) )
  )
);
