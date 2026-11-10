// Clasificador de tema (ocupación) de un valor.
//
// Orden de decisión (auditoría de filtros 2026-11, propuesta 4):
//   1. Industria del proveedor (INDUSTRY_RULES): la señal más precisa.
//   2. Sector del proveedor (SECTOR_DEFAULTS): si la industria no casa.
//   3. Texto sector+industria con reglas amplias (SECTOR_INDUSTRY_RULES), para
//      taxonomías que no son las de Yahoo (filas intl o curadas).
//   4. Solo si no hay sector/industria utilizable: la descripción (summary),
//      con reglas SIN palabras ambiguas. Antes se buscaba en el summary con
//      «properties», «data», «platform», «applications», «infrastructure»…, y
//      así acababan mineras («mineral properties») en «Inmobiliario / REIT» y
//      fertilizantes («data», «platform») en «Software / IA».
//
// Las claves de tema existentes NO cambian: están guardadas en snapshots
// (metrics.theme), en los engine_version del RS tema y en sesiones de filtros
// del navegador. Varias van sin tilde («Automatizacion», «Energia / red»,
// «Semis / fotonica»); normalizarlas exige migrar esos datos, así que se
// documenta en research/auditoria-filtros-2026-11/informe.md §10 y no se toca
// aquí. La clave nueva («Materiales / minería») nace ya con tilde.

const MATERIALS_KEY = "Materiales / minería";

const THEME_RULES = [
  {
    key: "Semis / fotonica",
    re: /semiconductors?|semiconductor equipment|integrated circuit|microchip|\bchips?\b|wafer|photonics?|optical networking|fiber optics?|\blasers?\b|lithography|foundry/i,
    text: "Tiene exposicion a semiconductores, optica/fotonica, litografia, fabricacion de chips o infraestructura de computacion.",
  },
  {
    key: "Internet / plataformas",
    re: /internet content|interactive media|online advertising|social network|social media|video games?|online gaming|digital entertainment|streaming|e-commerce|online marketplace|search engine|digital payments|fintech/i,
    text: "Opera en plataformas digitales, internet, publicidad online, gaming, contenidos, pagos digitales o ecosistemas de comercio y servicios.",
  },
  {
    key: "Autos / movilidad",
    re: /auto manufacturers?|automobiles?|automotive|electric vehicles?|mobility services|vehicle charging|charging stations?|autonomous driving/i,
    text: "Participa en automocion, vehiculos electricos, movilidad, carga o tecnologia aplicada al transporte.",
  },
  {
    key: MATERIALS_KEY,
    // Va antes que «Inmobiliario / REIT»: las mineras describen sus activos
    // como «mineral properties».
    // En la descripción solo cuentan palabras inequívocas de minería y
    // fertilizantes: «chemicals», «steel» o «aluminum» aparecen en descripciones
    // de distribuidores, laboratorios o fabricantes que no son materias primas.
    re: /\b(gold|silver|copper|lithium|platinum|palladium|rare earths?|iron ore|mining|mineral (?:exploration|properties|projects?|resources|deposits?)|fertili[sz]ers?|potash)\b/i,
    text: "Opera en materias primas: mineria de metales preciosos e industriales, acero, aluminio, quimica, fertilizantes, materiales de construccion o productos forestales.",
  },
  {
    key: "Inmobiliario / REIT",
    re: /\breal estate\b|\breits?\b|\bproperty (management|development|trust|holdings?|investment|owner|operator)\b|\bcommercial real estate\b|\bshopping malls?\b|\blandlord\b|\bhomebuilding\b|\bhomebuilders?\b/i,
    text: "Opera en activos inmobiliarios, promocion, alquileres, REITs, centros comerciales, oficinas, residencial o suelo.",
  },
  {
    key: "Defensa / aeroespacial",
    re: /aerospace|defense|defence|military|missile|radar|satellite|space systems|aviation|homeland security/i,
    text: "Opera en defensa, aeroespacial, aviacion, satelites, sistemas criticos o ingenieria avanzada.",
  },
  {
    key: "Software / IA",
    re: /\b(software|cloud computing|cloud-based|cybersecurity|artificial intelligence|machine learning|saas)\b/i,
    text: "Su negocio esta vinculado a software, cloud, datos, ciberseguridad, plataformas digitales, automatizacion o infraestructura de IA.",
  },
  {
    key: "Consumer tech / hardware",
    re: /consumer electronics|smartphones?|wearables?|personal computers?|computer hardware|consumer devices?|hardware products?/i,
    text: "Vende hardware, dispositivos, electronica de consumo, accesorios o ecosistemas de producto tecnologico.",
  },
  {
    key: "Energia / red",
    re: /\b(electric utility|power generation|power grid|electricity|energy|uranium|nuclear|utility|utilities|solar|renewables?|oil|natural gas|petroleum)\b/i,
    text: "Esta expuesta a energia, electrificacion, red electrica, utilities, nuclear, renovables, baterias o infraestructura energetica.",
  },
  {
    key: "Automatizacion",
    re: /\b(robots?|robotics|automation|machinery|industrial equipment|factory|electrical equipment|sensors)\b/i,
    text: "Participa en automatizacion industrial, maquinaria, robotica, sensores, equipos electricos o productividad industrial.",
  },
  {
    key: "Medtech / biotech",
    re: /medical|diagnostics?|biotech|biopharma|pharmaceuticals?|health ?care|therapeutics|clinical|surgical/i,
    text: "Opera en salud, biotecnologia, diagnostico, dispositivos medicos, farmaceuticas, terapias o tecnologia medica.",
  },
  {
    key: "Consumo / marca",
    re: /\b(consumer products|retail(er|ers)?|apparel|restaurants?|beverages?|food|luxury|footwear)\b/i,
    text: "Su actividad esta vinculada a consumo, distribución, retail, marcas, alimentacion, restauracion o comercio digital.",
  },
  {
    key: "Finanzas",
    re: /\b(bank|banking|insurance|asset management|financial services|broker(age)?|stock exchange|credit|lending)\b/i,
    text: "Pertenece al area financiera: banca, seguros, gestion de activos, pagos, mercados, credito o fintech.",
  },
];

