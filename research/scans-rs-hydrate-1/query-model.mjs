#!/usr/bin/env node
/**
 * SCANS-RS-HYDRATE-1 — modelo estático de peticiones PostgREST en hidratación RS.
 * No toca producto. Ejecutar: node research/scans-rs-hydrate-1/query-model.mjs [symbolCount]
 */
const POSTGREST_MAX_ROWS = 1000;
const WEEKLY_RS_CONCURRENCY = 6;
const rowsPerSymbolCapGlobal = 60;
const chunkSizeGlobal = Math.floor(POSTGREST_MAX_ROWS / rowsPerSymbolCapGlobal); // 16

const chunkSizeCountryIntl = 16;
const chunkSizeTheme = 80;
const themeConcurrency = 4;
const themeEngines = 12;

function globalRsChunkQueries(symbolCount, { bulkSnapshot = true } = {}) {
  const bulkPages = bulkSnapshot ? Math.ceil(4868 / (WEEKLY_RS_CONCURRENCY * POSTGREST_MAX_ROWS)) + 1 : 0;
  const pending = bulkSnapshot ? Math.max(0, symbolCount - 3232) : symbolCount;
  const chunks = Math.ceil(pending / chunkSizeGlobal);
  const chunkQueries = chunks; // each chunk = 1 request; batches of 6 in parallel
  const batchRounds = Math.ceil(chunks / WEEKLY_RS_CONCURRENCY);
  return {
    bulkHead: bulkSnapshot ? 1 : 0,
    bulkPages,
    chunkQueries,
    batchRounds,
    totalHttp: (bulkSnapshot ? 1 + bulkPages * WEEKLY_RS_CONCURRENCY : 0) + chunkQueries,
  };
}

function countryIntlSequentialQueries(symbolCount) {
  const chunks = Math.ceil(symbolCount / chunkSizeCountryIntl);
  return { chunkQueries: chunks, batchRounds: chunks, totalHttp: chunks, pattern: "sequential-await" };
}

function themeRsQueries(symbolCount) {
  const perEngine = Math.ceil(symbolCount / themeEngines);
  const chunksPerEngine = Math.ceil(perEngine / chunkSizeTheme);
  const roundsPerEngine = Math.ceil(chunksPerEngine / themeConcurrency);
  const totalHttp = themeEngines * chunksPerEngine;
  return { perEngineSymbols: perEngine, chunksPerEngine, roundsPerEngine, totalHttp, enginesParallel: themeEngines };
}

const n = Number(process.argv[2] || 3576);

const core = {
  scanResultsPages: 4,
  globalRs: globalRsChunkQueries(n, { bulkSnapshot: true }),
  marketCap: { chunks: Math.ceil(n / 200), concurrency: 4, totalHttp: Math.ceil(n / 200) },
};

const extendedExtra = {
  countryUsDuplicateGlobal: globalRsChunkQueries(n, { bulkSnapshot: false }),
  themeRs: themeRsQueries(n),
};

const out = {
  ticket: "SCANS-RS-HYDRATE-1",
  symbolCount: n,
  corePathApproxHttp: core.scanResultsPages + core.globalRs.totalHttp + core.marketCap.totalHttp,
  extendedExtraHttp:
    extendedExtra.countryUsDuplicateGlobal.totalHttp + extendedExtra.themeRs.totalHttp,
  core,
  extendedExtra,
  notes: [
    "US country RS llama readGlobalRsForSymbols con US_EQUITY (= canonical) y bulkSnapshot:false → re-lee rs_weekly_items.",
    "readEngineCountryRsForSymbols (intl) usa for-await secuencial por chunk de 16.",
    "theme: hasta 12 engines en Promise.all; dentro de cada engine batches de 4 chunks.",
  ],
};

console.log(JSON.stringify(out, null, 2));
