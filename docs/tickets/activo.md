# Ticket activo — YIELD-EU-1 (+ paralelo FIRDS-CURATED-AVISO-1)

**Estado:** programación cloud (B + C en paralelo, ramas propias)  
**Rama base:** `codex/statsedge-ui-polish` @ `79418f0`  
**Tickets:** `docs/tickets/YIELD-EU-1.md` · `docs/tickets/FIRDS-CURATED-AVISO-1.md`

## Prompt para Agent chat (copiar tal cual) — YIELD-EU-1

```
@docs/tickets/activo.md @docs/tickets/YIELD-EU-1.md

Eres programación StatsEdge (NO orquestador). Rama base: codex/statsedge-ui-polish @ 79418f0.
Trabaja en rama propia (cursor/…); SIN commit a polish ni push a polish. Modelo: Composer 2.5 (o Terra).

Ticket YIELD-EU-1 — cron/lote EU: meter AT/BE/IE/PT en rotación shadow-europe medible.

Contexto: SHADOW_EUROPE_CRON_GROUPS (lib/cronPlan.js) tiene UK/Nordics/West/South pero NO AT/BE/IE/PT (sí están en SHADOW_FIRDS_CRON_GROUPS). SCAN_CRON_GROUPS ya tiene europe-{market} para secondary. Slice A truth cerrado (#42); no tocar UI truth.

Alcance:
1) Añadir cohorte(s) shadow-europe que cubran AT, BE, IE, PT (caps conservadores como West/South).
2) Test: unión SHADOW_EUROPE incluye esos cuatro; helpers shadowEuropeCronGroupAt OK.
3) Comentario breve thin vs FIRDS pairs. ./vfc o vitest del ticket verde.

No: activar ESMA_FIRDS_ENABLED/FCA; nocturno US; scoring; auth; truth/P9; correr cron prod.

Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ. Sin commit ni push a polish (PR en tu rama cloud OK si el entorno lo pide).
```

## Prompt paralelo — FIRDS-CURATED-AVISO-1

```
@docs/tickets/FIRDS-CURATED-AVISO-1.md

Eres programación StatsEdge (NO orquestador). Rama base: codex/statsedge-ui-polish @ 79418f0.
Rama propia; SIN commit/push a polish. Modelo: Composer 2.5 (o Terra).

Ticket FIRDS-CURATED-AVISO-1 — aviso producto cuando Europa opera en curated-fallback / FIRDS off.

Gap backlog: población parcial sin aviso. Reusar marketAvailability / screenerTruthLine / coveragePlan / universeEngine cache status.

Alcance: detectar + copy en truth/P9; tests; ./vfc o vitest verde.
No: activar flags FIRDS; cron EU (YIELD-EU-1); scoring; nocturno; auth.

Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ.
```

## Notas orquestador

- Paralelo OK: B toca `cronPlan` / shadow-europe; C toca truth/availability.
- Gate merge: B = datos/cron → OK dueño antes de squash a polish si afecta corridas; C = UI honesty → smoke + merge normal.
- Cola restante tras cierre: D Twelve Data / Hito 1B (aparcado).