// 1. Industria del proveedor (Yahoo). Se evalúa en orden: la primera que casa
// gana. El orden importa: REIT antes que Finanzas («REIT - Mortgage»), seguros
// antes que cualquier regla con «property» («Insurance - Property & Casualty»),
// REIT antes que Medtech («REIT - Healthcare Facilities»), materiales antes que
// energía («Coking Coal» es materia prima siderúrgica; «Thermal Coal», energía).
const INDUSTRY_RULES = [
  { key: "Inmobiliario / REIT", re: /\breits?\b|real estate|residential construction/i },
  { key: "Finanzas", re: /insurance|reinsurance|banks?\b|capital markets|asset management|credit services|mortgage finance|financial|brokers?\b|stock exchanges|shell companies/i },
  { key: "Semis / fotonica", re: /semiconductor/i },
  {
    key: MATERIALS_KEY,
    re: /\bgold\b|\bsilver\b|\bcopper\b|\baluminum\b|\baluminium\b|\bsteel\b|coking coal|metals? & mining|chemicals|agricultural inputs|building materials|lumber|wood production|paper & paper|paper products|forest products/i,
  },
  { key: "Defensa / aeroespacial", re: /aerospace|defen[cs]e/i },
  { key: "Autos / movilidad", re: /auto manufacturers?|auto parts|auto & truck|automobiles?|automotive|airlines|airports|trucking|railroads|marine shipping|freight|logistics/i },
  { key: "Medtech / biotech", re: /biotech|drug manufacturers|pharma|medical|diagnostics|health/i },
  { key: "Energia / red", re: /\boil\b|\bgas\b|uranium|thermal coal|utilities|solar|renewable|power producers/i },
  { key: "Software / IA", re: /software|information technology services/i },
  { key: "Consumer tech / hardware", re: /consumer electronics|computer hardware|electronics & computer distribution|communication equipment/i },
  { key: "Internet / plataformas", re: /internet|interactive media|electronic gaming|multimedia|entertainment|advertising|broadcasting|publishing|telecom/i },
  { key: "Automatizacion", re: /machinery|electrical equipment|electronic components|scientific & technical instruments|industrial distribution|tools & accessories|metal fabrication|pollution & treatment|building products|engineering & construction|conglomerates/i },
];

// Refinamiento dentro de una industria del proveedor: «Communication
// Equipment» mezcla fabricantes de equipos de red con fotónica/óptica (Ciena,
// Lumentum…). Solo aquí se mira la descripción, y nunca para cambiar de
// industria a un tema ajeno.
const PHOTONICS_SUMMARY_RE = /photonics?|optical|fiber optics?|\blasers?\b|transceivers?/i;

