-- scan_progress_patch: actualiza SOLO settings.progress + row_count de una
-- fila de `scans`, sin reescribir el resto de `settings`.
--
-- Contexto (docs/timeout-scan-universo-2026-08-09.md): el bucle de progreso
-- del escaneo interactivo (lib/serverScanRunner.js#runScanChunk) hacía, cada
-- ~1,5-3s mientras dura el eslabón, un PATCH REST a `scans` cuyo body era
-- `{...settings, progress: {...}}` — es decir, reescribía la columna
-- `settings` COMPLETA, incluida `settings.scanSymbols` (la lista de símbolos
-- del universo pedido, invariante desde que se crea el scan). Medido contra
-- un scan real de producción: settings completo pesaba 59.688 bytes, de los
-- cuales 44.575 bytes (75%) eran solo scanSymbols. Con un escaneo de "todo el
-- universo" (~10.000 símbolos) ese payload se retransmitía entero varias
-- veces por minuto durante toda la corrida.
--
-- PostgREST no soporta un merge parcial de una columna JSONB desde el body de
-- un PATCH (siempre reemplaza la columna completa) — por eso este merge tiene
-- que hacerse del lado de Postgres via jsonb_set. El cliente solo transmite
-- el objeto `progress` (unos pocos KB: cursor, contadores, estado, errores),
-- nunca `scanSymbols`.
--
-- Convención de la casa: SECURITY INVOKER + set search_path + revoke/grant a
-- service_role, igual que finalize_scan_results (schema.sql:302-356).
create or replace function public.scan_progress_patch(
  p_id uuid,
  p_owner_id text,
  p_progress jsonb,
  p_row_count integer default null
)
returns table(id uuid, row_count integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  update public.scans as s
  set settings = jsonb_set(coalesce(s.settings, '{}'::jsonb), '{progress}', coalesce(p_progress, '{}'::jsonb), true),
      row_count = coalesce(p_row_count, s.row_count),
      updated_at = now()
  where s.id = p_id
    and s.owner_id = p_owner_id
  returning s.id, s.row_count, s.updated_at;
end;
$$;

revoke all on function public.scan_progress_patch(uuid, text, jsonb, integer) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.scan_progress_patch(uuid, text, jsonb, integer) to service_role;
  end if;
end $$;
