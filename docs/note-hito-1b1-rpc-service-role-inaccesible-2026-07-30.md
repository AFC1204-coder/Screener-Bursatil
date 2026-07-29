# Nota — la superficie de RPC de Hito 1B-1 es inaccesible para `service_role` (2026-07-30)

> Estado: nota de seguimiento, no bloqueante hoy. No es un ADR ni una
> decisión de producto. Escrita al cerrar el incidente de
> `statsedge_published_result_set_sealed_v1` (commit
> `fix(schema): security definer en el trigger de sellado + guarda de
> idempotencia`) para dejar constancia de un hallazgo relacionado que
> no se tocó en ese fix.

## Qué se observó

Al investigar el incidente de producción del 29 de julio de 2026 (un
trigger de Hito 1B-2 fallaba con `permission denied` al escribir en
`public.scans` vía `service_role`/PostgREST), se confirmó que el mismo
patrón de fondo — `security invoker` + `revoke all ... from
service_role` sin ningún grant compensatorio — también deja
**inaccesible para `service_role` toda la superficie de RPC de Hito
1B-1**: `begin_scan_execution`, `resume_scan_execution`,
`takeover_scan_execution`, `register_scan_work_item`,
`persist_scan_result`, `complete_scan_work_item`,
`checkpoint_scan_execution`, `abandon_scan_execution`, y los helpers
internos que usan (`statsedge_execution_identity_key_v1`,
`statsedge_lock_result_sets_v1`, `statsedge_lock_result_set_v1`,
`statsedge_assert_execution_lease_v1`).

## Por qué esto NO es un bug (a diferencia del trigger)

A diferencia del trigger de sellado — que interceptaba una escritura
legacy que **ya estaba en uso real** (`writeMaterializedScan` sobre
`public.scans`) —, esta inaccesibilidad de las RPC de Hito 1B-1 es
**intencional y está verificada activamente por un test**:

`tests/integration/scan-execution-lifecycle.real.test.mjs:213-234`
consulta `has_function_privilege('service_role', ..., 'EXECUTE')` para
las diez funciones de Hito 1B-1 y afirma explícitamente que debe ser
`false` para las tres — `anon`, `authenticated` y `service_role` — más
que ninguna tiene `EXECUTE` en `PUBLIC`. Es, literalmente, el contrato
de seguridad que el propio Hito 1B-1 se propuso proteger.

Hoy es inofensivo porque **nada en el código vivo llama a estas RPC**:
`lib/materializedScanner.js` sigue escribiendo `scans`/`scan_results`
directamente por PostgREST (el camino legacy), no a través de
`begin_scan_execution` ni de ninguna otra función de este grupo.

## La mina para el día que alguien conecte `begin_scan_execution`

El día que alguna ruta de la aplicación necesite invocar estas RPC
(por ejemplo, para migrar el escritor del scan materializado al modelo
de `scan_result_sets`/`scan_executions`), la llamada fallará con el
mismo `permission denied` que el trigger de sellado, porque
`service_role` es exactamente el rol con el que Next.js habla con
Supabase (`SUPABASE_SERVICE_ROLE_KEY`, vía `lib/supabaseServer.js`).
No hay ningún camino de invocación ya construido para este grupo de
RPC — hay que diseñarlo antes de conectarlas, no asumir que basta con
llamarlas por PostgREST como cualquier otra RPC del proyecto.

## Qué hace falta antes de conectar cualquiera de estas RPC

Verificado contra producción (solo lectura, vía Management API) el
29/30 de julio de 2026: `begin_scan_execution` y las demás son
propiedad de `postgres`, que sí tiene `EXECUTE` sobre sus propios
helpers internos — el mismo hecho que permitió resolver el incidente
del trigger de sellado. Dos caminos razonables, a decidir cuando llegue
el momento real de conectarlas, no ahora:

1. **`security definer`** en las RPC de entrada (`begin_scan_execution`
   y hermanas), igual que se hizo con
   `statsedge_published_result_set_sealed_v1` y como ya usa
   `read_published_scan_result_set_v1`. Mantiene el `revoke` sobre los
   helpers internos intacto; solo las RPC de entrada quedarían
   invocables por `service_role`.
2. Un `grant execute` explícito y acotado a `service_role` sobre las
   RPC de entrada (no sobre los helpers internos), si por lo que sea
   `security definer` no encaja con el diseño de esa integración
   concreta.

**Importante — esto no es un detalle de implementación menor.** Esa
aserción no es un test frágil que se pueda ajustar de paso al tocar
otra cosa: es el contrato de seguridad activo de Hito 1B-1, la misma
razón por la que hoy `service_role` no tiene `EXECUTE` en absoluto.
Cualquiera de los dos caminos de arriba la rompe a propósito, y
actualizarla debe ser una **decisión explícita y deliberada de quien
conecte estas RPC** — revisada como tal, con su propio razonamiento
documentado en ese momento — nunca un cambio incidental o un ajuste
automático para que la suite vuelva a pasar.
