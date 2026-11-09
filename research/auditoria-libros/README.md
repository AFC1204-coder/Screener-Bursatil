# Auditoría libros ↔ código

Marco para que otros agentes verifiquen si el producto aplica bien los conceptos de los libros
(etapas, VCP, indicadores de mercado). Dos piezas:

1. **Biblioteca consultable** (texto privado, fuera de git)
2. **Matriz viva** `matriz.json` (versionada): criterio → regla medible → código → tests → pantalla

## 1. Biblioteca de libros

Los PDF están en `research/books/` y su texto extraído en `research/books/_text/` — ambos
**ignorados por git** y privados: se parafrasea y se cita «libro + página PDF», nunca se pegan
pasajes largos en docs ni en la app.

```bash
# una vez (macOS; PDFKit + OCR Vision para páginas sin capa de texto)
swiftc -O scripts/books/extract.swift -o /tmp/extract-books
/tmp/extract-books research/books research/books/_text --ocr

# buscar / leer / listar
NODE_NO_WARNINGS=1 node scripts/books/search.mjs "media móvil de 30 semanas" --book=weinstein-es
NODE_NO_WARNINGS=1 node scripts/books/search.mjs --page=46 --book=weinstein-es
NODE_NO_WARNINGS=1 node scripts/books/search.mjs --list
```

La «página» es el índice de página del PDF (1-based), no la impresa. Salidas: 0 bien, 1 sin
resultados, 2 uso o texto sin extraer. Slugs: `weinstein-es`, `minervini-think-trade`,
`minervini-mark`, `oneil-htmmis`, `momentum-masters`, `point-figure`, `livermore`.

## 2. Matriz viva

`matriz.json` → `rows[]` con: `id`, `tema` (etapas | vcp | mercado), `fuentes` (libro + páginas PDF),
`criterio` (parafraseado), `regla` (formulación medible), `codigo` (archivo + símbolo),
`tests`, `pantalla`, `estado_sep08` (línea base de la auditoría del 8-sep), `estado_actual`
(`null` = por verificar), `verificado` (commit + fecha; obligatorio si hay `estado_actual`) y `notas`.

Estados: `ok · parcial · no · riesgo · n/a · sin evaluar`.

`tests/auditoriaLibrosMatriz.test.js` evita que se pudra: ids únicos, esquema, que existan los
archivos, los símbolos y los tests citados y, si hay texto extraído, que las páginas quepan en el libro.

### Cómo auditar una fila (agentes)

1. Localizar el criterio en el libro con `search.mjs` y contrastar la página.
2. Leer el código citado en HEAD y los tests; si hace falta, medir con la base (solo lectura).
3. Rellenar `estado_actual` y `verificado`, y anotar la evidencia en `notas`.
4. Etiquetar cada afirmación del informe: `[LIBRO]`, `[CÓDIGO]`, `[MEDIDO]` o `[JUICIO]`.
5. No cambiar código de producto desde una auditoría: proponer y abrir ticket.

Filas con `codigo: []` son huecos reconocidos (p. ej. W8 en pantalla, M6/O5 recuento de bases,
MK1/MK6/MK7/MK8 indicadores de mercado no implementados).
