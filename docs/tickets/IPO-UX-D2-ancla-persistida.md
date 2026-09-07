# IPO-UX-D2 — Persistir ancla «desde salida» en scan/nocturno

**Estado:** Cerrado `3adc86d` · código · smoke mesa % tras ops `--write`/nocturno  
**Prioridad:** P1 (habilita cobertura real de IPO-UX-D)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Tipo:** datos / proyección scan — **no scoring · no RS IPO · no correr nocturno full en Mini sin OK ops**

## Problema

IPO-UX-D calcula % con `chartPreview` (~48 sesiones). En mesa real, IPOs con edad >~2 m quedan en «— · serie no alcanza salida». Hace falta ancla persistida cuando el scan tiene histórico completo.

## Alcance

1. En el camino de construcción de fila de scan (`researchRow` / runner), con serie completa disponible y `ipoDate` verificada: calcular **primer cierre usable ≥ ipoDate** → campos p.ej. `ipoAnchorClose` + `ipoAnchorDate` (nombres coherentes con el repo).
2. Incluirlos en proyección ligera (`scanLightProjection` / contrato compacto) para que lleguen a la mesa.
3. Actualizar `ipoDesdeSalidaPct` / ancla en `ipoDiscoveryView.js`: **preferir ancla persistida**; fallback `chartPreview` como hoy.
4. Tests unitarios de cálculo + proyección + % con ancla. `./vfc`.
5. **No** ejecutar nocturno US completo ni escribir Mini en este ticket. Si hace falta script de backfill one-shot, dejarlo **dry-run por defecto** y documentar comando `--write` para ops (orquestador/dueño).

## Fuera

- IPO-UX-E ficha  
- IPO-UX-F RS  
- Cambiar scoring / `ipoScore`  
- Ampliar `chartPreview` a N años (no: preferir campo escalar)

## Criterios

1. Con fila que trae ancla + `price`, `%` es finito aunque `chartPreview` no alcance `ipoDate`.
2. Sin `ipoDate` o sin barra en histórico de scan → ausencia honesta (no inventar).
3. Fila ligera de mesa incluye el campo (o documenta por qué no y cómo hidratar).
4. Vitest OK. Sin commit/push.

## Ops

`scripts/backfill-ipo-anchor.mjs` (dry-run default; `--write` con OK dueño).

