# Ticket activo — UX-NAC-2 (verdad de mercados en mesa)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Track: mesa multi-mercado seria · prerrequisito UX-NAC-1 (bloquea filas en desalineación)
NO MIGRATE

Implementa UX-NAC-2. Sin commit ni push.

Objetivo: que la línea de verdad diga siempre qué mercados hay en la mesa y qué falta, no solo N analizadas / pasan.

Alcance:
1. Extender `buildScreenerTruthLine` / `lib/screenerTruthLine.js` (o helper en marketAvailability) para incluir, cuando hay scan cargado:
   - mercados efectivos del scan (códigos cortos, p. ej. «mesa: US» o «mesa: HK+CA»)
   - si `marketsStale`/misalignment: fragmento «selección ≠ mesa» (sin duplicar el banner entero)
2. Cablear desde ScreenerShell con `scannedMarkets` + `markets` (selección) ya disponibles; no inventar N.
3. Mantener UX-NAC-1: con misalignment truth en 0 analizadas/pasan; el fragmento de mercados puede seguir aclarando «datos: US · selección: HK».
4. Copy corto, castellano producto; sin jerga localId.
5. Tests en screenerTruthLine / ScreenerShell truth; `./vfc` del área.
6. Smoke: orquestador.

Fuera: PERF-NAC, YIELD cron, MIGRATE, scoring, cambiar semántica de filtros, commit/push.

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
| Id | UX-NAC-2 |
| Tipo | UX / confianza |
| Modelo | **Composer 2.5** |
| Rama | `codex/statsedge-ui-polish` |
| Prerreq | UX-NAC-1 cerrado |

## Objetivo

Verdad fija: N + mercados en mesa + desalineación corta.

## Fuera

PERF-NAC · YIELD · MIGRATE
