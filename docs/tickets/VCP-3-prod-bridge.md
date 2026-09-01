# VCP-3-prod-bridge — Un solo VCP en producto (unificado)

**Estado:** activo (reescrito tras feedback dueño: no duplicar)  
**Rama:** `codex/statsedge-ui-polish`  
**ADR:** `docs/adr-vcp-reconfig-selectividad-2026-09-01.md` (§5)

## Decisión de producto

**No** segunda ficha de caza, **no** campo paralelo `vcpQualityProposal`, **no** segundo indicador en pantalla.

Un solo hilo: el motor que ya pasó golden (v7 + G1–G3) **sustituye por dentro** la lógica que hoy alimenta el VCP que ya existe (`vcpCandidate`, veredicto metodología, píldora VCP, gráfico en ficha).

El usuario sigue viendo lo de siempre («VCP plan válido», «VCP estricto», evidencia en gráfico). Cambia **la calidad** de lo que enciende esas luces, no el número de luces.

## Alcance

### Sí

1. **`lib/vcpEngine.mjs`** (nombre orientativo): portar desde research `detectV7` + `shadow-gates` (evaluación episodio activo, cierre post-fallo, G1–G3). Sin `import` de `research/` en runtime app.
2. **`setupPatternForBars`** (`lib/setupPatterns.js`): detrás de flag `STATSEDGE_VCP_UNIFIED=1`, calcular `vcpCandidate` (y campos que dependan de él: `patternFamily`, contracciones, etc.) con el motor nuevo. Flag **OFF** = comportamiento actual (rollback).
3. **Misma superficie UI**: no nuevas fichas hunt, no nueva columna, no nuevo filtro con otro nombre. Reutilizar `vcpReliability` / `methodologyVerdict` / overlay VCP en ficha.
4. **Reconfig en el mismo motor**: episodio cerrado → no `vcpCandidate`; episodio N+1 tight → vuelve a encender (VLO). Integrar con `failedBreakout` para no bloquear reconfig (cerrar N, no matar el símbolo).
5. **Arnés**: `rubric-gap.mjs` prod = mismo `setupPatternForBars` (ya es así); tras unificar, re-ejecutar y comprobar golden shadow ≈ prod con flag ON.
6. **Tests**: unitarios motor + tests existentes `vcpReliability` / setupPatterns que no rompan con flag OFF; casos golden con flag ON en test dedicado (fixtures o Supabase si configurado).
7. README research: una sección «prod = mismo motor».

### No

- Ficha «VCP calidad» ni `vcpQualityProposal`.
- Copiar v4 suelto sin gates.
- Cambiar textos visibles de metodología salvo que el veredicto sea más honesto con el mismo label.
- Commit ni push.

## Criterios de aceptación

| Comprobación | Esperado |
|--------------|----------|
| Flag OFF | diff comportamiento = cero vs HEAD (salvo código muerto detrás de flag) |
| Flag ON + golden anclas | mismos sí/no que shadow en arnés (GOOGL/VLO sí; NDAQ/HPE/MSI/ELV/MSGS/BEKE no) |
| UI | sin elementos nuevos; misma píldora/labels VCP |
| Tests | pasan OFF y ON donde aplique |
| Smoke Browser Use | 2–3 símbolos conocidos en ficha; sin segunda capa VCP |

## Riesgo / gate dueño

Tocar `vcpCandidate` puede mover bonuses colaterales (`breakoutQualityScore`, tags metodología). **No commit** hasta OK dueño tras ver diff + smoke. Orquestador documenta si cambia conteo en scan.

## Fuera de este ticket

- Cap global en mesa (si hace falta, filtro existente + orden, no producto nuevo).
- Retirar labels legacy redundantes («VCP estricto» vs «plan válido») — otro ticket UX si molesta.
