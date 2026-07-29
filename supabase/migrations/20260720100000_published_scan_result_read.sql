-- Hito 1B-3: canonical DB-owned reader for an atomically published result set.
-- This reader deliberately has no legacy scan_results fallback.
--
-- RECONSTRUCCION AUDITADA (2026-07-22): esta es una reconstruccion razonada de
-- la version final auditada, perdida en una limpieza de /tmp. Se parte de la
-- version pre-correccion recuperada y se aplican las 5 correcciones de la
-- auditoria estatica. Las piezas de Hito 1B-2 referenciadas (manifiesto,
-- set-hash, CASE de estado derivado, estructura del receipt) se copiaron
-- VERBATIM del commit 3ab49df (rama codex/scan-integrity-result-sets,
-- supabase/migrations/20260719100000_scan_result_set_finalize_publish.sql),
-- no se asumieron.
--
-- DECISION DE DISENO (2026-07-23): el lector pasa de SECURITY INVOKER a
-- SECURITY DEFINER — el primero y unico de la base de codigo. Motivo: el
-- contrato absoluto de 1B-1/1B-2 (verificado por test) exige que los helpers
-- internos (canonical/sha256/identity_key/manifiesto/set-hash) NUNCA sean
-- ejecutables por service_role, y a la vez la aplicacion viva invoca este
-- lector con SUPABASE_SERVICE_ROLE_KEY. Con SECURITY INVOKER ambas cosas son
-- incompatibles: la ACL transitiva del lector exigiria EXECUTE de
-- service_role sobre los helpers. Con SECURITY DEFINER el cuerpo corre como
-- el owner de la funcion y service_role solo necesita EXECUTE sobre el lector
-- mismo. Esto ademas elimina el punto "-- AMBIGUO:" de la reconstruccion
-- (grants de tabla + politicas RLS para service_role): ya no aplica, ver el
-- bloque final de ACL.

create or replace function public.statsedge_published_result_read_fail_v1(p_code text)
returns boolean
language plpgsql
volatile
strict
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end;
$$;

