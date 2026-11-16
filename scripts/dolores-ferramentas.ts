// EPIC-025 (Dolores) — gera docs/dolores/ferramentas-etapa1.json a partir do registro de funções da ponte (fonte única).
// Uso: npx tsx scripts/dolores-ferramentas.ts   (o teste server/dolores/ponte.test.ts acusa se o arquivo ficar velho)
import { writeFileSync } from "node:fs";
import { ETAPA_ATUAL } from "../server/dolores/permissoes.js";
import { ferramentasLiberadas } from "../server/dolores/ponte.js";

const destino = new URL("../docs/dolores/ferramentas-etapa1.json", import.meta.url);
const conteudo = {
  etapa: ETAPA_ATUAL,
  observacao: "Gerado de server/dolores/funcoes.ts + permissoes.ts (npx tsx scripts/dolores-ferramentas.ts). Não editar à mão.",
  chamada: "POST /api/dolores/ponte com Authorization: Bearer <DOLORES_PONTE_TOKEN> e corpo { \"funcao\": <name>, \"argumentos\": { ... }, \"pedidoId\": \"opcional\" }",
  ferramentas: ferramentasLiberadas(),
};
writeFileSync(destino, `${JSON.stringify(conteudo, null, 2)}\n`);
console.log(`${conteudo.ferramentas.length} ferramentas gravadas em docs/dolores/ferramentas-etapa1.json`);
