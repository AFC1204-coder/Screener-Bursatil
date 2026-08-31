# VCP-1 — Etiquetado tanda 3 (research, fractal)

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 (páginas/arnés) · Fable solo si hace falta juicio de reglas tras la tanda  
**Tipo:** research — **sin** tocar `lib/setupPatterns.js` ni UI de producto  
**Origen:** dueño 2026-08-31 noche — retomar bucle gráficos→etiquetas; fractal / multi-temporalidad / potencial; respuestas útiles sin relleno  
**Prerreq:** `research/contracciones/` · `docs/temporalidad-contracciones-2026-08-21.md` · corpus 21  
**Copia activa:** `docs/tickets/activo.md`

## Marco (contrato dueño)

- Las bases son **fractales**: varios patrones/tendencias a la vez en distintas escalas.
- Muchas lecturas son **potenciales**, no confirmadas; no es ciencia exacta.
- El dueño etiqueta con lo **útil**; un caso corto o sin ensayo largo es válido (no pedir párrafos).
- Distinguir cuando se pueda: **estructura** vs **operable** (como ICE: base ≠ trade ganador).

## Objetivo

Retomar el bucle de etiquetado:

1. Agent genera página HTML de gráficos **sin marcas del detector** (evolución de `arneses/build-charts.mjs`).
2. Dueño marca en chat (o notas): veredicto, PERIODO, pares max→mín por tramo si aporta, matiz potencial/confirmado si hace falta.
3. Agent incorpora al corpus / borrador de tanda y deja lista la medición **con fechas** (no solo sí/no).

## Alcance Agent (esta tanda)

- Alinear **ventana del gráfico** con la que usa el detector (fix conocido: FROM fijo 2025-11-03 vs lookback del detector — ver memoria ventana NDAQ).
- Lista de **8–12 símbolos** para tanda 3: mezcla frontera (marcados v4, rechazados, disputados R7/R2/anidamiento); excluir o avisar símbolos con barras corruptas conocidas (AAPL/JPM/MSFT/TXN/WELL residuales).
- Generar HTML (p. ej. `/tmp/etiquetado-tanda3.html` o bajo `~/Desktop/etiquetado-bases/` si el dueño lo pide).
- Plantilla mínima de respuesta dueño (una línea por caso basta).
- **No** implementar R7/R8/R2 en el prototipo en este ticket salvo que el dueño lo pida tras etiquetar.
- **No** producto, **no** commit/push de código de app (docs research OK si hacen falta).

## Alcance dueño

Etiquetar la tanda a su ritmo. Formato sugerido (flexible):

```
SYM · BASE|NO|POTENCIAL · PERIODO: fecha→fecha · (opcional) tramos max→min · nota corta
```

## Fuera

- Meter VCP en ficha/mesa/filtros.
- Fusionar research → `setupPatterns.js`.
- Exigir ensayo largo por símbolo.
- MIGRATE / scoring.

## Criterios de cierre (orquestador)

- [ ] Página tanda 3 generada y abierta/entregada al dueño.
- [ ] Ventana gráfico alineada (o documentado el gap restante).
- [ ] Al menos parte de la tanda etiquetada → corpus/notas actualizados.
- [ ] Sin diff de producto.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
(n/a o arnés research ejecutado)
## LO QUE NO VERIFIQUÉ
Sin commit ni push de producto.
```