create or replace function public.read_published_scan_result_set_v1(
  p_owner_id text,
  p_scan_id uuid,
  p_expected_result_set_id uuid,
  p_expected_set_hash text,
  p_after_work_index integer,
  p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with input as materialized (
    select nullif(btrim(p_owner_id), '') as owner_id,
           p_after_work_index as after_work_index,
           p_limit as page_limit
  ), input_guard as materialized (
    select case
      when input.owner_id is null
        or p_scan_id is null
        or p_after_work_index is null
        or p_after_work_index < -1
        or p_limit is null
        or p_limit < 1
        or p_limit > 500
        or (p_expected_result_set_id is null) is distinct from (p_expected_set_hash is null)
        or (p_expected_result_set_id is null and p_after_work_index <> -1)
      then public.statsedge_published_result_read_fail_v1('SE_INVALID_PUBLISHED_RESULT_READ_INPUT')
      else true
    end as ok
    from input
  ), scan_snapshot as materialized (
    select s.*
      from public.scans s
      cross join input_guard guard
      cross join input
     where guard.ok
       and s.id = p_scan_id
       and s.owner_id = input.owner_id
  ), publication_snapshot as materialized (
    select s.id as scan_id,
           s.owner_id,
           s.published_result_set_id,
           s.published_state,
           s.row_count as scan_row_count,
           s.published_at,
           s.published_updated_at,
           rs.id as result_set_id,
           rs.execution_id,
           rs.integrity_class,
           rs.state as result_set_state,
           rs.hash_version as result_set_hash_version,
           rs.expected_count,
           rs.ledger_count,
           rs.row_count as result_set_row_count,
           rs.set_hash,
           rs.sealed_at,
           rs.abandoned_at,
           e.state as execution_state,
           e.hash_version as execution_hash_version,
           e.policy_version as execution_policy_version,
           e.expected_count as execution_expected_count,
           e.lease_epoch as execution_lease_epoch,
           e.issued_lease_epoch,
           e.issued_lease_until,
           e.registered_count,
           e.persisted_count,
           e.completed_count,
           e.failed_count,
           e.cancelled_count,
           e.finalizing_at,
           e.finished_at,
           e.checkpoint
      from scan_snapshot s
      left join public.scan_result_sets rs
        on rs.id = s.published_result_set_id
       and rs.owner_id = s.owner_id
       and rs.scan_id = s.id
      left join public.scan_executions e
        on e.id = rs.execution_id
       and e.owner_id = rs.owner_id
       and e.scan_id = rs.scan_id
       and e.result_set_id = rs.id
  ), row_integrity as materialized (
    select publication.*,
           coalesce((
             select count(*)
               from public.scan_result_set_rows r
              where r.result_set_id = publication.result_set_id
           ), 0)::bigint as persisted_row_count,
           exists (
             select 1
               from public.scan_result_set_rows r
               left join public.scan_work_items w
                 on w.result_set_id = r.result_set_id
                and w.work_index = r.work_index
              where r.result_set_id = publication.result_set_id
                and (
                  r.owner_id is distinct from publication.owner_id
                  or r.scan_id is distinct from publication.scan_id
                  or r.hash_version is distinct from 'statsedge-pg-jsonb-sha256-v1'
                  or r.row_schema_version is distinct from 'statsedge-scan-result-row-v1'
                  or r.payload_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(r.payload)
                  or r.row_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(r.payload)
                  or r.identity_key is distinct from public.statsedge_execution_identity_key_v1(r.payload)
                  or w.result_set_id is null
                  or w.owner_id is distinct from r.owner_id
                  or w.scan_id is distinct from r.scan_id
                  or w.outcome is distinct from 'persisted'
                  or w.identity_key is distinct from r.identity_key
                  or w.row_hash is distinct from r.row_hash
                )
           ) as has_invalid_row
      from publication_snapshot publication
  ), ledger_integrity as materialized (
    -- Correccion 1: reconciliacion del ledger real dentro del mismo snapshot.
    -- Espejo de la reconciliacion fisica de finalize_scan_execution /
    -- statsedge_assert_terminal_replay_evidence_v1 (Hito 1B-2, commit 3ab49df).
    select ri.*,
           physical.physical_ledger_count,
           physical.physical_min_work_index,
           physical.physical_max_work_index,
           physical.physical_persisted_count,
           physical.physical_failed_count,
           physical.physical_cancelled_count,
           exists (
             select 1
               from public.scan_work_items w
               left join public.scan_result_set_rows r
                 on r.result_set_id = w.result_set_id
                and r.work_index = w.work_index
              where w.result_set_id = ri.result_set_id
                and (
                  w.owner_id is distinct from ri.owner_id
                  or w.scan_id is distinct from ri.scan_id
                  or w.outcome is null
                  or w.outcome not in ('persisted', 'excluded', 'failed', 'cancelled')
                  or w.written_lease_epoch is null
                  or w.written_lease_epoch < ri.issued_lease_epoch
                  or w.written_lease_epoch > ri.execution_lease_epoch
                  or w.payload_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(w.payload)
                  or w.identity_key is distinct from public.statsedge_execution_identity_key_v1(w.payload)
                  or (w.outcome = 'persisted' and r.result_set_id is null)
                  or (w.outcome is distinct from 'persisted' and r.result_set_id is not null)
                )
           ) as has_invalid_work_item
      from row_integrity ri
      cross join lateral (
        select count(*)::bigint as physical_ledger_count,
               min(w.work_index) as physical_min_work_index,
               max(w.work_index) as physical_max_work_index,
               (count(*) filter (where w.outcome = 'persisted'))::bigint as physical_persisted_count,
               (count(*) filter (where w.outcome = 'failed'))::bigint as physical_failed_count,
               (count(*) filter (where w.outcome = 'cancelled'))::bigint as physical_cancelled_count
          from public.scan_work_items w
         where w.result_set_id = ri.result_set_id
      ) physical
  ), manifest_reconstruction as materialized (
    -- Correccion 1: el manifiesto canonico se reconstruye desde ledger y filas
    -- fisicas y se recalcula el hash canonico de Hito 1B-2. Las formas
    -- jsonb_build_object y el orden por work_index son copia verbatim de
    -- finalize_scan_execution (commit 3ab49df); statsedge_finalization_manifest_v1
    -- y statsedge_finalization_set_hash_v1 son las funciones reales de 1B-2 y
    -- son strict, asi que cualquier linaje roto (columna null) produce hash
    -- null, que nunca iguala a set_hash: fail-closed.
    select li.*,
           case
             when li.result_set_id is not null then
               public.statsedge_finalization_set_hash_v1(
                 public.statsedge_finalization_manifest_v1(
                   li.owner_id,
                   li.scan_id,
                   li.execution_id,
                   li.result_set_id,
                   li.execution_policy_version,
                   li.execution_hash_version,
                   li.execution_expected_count::bigint,
                   li.physical_ledger_count,
                   coalesce((
                     select jsonb_agg(jsonb_build_object(
                       'work_index', w.work_index,
                       'identity_key', w.identity_key,
                       'payload', w.payload,
                       'payload_hash', w.payload_hash,
                       'outcome', w.outcome,
                       'row_hash', w.row_hash,
                       'error', w.error,
                       'written_lease_epoch', w.written_lease_epoch
                     ) order by w.work_index)
                       from public.scan_work_items w
                      where w.result_set_id = li.result_set_id
                   ), '[]'::jsonb),
                   coalesce((
                     select jsonb_agg(jsonb_build_object(
                       'work_index', r.work_index,
                       'identity_key', r.identity_key,
                       'payload', r.payload,
                       'payload_hash', r.payload_hash,
                       'row_hash', r.row_hash,
                       'hash_version', r.hash_version,
                       'row_schema_version', r.row_schema_version,
                       'owner_id', r.owner_id,
                       'scan_id', r.scan_id,
                       'result_set_id', r.result_set_id
                     ) order by r.work_index)
                       from public.scan_result_set_rows r
                      where r.result_set_id = li.result_set_id
                   ), '[]'::jsonb)
                 )
               )
             else null
           end as recomputed_set_hash
      from ledger_integrity li
  ), validated_publication as materialized (
    select mr.*,
           derived.derived_finalization_state,
           receipt_source.receipt,
           -- coalesce(..., false): cualquier condicion NULL (columna ausente,
           -- receipt no-objeto, caches rotas) degrada a invalido, nunca a un
           -- estado que "parece" valido ni a un salto silencioso de la rama
           -- de rechazo. Fail-closed.
           coalesce((
             mr.published_state is not distinct from 'published'
             and mr.result_set_id is not null
             and mr.integrity_class is not distinct from 'verified'
             and mr.result_set_state is not distinct from 'sealed'
             and mr.result_set_hash_version is not distinct from 'statsedge-pg-jsonb-sha256-v1'
             and mr.set_hash is not null
             and mr.sealed_at is not null
             and mr.abandoned_at is null
             and mr.execution_id is not null
             and mr.execution_state is not distinct from 'published'
             and mr.execution_hash_version is not distinct from 'statsedge-pg-jsonb-sha256-v1'
             -- Correccion 1: policy y linaje de lease del contrato 1B-2.
             and mr.execution_policy_version is not distinct from 'statsedge-scan-execution-v1'
             and mr.issued_lease_epoch is not null
             and mr.issued_lease_until is not null
             and mr.issued_lease_epoch >= 0
             and mr.execution_lease_epoch is not null
             and mr.issued_lease_epoch <= mr.execution_lease_epoch
             and mr.execution_expected_count is not distinct from mr.expected_count
             and mr.expected_count is not distinct from mr.ledger_count
             -- Correccion 1: el ledger fisico debe reconciliar con las caches.
             and mr.physical_ledger_count is not distinct from mr.expected_count
             and (mr.physical_ledger_count > 0 or mr.expected_count = 0)
             and (mr.physical_ledger_count = 0
               or (mr.physical_min_work_index = 0
                 and mr.physical_max_work_index = mr.expected_count - 1))
             and not mr.has_invalid_work_item
             -- Correccion 1: contadores cacheados contra contadores fisicos.
             and mr.registered_count is not distinct from mr.physical_ledger_count
             and mr.persisted_count is not distinct from mr.physical_persisted_count
             and mr.failed_count is not distinct from mr.physical_failed_count
             and mr.cancelled_count is not distinct from mr.physical_cancelled_count
             and mr.completed_count is not distinct from mr.physical_ledger_count - mr.physical_persisted_count
             and mr.persisted_row_count is not distinct from mr.physical_persisted_count
             and mr.result_set_row_count is not distinct from mr.persisted_count
             and mr.result_set_row_count is not distinct from mr.persisted_row_count
             and mr.scan_row_count is not distinct from mr.result_set_row_count
             -- Correccion 1: validacion criptografica del set_hash publicado
             -- contra el manifiesto reconstruido en este mismo snapshot.
             and mr.recomputed_set_hash is not null
             and mr.set_hash is not distinct from mr.recomputed_set_hash
             and mr.finalizing_at is not null
             and mr.finished_at is not null
             and mr.finalizing_at is not distinct from mr.finished_at
             and mr.sealed_at is not distinct from mr.finalizing_at
             and mr.published_at is not null
             and mr.published_updated_at is not null
             and mr.published_at is not distinct from mr.finalizing_at
             and mr.published_updated_at is not distinct from mr.finalizing_at
             -- Correccion 3: el estado no se acepta desde la cache; se deriva
             -- de los contadores fisicos y tanto finalization_state como
             -- receipt.state deben ser identicos al valor derivado.
             and derived.derived_finalization_state in ('complete', 'partial')
             and (mr.checkpoint ->> 'finalization_state') is not distinct from derived.derived_finalization_state
             and jsonb_typeof(receipt_source.receipt) is not distinct from 'object'
             and receipt_source.receipt ?& array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[]
             and not exists (
               select 1
                 from jsonb_object_keys(
                   case when jsonb_typeof(receipt_source.receipt) = 'object'
                     then receipt_source.receipt else '{}'::jsonb end
                 ) as receipt_key(key)
                where receipt_key.key <> all (array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[])
             )
             and receipt_source.receipt -> 'owner_id' is not distinct from to_jsonb(mr.owner_id)
             and receipt_source.receipt -> 'scan_id' is not distinct from to_jsonb(mr.scan_id)
             and receipt_source.receipt -> 'execution_id' is not distinct from to_jsonb(mr.execution_id)
             and receipt_source.receipt -> 'result_set_id' is not distinct from to_jsonb(mr.result_set_id)
             and receipt_source.receipt -> 'lease_epoch' is not distinct from to_jsonb(mr.execution_lease_epoch)
             and receipt_source.receipt -> 'state' is not distinct from to_jsonb(derived.derived_finalization_state)
             and receipt_source.receipt -> 'set_hash' is not distinct from to_jsonb(mr.recomputed_set_hash)
             and receipt_source.receipt -> 'expected_count' is not distinct from to_jsonb(mr.expected_count)
             and receipt_source.receipt -> 'ledger_count' is not distinct from to_jsonb(mr.physical_ledger_count)
             and receipt_source.receipt -> 'persisted_count' is not distinct from to_jsonb(mr.physical_persisted_count)
             and receipt_source.receipt -> 'failed_count' is not distinct from to_jsonb(mr.physical_failed_count)
             and receipt_source.receipt -> 'cancelled_count' is not distinct from to_jsonb(mr.physical_cancelled_count)
             and receipt_source.receipt -> 'row_count' is not distinct from to_jsonb(mr.persisted_row_count)
             and receipt_source.receipt -> 'replayed' is not distinct from 'false'::jsonb
             and not mr.has_invalid_row
           ), false) as is_valid
      from manifest_reconstruction mr
      cross join lateral (
        -- Correccion 3: CASE de estado derivado copiado VERBATIM de
        -- finalize_scan_execution y statsedge_assert_terminal_replay_evidence_v1
        -- (Hito 1B-2, commit 3ab49df). La secuencia citada por la auditoria
        -- ("cancelled, failed, complete, partial, failed") es literalmente
        -- correcta: "failed" aparece dos veces (ledger sin resultados y
        -- mayoria de fallos).
        select case
          when mr.physical_cancelled_count > 0 then 'cancelled'
          when mr.physical_persisted_count + mr.physical_failed_count = 0 then 'failed'
          when mr.physical_persisted_count > 0 and mr.physical_failed_count = 0 then 'complete'
          when mr.physical_failed_count > 0 and mr.physical_persisted_count >= mr.physical_failed_count then 'partial'
          else 'failed'
        end as derived_finalization_state
      ) derived
      cross join lateral (
        select mr.checkpoint -> 'finalization_receipt' as receipt
      ) receipt_source
  ), page_rows as materialized (
    select r.work_index,
           r.identity_key,
           r.row_hash,
           r.payload,
           row_number() over (order by r.work_index asc) as page_position
      from validated_publication publication
      cross join input
      join public.scan_result_set_rows r
        on r.result_set_id = publication.result_set_id
     where publication.is_valid
       and r.work_index > input.after_work_index
     order by r.work_index asc
     limit (select page_limit + 1 from input)
  )
  select case
    when exists (
      select 1
        from publication_snapshot publication
       where p_expected_result_set_id is not null
         and (
           publication.published_result_set_id is distinct from p_expected_result_set_id
           or (publication.published_result_set_id is not null
             and publication.result_set_id is not null
             and publication.set_hash is distinct from p_expected_set_hash)
         )
    ) then to_jsonb(public.statsedge_published_result_read_fail_v1('SE_PUBLICATION_CHANGED'))
    when exists (
      select 1
        from validated_publication publication
       where publication.published_result_set_id is not null
         and not publication.is_valid
    ) then to_jsonb(public.statsedge_published_result_read_fail_v1('SE_PUBLISHED_RESULT_INVALID'))
    when exists (select 1 from scan_snapshot where published_result_set_id is null) then
      jsonb_build_object(
        'contract_version', 'statsedge-published-scan-result-read-v1',
        'state', 'unpublished',
        'scan_id', p_scan_id,
        'result_set_id', null,
        'execution_id', null,
        'set_hash', null,
        'hash_version', null,
        'row_schema_version', null,
        'published_at', null,
        'published_updated_at', null,
        'row_count', 0,
        'rows', '[]'::jsonb,
        'has_more', false,
        'next_cursor', null
      )
    when exists (select 1 from validated_publication where is_valid) then (
      select jsonb_build_object(
        'contract_version', 'statsedge-published-scan-result-read-v1',
        'state', 'published',
        'scan_id', publication.scan_id,
        'result_set_id', publication.result_set_id,
        'execution_id', publication.execution_id,
        'set_hash', publication.set_hash,
        'hash_version', publication.result_set_hash_version,
        'row_schema_version', 'statsedge-scan-result-row-v1',
        'published_at', publication.published_at,
        'published_updated_at', publication.published_updated_at,
        'row_count', publication.result_set_row_count,
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'work_index', page.work_index,
            'rank_index', page.work_index + 1,
            'identity_key', page.identity_key,
            'row_hash', page.row_hash,
            'payload', page.payload
          ) order by page.work_index asc)
          from page_rows page
          cross join input
         where page.page_position <= input.page_limit
        ), '[]'::jsonb),
        'has_more', exists (select 1 from page_rows page cross join input where page.page_position > input.page_limit),
        'next_cursor', case when exists (select 1 from page_rows page cross join input where page.page_position > input.page_limit) then jsonb_build_object(
          'result_set_id', publication.result_set_id,
          'set_hash', publication.set_hash,
          'after_work_index', (select max(page.work_index) from page_rows page cross join input where page.page_position <= input.page_limit)
        ) else null end
      )
      from validated_publication publication
      where publication.is_valid
    )
    else jsonb_build_object(
      'contract_version', 'statsedge-published-scan-result-read-v1',
      'state', 'not_found',
      'scan_id', p_scan_id,
      'result_set_id', null,
      'execution_id', null,
      'set_hash', null,
      'hash_version', null,
      'row_schema_version', null,
      'published_at', null,
      'published_updated_at', null,
      'row_count', 0,
      'rows', '[]'::jsonb,
      'has_more', false,
      'next_cursor', null
    )
  end
  from input_guard;
