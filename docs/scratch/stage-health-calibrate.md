# MET-5-calibrate

```

Cobertura índice: 681/685 (99.4%)
Ausencias:
  discontinuous: 4

--- Etapa 2 (índice computable: 505) ---

Persistencia 30w (sem) (n=505)
  p10=6.0  p25=12.0  p50=20.0  p75=31.0  p90=54.0  p95=54.0  min=1.0  max=54.0

Histograma persistencia 30w (n=505)
0-4             42 ████████
5-9             36 ███████
10-14           93 █████████████████
15-19           63 ███████████
20-24          116 █████████████████████
25               1 
26+            154 ████████████████████████████

Persistencia 10w (sem) (n=505)
  p10=1.0  p25=2.0  p50=5.0  p75=11.0  p90=19.2  p95=21.0  min=1.0  max=43.0

Histograma persistencia 10w (n=505)
0                0 
1-3            173 ████████████████████████████
4-6            114 ██████████████████
7-9             48 ████████
10+            170 ████████████████████████████

|distanceSlowMaPct| (%) (n=505)
  p10=3.2  p25=6.6  p50=11.9  p75=21.5  p90=37.8  p95=48.1  min=0.0  max=107.6

Histograma |extensión| (n=505)
0-4             80 ██████████
5-14           214 ████████████████████████████
15-24          106 ██████████████
25-34           46 ██████
35-49           38 █████
50+             21 ███

Salud de etapa (0-100) (n=505)
  p10=45.0  p25=55.0  p50=70.0  p75=84.0  p90=90.0  p95=95.0  min=21.0  max=100.0

Histograma salud (n=505)
0-19             0 
20-39           27 ████
40-59          127 ███████████████████
60-79          187 ████████████████████████████
80-100         164 █████████████████████████

--- Etapa 4 (índice computable: 176) ---

Persistencia 30w (sem) (n=176)
  p10=2.0  p25=6.8  p50=14.5  p75=26.0  p90=41.0  p95=44.0  min=1.0  max=54.0

Histograma persistencia 30w (n=176)
0-4             34 ███████████████████
5-9             26 ███████████████
10-14           28 ████████████████
15-19           28 ████████████████
20-24            6 ███
25               4 ██
26+             50 ████████████████████████████

Persistencia 10w (sem) (n=176)
  p10=1.0  p25=3.0  p50=4.0  p75=8.0  p90=10.5  p95=13.0  min=1.0  max=19.0

Histograma persistencia 10w (n=176)
0                0 
1-3             68 ████████████████████████████
4-6             54 ██████████████████████
7-9             28 ████████████
10+             26 ███████████

|distanceSlowMaPct| (%) (n=176)
  p10=2.9  p25=6.4  p50=12.4  p75=20.3  p90=29.7  p95=38.9  min=0.1  max=55.4

Histograma |extensión| (n=176)
0-4             27 █████████
5-14            81 ████████████████████████████
15-24           41 ██████████████
25-34           16 ██████
35-49           10 ███
50+              1 

Salud de etapa (0-100) (n=176)
  p10=44.5  p25=54.0  p50=66.5  p75=77.0  p90=86.0  p95=90.0  min=21.0  max=95.0

Histograma salud (n=176)
0-19             0 
20-39           14 █████
40-59           45 ███████████████
60-79           82 ████████████████████████████
80-100          35 ████████████

=== Recomendación (MET-5-calibrate) ===
- Persistencia 30w: mantener 26 sem (30% en techo; p75=29.0, p90=48.0).
- Persistencia 10w: mantener 10 sem (p90=15.0; pocos en techo pero rampa corta útil).
- Extensión: mantener 15/50% (p50 |ext|=12.1%, p90=35.9%).
- Índice: buena dispersión (p90−p10=44 pts); fórmula discrimina con umbrales propuestos.

=== Ejemplos con desglose ===

NVDA · Etapa 2
  salud 44 · 30w 20.2/25 · 10w 4.0/10 · avance 0.0/20 · vol 0.0/25 · ext 20.0/20
  30w=21sem, 10w=4sem, Δavance=3.2% vs 19.2%, vol=0.92×, |ext|=9.1%, weekInStage=16

AAPL · Etapa 2
  salud 80 · 30w 19.2/25 · 10w 1.0/10 · avance 15.0/20 · vol 25.0/25 · ext 20.0/20
  30w=20sem, 10w=1sem, Δavance=2.5% vs 0.0%, vol=1.36×, |ext|=10.4%, weekInStage=20

META · Etapa 4
  salud 67 · 30w 5.8/25 · 10w 6.0/10 · avance 20.0/20 · vol 15.0/25 · ext 20.0/20
  30w=6sem, 10w=6sem, Δavance=-8.5% vs -2.3%, vol=1.19×, |ext|=5.0%, weekInStage=6

GOOGL · Etapa 2
  salud 25 · 30w 4.8/25 · 10w 0.0/10 · avance 0.0/20 · vol 0.0/25 · ext 20.0/20
  30w=5sem, 10w=3sem, Δavance=-8.8% vs 22.1%, vol=0.72×, |ext|=1.6%, weekInStage=5

AMZN · Etapa 2
  salud 45 · 30w 4.8/25 · 10w 5.0/10 · avance 0.0/20 · vol 15.0/25 · ext 20.0/20
  30w=5sem, 10w=5sem, Δavance=-1.6% vs 28.9%, vol=1.25×, |ext|=10.7%, weekInStage=5

TSLA · Etapa 4
  salud 79 · 30w 12.5/25 · 10w 1.0/10 · avance 20.0/20 · vol 25.0/25 · ext 20.0/20
  30w=13sem, 10w=1sem, Δavance=-20.0% vs 8.3%, vol=0.93×, |ext|=9.2%, weekInStage=7

AMD · Etapa 2
  salud 37 · 30w 21.2/25 · 10w 0.0/10 · avance 0.0/20 · vol 0.0/25 · ext 16.1/20
  30w=22sem, 10w=2sem, Δavance=-9.8% vs 157.8%, vol=0.92×, |ext|=21.9%, weekInStage=22

INTC · Etapa 2
  salud 45 · 30w 25.0/25 · 10w 0.0/10 · avance 0.0/20 · vol 0.0/25 · ext 20.0/20
  30w=54sem, 10w=8sem, Δavance=-22.0% vs 151.4%, vol=0.79×, |ext|=4.3%, weekInStage=44

F · Etapa 2
  salud 50 · 30w 15.4/25 · 10w 0.0/10 · avance 0.0/20 · vol 15.0/25 · ext 20.0/20
  30w=16sem, 10w=1sem, Δavance=-19.6% vs 25.3%, vol=1.21×, |ext|=3.9%, weekInStage=14

NFLX · Etapa 4
  salud 64 · 30w 19.2/25 · 10w 0.0/10 · avance 0.0/20 · vol 25.0/25 · ext 20.0/20
  30w=20sem, 10w=3sem, Δavance=-5.0% vs -10.6%, vol=0.98×, |ext|=3.3%, weekInStage=20

JNJ · Etapa 2
  salud 100 · 30w 25.0/25 · 10w 10.0/10 · avance 20.0/20 · vol 25.0/25 · ext 20.0/20
  30w=54sem, 10w=10sem, Δavance=19.5% vs -8.8%, vol=1.78×, |ext|=10.8%, weekInStage=44

EVH · Etapa 2
  salud 21 · 30w 3.8/25 · 10w 0.0/10 · avance 0.0/20 · vol 0.0/25 · ext 16.9/20
  30w=4sem, 10w=6sem, Δavance=16.5% vs 21.5%, vol=0.95×, |ext|=20.3%, weekInStage=4

Tiempo: 11.2s · concurrencia=12
```
