import { resolve } from "node:path";
import { parseEnv } from "@hejmly/core/shared";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const env = parseEnv(process.env);
const apiTarget = `http://localhost:${env.PORT}`;

const vendorChunk = (id: string): string | undefined => {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("@tanstack")) return "tanstack";
  if (id.includes("@phosphor-icons")) return "icons";
  return "vendor";
};

export default defineConfig({
  define: {
    __PERSIST_BUSTER__: JSON.stringify(`Hejmly-${Date.now()}`),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["favicon.ico", "favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Hejmly",
        short_name: "Hejmly",
        description: "Family app platform — internal only.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, ws: true, changeOrigin: true },
      "/mcp": { target: apiTarget, changeOrigin: true },
      "/.well-known": { target: apiTarget, changeOrigin: true },
    },
  },
});
