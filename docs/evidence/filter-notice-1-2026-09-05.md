# Evidencia — FILTER-NOTICE-1 (2026-09-05)

## Cambio

- `snapshotNoticeForPersistence` excluye `filter-layers-upgrade`.
- `resolveSnapshotNotice` ignora primary efímero ya persistido.
- Copy sin «Más filtros»; botón **Entendido**.

## Verify

- Vitest: 59 tests; `./vfc` OK (2671+).
- Smoke Mini `http://127.0.0.1:13000/` hard-reload: **sin** banner «Filtros actualizados» / «Más filtros» (sesión ya en v3 + no reencarna el notice persistido). Queda otro aviso legítimo («Datos incompletos» muestreo).
