# HYDRATION-1 — React hydration mismatch en screener `/`

**Estado:** Activo  
**Prioridad:** residual smoke (P1 menor · calidad runtime)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Tipo:** bugfix UI — **no scoring · no IPO · no datos Mini**

## Problema

En smoke IPO (2026-09-07) Next.js muestra **hydration error** apuntando a `app/components/screener/ScreenerShell.jsx` (~L647, el `<main>`). Suele ser un hijo con HTML distinto en SSR vs cliente (`Date`, `localStorage`, `window`, locale, WeeklyChangesLine, etc.).

## Alcance

1. Reproducir en `/` (hard-reload) y anotar el mensaje/diff real de React (texto que difiere).
2. Localizar el nodo culpable (no “arreglar” el `<main>` a ciegas). Candidatos: `WeeklyChangesLine`, labels de mercado/ficha desde storage, fechas/locale.
3. Fix mínimo de paridad SSR/cliente (mismo markup inicial; hidratar datos client-only tras mount si hace falta).
4. Test de regresión si es barato (render estático / assert de no branch `typeof window` en el HTML inicial del culpable). `./vfc` tocados.
5. Sin commit/push.

## Fuera

- Rediseño LOOK · IPO-UX-F · proceso B/A  
- Cambiar copy de producto salvo lo imprescindible para paridad  
- “Silenciar” el warning con `suppressHydrationWarning` en el árbol entero (solo OK en un nodo hoja con justificación)

## Criterios

1. Hard-reload `/` sin overlay/error de hydration en consola (o evidencia de que el mismatch ya no es el reportado).
2. Smoke visual: hero + ficha IPO recientes siguen legibles.
3. Vitest/lint de lo tocado OK.
