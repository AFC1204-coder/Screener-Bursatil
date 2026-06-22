import { businessThemeKey } from "@/lib/businessTheme";

const PEERS = [
  { symbol: "NVDA", name: "NVIDIA", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductors", country: "US" },
  { symbol: "AVGO", name: "Broadcom", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductors", country: "US" },
  { symbol: "AMD", name: "Advanced Micro Devices", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductors", country: "US" },
  { symbol: "TSM", name: "Taiwan Semiconductor", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductors", country: "US" },
  { symbol: "ASML.AS", name: "ASML", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductor Equipment", country: "NL" },
  { symbol: "ARM", name: "Arm Holdings", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductors", country: "US" },
  { symbol: "AMAT", name: "Applied Materials", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductor Equipment", country: "US" },
  { symbol: "LRCX", name: "Lam Research", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductor Equipment", country: "US" },
  { symbol: "KLAC", name: "KLA", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductor Equipment", country: "US" },
  { symbol: "MU", name: "Micron Technology", theme: "Semis / fotonica", sector: "Technology", industry: "Semiconductors", country: "US" },

  { symbol: "0700.HK", name: "Tencent Holdings", theme: "Internet / plataformas", sector: "Communication Services", industry: "Internet Content & Information", country: "HK" },
  { symbol: "9988.HK", name: "Alibaba Group", theme: "Internet / plataformas", sector: "Consumer Cyclical", industry: "Internet Retail", country: "HK" },
  { symbol: "9618.HK", name: "JD.com", theme: "E-commerce / plataformas", sector: "Consumer Cyclical", industry: "Internet Retail", country: "HK" },
  { symbol: "3690.HK", name: "Meituan", theme: "Internet / plataformas", sector: "Communication Services", industry: "Internet Content & Information", country: "HK" },
  { symbol: "1024.HK", name: "Kuaishou Technology", theme: "Social video / creadores", sector: "Communication Services", industry: "Internet Content & Information", country: "HK" },
  { symbol: "9888.HK", name: "Baidu", theme: "Internet / plataformas", sector: "Communication Services", industry: "Internet Content & Information", country: "HK" },
  { symbol: "9999.HK", name: "NetEase", theme: "Gaming / entretenimiento digital", sector: "Communication Services", industry: "Electronic Gaming & Multimedia", country: "HK" },
  { symbol: "1810.HK", name: "Xiaomi", theme: "Consumer tech / plataformas", sector: "Technology", industry: "Consumer Electronics", country: "HK" },
  { symbol: "BILI", name: "Bilibili", theme: "Social video / creadores", sector: "Communication Services", industry: "Internet Content & Information", country: "CN" },
  { symbol: "PDD", name: "PDD Holdings", theme: "E-commerce / plataformas", sector: "Consumer Cyclical", industry: "Internet Retail", country: "CN" },
  { symbol: "SE", name: "Sea Limited", theme: "Gaming / e-commerce", sector: "Communication Services", industry: "Electronic Gaming & Multimedia", country: "SG" },
  { symbol: "META", name: "Meta Platforms", theme: "Social / publicidad digital", sector: "Communication Services", industry: "Internet Content & Information", country: "US" },
  { symbol: "GOOGL", name: "Alphabet", theme: "Internet / publicidad digital", sector: "Communication Services", industry: "Internet Content & Information", country: "US" },
  { symbol: "TTWO", name: "Take-Two Interactive", theme: "Gaming / entretenimiento digital", sector: "Communication Services", industry: "Electronic Gaming & Multimedia", country: "US" },
  { symbol: "EA", name: "Electronic Arts", theme: "Gaming / entretenimiento digital", sector: "Communication Services", industry: "Electronic Gaming & Multimedia", country: "US" },

  { symbol: "RHM.DE", name: "Rheinmetall", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "DE" },
  { symbol: "LDO.MI", name: "Leonardo", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "IT" },
  { symbol: "HO.PA", name: "Thales", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "FR" },
  { symbol: "SAF.PA", name: "Safran", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "FR" },
  { symbol: "BA.L", name: "BAE Systems", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "GB" },
  { symbol: "LMT", name: "Lockheed Martin", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "US" },
  { symbol: "RTX", name: "RTX", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "US" },
  { symbol: "NOC", name: "Northrop Grumman", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "US" },
  { symbol: "GD", name: "General Dynamics", theme: "Defensa / aeroespacial", sector: "Industrials", industry: "Aerospace & Defense", country: "US" },

  { symbol: "MSFT", name: "Microsoft", theme: "Software / IA", sector: "Technology", industry: "Software", country: "US" },
  { symbol: "PLTR", name: "Palantir", theme: "Software / IA", sector: "Technology", industry: "Software - Infrastructure", country: "US" },
  { symbol: "NOW", name: "ServiceNow", theme: "Software / IA", sector: "Technology", industry: "Software - Application", country: "US" },
  { symbol: "CRM", name: "Salesforce", theme: "Software / IA", sector: "Technology", industry: "Software - Application", country: "US" },
  { symbol: "CRWD", name: "CrowdStrike", theme: "Software / IA", sector: "Technology", industry: "Cybersecurity", country: "US" },
  { symbol: "NET", name: "Cloudflare", theme: "Software / IA", sector: "Technology", industry: "Cloud Infrastructure", country: "US" },
  { symbol: "DDOG", name: "Datadog", theme: "Software / IA", sector: "Technology", industry: "Software - Application", country: "US" },
  { symbol: "SNOW", name: "Snowflake", theme: "Software / IA", sector: "Technology", industry: "Data Platform", country: "US" },
  { symbol: "SAP.DE", name: "SAP", theme: "Software / IA", sector: "Technology", industry: "Software", country: "DE" },

  { symbol: "ITX.MC", name: "Inditex", theme: "Consumo / retail", sector: "Consumer Cyclical", industry: "Apparel Retail", country: "ES" },
  { symbol: "MC.PA", name: "LVMH", theme: "Consumo / retail", sector: "Consumer Cyclical", industry: "Luxury Goods", country: "FR" },
  { symbol: "RMS.PA", name: "Hermes", theme: "Consumo / retail", sector: "Consumer Cyclical", industry: "Luxury Goods", country: "FR" },
  { symbol: "NKE", name: "Nike", theme: "Consumo / retail", sector: "Consumer Cyclical", industry: "Footwear & Accessories", country: "US" },
  { symbol: "LULU", name: "Lululemon", theme: "Consumo / retail", sector: "Consumer Cyclical", industry: "Apparel Retail", country: "US" },
  { symbol: "ONON", name: "On Holding", theme: "Consumo / retail", sector: "Consumer Cyclical", industry: "Footwear & Accessories", country: "US" },
  { symbol: "BURL", name: "Burlington Stores", theme: "Consumo / retail", sector: "Consumer Cyclical", industry: "Apparel Retail", country: "US" },

  { symbol: "NOVO-B.CO", name: "Novo Nordisk", theme: "Medtech / biotech", sector: "Healthcare", industry: "Drug Manufacturers", country: "DK" },
  { symbol: "NVO", name: "Novo Nordisk ADR", theme: "Medtech / biotech", sector: "Healthcare", industry: "Drug Manufacturers", country: "US" },
  { symbol: "LLY", name: "Eli Lilly", theme: "Medtech / biotech", sector: "Healthcare", industry: "Drug Manufacturers", country: "US" },
  { symbol: "AZN.L", name: "AstraZeneca", theme: "Medtech / biotech", sector: "Healthcare", industry: "Drug Manufacturers", country: "GB" },
  { symbol: "ROG.SW", name: "Roche", theme: "Medtech / biotech", sector: "Healthcare", industry: "Drug Manufacturers", country: "CH" },
  { symbol: "NOVN.SW", name: "Novartis", theme: "Medtech / biotech", sector: "Healthcare", industry: "Drug Manufacturers", country: "CH" },
  { symbol: "TMO", name: "Thermo Fisher Scientific", theme: "Medtech / biotech", sector: "Healthcare", industry: "Diagnostics & Research", country: "US" },
  { symbol: "ISRG", name: "Intuitive Surgical", theme: "Medtech / biotech", sector: "Healthcare", industry: "Medical Devices", country: "US" },

  { symbol: "SU.PA", name: "Schneider Electric", theme: "Energia / red", sector: "Industrials", industry: "Electrical Equipment", country: "FR" },
  { symbol: "SIE.DE", name: "Siemens", theme: "Energia / red", sector: "Industrials", industry: "Electrical Equipment", country: "DE" },
  { symbol: "ENR.DE", name: "Siemens Energy", theme: "Energia / red", sector: "Industrials", industry: "Electrical Equipment", country: "DE" },
  { symbol: "VWS.CO", name: "Vestas", theme: "Energia / red", sector: "Industrials", industry: "Renewable Energy", country: "DK" },
  { symbol: "IBE.MC", name: "Iberdrola", theme: "Energia / red", sector: "Utilities", industry: "Renewable Utilities", country: "ES" },
  { symbol: "ETN", name: "Eaton", theme: "Energia / red", sector: "Industrials", industry: "Electrical Equipment", country: "US" },
  { symbol: "PWR", name: "Quanta Services", theme: "Energia / red", sector: "Industrials", industry: "Engineering & Construction", country: "US" },
];

const PEER_DOMAINS = {
  "NVDA": "nvidia.com",
  "AVGO": "broadcom.com",
  "AMD": "amd.com",
  "TSM": "tsmc.com",
  "ASML.AS": "asml.com",
  "ARM": "arm.com",
  "AMAT": "appliedmaterials.com",
  "LRCX": "lamresearch.com",
  "KLAC": "kla.com",
  "MU": "micron.com",
  "0700.HK": "tencent.com",
  "9988.HK": "alibabagroup.com",
  "9618.HK": "jd.com",
  "3690.HK": "meituan.com",
  "1024.HK": "kuaishou.com",
  "9888.HK": "baidu.com",
  "9999.HK": "neteasegames.com",
  "1810.HK": "mi.com",
  "BILI": "bilibili.com",
  "PDD": "pinduoduo.com",
  "SE": "sea.com",
  "META": "meta.com",
  "GOOGL": "google.com",
  "TTWO": "take2games.com",
  "EA": "ea.com",
  "RHM.DE": "rheinmetall.com",
  "LDO.MI": "leonardo.com",
  "HO.PA": "thalesgroup.com",
  "SAF.PA": "safran-group.com",
  "BA.L": "baesystems.com",
  "LMT": "lockheedmartin.com",
  "RTX": "rtx.com",
  "NOC": "northropgrumman.com",
  "GD": "gd.com",
  "MSFT": "microsoft.com",
  "PLTR": "palantir.com",
  "NOW": "servicenow.com",
  "CRM": "salesforce.com",
  "CRWD": "crowdstrike.com",
  "NET": "cloudflare.com",
  "DDOG": "datadoghq.com",
  "SNOW": "snowflake.com",
  "SAP.DE": "sap.com",
  "ITX.MC": "inditex.com",
  "MC.PA": "lvmh.com",
  "RMS.PA": "hermes.com",
  "NKE": "nike.com",
  "LULU": "lululemon.com",
  "ONON": "on.com",
  "BURL": "burlington.com",
  "NOVO-B.CO": "novonordisk.com",
  "NVO": "novonordisk.com",
  "LLY": "lilly.com",
  "AZN.L": "astrazeneca.com",
  "ROG.SW": "roche.com",
  "NOVN.SW": "novartis.com",
  "TMO": "thermofisher.com",
  "ISRG": "intuitivesurgical.com",
  "SU.PA": "se.com",
  "SIE.DE": "siemens.com",
  "ENR.DE": "siemens-energy.com",
  "VWS.CO": "vestas.com",
  "IBE.MC": "iberdrola.com",
  "ETN": "eaton.com",
  "PWR": "quantaservices.com",
};

export function peerIdentityForSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const peer = PEERS.find((item) => item.symbol === clean);
  if (!peer) return null;
  return {
    ...peer,
    domain: PEER_DOMAINS[clean] || "",
  };
}

function logoForPeer(symbol = "") {
  const domain = PEER_DOMAINS[String(symbol).toUpperCase()];
  return domain ? `https://logo.clearbit.com/${domain}` : "";
}

function fallbackLogoForPeer(symbol = "") {
  const domain = PEER_DOMAINS[String(symbol).toUpperCase()];
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : "";
}

function norm(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tokenSet(...values) {
  return new Set(values.flatMap((value) => norm(value).split(/[^a-z0-9]+/).filter((x) => x.length > 2)));
}

function themeForItem(item = {}) {
  const sector = item.sector || "";
  const industry = item.industry || "";
  const hasBusinessTaxonomy = Boolean(sector || industry);
  return hasBusinessTaxonomy ? businessThemeKey(sector, industry, item.summary || item.businessSummary || item.theme || "") : item.theme || "";
}

function overlap(a, b) {
  let count = 0;
  for (const item of a) if (b.has(item)) count += 1;
  return count;
}

const FAMILY_LABELS = {
  semis: "semiconductores",
  defense: "defensa/aeroespacial",
  internet: "internet/plataformas",
  software: "software/IA",
  retail: "consumo/retail",
  healthcare: "salud",
  energy: "energia/red",
};

const GEO_LABELS = {
  greaterChina: "China/Hong Kong/Taiwan",
  northAmerica: "Norteamerica",
  europe: "Europa",
  asiaPacific: "Asia Pacifico",
};

function textFor(item = {}) {
  return norm([item.sector, item.industry, themeForItem(item), item.name, item.country, item.symbol].filter(Boolean).join(" "));
}

function activityFamily(item = {}) {
  const text = textFor(item);
  if (/semiconductor|semiconductor equipment|integrated circuit|chip|fotonica|photonic|lithography|foundry/.test(text)) return "semis";
  if (/internet|interactive media|communication services|social|gaming|game|multimedia|video|streaming|creator|creadores|e-commerce|commerce|retail online|marketplace|platform|plataforma|advertising|publicidad|search|content|tencent|alibaba|baidu|netease|meituan|kuaishou|jd\.?com|bilibili|pdd|sea limited|meta platforms|alphabet/.test(text)) return "internet";
  if (/defensa|defense|aerospace|aeroespacial|military|weapons/.test(text)) return "defense";
  if (/software|cybersecurity|cloud|data platform|infrastructure|application|crm|ia|ai/.test(text)) return "software";
  if (/retail|apparel|luxury|footwear|consumer cyclical|moda|lujo/.test(text)) return "retail";
  if (/healthcare|drug|biotech|medtech|medical|diagnostic|pharma/.test(text)) return "healthcare";
  if (/renewable|utility|utilities|electrical|grid|energia|energy|power|construction/.test(text)) return "energy";
  return "";
}

function geoGroup(country = "", symbol = "") {
  const value = norm(`${country} ${symbol}`);
  if (/(hong kong|\bhk\b|\.hk|china|\bcn\b|taiwan|\btw\b|\.tw)/.test(value)) return "greaterChina";
  if (/(united states|\bus\b|usa|canada|\bca\b)/.test(value)) return "northAmerica";
  if (/(spain|espana|\bes\b|germany|deutschland|\bde\b|france|\bfr\b|italy|\bit\b|netherlands|\bnl\b|denmark|\bdk\b|switzerland|\bch\b|united kingdom|\bgb\b|\buk\b|\.mc|\.de|\.pa|\.mi|\.as|\.co|\.sw|\.l)/.test(value)) return "europe";
  if (/(japan|\bjp\b|\.t|singapore|\bsg\b|australia|\bau\b|\.ax|korea|\bkr\b|india|\bin\b)/.test(value)) return "asiaPacific";
  return "";
}

const COMPANY_STOPWORDS = new Set(["inc", "corp", "corporation", "company", "co", "limited", "ltd", "holdings", "holding", "adr", "plc", "group", "sa", "ag", "nv", "se", "the"]);

function companyCore(name = "") {
  return norm(name).split(/[^a-z0-9]+/).filter((part) => part.length > 2 && !COMPANY_STOPWORDS.has(part)).slice(0, 3);
}

function likelySameIssuer(peer, target) {
  const a = companyCore(peer.name);
  const b = companyCore(target.name);
  if (a.length < 2 || b.length < 2) return false;
  return a.slice(0, 2).join(" ") === b.slice(0, 2).join(" ");
}

export function findSimilarStocks(target = {}) {
  const targetWithTheme = { ...target, theme: themeForItem(target) || target.theme || "" };
  const targetSymbol = norm(target.symbol);
  const targetTokens = tokenSet(targetWithTheme.sector, targetWithTheme.industry, targetWithTheme.theme, targetWithTheme.name);
  const targetFamily = activityFamily(targetWithTheme);
  const targetGeo = geoGroup(target.country, target.symbol);
  return PEERS.map((peer) => {
    if (norm(peer.symbol) === targetSymbol) return null;
    if (likelySameIssuer(peer, targetWithTheme)) return null;
    const normalizedPeer = { ...peer, theme: themeForItem(peer) || peer.theme || "" };
    const peerTokens = tokenSet(normalizedPeer.sector, normalizedPeer.industry, normalizedPeer.theme, normalizedPeer.name);
    const peerFamily = activityFamily(normalizedPeer);
    const peerGeo = geoGroup(peer.country, peer.symbol);
    if (targetFamily && peerFamily && targetFamily !== peerFamily) return null;

    const reasons = [];
    let score = 0;
    const exactIndustry = targetWithTheme.industry && norm(peer.industry) === norm(targetWithTheme.industry);
    const sameSector = targetWithTheme.sector && norm(peer.sector) === norm(targetWithTheme.sector);
    const sameTheme = targetWithTheme.theme && norm(normalizedPeer.theme) === norm(targetWithTheme.theme);
    const sameGeo = targetGeo && peerGeo && targetGeo === peerGeo;

    if (targetFamily && peerFamily === targetFamily) {
      score += 58;
      reasons.push(`Actividad: ${FAMILY_LABELS[targetFamily] || targetFamily}`);
    }
    if (exactIndustry) {
      score += 54;
    } else if (target.industry && (norm(peer.industry).includes(norm(target.industry)) || norm(target.industry).includes(norm(peer.industry)))) {
      score += 36;
    }
    if (sameSector) score += 22;
    if (sameTheme) score += 24;
    if (sameGeo) {
      score += 20;
      reasons.push(`Origen: ${GEO_LABELS[targetGeo] || targetGeo}`);
    } else if (targetGeo && peerGeo === "asiaPacific" && targetGeo === "greaterChina") {
      score += 8;
      reasons.push("Origen: Asia");
    }
    score += Math.min(24, overlap(targetTokens, peerTokens) * 6);

    const hasHardSimilarity = targetFamily
      ? peerFamily === targetFamily
      : exactIndustry || sameTheme || (sameSector && sameGeo);
    if (!hasHardSimilarity || score < 44) return null;
    return {
      ...normalizedPeer,
      logoUrl: logoForPeer(peer.symbol),
      fallbackLogoUrl: fallbackLogoForPeer(peer.symbol),
      score,
      similarityScore: score,
      similarityReason: reasons.slice(0, 2).join(" · "),
      source: "peer-map",
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12);
}
