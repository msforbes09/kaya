import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Kaya",
        short_name: "Kaya",
        description: "Voice assistant for development work",
        display: "standalone",
        background_color: "#141A26",
        theme_color: "#141A26",
        icons: [
          { src: "kaya-192.png", sizes: "192x192", type: "image/png" },
          { src: "kaya-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Never cache the API or the socket; the shell is what should work offline.
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/auth": "http://localhost:8787",
      "/pair": "http://localhost:8787",
      "/runner": { target: "ws://localhost:8787", ws: true },
    },
  },
});
