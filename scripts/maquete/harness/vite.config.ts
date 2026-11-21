// EPIC-028 (Etapa 2) — build do harness de capturas da maquete (mesmo padrão de scripts/layout-check).
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const raiz = path.resolve(import.meta.dirname, "..", "..", "..");
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(raiz, "client", "src"),
      "@shared": path.resolve(raiz, "shared"),
    },
  },
  root: import.meta.dirname,
  base: "./",
  build: { outDir: path.resolve(import.meta.dirname, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  logLevel: "warn",
});
