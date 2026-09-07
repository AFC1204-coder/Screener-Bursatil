# AUTH-BOOT-1 — Arranque sin quedarse en «Comprobando acceso»

**Estado:** Cerrado `9f9b660` · smoke OK 2026-09-07  
**Prioridad:** P1 fricción diaria  
**Rama base:** `codex/statsedge-ui-polish` · aterrizado cherry-pick  
**Modelo:** Grok 4.6 / Cloud  
**Origen:** dueño 2026-09-07 — la banda/pantalla de comprobación de acceso tarda demasiado al cargar  
**Tipo:** boot / AuthGate — **no scoring**

## Problema

`app/AuthGate.jsx` (envuelve el layout) arranca con `loading: true` y pinta pantalla completa «Comprobando acceso» hasta que responde `GET /api/auth/session`. Si la petición va lenta (cold start, red, Mini), el usuario ve esa pantalla en vez del screener. Tras autenticar, `sessionReady` en `app/page.jsx` puede añadir otra espera antes de hidratar.

## Objetivo

Acortar o eliminar la sensación de bloqueo:

1. Medir/leer el camino: AuthGate → `/api/auth/session` → children → `sessionReady`.
2. Mejoras concretas (elegir las que quepan sin romper seguridad):
   - No bloquear UI entera si hay cookie/sesión reciente plausible (optimistic show + revalidar).
   - Timeout corto + UI no a pantalla completa (barra discreta vs main vacío).
   - Evitar `cache: "no-store"` si hay forma segura de reutilizar respuesta fresca.
   - Paralelizar lo que hoy espera a AuthGate innecesariamente.
3. Tests del contrato de sesión / AuthGate si existen o harness mínimo.
4. Sin debilitar el perímetro: token sigue siendo obligatorio cuando `requiresToken`.

## Fuera

- Cambiar el secreto / quitar AuthGate en prod.
- IPO-UX / LOGO / scoring / nocturno Mini.
- Commit a polish del dueño; rama cloud + resumen de retorno.

## Criterios

1. Con sesión válida, el tiempo visible de «Comprobando acceso» baja de forma medible (o desaparece a favor de shell + revalidación).
2. Sin sesión, el formulario de token sigue apareciendo.
3. `./vfc` / tests afectados OK.

## Archivos probables

- `app/AuthGate.jsx`
- `app/api/auth/session/route.js`
- `app/layout.jsx`
- `app/page.jsx` (`sessionReady`)
- `lib/cloudReauth.js` / session helpers
