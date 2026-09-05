# MARKETS-COMPACT-1 — smoke Mini 2026-09-05

Host: `http://127.0.0.1:13000/` · deploy `marketAvailability.js` + `screenerFormat.js` · build · kickstart.

## Smoke desktop · Global (28 mercados) vs mesa US

| Superficie | Antes | Después |
|---|---|---|
| Truth | `selección: AT+AU+BE+…+ZA` | `mesa: US · 28 mercados en selección · selección ≠ mesa` |
| Status | `Cargando materializados (Estados Unidos + España + …)` | `Cargando 28 materializados…` |
| ACTUALIZANDO MESA | `Cargando datos de la selección (AT+AU+…)` | `Cargando 28 mercados…` |

Muro de códigos: **no**.

## Gates

- vitest marketAvailability + truth + misalignment: 82 passed
- `./vfc`: OK
