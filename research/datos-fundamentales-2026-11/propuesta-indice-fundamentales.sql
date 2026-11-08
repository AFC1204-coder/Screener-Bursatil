-- PROPUESTA — NO EJECUTADA. No hay tabla nueva: fundamental_snapshots ya
-- guarda los perfiles (57.295 filas, 2026-11-08). Lo único que aporta este
-- índice es acelerar «último perfil por símbolo» (DISTINCT ON … ORDER BY
-- updated_at DESC) que usan las lecturas y el barrido de refresco, hoy
-- cubierto solo por (owner_id, symbol, period_end DESC).
-- Aplicar en el Mini solo con permiso expreso del usuario.
CREATE INDEX CONCURRENTLY IF NOT EXISTS fundamental_snapshots_profile_latest_idx
  ON public.fundamental_snapshots (owner_id, symbol, updated_at DESC)
  WHERE period_type = 'profile';
