import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:8791";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": apiTarget, "/mcp": apiTarget },
  },
  build: { sourcemap: false },
});
