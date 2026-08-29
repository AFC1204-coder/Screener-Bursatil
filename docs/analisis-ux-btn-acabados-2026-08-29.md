# Análisis UX — Acabados de botones / teclas (brief UX-BTN)

**Fecha:** 2026-08-29  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo brief:** Gemini 3.7 Flash  
**Ticket origen:** `docs/tickets/UX-BTN-acabados-brief.md`  
**Verificación orquestador:** citas CSS comprobadas en filesystem —  
`components.css:4421` (`.btn…, .compactSeg button`), `:2626` (`.marketChip.active` + `--accent` tiza), `:1289` (nav chart reposo ámbar/`--accent`), `:6773` (`.btnPrimary` gradient + `translateY` `!important`). Tokens v2: `--radius-s` 3 / `--radius` 6 / `--cta-bg` tiza.

---

## Resumen

Fragmentación severa por capas CSS históricas. Segmented (`.compactSeg`) rotos por herencia global `.btn`. Chart nav parece activo en reposo. Primary con gradiente claro `!important`. Chips de mercado con fondo `--accent` (tiza sólida) en active. Unificar en **5 familias** bajo Pizarra y Tiza (tokens v2) vía **6 tickets** CSS/tokens, sin rediseño de marca ni metodología.

## Familias (hoy → propuesto)

1. **Primary / Ghost / Pager** — gradiente `!important` → CTA tiza sólida; alturas 32/36; pager 32×32.  
2. **Segmented / keycaps** — desacoplar de `.btn`; pozo + tecla activa `--surface`/`--line2`.  
3. **Hunt rail** — radio 8→6; activo sin `--senal-dim` genérico.  
4. **Market chips** — quitar active blanco-tiza; contorno `--line2`/`--line3`.  
5. **Chart icon-nav** — reposo pizarra/`--line2`; 30×30; hex → tokens.

## Reglas de acabado (7)

1. Radios solo 3 / 6 / 999.  
2. Reposo = pizarra/tiza; ámbar/azul solo veredicto/RS.  
3. Tecla activa por elevación de superficie, no `#fff`.  
4. Primary = `--cta-bg` / `--cta-fg`, sin gradient ni rebote.  
5. Icon-nav 1:1 (30/32).  
6. Disabled = `--ghost` / opacity 0.40.  
7. Sin `!important` que contamine hijos compuestos.

## Tickets

| ID | Prio | Título |
|---|---|---|
| UX-BTN-1 | P1 | Segmented / keycaps unificados |
| UX-BTN-2 | P1 | Primary / Ghost / Pager |
| UX-BTN-3 | P2 | Chart floating nav |
| UX-BTN-4 | P2 | Stock decision rail |
| UX-BTN-5 | P2 | Hunt rail + «+ Filtro» |
| UX-BTN-6 | P3 | Market / country chips |

**Orden:** 1 → 2 → 3 → 4 → 5 → 6.

## Fuera

Tabla densidades · scoring/orden · copy verdad · CLEAN-2 · infoHints (UX-23).

## LO QUE NO VERIFICÓ el brief

- Táctil 390px con nuevos tamaños segmented.  
- Popovers nube / sesión Supabase.
