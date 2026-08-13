import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2020",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Leaflet — only loads when user visits a map page (fleet-view, heat-map, zones)
          if (id.includes("node_modules/leaflet")) return "leaflet";
          // Recharts / d3 — only loads when user visits dashboard or reports
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3") || id.includes("node_modules/victory")) return "charts";
          // Radix UI components
          if (id.includes("node_modules/@radix-ui")) return "vendor-ui";
          // Tanstack Query
          if (id.includes("node_modules/@tanstack/react-query")) return "vendor-query";
          // Framer motion
          if (id.includes("node_modules/framer-motion")) return "vendor-motion";
          // React core — keep in its own chunk for long-term caching
          if (id.includes("node_modules/react-dom")) return "vendor-react-dom";
          if (id.includes("node_modules/react/")) return "vendor-react";
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
