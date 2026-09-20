# Ticket activo — OPS-MINI-SMOKE-1

**Estado:** activo · programación en Agent chat aparte  
**Rama:** `codex/statsedge-ui-polish` @ `b082656`  
**Modelo:** Composer 2.5 High (o Terra)  
**Origen:** plan datos/fiabilidad (Agent Store `docs/plan-datos-fiabilidad.md`) · eje #1 ops  
**Nota Mac:** computer-use es frágil; preferir Playwright/shell. Si el worker Mac cae, documentar y parar — no insistir.

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md

Eres programación StatsEdge (NO orquestador). Rama: codex/statsedge-ui-polish @ b082656.
Modelo: Composer 2.5 High (o Terra). SIN commit ni push.

Ticket OPS-MINI-SMOKE-1 — ops Mini + smoke Playwright (sin computer-use).

Alcance:
1) Documentar / automatizar check de Mini (:15432) + cómo arrancar túnel SSH
   si está caído (sin matar túnel existente si el puerto ya escucha).
2) Script o comando único de smoke Playwright headless contra :3300:
   home US, Caza (sparks o truth line), /review?symbol=AAPL (chart no stuck
   en «Cargando histórico…»). Escribir veredicto + PNGs a paths que indique
   el ticket o /tmp si store no escribible; resumen en retorno.
3) Si :3300/Mini no están: fallar con mensaje claro (no colgar).

No tocar scoring, auth prod, nocturno de producción, writers, VCP detector,
cobertura Europa profunda, ni computer-use.

Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ. Sin commit ni push.
```

## Objetivo

Dejar un camino **repetible** para comprobar que la sesión de caza US es usable sin depender de computer-use (que se desconecta en el Mac):

1. Saber si Mini/`127.0.0.1:15432` está UP; si no, pasos mínimos de túnel (`cristian@192.168.0.116`) sin matar un túnel ya vivo.  
2. Smoke Playwright headless en `:3300`: home, Caza, `/review?symbol=AAPL`.  
3. Salida: PASS/FAIL + capturas + texto de status (truth line / precio / «Cargando histórico…» ausente).

## Contexto

- Smoke AAPL ya PASS vía Playwright (2026-09-19) tras «Entrar en local».  
- Sin Mini → mesa 0; no inventar datos.  
- Preferir scripts en `scripts/` o `tests/e2e` al estilo del repo; no UI nueva salvo un indicador mínimo de «Mini UP/DOWN» si ya existe gancho trivial.

## Fuera de alcance

- Arreglar WiFi / worker Mac / Screen Recording  
- Yield Europa / FIRDS / Twelve Data  
- Hydrate scroll >80 (ticket siguiente)  
- Commit / push

## Done when

1. Hay un comando documentado (README corto en ticket o `scripts/… --help`) para check Mini + smoke.  
2. Smoke corre en Mac o cloud con acceso a `:3300`/`15432`; si no hay entorno, el retorno lo dice en LO QUE NO VERIFIQUÉ.  
3. Tests unitarios solo si tocas lógica parseable; `./vfc` si aplica.  
4. Retorno con plantilla; **sin commit ni push**.

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
