import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_API_URL || "http://localhost:8000";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      // Proxy all backend traffic through the Vite dev server so the
      // browser only ever sees same-origin requests. This avoids:
      //   - CORS preflight overhead
      //   - Brave Shields / extensions blocking cross-origin XHR & images
      //   - <img crossorigin> cache-mismatch issues
      proxy: {
        "/api": {
          target: backend,
          changeOrigin: true,
        },
      },
    },
  };
});
