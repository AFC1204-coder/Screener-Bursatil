import { jquantsStatus } from "@/lib/jquants";

export async function GET() {
  return Response.json({
    ok: true,
    provider: "J-Quants",
    ...jquantsStatus(),
    cacheTargets: ["daily_bars", "fundamental_snapshots", "universe_snapshots"],
    note: "J-Quants se usa como fuente oficial de Japon para cache interno y senales derivadas; no como redistribucion de datasets crudos.",
  });
}
