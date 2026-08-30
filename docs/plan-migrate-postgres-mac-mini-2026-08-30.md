# Plan — Postgres en Mac Mini M4 (salida Supabase Pro)

**Fecha:** 2026-08-30  
**Destino:** Mac Mini M4 (siempre encendido)  
**Estrategia:** ruta **B** — Postgres local + adaptador `pg` en `supabaseServer` (no clonar PostgREST).  
**Proyecto nube actual:** `screener` · `dzovggfbcoymjgikkbno` · `eu-central-1` · Postgres 17 · `ACTIVE_HEALTHY`  
**Billing (dueño 2026-08-30):** ciclo **5 ago – 5 sep** · **5 días** hasta fin de ciclo · renovación / upcoming invoice ancla **2026-09-05**.  
**Fecha acordada (2026-08-30):** ventana de migrate **martes 2 sep 2026** (dump MIGRATE-1 por la mañana / primeras horas; adaptador+cutover mismo día o **mié 3 sep**). Buffer hasta **vie 5 sep**. No cancelar Pro antes de smoke Mini.  
**MCP** no expone period end; fuente = dashboard Billing.

## Principios

1. No cancelar Pro hasta smoke verde en el Mini.
2. Un ticket a la vez; orquestador verify + dueño solo en cutover.
3. Vercel **no** apunta al Postgres del Mini (NAT). App + DB + nocturno = Mini.
4. Dump verificado **antes** de tocar código de producción local.

## Tres tickets

| ID | Qué | Dueño | Agent |
|---|---|---|---|
| **MIGRATE-1** | Postgres 16/17 en Mini + `pg_dump` Pro + restore + conteos | Password DB + OK dump | Scripts / checklist |
| **MIGRATE-2** | `supabaseServer` → `DATABASE_URL` / `pg` (o dual-mode) | Smoke mesa/ficha | Código + tests |
| **MIGRATE-3** | Cutover env + `launchd` nocturno + checklist cancel Pro | Presente ~1 h | launchd + smoke |

Detalle: `docs/tickets/MIGRATE-1-mini-dump-restore.md`, `MIGRATE-2-pg-adapter.md`, `MIGRATE-3-cutover-nocturno.md`.

## Tiempo

- Dueño: ~2–4 h en ráfagas.
- Calendario: 1–2 días de trabajo con Agents.
- Margen cobro: **hasta 2026-09-05**. **Día acordado: martes 2 sep** (+ mié 3 sep si hace falta).

## Orden de activación

1. Dueño confirmó billing **2026-09-05** (~5 días) y acordó ventana **mar 2 sep** (reserva **mié 3**).
2. El **2 sep** orquestador activa **MIGRATE-1** (Mini a mano + password DB).
3. Tras restore OK → MIGRATE-2 → MIGRATE-3 el mismo día o **3 sep**.
4. Solo entonces cancelar / no renovar Pro (evitar cobro del ciclo siguiente).
