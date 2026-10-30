// Correção 11 (lote 3): harness de validação visual dos componentes
// compartilhados (modal, datas, selects, grades, tabelas, campos numéricos).
// Uso: `node scripts/layout-check/check.mjs` (faz o build e roda o Playwright).
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const raiz = path.resolve(import.meta.dirname, "..", "..");
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
  build: { outDir: path.resolve(import.meta.dirname, "dist"), emptyOutDir: true },
  logLevel: "warn",
});
