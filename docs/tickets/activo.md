# Ticket activo — HYDRATION-1

**Estado:** activo programación  
**Rama:** `codex/statsedge-ui-polish`  
**Ticket:** `docs/tickets/HYDRATION-1-screener.md`  
**Modelo:** Composer  
**Tipo:** bug hydration screener — sin commit/push

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/HYDRATION-1-screener.md

Rama: codex/statsedge-ui-polish
Modelo: Composer

Alcance (solo esto):
1. Reproducir hydration mismatch en `/` (hard-reload) y localizar el nodo real (no parchear ScreenerShell a ciegas).
2. Fix mínimo de paridad SSR/cliente. Evitar suppressHydrationWarning en el árbol entero.
3. Test barato si cabe + ./vfc en tocados.

Sin IPO, scoring, nocturno, LOOK.
Sin commit ni push.

Al terminar, resume con la plantilla de retorno (Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ).
```

## Criterios de aceptación (orquestador)

1. Hard-reload `/` sin error de hydration (evidencia consola/overlay).
2. Mesa/IPO recientes siguen OK.
3. Commit tras verify.

## Residuales tras este

- Proceso B/A (opcional) · IPO-UX-F aparcado · QA dueño páginas.
