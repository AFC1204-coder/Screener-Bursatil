# Evidencia — SAMPLE-NOTICE-1 (2026-09-05)

## Cambio

- Truncado sin stale → label «Muestra» / «Universo parcial», tone `info`, copy sin «este dispositivo».
- Dismiss **Entendido** + CTA **Traer datos frescos**.

## Verify

- Vitest 37; `./vfc` OK.
- Smoke Mini `:13000`: notice plantado `Universo parcial` + clase `info` + Entendido/Traer; dismiss limpia el banner. Sin «Datos incompletos» ni «este dispositivo».
