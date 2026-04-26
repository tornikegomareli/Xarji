import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * During development the client runs on Vite's dev server (default
 * 5173) while the service runs separately on 127.0.0.1:8721. The client
 * calls /api/* endpoints; without a proxy those requests would 404 on
 * the Vite dev server. Route them through to the service so the same
 * code path works in dev and in the compiled binary.
 *
 * In production (compiled binary) the service serves both the client
 * assets and /api/* on the same port, so there's no proxy involved.
 */
const API_TARGET = process.env.XARJI_SERVICE_URL ?? "http://127.0.0.1:8721";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Single greppable literal in the bundle. `scripts/release/build.sh`
  // greps `client/dist/` for `__XARJI_DEMO_ALLOWED__:true` (and the
  // other demo-mode strings) and fails the DMG build if any of them
  // appear — defense-in-depth against an `import.meta.env.DEV`
  // tree-shake regression that would otherwise leak demo code into
  // production silently.
  define: {
    __XARJI_DEMO_ALLOWED__: JSON.stringify(mode === "development"),
  },
  server: {
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: false,
      },
    },
  },
}));
