import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mismo alias "@/" que jsconfig.json para que las libs resuelvan igual que en Next.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // Ordinary Vitest is strictly unit/static: database integrations run only
    // through their explicit scripts. Hito 1A uses node:test.
    include: ["tests/**/*.test.js", "tests/**/*.test.mjs"],
    exclude: ["tests/integration/**/*.test.mjs"],
    environment: "node",
  },
});
