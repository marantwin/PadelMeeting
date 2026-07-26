-- ============================================================
-- Estende pm_update_ratings per aggiornare anche la "striscia"
-- (vittorie/sconfitte consecutive), oggi mai scritta nel database.
--
-- Il client ora passa anche 'streak' per ogni giocatore in ratingsArr.
-- coalesce(...) mantiene il valore esistente se un chiamante non lo passasse.
--
-- Esegui in Supabase -> SQL Editor.
-- ============================================================

create or replace function pm_update_ratings(ratings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  for r in select * from jsonb_array_elements(ratings)
  loop
    update pm_profiles
      set rating = (r->>'rating')::numeric,
          games = (r->>'games')::int,
          streak = coalesce((r->>'streak')::int, streak)
      where id = (r->>'id')::uuid;
  end loop;
end;
$$;

grant execute on function pm_update_ratings(jsonb) to authenticated;
