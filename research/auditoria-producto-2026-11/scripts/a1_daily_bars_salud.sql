-- A1. Salud de daily_bars (solo lectura)
\echo '== totales'
select count(*) filas, count(distinct symbol) simbolos, min(trade_date), max(trade_date) from daily_bars;
\echo '== duplicados (symbol, trade_date, owner)'
select count(*) from (select symbol, trade_date, owner_id from daily_bars group by 1,2,3 having count(*)>1) x;
\echo '== precios <=0 o nulos, OHLC incoherente, volumen 0 (desde 2025-10-01)'
select count(*) filter (where close<=0 or open<=0 or low<=0) precio_le0,
       count(*) filter (where close is null) close_null,
       count(*) filter (where high<low) high_lt_low,
       count(*) filter (where close>high*1.0001 or close<low*0.9999) close_fuera_rango,
       count(*) filter (where open>high*1.0001 or open<low*0.9999) open_fuera_rango,
       count(*) filter (where volume=0) vol0,
       count(*) filter (where volume is null) volnull,
       count(*) filter (where extract(isodow from trade_date) in (6,7)) finde,
       count(*)
from daily_bars where trade_date>='2025-10-01';
\echo '== volumen 0 por sufijo de mercado (desde 2025-10-01)'
select coalesce(nullif(split_part(symbol,'.',2),''),'US') mk, count(*) filas, count(*) filter (where volume=0) vol0,
 round(100.0*count(*) filter (where volume=0)/count(*),1) pct
from daily_bars where trade_date>='2025-10-01' group by 1 order by 2 desc limit 25;
