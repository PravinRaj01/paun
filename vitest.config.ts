import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberately separate from vite.config.ts: that file wires the TanStack Start and Nitro build plugins, which unit tests
// of pure functions do not need (and which would slow them down).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
