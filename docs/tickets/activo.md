# Ticket activo — LOGO-1

**Estado:** Activo (programación Grok / Composer)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Grok 4.6 o Composer  
**Copia:** `docs/tickets/LOGO-1-empresa-mesa-ficha.md`

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md
@docs/tickets/LOGO-1-empresa-mesa-ficha.md

Rama: codex/statsedge-ui-polish
Modelo: Grok 4.6 (o Composer)

Alcance LOGO-1:
1) Portada ficha (/stock): en StockVerdictHead / .stockLogoPro usar visual.logoUrl → clearbitLogoUrl (logoCandidates + onError); si fallan → iniciales. Hoy solo pinta iniciales y deja logoCandidates sin usar.
2) Mesa: añadir website + logoDomain a scanLightProjection (TABLE_FIELDS / lista canónica) + test scanLightProjection.
3) CompanyMark: con dominio, Google favicon y fallback Clearbit al fallar; sin dominio → iniciales.
No scoring, no IPO-UX, no sticky medias/filtros, no backfill SQL masivo.
Tests + ./vfc si aplica.
Sin commit ni push. Plantilla de retorno del ticket.
```

## Tú (dueño) — solo humano

1. Entra en StatsEdge en Chrome (`localhost:3000`) y avisa **listo** → orquestador smoke IPO-UX-A (chips) + LOGO cuando Grok acabe.  
2. Nav IPO (sacar vs «Vigiladas pre-IPO») → cuando toque IPO-UX-C.  
3. Hard-reload ficha: Media 1 debe dejar escribir **50** (fix ya en rama).

## Cola tras LOGO

- IPO-UX-B · IPO-UX-C · sticky 0 filtros (mini)
