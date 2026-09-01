# Tanda 3 — símbolos y motivo (VCP-1)

Actualizado 2026-09-01. Research only.

## Ventana del gráfico

**290 sesiones** = v4 `lookback` 140 + `smaLen` 150. Sustituye el `FROM` fijo
2025-11-03 (199 sesiones).

## Lista (12 símbolos — todos nuevos respecto al corpus de 21)

| Símbolo | En corpus 21 | Motivo en la tanda |
|---------|--------------|-------------------|
| APH | no | Avance / contexto (diseño tanda 3 original) |
| DELL | no | idem |
| F | no | idem |
| GE | no | idem |
| HPE | no | idem |
| MDLZ | no | idem |
| MMM | no | idem |
| MSI | no | idem |
| NVDA | no | idem |
| SCHW | no | idem |
| STX | no | idem |
| VLO | no | idem |

Pregunta guía (del `plantilla-tanda3.txt` original): ¿primera base del avance
o ya van varias? Mezcla de contextos sin decir cuál es cuál.

**Corrección 2026-09-01:** una primera versión VCP-1 reutilizó 8 casos del corpus
(BEKE, DECK, ELV, FLG, IP, MSGS, NDAQ, QRVO) para relectura de ventana; eso no
era tanda nueva. Esta lista es la pendiente de etiquetar.

## Generar HTML

```bash
SYMBOLS="APH,DELL,F,GE,HPE,MDLZ,MMM,MSI,NVDA,SCHW,STX,VLO" \
  node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/build-charts.mjs
```
