const THEME_RULES = [
  {
    key: "Semis / fotonica",
    re: /semiconductors?|semiconductor equipment|integrated circuit|microchip|\bchips?\b|wafer|photonics?|optical networking|fiber optics?|laser|lithography|foundry/i,
    text: "Tiene exposicion a semiconductores, optica/fotonica, litografia, fabricacion de chips o infraestructura de computacion.",
  },
  {
    key: "Internet / plataformas",
    re: /internet content|interactive media|communication services|online advertising|social network|social media|video game|gaming|multimedia|digital entertainment|streaming|e-commerce|marketplace|\bsearch\b|payments|fintech/i,
    text: "Opera en plataformas digitales, internet, publicidad online, gaming, contenidos, pagos digitales o ecosistemas de comercio y servicios.",
  },
  {
    key: "Autos / movilidad",
    re: /auto manufacturers?|automobiles?|automotive|electric vehicles?|\bev\b|mobility services|vehicle charging|charging stations?|autonomous driving/i,
    text: "Participa en automocion, vehiculos electricos, movilidad, carga o tecnologia aplicada al transporte.",
  },
  {
    key: "Inmobiliario / REIT",
    re: /\breal estate\b|\breits?\b|\bproperty (management|development|trust|holdings?|investment|owner|operator)\b|\bproperties\b|\bresidential\b|\bcommercial real estate\b|\bshopping malls?\b|\bleasing\b|\blandlord\b|\bhomebuilding\b|\bproperty development\b/i,
    text: "Opera en activos inmobiliarios, promocion, alquileres, REITs, centros comerciales, oficinas, residencial o suelo.",
  },
  {
    key: "Defensa / aeroespacial",
    re: /aerospace|defense|defence|military|missile|radar|satellite|space systems|aviation|homeland security/i,
    text: "Opera en defensa, aeroespacial, aviacion, satelites, sistemas criticos o ingenieria avanzada.",
  },
  {
    key: "Software / IA",
    re: /\b(software|cloud|cyber|data|ai|artificial intelligence|analytics|platform|applications?|infrastructure|saas)\b/i,
    text: "Su negocio esta vinculado a software, cloud, datos, ciberseguridad, plataformas digitales, automatizacion o infraestructura de IA.",
  },
  {
    key: "Consumer tech / hardware",
    re: /consumer electronics|smartphones?|wearables?|personal computers?|computer hardware|consumer devices?|electronic devices?|hardware products?|tablets?|accessories/i,
    text: "Vende hardware, dispositivos, electronica de consumo, accesorios o ecosistemas de producto tecnologico.",
  },
  {
    key: "Energia / red",
    re: /electrical|power|grid|energy|uranium|nuclear|utility|solar|battery|renewable|transmission/i,
    text: "Esta expuesta a energia, electrificacion, red electrica, utilities, nuclear, renovables, baterias o infraestructura energetica.",
  },
  {
    key: "Automatizacion",
    re: /robot|automation|machinery|industrial|factory|electrical equipment|sensors|controls/i,
    text: "Participa en automatizacion industrial, maquinaria, robotica, sensores, equipos electricos o productividad industrial.",
  },
  {
    key: "Medtech / biotech",
    re: /medical|diagnostic|device|biotech|pharma|health|therapeutics|clinical|surgical/i,
    text: "Opera en salud, biotecnologia, diagnostico, dispositivos medicos, farmaceuticas, terapias o tecnologia medica.",
  },
  {
    key: "Consumo / marca",
    re: /consumer|retail|apparel|restaurant|beverage|food|luxury|brand|e-commerce/i,
    text: "Su actividad esta vinculada a consumo, distribucion, retail, marcas, alimentacion, restauracion o comercio digital.",
  },
  {
    key: "Finanzas",
    re: /bank|insurance|asset management|financial|broker|exchange|payments|fintech|credit/i,
    text: "Pertenece al area financiera: banca, seguros, gestion de activos, pagos, mercados, credito o fintech.",
  },
];

const SECTOR_INDUSTRY_RULES = [
  {
    key: "Semis / fotonica",
    re: /semiconductors?|semiconductor equipment|integrated circuits?|microchips?|\bchips?\b|wafer|lithography|foundry/i,
  },
  {
    key: "Consumer tech / hardware",
    re: /consumer electronics|smartphones?|wearables?|personal computers?|computer hardware|hardware products?|tablets?/i,
  },
  {
    key: "Autos / movilidad",
    re: /auto manufacturers?|automobiles?|automotive|electric vehicles?|\bev\b/i,
  },
  {
    key: "Inmobiliario / REIT",
    re: /\breal estate\b|\breits?\b|\bproperty\b|\bproperties\b|\bresidential\b|\bcommercial real estate\b|\bhomebuilding\b|\bhealthcare facilities\b/i,
  },
  {
    key: "Defensa / aeroespacial",
    re: /aerospace|defen[cs]e|military|missile|radar|satellite|space systems|aviation|homeland security/i,
  },
  {
    key: "Medtech / biotech",
    re: /healthcare|health care|medical|diagnostic|biotech|biotechnology|pharma|drug manufacturers?|therapeutics|clinical|surgical|life sciences/i,
  },
  {
    key: "Finanzas",
    re: /financial services|banks?|banking|insurance|asset management|capital markets|brokerage|credit services|mortgage|exchanges?/i,
  },
  {
    key: "Energia / red",
    re: /\benergy\b|oil|gas|petroleum|utilities?|power|electric utilities?|renewable|solar|uranium|nuclear/i,
  },
  {
    key: "Internet / plataformas",
    re: /internet content|interactive media|communication services|online advertising|social media|video games?|gaming|multimedia|digital entertainment|streaming|internet retail|marketplace/i,
  },
  {
    key: "Software / IA",
    re: /software|cloud|cyber|cybersecurity|data infrastructure|artificial intelligence|analytics|applications?|saas|information technology services/i,
  },
  {
    key: "Automatizacion",
    re: /automation|robotics?|machinery|electrical equipment|electronic components|scientific & technical instruments|specialty industrial machinery|industrial distribution/i,
  },
  {
    key: "Consumo / marca",
    re: /consumer cyclical|consumer defensive|retail|apparel|restaurants?|beverages?|food|luxury|brand|discount stores?|specialty retail|footwear|packaged foods|household/i,
  },
];

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function rule(key = "") {
  return THEME_RULES.find((item) => item.key === key);
}

export function inferBusinessTheme(sector = "", industry = "", summary = "") {
  const sectorIndustry = cleanText(`${sector} ${industry}`);
  const sectorIndustryMatch = SECTOR_INDUSTRY_RULES.find((item) => item.re.test(sectorIndustry));
  if (sectorIndustryMatch) return rule(sectorIndustryMatch.key);

  const text = cleanText(`${sector} ${industry} ${summary}`);
  return THEME_RULES.find((rule) => rule.re.test(text)) || {
    key: cleanText(sector) || "General",
    text: "Clasificacion tematica general.",
  };
}

export function businessThemeKey(sector = "", industry = "", summary = "") {
  return inferBusinessTheme(sector, industry, summary).key;
}

export { THEME_RULES };
