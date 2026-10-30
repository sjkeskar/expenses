import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built into client/dist, which src/server.js serves. During development,
// `npm run dev:client` runs Vite's dev server with hot reload and forwards
// /api to the Express server on 8080 (`npm run dev`).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  // One bundle (~1.1 MB, ~360 kB gzipped) is fine on a LAN and is cached after
  // the first load, so the size warning is raised rather than code-splitting.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { proxy: { "/api": "http://localhost:8080" } },
});
