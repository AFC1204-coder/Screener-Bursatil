# VCP footprint — notación Minervini / SEPA (producto)

**Estado:** anotado dueño 2026-09-05 · sin cambio de motor aún  
**Memoria Claude:** `memory/vcp-footprint-notacion-minervini.md`

## Formato

**`XW Y/Z NT`** — ej. **`40W 31/3 4T`**

- **XW** — semanas de la base (o `40D` días)
- **Y/Z** — mayor (o primera) contracción % / última (más estrecha) %
- **NT** — número de tightenings (`4T`)

Conteo: **T1, T2, T3…** (o C1, C2…). Ideal 2–4, cada una ~½ de la anterior; última &lt;10 %.

## UI StatsEdge

| Evitar | Preferir |
|---|---|
| `2C·form·PV%`, “form”, nombres geométricos | `19W 22/7 3T` |
| Jerga de detector en mesa de caza | Huella + detalle en ficha/tooltip |

## Fila de caza (cuando se aplique a producto)

Presupuesto de atención: **pasar o abrir en ~1–2 s**. Nada más en la cinta.

| Campo | Por qué |
|---|---|
| **Ticker** | Identidad |
| **Spark semanal** (~12M, legible + MM) | Forma de la base sin abrir ficha |
| **Etapa · sem. N** (`weeklyStageWeek`) | Régimen + edad en etapa — no «Base / Con fuga» |
| **RS** (uno, canónico) | Fuerza relativa |
| **VCP footprint** `XW Y/Z NT` | Huella Minervini; `–` si no hay |
| **Máx 52s %** | Extensión / «¿llego tarde?» |

Fuera de la cinta (modo Auditoría / ficha): tema, cap, 3M, RS país/tema, jerga `form`/`PV`, veredictos.

Detalle T1–T3 → tooltip o ficha, no columnas extra en caza.

