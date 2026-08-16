-- Añade la distancia al máximo de 52 semanas al histórico change-only.
--
-- Por qué ahora: el escaneo nocturno empieza a escribir scan_symbol_history
-- (2026-08-16) y rellenarla sin este campo dejaría la memoria larga sin el
-- único de los tres deltas del diseño «qué ha cambiado» que la tabla no
-- cubría (docs/diseno-que-cambio-2026-08-16.md, B.8.2: la tabla «no guarda
-- ninguna forma de distancia al máximo»). Rellenar mal es peor que no
-- rellenar: se añade el campo ANTES de la primera escritura del nocturno.
--
-- Semántica: el mismo distance52w del escáner (highDist, en %, ≤ 0: cierre
-- contra el máximo de los high de las 252 barras más recientes, incluida la
-- de hoy). Nullable — un dato no medido se guarda ausente, no como cero.
-- Sin check de rango a propósito: un check demasiado estricto tumba la tanda
-- entera del POST (el modo de fallo que dejó a 6/6 corridas EU sin escribir),
-- y el rango real depende del proveedor de barras.
--
-- NO se añade ninguna change reason nueva: la métrica incluye la barra de hoy
-- en el máximo, así que «marcó máximo nuevo» no es derivable de forma exacta
-- de este campo; el decisor change-only queda igual y este campo viaja en las
-- filas que ya se escriben (primera aparición, cambios, ancla semanal).
--
-- Aditiva salvo el check de forma de ausencia, que se recrea para exigir
-- también distance_52w null en una salida del universo (una fila de ausencia
-- no arrastra métricas — mismo contrato que el resto de campos técnicos).

alter table public.scan_symbol_history
  add column if not exists distance_52w numeric;

alter table public.scan_symbol_history
  drop constraint if exists scan_symbol_history_out_of_universe_shape;

alter table public.scan_symbol_history
  add constraint scan_symbol_history_out_of_universe_shape
    check (
      absence_reason <> 'not_in_universe'
      or (
        data_as_of is null
        and stage is null
        and stage_week is null
        and rs_global is null
        and rs_benchmark is null
        and rs_country is null
        and rs_sector is null
        and composite_score is null
        and distance_52w is null
        and composite_coverage = 0
        and composite_partial = true
      )
    );
