import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mismo alias "@/" que jsconfig.json para que las libs resuelvan igual que en Next.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // unit tests (.test.js) + integration tests against real Supabase (.test.mjs).
    // Integration tests skip themselves when SUPABASE_URL is unset, so
    // regular `npm test` runs stay green in CI.
    include: ["tests/**/*.test.js", "tests/**/*.test.mjs"],
    environment: "node",
  },
});
