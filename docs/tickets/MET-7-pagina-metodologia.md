# MET-7 — Página de metodología `/metodologia`

**Estado:** Hecho  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` A-7 · specs MET-4/MET-5  
**Tipo:** docs-en-producto · umbrales declarados · sin scoring nuevo  
**Cierre:** smoke `/metodologia` 4 secciones + Salud 90/100; ficha AAPL enlaces `#sosten`/`#salud`

## Problema

Los specs aceptados delegan umbrales y fórmulas a una **página de metodología** que no existe (`app/` sin `/metodologia`). El usuario ve «Salud 90/100» y «Etapa 2 · Pre-fuga» sin vía para auditar flatPct 2%, caja 32%, pesos 25/10/20/25/20, etc. Principio 5 (metodología en un solo sitio).

Ya existe material listo en código: `STAGE_HEALTH_METHODOLOGY` en `lib/stageHealth.js`, constantes en `weeklyStage.js`, `weeklyStageStructure.js`, `trendSupport.js`, `marketVolume.js`.

## Alcance

1. **Ruta** `app/metodologia/page.jsx` (o equivalente App Router) con secciones:
   - **Etapa semanal (Weinstein)** — MM30s, `flatPct`, confirmada/tentativa (desde `DEFAULT_WEEKLY_STAGE_SETTINGS`).
   - **Subestado estructural** — Pre-fuga / Con fuga / n/a: caja 26s ≤32%, techo 52s−4, HH/HL, histórico mínimo (desde `DEFAULT_WEEKLY_STAGE_STRUCTURE_SETTINGS` + labels de `stageDisplay`).
   - **Sostén de la tendencia (MET-4)** — ventanas 30/10, avance 13 vs 13, banda 5 pp, volumen 1 / 1,25× (constantes de `trendSupport` / `marketVolume`).
   - **Salud de etapa (MET-5)** — consumir `STAGE_HEALTH_METHODOLOGY` (tabla pesos/rampas + ejemplo trabajado). Dejar claro: solo etapas 2/4; sin semáforo.
2. **Fuente de verdad = constantes exportadas** — la página importa números/copy desde `lib/*`; no hardcodear umbrales en JSX que puedan divergir del motor.
3. **Enlace desde producto** — al menos desde ficha (bloque Salud / Sostén via `InfoHint` o link «Metodología») sin meter ítem nuevo en BottomNav primario (5 ítems). Opcional: pie de Research / Mercado.
4. **Estilo** — tokens/CSS del producto (pizarra); una composición legible, no marketing. Sin cards decorativas innecesarias.
5. **Tests** — página renderiza secciones clave; al menos un assert de que un umbral de `STAGE_HEALTH_WEIGHTS` / structure aparece en el markup; `./vfc` tocados.

## Fuera de alcance (NO)

| Tema | Motivo |
|---|---|
| Cambiar fórmulas / pesos / `weeklyStage` | Solo publicar lo ya decidido |
| STAGE-4 volumen de fuga | Ticket aparte |
| MH-FILL-5 régimen regional | Ticket aparte |
| Nav superior nuevo ítem | Evitar saturación; link contextual basta |
| Traducir specs enteros a la UI | Umbrales + ejemplo; no ensayo |

## Criterios

1. `/metodologia` carga autenticado (mismo AuthGate que el resto).  
2. Salud 90 del ejemplo MET-5 (o el de `STAGE_HEALTH_METHODOLOGY`) visible y coherente con constantes.  
3. Smoke orquestador: hard-reload + enlace desde ficha.  
4. Vitest + lint OK.

Sin commit/push.
