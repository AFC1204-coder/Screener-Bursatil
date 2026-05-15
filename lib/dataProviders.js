export const PROVIDER_PLAN = [
  {
    id: "yahoo-chart",
    name: "Yahoo Finance chart",
    role: "Histórico diario y precio",
    tier: "gratis no oficial",
    status: "primary",
    envKey: "",
    coverage: "Global amplia con sufijos Yahoo",
  },
  {
    id: "stooq-chart",
    name: "Stooq CSV",
    role: "Fallback de histórico diario",
    tier: "gratis con clave CSV",
    status: "fallback",
    envKey: "STOOQ_API_KEY",
    coverage: "EEUU, Europa y varios mercados internacionales segun simbolo Stooq",
  },
  {
    id: "nasdaq-trader",
    name: "NasdaqTrader Symbol Directory",
    role: "Universo EEUU",
    tier: "gratis publico",
    status: "active",
    envKey: "",
    coverage: "NYSE/Nasdaq/AMEX listadas en EEUU",
  },
  {
    id: "sec-edgar",
    name: "SEC EDGAR companyfacts",
    role: "Fundamentales historicos EEUU",
    tier: "gratis publico",
    status: "active",
    envKey: "SEC_USER_AGENT",
    coverage: "Empresas con reporting SEC",
  },
  {
    id: "alpha-vantage",
    name: "Alpha Vantage",
    role: "Fallback opcional de precio/fundamentales",
    tier: "gratis con cuota y API key",
    status: "planned",
    envKey: "ALPHA_VANTAGE_API_KEY",
    coverage: "Acciones globales segun endpoint y simbolo soportado",
  },
  {
    id: "fmp",
    name: "Financial Modeling Prep",
    role: "Fundamentales opcionales",
    tier: "gratis limitado con API key",
    status: "planned",
    envKey: "FMP_API_KEY",
    coverage: "Cobertura variable por plan y mercado",
  },
];

export function providerStatus() {
  return PROVIDER_PLAN.map((provider) => ({
    ...provider,
    configured: provider.envKey ? Boolean(process.env[provider.envKey]) : true,
  }));
}
