# UX-P2 — Toolbar de resultados: jerarquía y fuera JSON audit

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer (fast OK)  
**Origen:** `docs/analisis-ux-producto-final-2026-08-27.md` · Día 1 (tras o junto a UX-P1)  
**Principio:** acciones de producto primero; herramientas de QA no al mismo peso que «Revisar».

## Problema

En `resultsHeader` / mobile list, `Traer datos frescos`, `Resetear criterios`, `↓ CSV`, `JSON audit`, `Revisar`, `Guardar` compiten visualmente. `JSON audit` es jerga de desarrollo en primer plano.

## Objetivo

1. **Ocultar `JSON audit`** de la toolbar principal: menú «⋯» / «Más» / disclosure secundario, o solo si `NODE_ENV === "development"` / flag explícito documentado. No borrar la función `decisionAuditJson`.
2. **Jerarquía:** `Revisar` = primaria (ya `btnPrimary`; reforzar si hace falta). CSV / Guardar / Reset / Traer datos = secundarios, agrupados (mismo grupo visual o menú «Datos»).
3. Copy: título «Results / Resultados» — si sobra, unificar a español «Resultados» sin el rótulo inglés vacío.
4. Misma política en `MobileResultList` si expone audit/CSV al mismo nivel.

## Alcance

### Dentro

- `ScreenerShell.jsx` (bloque `controls` ~594–626).
- Componente móvil de resultados si aplica.
- CSS mínimo.
- Tests que busquen el string `JSON audit` en HTML principal: ajustar a «oculto / menú».
- Sin commit ni push.

### Fuera

- Cambiar lógica de refresh/reset/P4.
- UX-P1 (salvo conflicto de layout menor).

## Verificación (orquestador)

1. Tests afectados en verde.  
2. Browser Use: en toolbar principal **no** aparece «JSON audit» a primer nivel; «Revisar» sigue siendo la acción clara; CSV/Guardar/refresh accesibles.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