$$;

comment on function public.read_published_scan_result_set_v1(text, uuid, uuid, text, integer, integer)
  is 'Hito 1B-3 canonical DB-owned read of exactly one published scan result set.';

-- ACL del diseno SECURITY DEFINER (2026-07-23):
--
-- Owner del definer: no se fija con ALTER FUNCTION ... OWNER TO. El owner por
-- defecto es el rol que aplica esta migracion (postgres en Supabase, el
-- superusuario local en el harness efimero), que es el mismo rol que creo los
-- helpers y las tablas en 1A/1B-1/1B-2. Como owner de esos objetos conserva
-- EXECUTE y SELECT implicitos sobre ellos, asi que no hace falta ningun grant
-- adicional para que el cuerpo del lector funcione.
--
-- Contrato de roles: service_role recibe EXECUTE unicamente sobre las dos
-- funciones propias de 1B-3 (el lector y su helper de error). Los cinco
-- helpers heredados de 1A/1B-1/1B-2 vuelven al contrato absoluto de sus
-- migraciones de origen: revocados para public/anon/authenticated y TAMBIEN
-- para service_role. Esto deshace explicitamente los grants transitorios que
-- una version anterior de esta migracion concedio a service_role sobre esos
-- helpers (necesarios solo mientras el lector fue SECURITY INVOKER).
revoke all on function public.statsedge_published_result_read_fail_v1(text) from public;
revoke all on function public.read_published_scan_result_set_v1(text, uuid, uuid, text, integer, integer) from public;
do $$
declare function_name text; role_name text;
begin
  foreach function_name in array array[
    'statsedge_pg_jsonb_canonical_v1(jsonb)',
    'statsedge_pg_jsonb_sha256_v1(jsonb)',
    'statsedge_execution_identity_key_v1(jsonb)',
    'statsedge_finalization_manifest_v1(text,uuid,uuid,uuid,text,text,bigint,bigint,jsonb,jsonb)',
    'statsedge_finalization_set_hash_v1(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public', function_name);
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on function public.%s from %I', function_name, role_name);
      end if;
    end loop;
  end loop;
  foreach function_name in array array[
    'statsedge_published_result_read_fail_v1(text)',
    'read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)'
  ] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on function public.%s from %I', function_name, role_name);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', function_name);
    end if;
  end loop;
end
$$;

-- Sin grants de tabla ni politicas RLS para service_role: con SECURITY
-- DEFINER las lecturas de tabla del cuerpo corren como el owner de la
-- funcion, que es tambien el owner de las tablas. Las cuatro tablas de 1B
-- tienen "enable row level security" pero NO "force row level security", asi
-- que el owner las lee sin necesitar politica alguna, y service_role no
-- necesita (ni recibe aqui) SELECT directo sobre ninguna tabla del lector.
-- (La version transitoria anterior anadia GRANT SELECT sobre 5 tablas mas
-- politicas using(true) para service_role; nunca se aplico fuera de bases
-- efimeras de test, por lo que basta con eliminar ese bloque sin revocaciones
-- compensatorias.)
