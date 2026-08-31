# Ticket activo — YIELD-1 (mesa intl: más filas útiles sin subir lote)

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md

Rama: codex/statsedge-ui-polish
Modelo: Composer 2.5
Track: mesa multi-mercado · post UX-NAC / PERF-NAC
NO MIGRATE · NO scoring

Implementa YIELD-1. Sin commit ni push.

Contexto producto (2026-08-28): mejor yield por lote, no más símbolos/noche (Pro MICRO + spend-cap). INT-3c/e/d hechos (gates HKD, líquidos Main Board, acumular N noches). Dolor residual: mesa Global/Core a veces no fusiona; HK ~122 tras acumular.

Objetivo: más filas intl **útiles** en mesa sin romper caps de lote ni bajar umbrales de precio.

Alcance (elige 1–2 palancas con evidencia; documenta):
1. Auditoría corta en código: por qué `getLatestScanFromCloudForMarkets` / merge Global puede fallar o quedar en CTA (UX-NAC-1 smoke: Global sticky). Fix honesto de merge/lookup si hay bug claro.
2. O: mejorar copy/estado cuando merge parcial (qué mercados faltan) — sin inventar filas.
3. O: acumular CA igual que HK (INT-3d patrón) si CA sigue en 1 noche pobre — solo si el código de accumulate no cubre CA hoy.
4. Tests del área + `./vfc`. Smoke: orquestador.

Fuera: MIGRATE, subir concurrency/lote cron a lo bruto, scoring, PERF hunt, commit/push.

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
| Id | YIELD-1 |
| Tipo | datos / mesa intl |
| Modelo | **Composer 2.5** |
| Rama | `codex/statsedge-ui-polish` |

## Fuera

MIGRATE · scoring · subir lote a ciegas
