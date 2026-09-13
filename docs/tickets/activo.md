# Ticket activo — ASTRA Review brief T0/T1/T2

**Estado:** prep · espera decisión Astra (dueño pega en chat Astra)  
**Bloquea:** REVIEW-HYDRATE-DEFER-1  
**Doc:** `docs/tickets/ASTRA-REVIEW-BRIEF-T0T1T2.md`  
**HEAD:** `codex/statsedge-ui-polish` @ origin

## Prompt para Astra (copiar tal cual)

```
@docs/tickets/ASTRA-REVIEW-BRIEF-T0T1T2.md

Eres Astra en modo decisión de contrato (NO código).

Contexto StatsEdge Rapid Review: company-brief bloquea el critical path 2–6 s.
Diseño ya ACCEPT: T0 fila sesión → T1 chart/rs-weekly → T2 brief diferido/ficha.
REVIEW-REFETCH-1 cerrado. RS canónico = weeklyRs* de sesión.

Responde SOLO en el formato del doc:
A1 / A2 / A3 / A5 con códigos de opción (A1-S|A1-C|A1-H, etc.)
+ notas ≤5 líneas
+ autoriza o no REVIEW-HYDRATE-DEFER-1

Si una opción de la recomendación orquestador te parece mal, dilo y elige otra.
No inventes tickets nuevos fuera de la secuencia del doc.
```

## Tras respuesta Astra

Pegar aquí el bloque A1–A5. El orquestador escribe `REVIEW-HYDRATE-DEFER-1` y el prompt Composer.
