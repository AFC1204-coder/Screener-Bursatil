# VCP-0 — Auditoría Etapa 1 vs Etapa 2 (semanal)

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Fable 5 (juicio metodológico + citas) · fallback Opus  
**Tipo:** diseño/medición read-only — **sin** cambiar `weeklyStage.js` ni producto hasta ADR  
**Origen:** MSI tanda 3 + `docs/auditoria-etapa1-etapa2-semanal-propuesta-2026-09-01.md`  
**Bloquea:** retomar etiquetado VCP tanda 3 con brief honesto  
**Copia activa:** `docs/tickets/activo.md`

## Problema

`weeklyStage.js` = precio vs MM30s + pendiente. No mira ruptura de base ni HH/HL. MSI: código «Etapa 2 confirmada» vs dueño «base larga E1 potencial sin ruptura». El brief automático mezcló escalas (jun–ago diario ≠ VCP semanal).

## Objetivo

Cerrar definición operativa E1/E2 semanal antes de seguir VCP.

## Alcance

1. Tabla **libro → criterio → medible** con citas desde `research/books/` (Weinstein, Minervini, O'Neil ya en disco local).
2. Muestra **15–20 valores** con veredicto dueño E1 / E2 / dudoso (MSI ancla + tanda 3 + nocturno).
3. Script read-only: etapa código vs criterio candidato.
4. ADR corto: ¿cambiar clasificador / campo paralelo (`pre_breakout`, `E2_ma_only`) / solo UI?
5. Nota para `chart-brief.mjs`: no decir «Etapa 2» sin subestado (implementación tras ADR).

## Fuera

- Cambiar `weeklyStage.js` o screener en este ticket.
- Fusionar detector VCP → producto.
- MET-6 (ese id = RS stress).
- commit/push de producto.

## Caso ancla dueño (MSI)

```
MSI · POTENCIAL · PERIODO: 2025-09-11→2026-08-31 · base larga sin ruptura ·
semanal = E1 potencial, no E2 cazable · jun-ago = tendencia, no el VCP
```

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
(n/a o script read-only ejecutado)
## LO QUE NO VERIFIQUÉ
Sin commit ni push de producto.
```
