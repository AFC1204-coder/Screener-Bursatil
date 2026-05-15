import { disabledPayload, finiteOrNull, supabaseConfig, supabaseRequest, textOrNull, toTimestamp } from "@/lib/supabaseServer";

function scanPayload(scan = {}, ownerId) {
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  return {
    owner_id: ownerId,
    local_id: textOrNull(scan.id) || crypto.randomUUID(),
    name: textOrNull(scan.name) || `Scan ${new Date().toLocaleString()}`,
    preset: textOrNull(scan.preset),
    settings: scan.settings || {},
    market_score: finiteOrNull(scan.marketScore),
    market_regime: textOrNull(scan.marketRegime),
    row_count: rows.length,
    created_at: toTimestamp(scan.createdAt),
    updated_at: new Date().toISOString(),
  };
}

function resultPayload(row = {}, scanId, ownerId, index) {
  return {
    owner_id: ownerId,
    scan_id: scanId,
    symbol: textOrNull(row.symbol) || "-",
    company_name: textOrNull(row.companyName || row.name || row.symbol),
    country: textOrNull(row.country),
    sector: textOrNull(row.sector),
    industry: textOrNull(row.industry),
    theme: textOrNull(row.theme),
    rank_index: index + 1,
    total_score: finiteOrNull(row.totalScore),
    weinstein_score: finiteOrNull(row.weinsteinScore),
    minervini_score: finiteOrNull(row.minerviniScore),
    risk_score: finiteOrNull(row.riskScore),
    rs_rating: finiteOrNull(row.rsRating),
    metrics: {
      perf3m: row.perf3m ?? null,
      perf6m: row.perf6m ?? null,
      perf12m: row.perf12m ?? null,
      distance20d: row.distance20d ?? null,
      distance50d: row.distance50d ?? null,
      distance52w: row.distance52w ?? null,
      extSma50: row.extSma50 ?? null,
      avgVolume: row.avgVolume ?? null,
      latestVolume: row.latestVolume ?? null,
      avgTurnover: row.avgTurnover ?? null,
      latestTurnover: row.latestTurnover ?? null,
      relativeVolume: row.relativeVolume ?? null,
      volumeSurgePct: row.volumeSurgePct ?? null,
      upDownVolRatio: row.upDownVolRatio ?? null,
      shortPercentOfFloat: row.shortPercentOfFloat ?? null,
      sharesPercentSharesOut: row.sharesPercentSharesOut ?? null,
      shortRatio: row.shortRatio ?? null,
      sharesShort: row.sharesShort ?? null,
      floatShares: row.floatShares ?? null,
      volumeScore: row.volumeScore ?? null,
      volumeEffectScore: row.volumeEffectScore ?? null,
      volumeEvidence: row.volumeEvidence ?? null,
      liquidityScore: row.liquidityScore ?? null,
      sectorScore: row.sectorScore ?? null,
      growthScore: row.growthScore ?? null,
      setupQualityScore: row.setupQualityScore ?? null,
    },
    raw: row,
  };
}

function scanFromDb(row, results = []) {
  return {
    id: row.local_id || row.id,
    cloudId: row.id,
    createdAt: row.created_at,
    name: row.name,
    preset: row.preset,
    settings: row.settings || {},
    marketScore: finiteOrNull(row.market_score),
    marketRegime: row.market_regime || "sin dato",
    rows: results
      .filter((item) => item.scan_id === row.id)
      .sort((a, b) => (a.rank_index || 0) - (b.rank_index || 0))
      .map((item) => item.raw || {
        symbol: item.symbol,
        companyName: item.company_name,
        country: item.country,
        sector: item.sector,
        industry: item.industry,
        theme: item.theme,
        totalScore: finiteOrNull(item.total_score),
        weinsteinScore: finiteOrNull(item.weinstein_score),
        minerviniScore: finiteOrNull(item.minervini_score),
        riskScore: finiteOrNull(item.risk_score),
        rsRating: finiteOrNull(item.rs_rating),
        ...(item.metrics || {}),
      }),
  };
}

async function saveScan(scan, ownerId) {
  const [saved] = await supabaseRequest("scans", {
    method: "POST",
    query: "on_conflict=owner_id,local_id",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [scanPayload(scan, ownerId)],
  });
  await supabaseRequest("scan_results", {
    method: "DELETE",
    query: `scan_id=eq.${encodeURIComponent(saved.id)}`,
  });
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  if (rows.length) {
    for (let i = 0; i < rows.length; i += 300) {
      await supabaseRequest("scan_results", {
        method: "POST",
        prefer: "return=minimal",
        body: rows.slice(i, i + 300).map((row, offset) => resultPayload(row, saved.id, ownerId, i + offset)),
      });
    }
  }
  return { ...saved, row_count: rows.length };
}

export async function GET(req) {
  const config = supabaseConfig();
  if (!config.configured) return Response.json({ ...disabledPayload(), scans: [] });
  const { searchParams } = new URL(req.url);
  const includeRows = searchParams.get("includeRows") !== "0";
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);
  try {
    const scans = await supabaseRequest("scans", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&select=*&order=created_at.desc&limit=${limit}`,
    });
    let results = [];
    if (includeRows && scans.length) {
      const ids = scans.map((scan) => scan.id).join(",");
      results = await supabaseRequest("scan_results", {
        query: `scan_id=in.(${ids})&select=*&order=rank_index.asc`,
      });
    }
    return Response.json({
      configured: true,
      ok: true,
      scans: scans.map((scan) => scanFromDb(scan, results)),
    });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}

export async function POST(req) {
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    const body = await req.json();
    const scans = body.scans || (body.scan ? [body.scan] : []);
    const saved = [];
    for (const scan of scans) saved.push(await saveScan(scan, config.ownerId));
    return Response.json({ configured: true, ok: true, saved: saved.length, scans: saved });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}

export async function DELETE(req) {
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "Falta id" }, { status: 400 });
  try {
    await supabaseRequest("scans", {
      method: "DELETE",
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&local_id=eq.${encodeURIComponent(id)}`,
    });
    return Response.json({ configured: true, ok: true });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
  }
}
