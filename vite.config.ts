import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

/**
 * Build configuration. Plugin order matters: Tailwind and path resolution first, then TanStack Start (routing, SSR
 * and server functions), then Nitro (build only: packages the server for the deploy target), then React.
 *
 * Deploy target: a Cloudflare Worker with static assets (Nitro preset "cloudflare-module"). `nodeCompat` enables the
 * Workers Node.js compatibility flag; `deployConfig` writes the wrangler config for `wrangler deploy` into .output.
 */
export default defineConfig(({ command, mode }) => ({
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // src/server.ts wraps the generated server entry with our SSR error page.
      server: { entry: "server" },
      // Keep server-only code out of the browser bundle: fail the build instead of silently shipping it.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    ...(command === "build"
      ? [
          nitro({
            preset: "cloudflare-module",
            cloudflare: { deployConfig: true, nodeCompat: true },
          }),
        ]
      : []),
    react(),
  ],
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    // One copy of each, or hooks and query contexts break across duplicated packages.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },
  // `build --mode development` (bun run build:dev): a development-mode client bundle for debugging.
  ...(command === "build" && mode === "development"
    ? {
        environments: {
          client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
        },
      }
    : {}),
  // host "::" listens on all interfaces so a real phone on the same Wi-Fi can open the dev server (map/geolocation testing).
  server: { host: "::", port: 8080 },
}));
