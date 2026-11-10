# date-001 — aceptación reforzada (sandbox)

**Veredicto:** `DATE_ACCEPTANCE_HARDENED_OK`  
**Fecha:** 2026-09-10  
**Scope:** solo gate de aceptación; sin Mini; sin `enqueue`/`run`; sin corregir producto.

## Archivos

| Ruta | Rol |
|---|---|
| `accept-date.mjs` | Oráculo endurecido (literales; 3 TZ) |
| `contract.date-001.hardened.json` | Contrato con partición CHANGED/PRESERVED |
| `run-triad.mjs` | Ejecuta WRONG/RIGHT/PRESERVATION_BREAK/BASELINE |
| `fixtures/wrong/formatters.js` | Entrega histórica date-001 |
| `fixtures/right/formatters.js` | Referencia de contrato (no producto) |
| `fixtures/preservation-break/formatters.js` | TZ OK + rompe `2027-02-29` |
| `source/formatters.js` | Source congelado `19c947b` |
| `source/measured-outputs.json` | Medición source por TZ |
| `triad-summary.json` | Resultado máquina |
| `logs/*.log` | Salidas crudas |

`v1.py` **no** modificado.

## Matriz de casos (accept)

### CHANGED (mismo literal en Madrid / New_York / Tokyo)

| Input | Expected |
|---|---|
| `2026-09-08` | `8 sept 2026` |
| `2026-01-01` | `1 ene 2026` |
| `2026-12-31` | `31 dic 2026` |
| `2027-01-01` | `1 ene 2027` |
| `2024-02-29` | `29 feb 2024` |
| `2028-02-29` | `29 feb 2028` |

### PRESERVED (literales medidos del source; por TZ)

| Input | Europe/Madrid | America/New_York | Asia/Tokyo |
|---|---|---|---|
| `0001-01-01` | `31 dic 1` | `31 dic 1` | `1 ene 1` |
| `0099-12-31` | `30 dic 99` | `30 dic 99` | `31 dic 99` |
| `2027-02-29` | `1 mar 2027` | `28 feb 2027` | `1 mar 2027` |
| `2026-09-08T00:00:00Z` dateShort | `8 sept 2026` | `7 sept 2026` | `8 sept 2026` |
| `2026-01-01T23:00:00Z` dateShort | `2 ene 2026` | `1 ene 2026` | `2 ene 2026` |
| Date(`2026-09-08T00:00:00Z`) | `8 sept 2026` | `7 sept 2026` | `8 sept 2026` |
| dateTime `…T00:00:00Z` | `8 sept, 02:00` | `7 sept, 20:00` | `8 sept, 09:00` |
| dateTime `…T23:00:00Z` | `2 ene, 00:00` | `1 ene, 18:00` | `2 ene, 08:00` |
| null / undefined / `""` / `not-a-date` | `-` | `-` | `-` |
| `num(1234.5,1)` | `1234,5` | `1234,5` | `1234,5` |

19 aserciones × 3 TZ = 57 por PASS.

## Resultados triad

| Fixture | Esperado | Obtenido | Motivo del fallo (si FAIL) |
|---|---|---|---|
| WRONG | FAIL | FAIL | `0001-01-01` → `-` (años 0–99) |
| RIGHT | PASS | PASS | — |
| PRESERVATION_BREAK | FAIL | FAIL | `2027-02-29` → `-` vs roll pinneado |
| BASELINE_SOURCE | FAIL | FAIL | NY `2026-09-08` → `7 sept 2026` (bug TZ) |

## Cómo reproducir

```bash
node research/v1-date-acceptance-hardened/run-triad.mjs
```
