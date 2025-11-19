// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: {
      // Forward API calls to the backend which will listen on port 5175
      "/api": {
        target: "http://localhost:5175",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path, // keep path the same
      },
      // Status file endpoints
      "/status.json": {
        target: "http://localhost:5175",
        changeOrigin: true,
        secure: false
      },
      "/api/status-file": {
        target: "http://localhost:5175",
        changeOrigin: true,
        secure: false
      },
      "/status-file": {
        target: "http://localhost:5175",
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: "dist",
  }
});
