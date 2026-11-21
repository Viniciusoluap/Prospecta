// EPIC-028 (Etapa 2) — harness das capturas: abre a MESMA página de prévia (/maquete-demo/<planta>) fora do app,
// sem servidor nem banco. Uso: `node scripts/maquete/screenshots.mjs`.
import "./harness.css";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import MaqueteDemo from "@/pages/MaqueteDemo";

const planta = new URLSearchParams(location.search).get("planta") ?? "lote4-qd18";
const { hook } = memoryLocation({ path: `/maquete-demo/${planta}` });
createRoot(document.getElementById("root")!).render(<Router hook={hook}><MaqueteDemo /></Router>);
