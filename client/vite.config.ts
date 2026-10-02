import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Phones on LAN / tunnels need the host reachable
    host: true,
    // Remote clients often can't keep the HMR websocket; Vite then full-reloads
    // the page and kills in-flight photo scans. Prefer manual refresh while testing.
    hmr: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        // Vision scans can take several minutes; default proxy timeouts drop the phone
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
    watch: {
      ignored: ["**/data/**", "**/*.db", "**/*.db-*"],
    },
  },
});
