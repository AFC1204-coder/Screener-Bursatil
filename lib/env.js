export function envValue(key = "") {
  const value = String(process.env[key] || "").trim();
  if (!value) return "";
  if (/^(your-|tu_|change-me$)/i.test(value)) return "";
  return value;
}

export function hasEnvValue(key = "") {
  return Boolean(envValue(key));
}
