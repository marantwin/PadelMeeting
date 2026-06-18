-- ============================================================
-- Pulizia dati creati durante i test del 2026-06-18
-- Esegui in Supabase → SQL Editor (UNA TANTUM, dopo aver verificato il fix)
-- ============================================================

-- 1) Elimina la partita di test
delete from pm_matches
where id = '7d269c16-1904-431d-8c8f-8ad6901bfea5';

-- 2) Elimina l'invito di test
delete from pm_notifications
where data->>'invite_id' = 'abde6152-8bed-4f96-a7fb-032f080db0ad';

-- 3) Ripristina rating e games ai valori precedenti alla partita di test
--    (la partita aveva spostato: Luca/markkk +1.8, Marta/Antonello -1.8)
update pm_profiles set rating = 33.2, games = greatest(games - 1, 0)
  where id = 'f9fab9ab-7494-44f9-843c-5928bd8c0cd5'; -- Luca Nero
update pm_profiles set rating = 35,   games = greatest(games - 1, 0)
  where id = 'b1335d51-ab0d-451d-af3e-76391808f62e'; -- markkk verdeee
update pm_profiles set rating = 35,   games = greatest(games - 1, 0)
  where id = '256cdcc5-8017-4397-83f5-28d5282184ea'; -- Marta Martu
update pm_profiles set rating = 35,   games = greatest(games - 1, 0)
  where id = 'cd978468-971c-4dab-a569-9ea057e2e003'; -- Antonello Martuscelli
