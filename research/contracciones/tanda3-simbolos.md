# Tanda 3 — símbolos y motivo (VCP-1)

Actualizado 2026-09-01. Research only.

## Ventana del gráfico

**290 sesiones** = v4 `lookback` 140 + `smaLen` 150. Sustituye el `FROM` fijo
2025-11-03 (199 sesiones).

---

## Tanda 3 original (congelada 2026-09-01)

Diseño inicial: mezcla de contextos («¿primera base del avance?») **sin filtro
de tendencia**. Descartada para etiquetado alcista: muchos laterales / bases
anchas (STX base 39%, DELL 31%, F RS 30).

| Símbolo | Estado |
|---------|--------|
| HPE | etiquetado ✓ |
| VLO | etiquetado ✓ |
| APH, DELL, F, GE, MDLZ, MMM, MSI, NVDA, SCHW, STX | congelados |

---

## Tanda 3-alcista (activa)

**Objetivo:** consolidaciones **estrechas** en **tendencia alcista fuerte**
(perfil GOOGL / MPC ascendente), no fases laterales largas.

**Filtro nocturno US + barras (2026-09-01):**

- Etapa 2 · RS ≥ 80
- Liquidez ≥ 25 M$/d
- Precio a ≤ 10 % del máximo 52 semanas
- Avance 18–90 % desde mínimo 120d
- Ancho de base (52s high → 60d low) ≤ 30 %
- Preferencia: última contracción ≤ 6 % (scan)

| Símbolo | RS | vs 52s | Avance 120d | Base | Últ. contr. | Nota |
|---------|---:|-------:|------------:|-----:|------------:|------|
| ROKU | 90 | −1,9% | +85% | 28% | 2,9% | Muy tight |
| TECH | 88 | −0,3% | +68% | 29% | 5,9% | Bio-Techne |
| STT | 88 | −2,3% | +63% | 19% | 3,6% | |
| VOYA | 87 | −2,0% | +59% | 19% | 5,1% | contr. decrecientes |
| MATX | 89 | −2,4% | +57% | 20% | 5,2% | |
| UBS | 83 | −0,5% | +57% | 16% | 2,5% | Muy compacto |
| EXPD | 83 | −1,4% | +40% | 17% | 2,6% | Perfil textbook |
| KRYS | 90 | −6,1% | +48% | 22% | 4,7% | |
| SEIC | 84 | −1,0% | +49% | 23% | 5,3% | |
| CLBK | 89 | −3,2% | +51% | 26% | 3,7% | |

Reserva (ultC algo más ancha): ATKR, MT, ING, DGX.

La mayoría están **Con fuga** en vivo; al etiquetar retrospectivo marcar el
**periodo de la base en el avance**, no el snapshot.

## Generar HTML

```bash
SYMBOLS="ROKU,TECH,STT,VOYA,MATX,UBS,EXPD,KRYS,SEIC,CLBK" \
  OUT=/tmp/etiquetado-tanda3-alcista.html \
  TANDA=3-alcista \
  node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/build-charts.mjs
```

Lista completa original (referencia):

```bash
SYMBOLS="APH,DELL,F,GE,HPE,MDLZ,MMM,MSI,NVDA,SCHW,STX,VLO" \
  node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/build-charts.mjs
```
