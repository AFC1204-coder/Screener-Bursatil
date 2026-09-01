# Ticket activo — VCP-0

Ticket cerrado (verify 2026-09-01): entregable en `docs/auditoria-etapa1-etapa2-2026-09-01.md` + script. **Pendiente dueño:** aceptar ADR campo paralelo (`E2_ma_only` / `E2_structural`). Luego spec o VCP-1 con brief honesto.

**Cola:** **VCP-0** ✓ (ADR) → VCP-0b spec subestado **o** VCP-1 tanda 3 → VCP-2.

Detalle: `docs/tickets/VCP-0-auditoria-etapa1-etapa2.md`  
Propuesta: `docs/auditoria-etapa1-etapa2-semanal-propuesta-2026-09-01.md`

**MSI ancla:** POTENCIAL · E1 semanal sin ruptura (no E2 cazable).

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/VCP-0-auditoria-etapa1-etapa2.md
@docs/auditoria-etapa1-etapa2-semanal-propuesta-2026-09-01.md
@docs/tickets/activo.md
@lib/weeklyStage.js
@docs/auditoria-etapas-2026-08-16.md
@docs/diseno-indicadores-mercado-2026-08-17.md

Rama: codex/statsedge-ui-polish
Modelo: Grok 4.6 · esfuerzo High
Rol: auditoría metodológica read-only — NO implementar producto, NO editar weeklyStage.js, NO commit/push.

## Problema
weeklyStage.js clasifica Etapa 2 con precio > MM30s + pendiente al alza. No mira ruptura de base ni HH/HL. MSI: el código dice E2; el dueño ve base larga sin ruptura = E1 potencial, no E2 cazable.

## Entregables (en docs/research, no producto)
1. docs/auditoria-etapa1-etapa2-2026-09-01.md con:
   - Tabla libro → criterio operativo → medible en código (Weinstein, Minervini, O'Neil desde @research/books/).
   - Citas con capítulo/página cuando puedas leer el PDF. Si no puedes abrir un PDF, dilo — no inventes citas.
   - Definiciones candidatas medibles: «resistencia clave», ruptura, HH/HL en formación.
2. Muestra 15–20 símbolos: MSI ancla + mezcla tanda 3 (APH DELL F GE HPE MDLZ MMM NVDA SCHW STX VLO…) + algunos del nocturno si hay datos. Columnas: símbolo | etapa código | veredicto candidato E1/E2/dudoso | una línea por qué.
3. Script read-only en research/contracciones/arneses/ (p. ej. etapa-codigo-vs-candidato.mjs): compara weeklyStage vs reglas candidatas; imprime tabla; no escribe en DB ni cambia lib/.
4. ADR corto al final del doc: ¿cambiar clasificador / campo paralelo (pre_breakout, E2_ma_only) / solo UI y brief?
5. Nota para chart-brief.mjs: no decir «Etapa 2» sin subestado hasta ADR.

## Caso ancla (dueño)
MSI · POTENCIAL · PERIODO: 2025-09-11→2026-08-31 · base larga sin ruptura · semanal = E1 potencial, no E2 cazable · jun-ago = tendencia diaria, no el VCP semanal.

## Fuera de alcance
Cambiar weeklyStage, screener, setupPatterns, UI producto. MET-6 es otro ticket (RS stress).

## Retorno (pega aquí al orquestador)
## Resumen
(3–5 bullets)
## Archivos
(lista real creada)
## Tests
(comando script read-only + resultado, o n/a)
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
