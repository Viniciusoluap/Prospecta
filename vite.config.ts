import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// O plugin marca cada elemento JSX com `data-loc`. Os elementos da cena 3D (react-three-fiber) não são HTML e
// quebram ao receber esse atributo numa atualização; por isso o visualizador da Maquete 3D fica de fora.
const jsxLoc = jsxLocPlugin();
const transformarJsxLoc = jsxLoc.transform as (this: unknown, code: string, id: string) => unknown;
const jsxLocSemCena3d = {
  ...jsxLoc,
  transform(this: unknown, code: string, id: string) {
    return /\/maquete-3d\/visualizador\//.test(id) ? null : transformarJsxLoc.call(this, code, id);
  },
} as typeof jsxLoc;

export default defineConfig({
  plugins: [react(), tailwindcss(), jsxLocSemCena3d],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".vercel.app",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
