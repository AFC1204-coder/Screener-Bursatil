# UX-FILTERS — Rediseño presentación y configuración de filtros

**Estado:** Propuesto · **Origen:** dueño 2026-08-28 (junto IPO-1)  
**Contexto:** mesa de vistas (UX-5…9), deuda UX-15 (toggle vs expandir), familias en sidebar/modal desalineadas con uso real.

## Problema

Los filtros existen en capas (`EXECUTION_LAYERS`), familias (`FILTER_FAMILY_PRESETS`), modal «+ Filtro», chips y sidebar — pero la **presentación y el gesto de configuración** no son coherentes:

- Toggle de familia vs «Ajustar» mezclados (UX-15).
- Copy desactualizado en familias (UX-10 RS; IPO aún peor si se abre sin datos).
- Umbrales ocultos en presets hunt vs reglas explícitas en modal.
- IPO es el caso extremo: preset institucional + empty state permanente.

## Objetivo

Rediseño **de raíz** (no parches por familia): mismo patrón para **todas** las familias — qué se ve, cómo se enciende/apaga, cómo se ajusta, impacto N/M, relación con fichas hunt.

## Alcance spec (fase 0 — sin código aún)

1. Inventario actual: sidebar, modal familia, chips, rail hunt, «¿Qué recorta?».
2. Principios: toggle capa ≠ editor de reglas; discovery vs strict por ficha; ausencia de dato declarada.
3. Wire mínimo: familia IPO como **piloto** + una familia densa (RS) + una opcional (Estructura).
4. Migración: no romper sesión/localStorage; compat presets hunt.

## Relación

- **IPO-1d** implementa familia IPO bajo este marco.
- UX-15 puede absorberse aquí o cerrarse como sub-tarea.

## Fuera

- Cambiar semántica de scoring o scan nocturno.
- Nuevos indicadores (VCP track aparte).

Modelo spec: **Gemini 3.7 Flash** o **Fable 5** (brief) · implementación tras OK dueño.
