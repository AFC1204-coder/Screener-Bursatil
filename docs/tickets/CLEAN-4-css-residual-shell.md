# CLEAN-4 — CSS residual post-SHELL

**Estado:** Activo  
**Previo:** SHELL-D `d6dd808` · migrate Mini cerrado en uso  
**Rama:** `codex/statsedge-ui-polish`

## Anti-colisión (obligatorio)

Puede haber **otro orquestador** (Grok Bot / nube) despachando Agent chats sobre el mismo repo cuando el dueño no está.  
**Un solo escritor** en el working tree principal. Al empezar: `git status` limpio o solo docs de este ticket. Si hay diff ajeno → **parar** y reportar; no stash/rebase agresivo.

## Objetivo

Purgar CSS huérfano dejado por SHELL A→D (árbol finos, laboratorio, contadores, dualidad aside) sin cambiar comportamiento UI.

## Alcance

1. Inventario: selectores en `styles/` (y CSS modules si aplica) referenciados solo por JSX/clases retiradas en SHELL (p. ej. restos de árbol finos, `advancedOpen`, laboratorio, viewLayerMini, resets duplicados). Cruzar con `rg` de classNames vivos.
2. Borrar solo lo **demostrablemente** sin usos (mismo criterio CLEAN-1/2/3).
3. No rediseñar; no tocar tokens de marca; no tocar chart.
4. Smoke Browser Use: `/` desktop + 390 — aside Mercados+familias, mesa, sin regresiones visuales obvias.
5. Evidencia breve `docs/evidence/clean-4-….md` (lista de selectores borrados).

## Fuera

- RPC pg / historia / leaderboards  
- Túnel móvil→Mini  
- Apagar GHA  
- Scoring, nocturno, hunt cards  

## Criterios

- Diff acotado a CSS (+ evidencia/docs ticket)  
- `./vfc` en tocados OK  
- Smoke orquestador OK  
- Sin commit/push desde programación  
