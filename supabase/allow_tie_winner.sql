-- ============================================================
-- Permette il valore 'T' (pareggio/tie) nella colonna pm_matches.winner
--
-- Nuova regola: partita "abbreviata" (2 set conclusi 1-1, terzo set non
-- giocato/concluso per tempo) con game pari fra le due coppie viene
-- comunque registrata/validata, ma senza spostare la classifica.
-- Serve un terzo valore oltre ad 'A'/'B' per rappresentare questo esito.
--
-- Esegui in Supabase -> SQL Editor.
-- ============================================================

alter table pm_matches drop constraint if exists pm_matches_winner_check;
alter table pm_matches add constraint pm_matches_winner_check check (winner in ('A','B','T'));
