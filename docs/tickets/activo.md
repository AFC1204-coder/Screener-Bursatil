# Ticket activo — OPS-MINI-HARDEN-1

**Estado:** programación cloud  
**Rama base:** `codex/statsedge-ui-polish` @ `3da0081`  
**Ticket:** `docs/tickets/OPS-MINI-HARDEN-1.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md @docs/tickets/OPS-MINI-HARDEN-1.md

Eres programación StatsEdge (NO orquestador). Base: codex/statsedge-ui-polish @ 3da0081.
Rama propia cursor/ops-mini-harden-a41e. SIN commit/push a polish. Modelo: Composer 2.5.

Ticket OPS-MINI-HARDEN-1 — blindar Mini como hábito diario.

Ya existe OPS-MINI-SMOKE-1 (scripts/ops/mini-tunnel.mjs, ops-mini-smoke.mjs, mini-smoke-playwright.mjs, docs/ops-mini-smoke.md, npm run ops:mini-smoke[:start]). NO reescribir desde cero: extender.

Alcance:
1) npm run ops:mini:daily (+ ops:mini:check = preflight sin Playwright).
2) Preflight: :15432, hint DATABASE_URL/Mini, :3300; mensajes ES claros; exit ≠0; --start-tunnel opcional.
3) Smoke diario reusa ops-mini-smoke (home US, Caza, review AAPL).
4) Docs ritual «al abrir caza → un comando».
5) Tests si helpers puros; ./vfc o vitest del ticket verde.

No: nocturno/scoring/auth/FIRDS/computer-use/matar procesos ajenos.

Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ.
```

## Notas orquestador

- Gate: ops (no scoring). Smoke real Mini solo si Mac/túnel UP; si no, tests + dry preflight.
- Cola D Twelve Data / 1B sigue aparcada.
