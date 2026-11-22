// EPIC-028 (Etapas 2 e 3) — harness das capturas: abre a MESMA página de prévia (/maquete-demo/<planta>) fora do app,
// sem servidor nem banco. Uso: `node scripts/maquete/screenshots.mjs`. Com `?admin=1`, o botão "Editar" aparece e o
// editor fala com uma conexão EM MEMÓRIA que imita as rotas do servidor (mesmas conferências: formato, regras de
// validarFonte, versão base); `?editar=1` já abre o editor.
import "./harness.css";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MaqueteDemo } from "@/pages/MaqueteDemo";
import type { ConexaoEditor, ConexaoLotes, LoteAdmin } from "@/components/maquete-3d/editor/conexao";
import { VistaDoLote } from "@/pages/MaqueteLote";
import type { DadosLotePublico, StatusLote } from "@shared/maquete-3d/lote-publico";
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
    publicar: async (_p, versao) => {
      if (versoes.at(-1)?.versao !== versao) throw erro("Versão desatualizada.", "CONFLICT");
      publicada = versao;
      return { versao };
    },
    lotes: lotesEmMemoria(() => publicada, () => versoes.map(v => v.versao)),
  };
}

// Etapa 4: lotes em memória (mesmo formato das rotas maquete3d.lotes.*), para capturar o painel do admin.
function lotesEmMemoria(publicada: () => number | null, salvas: () => number[]): ConexaoLotes {
  const lotes: LoteAdmin[] = [];
  const codigo = () => Math.random().toString(36).slice(2, 12).padEnd(10, "x");
  const caminho = (l: LoteAdmin) => `/maquete/${l.empreendimentoSlug}/${l.loteSlug}-${codigo()}`;
  return {
    listar: async () => ({
      versaoPublicada: publicada(),
      versoes: salvas().filter(v => publicada() !== null && v <= publicada()!).reverse().map(v => ({ versao: v, situacao: v === publicada() ? "publicada" : "arquivada", publicadaEm: new Date().toISOString(), valeParaPlanta: true })),
      lotes: lotes.map(l => ({ ...l, versaoEfetiva: l.itensVersao ?? publicada(), pendencia: !l.ativo ? "Lote desligado." : !(l.itensVersao ?? publicada()) ? "Nenhuma versão de itens publicada ainda." : null })),
    }),
    salvar: async d => {
      const atual = d.id ? lotes.find(l => l.id === d.id) : undefined;
      const novo: LoteAdmin = { ...(atual ?? { id: lotes.length + 1, caminho: null, unidade: null, versaoEfetiva: null, pendencia: null }), empreendimentoSlug: d.empreendimentoSlug, loteSlug: d.loteSlug,
        empreendimentoNome: d.empreendimentoNome, quadra: d.quadra, lote: d.lote, itensVersao: d.itensVersao, ativo: d.ativo,
        unidade: d.unitId ? { id: d.unitId, codigo: "QD 18 LOTE 04", estudo: "Vila Esmeralda", status: "disponivel" } : null };
      if (!atual) novo.caminho = caminho(novo);
      if (atual) lotes.splice(lotes.indexOf(atual), 1, novo); else lotes.push(novo);
      return { id: novo.id };
    },
    gerarCodigo: async (_p, id) => { const l = lotes.find(x => x.id === id)!; l.caminho = caminho(l); return { caminho: l.caminho }; },
    unidades: async () => [{ id: 1, codigo: "QD 18 LOTE 04", estudo: "Vila Esmeralda", status: "disponivel" }],
    semearPadrao: async () => {
      if (lotes.some(l => l.loteSlug === "qd18-lote4")) return { criado: false, unidadeLigada: true };
      const l: LoteAdmin = { id: lotes.length + 1, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote4", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "4",
        itensVersao: null, versaoEfetiva: null, ativo: true, caminho: null, unidade: { id: 1, codigo: "QD 18 LOTE 04", estudo: "Vila Esmeralda", status: "disponivel" }, pendencia: null };
      l.caminho = caminho(l);
      lotes.push(l);
      return { criado: true, unidadeLigada: true };
    },
  };
}

const busca = new URLSearchParams(location.search);
const planta = busca.get("planta") ?? "lote4-qd18";
const { hook } = memoryLocation({ path: `/maquete-demo/${planta}` });
const conexao = busca.get("admin") === "1" ? conexaoEmMemoria() : null;
// Etapa 4: `?pagina=lote&status=disponivel|reservado|vendido|nenhum` mostra a página pública do lote com dados de teste
// (os mesmos campos que o servidor entrega: textos, status e a planta com os itens padrão).
const status = busca.get("status") ?? "disponivel";
const dadosDoLote: DadosLotePublico = {
  empreendimento: "Vila Esmeralda", quadra: "18", lote: "4", fonte: lerFonte(lote4),
  status: status === "nenhum" ? null : (status as StatusLote),
};
createRoot(document.getElementById("root")!).render(busca.get("pagina") === "lote"
  ? <VistaDoLote dados={dadosDoLote} />
  : <Router hook={hook}><MaqueteDemo conexao={conexao} /></Router>);
