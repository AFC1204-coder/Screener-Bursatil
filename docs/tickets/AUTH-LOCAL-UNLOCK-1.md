# AUTH-LOCAL-UNLOCK-1

**Estado:** hecho (ACCEPT · 2026-09-13)  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P1  
**MODE:** IMPLEMENTACIÓN  
**Cierre:** `localUnlock` emite cookie en non-prod + host local; AuthGate «Entrar en local». Tests 23. Smoke `:3300` next dev OK.

## PASS smoke

- GET `localUnlockAvailable: true`  
- Clic «Entrar en local» → autenticado, screener visible, sin pegar token  
- Nota: `next start` usa `NODE_ENV=production` → unlock no disponible; usar `next dev` en local
