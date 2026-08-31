# Ticket activo — PERF-NAC (latencia cambio de vista multi-mercado)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Track: mesa multi-mercado seria · post UX-NAC-1/2
NO MIGRATE · NO scoring

Implementa PERF-NAC. Sin commit ni push.

Contexto medido (R-06, 2026-08-30, Browser Use): cambio ficha rail cold — E2 ~1980 ms, pivot ~964, intl ~2522, IPO ~946, Deterioro ~1879. UX-11 ya dio warm/optimistic; residual = cold/secuencial + hydrate RS en /api/scans.

Objetivo: al cambiar ficha hunt o mercados, la UI no «se queda muerta» 1–2,5 s. Preferir feedback <200 ms percibido; el cálculo pesado puede seguir en transición.

Alcance (elige el mínimo que mueva la aguja; documenta qué hiciste):
1. Instrumentar o reutilizar marcas: tiempo desde clic hunt/preset hasta update de `.screenerTruthLine` (test o harness ligero).
2. Camino cold hunt: `startTransition` / deferred rows / skeleton de verdad ya existentes — asegurar que cold path no bloquee el paint del rail activo y de la truth line (aunque N aún stale un frame).
3. Si `/api/scans` hidrata RS país/tema en serie y alarga la respuesta de mesa: paralelizar o defer hydrate no-bloqueante para el primer paint de filas (sin mentir RS: ausencias honestas hasta hydrate). No tocar motores RS ni pins.
4. Tests del área + `./vfc`. Smoke ms: orquestador.

Fuera: MIGRATE, YIELD cron/volumen filas, UX-NAC copy, scoring, commit/push.

Plantilla de retorno:
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```

---

## Meta

| Campo | Valor |
|---|---|
| Id | PERF-NAC |
| Tipo | perf UX |
| Modelo | **Composer 2.5** |
| Rama | `codex/statsedge-ui-polish` |
| Prerreq | UX-NAC-1/2 |

## Objetivo

Menos espera percibida al cambiar vista/nacionalidad (R-06 residual).

## Fuera

MIGRATE · YIELD · scoring
