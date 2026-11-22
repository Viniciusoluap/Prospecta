// EPIC-028 (Etapas 2 e 3) — harness das capturas: abre a MESMA página de prévia (/maquete-demo/<planta>) fora do app,
// sem servidor nem banco. Uso: `node scripts/maquete/screenshots.mjs`. Com `?admin=1`, o botão "Editar" aparece e o
// editor fala com uma conexão EM MEMÓRIA que imita as rotas do servidor (mesmas conferências: formato, regras de
// validarFonte, versão base); `?editar=1` já abre o editor.
import "./harness.css";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MaqueteDemo } from "@/pages/MaqueteDemo";
import type { ConexaoEditor } from "@/components/maquete-3d/editor/conexao";
import { lerFonte, type ItemFonte } from "@shared/maquete-3d/fonte";
import { bloqueiaSalvar, itensEdicaoSchema, problemasDaEdicao } from "@shared/maquete-3d/edicao";
import lote4 from "../../../data/plantas/lote4-qd18.json";

function conexaoEmMemoria(): ConexaoEditor {
  const fonte = lerFonte(lote4);
  const versoes: { versao: number; itens: ItemFonte[] }[] = [];
  let publicada: number | null = null;
  const erro = (message: string, code: string) => Object.assign(new Error(message), { data: { code } });
  return {
    abrir: async () => {
      const ultima = versoes.at(-1);
      return {
        maqueteId: 1, fonte: { ...fonte, itens: ultima?.itens ?? fonte.itens }, padrao: fonte.itens, versaoBase: ultima?.versao ?? 0,
        situacao: ultima ? (ultima.versao === publicada ? "publicada" : "rascunho") : "padrao", versaoPublicada: publicada,
        rascunhoNaoPublicado: !!ultima && ultima.versao !== publicada, estruturaMudou: false, ultimaSalva: null,
      };
    },
    salvar: async (_p, base, itens) => {
      const r = itensEdicaoSchema.safeParse(itens);
      if (!r.success) throw erro("Itens em formato inválido.", "BAD_REQUEST");
      if (bloqueiaSalvar(problemasDaEdicao(fonte, itens))) throw erro("Não foi salvo: há itens que bloqueiam portas ou atravessam paredes.", "BAD_REQUEST");
      if ((versoes.at(-1)?.versao ?? 0) !== base) throw erro("Os itens foram salvos por outra pessoa.", "CONFLICT");
      versoes.push({ versao: base + 1, itens });
      return { versao: base + 1 };
    },
    publicar: async (_p, versao, publicadaVista) => {
      if (versoes.at(-1)?.versao !== versao || publicada !== publicadaVista) throw erro("Versão desatualizada.", "CONFLICT");
      publicada = versao;
      return { versao };
    },
  };
}

const busca = new URLSearchParams(location.search);
const planta = busca.get("planta") ?? "lote4-qd18";
const { hook } = memoryLocation({ path: `/maquete-demo/${planta}` });
const conexao = busca.get("admin") === "1" ? conexaoEmMemoria() : null;
createRoot(document.getElementById("root")!).render(<Router hook={hook}><MaqueteDemo conexao={conexao} /></Router>);
