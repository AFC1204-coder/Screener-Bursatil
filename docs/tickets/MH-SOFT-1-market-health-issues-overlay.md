# MH-SOFT-1 — Salud de mercado: 9 «issues» Next = timeouts ruidosos

**Estado:** Hecho (orquestador · smoke `/market-health` · Issues 9→1 tooling)  
**Prioridad:** P1 (ruido dev / sensación de rotura)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** dueño · overlay Next «9 Issues» · captura issue 3/9 `fetchJsonWithTimeout` → «El servidor de datos tardó demasiado… (más de 8 s)» en `app/market-health/page.jsx`.

## Qué es (y qué no)

No son 9 defectos de producto distintos. En `/market-health`, `load()` + cobertura/metodología hacen varios `fetchJsonWithTimeout`. Cada AbortError hace:

1. `console.error` dentro de `fetchJsonWithTimeout`, y  
2. otro `console.error` en el `.allSettled` / `catch` del caller.

Next.js 14 Dev Overlay trata **cada** `console.error` como un Issue → badge 9/N.

La UI ya degrada con mensajes de producto («amplitud no disponible», etc.). El problema es **ruido + throw** que hincha el overlay, no un panel rojo vacío.

**Fuera de alcance (no confundir):**

- Hydration con `data-cursor-ref` inyectado por automatización Cursor/Browser — falso positivo de tooling, no del app.  
- IPO-UX-F · scoring · refactor chart.  
- Acelerar Mini/PG de raíz (si hay query lenta, solo nota en LO QUE NO VERIFIQUÉ; no ops Mini en este ticket salvo lectura).

## Alcance

1. Inventario: listar todas las rutas `console.error` en `app/market-health/page.jsx` (+ helpers) y cuántos Issues genera un hard-reload con APIs lentas/timeout.
2. Fix mínimo:
   - Timeout/AbortError esperado → **un solo** registro silencioso (`console.warn` o logger sin overlay) **o** ningún log si la UI ya muestra el aviso.
   - No `throw` + `console.error` duplicado en el mismo fallo.
   - Mantener copy de usuario en pantalla (ya existe `userFacingServiceError`).
3. Tests: unit del helper timeout (AbortError → error presentable sin doble log; o contrato del soft-fail). `./vfc` tocados.
4. Sin commit/push.

## Criterios

1. Hard-reload `/market-health` con red normal: badge Issues de Next **no** se llena de timeouts duplicados (ideal 0 por timeout esperado; máximo 1 warn si se deja diagnóstico).
2. Si un endpoint falla/timeout: la tarjeta correspondiente sigue mostrando ausencia honesta (amplitud / titulares / cobertura…), sin tumbar toda la página salvo fallo duro de `/api/market-health` (comportamiento actual aceptable).
3. Vitest tocados verdes.

## Smoke orquestador

Hard-reload `/market-health` · contar Issues overlay · capturar que amplitud/titulares degradan sin spam.