// 2. Sector del proveedor (Yahoo) cuando la industria no casa con nada.
// «Industrials» cae en «Automatizacion», el tema industrial de la taxonomía
// (también los servicios a empresas: ver informe §10).
const SECTOR_DEFAULTS = [
  { key: MATERIALS_KEY, re: /^basic materials$/i },
  { key: "Automatizacion", re: /^industrials$/i },
  { key: "Software / IA", re: /^technology$/i },
  { key: "Finanzas", re: /^financial services$|^financials?$/i },
  { key: "Inmobiliario / REIT", re: /^real estate$/i },
  { key: "Medtech / biotech", re: /^healthcare$|^health care$/i },
  { key: "Energia / red", re: /^energy$|^utilities$/i },
  { key: "Internet / plataformas", re: /^communication services$/i },
  { key: "Consumo / marca", re: /^consumer cyclical$|^consumer defensive$/i },
];

// 3. Taxonomías no Yahoo: búsqueda amplia en «sector industria». Finanzas va
// antes que el inmobiliario para que «Property & Casualty Insurance» no sea REIT.
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
    key: "Finanzas",
    re: /financial services|banks?|banking|insurance|asset management|capital markets|brokerage|credit services|mortgage finance|exchanges?/i,
  },
  {
    key: MATERIALS_KEY,
    re: /basic materials|materials|metals? & mining|mining|\bgold\b|\bsilver\b|\bcopper\b|\bsteel\b|aluminium|aluminum|chemicals?|fertili[sz]ers?|agricultural inputs|forest products|paper/i,
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
    key: "Energia / red",
    re: /\benergy\b|\boil\b|\bgas\b|petroleum|utilities?|\bpower\b|electric utilities?|renewable|solar|uranium|nuclear/i,
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
    re: /automation|robotics?|machinery|electrical equipment|electronic components|scientific & technical instruments|specialty industrial machinery|industrial distribution|industrials?/i,
  },
  {
    key: "Consumo / marca",
    re: /consumer cyclical|consumer defensive|retail|apparel|restaurants?|beverages?|food|luxury|brand|discount stores?|specialty retail|footwear|packaged foods|household/i,
  },
];

// Valores de relleno que el escáner escribe cuando el proveedor no trae dato.
const PLACEHOLDERS = new Set(["", "sin sector", "sin industria", "general", "n/a", "-", "—", "unknown"]);

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// Yahoo mezcla guiones: «Banks—Regional», «Banks - Regional».
function normalizeTaxonomy(value = "") {
  const text = cleanText(value).replace(/\s*[—–]\s*/g, " - ");
  return PLACEHOLDERS.has(text.toLowerCase()) ? "" : text;
}

function rule(key = "") {
  return THEME_RULES.find((item) => item.key === key);
}

// Sin taxonomía del proveedor, gana el tema cuya palabra aparece ANTES en la
// descripción: la primera frase suele decir a qué se dedica la empresa
// («X operates as a property and casualty insurance company…») y las menciones
// de canales o clientes («e-commerce», «data») vienen después.
function earliestSummaryMatch(summary = "") {
  let best = null;
  let bestIndex = Infinity;
  for (const item of THEME_RULES) {
    const match = item.re.exec(summary);
    if (match && match.index < bestIndex) {
      best = item;
      bestIndex = match.index;
    }
  }
  return best;
}

function themeFromProvider(sector = "", industry = "", summary = "") {
  if (industry) {
    const match = INDUSTRY_RULES.find((item) => item.re.test(industry));
    if (match) {
      if (match.key === "Consumer tech / hardware" && /communication equipment/i.test(industry) && PHOTONICS_SUMMARY_RE.test(summary)) {
        return "Semis / fotonica";
      }
      return match.key;
    }
  }
  if (sector) {
    const match = SECTOR_DEFAULTS.find((item) => item.re.test(sector));
    if (match) return match.key;
  }
  const sectorIndustry = cleanText(`${sector} ${industry}`);
  if (sectorIndustry) {
    const match = SECTOR_INDUSTRY_RULES.find((item) => item.re.test(sectorIndustry));
    if (match) return match.key;
  }
  return "";
}

export function inferBusinessTheme(sector = "", industry = "", summary = "") {
  const cleanSector = normalizeTaxonomy(sector);
  const cleanIndustry = normalizeTaxonomy(industry);
  const cleanSummary = cleanText(summary);

  const providerKey = themeFromProvider(cleanSector, cleanIndustry, cleanSummary);
  if (providerKey) return rule(providerKey);

  // Algunos llamadores pasan como «summary» el tema ya calculado (peers).
  const asKey = rule(cleanSummary);
  if (asKey) return asKey;

  if (cleanSummary) {
    const summaryMatch = earliestSummaryMatch(cleanSummary);
    if (summaryMatch) return summaryMatch;
  }
  return {
    key: cleanText(sector) || "General",
    text: "Clasificacion tematica general.",
  };
}

export function businessThemeKey(sector = "", industry = "", summary = "") {
  return inferBusinessTheme(sector, industry, summary).key;
}

export { THEME_RULES };
