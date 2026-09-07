# AUDIT-CRITERIO-1 — Criterio libros → etapas en screener + huecos de Mercado

**Estado:** Hecho (informe · sin código producto)  
**Prioridad:** P1 (juicio de producto / metodología)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** **Claude Fable** (thinking high) o **Opus** thinking high — no Composer; hace falta criterio, no mecánica  
**Tipo:** auditoría read-only → informe + tickets priorizados · **sin código de producto** · sin commit/push  
**Origen:** dueño 2026-09-08 — (A) asegurar buen criterio de etapas/métricas en screener; (B) que `/market-health` recoja lo importante de los libros ya guardados.

## Fuentes obligatorias (leer antes de opinar)

**Libros locales** (`research/books/`, gitignored — no copiar PDF ni citas largas al repo):

- Weinstein (alcistas/bajistas)  
- Minervini (`mark minervini.pdf`, Think & trade like a champion)  
- O'Neil (How to make money in stocks)  
- Apoyo: Momentum Masters; P&F / Livermore solo si aportan señal de mercado medible

**Notas / método ya versionados:**

- `research/notes/00-books-manifest.md`  
- `research/notes/02-operational-extraction.md`  
- `research/notes/03-expanded-methodology-map.md` (si existe)  
- `docs/methodology/market-leadership-framework.md`  
- `docs/design/MARKET-HEALTH-IA.md`  
- `docs/auditoria-etapa1-etapa2-2026-09-01.md` + propuesta hermana  
- `docs/spec-salud-etapa.md`, `docs/spec-muletas-tendencia.md`  
- `docs/tickets/STAGE-1-estructura-semanal-paralela.md` (estado hecho)

**Código (lectura, no refactor):**

- `lib/weeklyStage.js` (+ cualquier proyección STAGE-1 / subestado)  
- Dónde se **muestra** etapa en mesa / Review / ficha (buscar usos, no inventar)  
- `app/market-health/page.jsx` + APIs que alimentan (`/api/market-health`, breadth, coverage, news…)

## Parte A — Etapas / métricas en screener (criterio)

1. Matriz **libro → regla medible → código actual → UI mesa/cola/ficha**.  
2. Separar: condición necesaria (precio vs MM30s) vs **inicio** de E2 tipo Weinstein (fuga/techo/volumen) vs Trend Template Minervini vs O'Neil (no etapas W).  
3. Revisar si STAGE-1 / salud de etapa / muletas **cierran** el hueco o solo lo documentan.  
4. Hallazgos con severidad: `criterio-ok` · `proxy-honesto-pero-limitado` · `mal nombrado en UI` · `hueco de producto`.  
5. **Prohibido** en este ticket: cambiar `weeklyStage.js` o scoring. Solo proponer tickets siguientes.

## Parte B — Análisis de mercado (relleno vs libros + IA)

1. Contra `MARKET-HEALTH-IA` + framework + extracción operativa: checklist de señales de mercado que **deben** verse (régimen, amplitud, liderazgo sector/región, presión/distribución, contexto contrarian).  
2. Estado real de la página hoy (qué responde, qué soft-fail, qué vacío sin snapshot).  
3. Gap list priorizada: dato ya existe / API falta / UI falta / ops Mini.  
4. Propuesta de oleada de tickets (MH-FILL-…) sin implementar.

## Entregable

Un solo informe versionable:

`docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md`

Estructura mínima:

1. Resumen ejecutivo (≤15 líneas)  
2. Parte A — matriz + hallazgos + tickets propuestos  
3. Parte B — checklist libros↔Mercado + gaps + tickets  
4. Orden sugerido de ejecución (qué primero si el dueño solo hace 1–2)

**Guardrails:** sin buy/sell; sin excerpts largos de PDF; no inventar APIs; verificar contra HEAD.

## Fuera

- Implementar fixes UI/código  
- IPO-UX-F · LOOK · nocturno write  
- Reabrir debate scoring compuesto  

## Criterios de aceptación (orquestador)

1. Informe en `docs/` con matriz A + checklist B y tickets accionables.  
2. Dueño puede elegir 1–2 tickets de implementación sin releer los PDF.  
3. Sin diff de producto (salvo el markdown del informe + backlog/activo).
