// Maquete 3D (EPIC-028, Etapa 3) — o que o editor de itens precisa do servidor. No app, as rotas tRPC só do admin
// (`maquete3d.itens.*`, `useConexaoEditor`); nas capturas, uma conexão em memória (scripts/maquete/harness). Só
// tipos e um gancho pequeno: o código do editor fica no pedaço `EditorItens` (lazy), baixado só pelo admin.
import { useMemo } from "react";
import type { FontePlanta, ItemFonte } from "@shared/maquete-3d/fonte";
import { trpc } from "@/lib/trpc";

export type DadosEdicao = {
  maqueteId: number;
  fonte: FontePlanta;
  padrao: ItemFonte[];
  versaoBase: number;
  situacao: "padrao" | "rascunho" | "publicada";
  versaoPublicada: number | null;
  rascunhoNaoPublicado: boolean;
  estruturaMudou: boolean;
  /** A versão carregada foi salva com outra estrutura: o Salvar fica liberado mesmo sem mudança nos itens. */
  precisaRegravar: boolean;
  ultimaSalva: { versao: number; em: Date | string; autor: string | null } | null;
};

export type ConexaoEditor = {
  abrir: (planta: string) => Promise<DadosEdicao>;
  salvar: (planta: string, versaoBase: number, itens: ItemFonte[]) => Promise<{ versao: number }>;
  /** `publicadaVista`: a versão publicada que a tela conhecia (null = nada publicado); mudou no servidor → CONFLICT. */
  publicar: (planta: string, versao: number, publicadaVista: number | null) => Promise<{ versao: number }>;
  /** Etapa 4: lotes ligados à maquete da planta (página pública por lote). */
  lotes?: ConexaoLotes;
};

// ── Etapa 4: lotes (N lotes → a mesma planta), cada um com a sua versão publicada e o link ──
export type StatusLoteAdmin = "disponivel" | "reservado" | "vendido" | null;
export type LoteAdmin = {
  id: number; empreendimentoSlug: string; loteSlug: string; empreendimentoNome: string | null; quadra: string | null; lote: string | null;
  itensVersao: number | null; versaoEfetiva: number | null; ativo: boolean; caminho: string | null;
  unidade: { id: number; codigo: string; estudo: string | null; status: StatusLoteAdmin } | null; pendencia: string | null;
};
export type ListaLotes = {
  versaoPublicada: number | null;
  versoes: { versao: number; situacao: string; publicadaEm: Date | string; valeParaPlanta: boolean }[];
  lotes: LoteAdmin[];
};
export type DadosSalvarLote = {
  id?: number; planta: string; empreendimentoSlug: string; loteSlug: string; empreendimentoNome: string;
  quadra: string | null; lote: string | null; itensVersao: number | null; unitId: number | null; ativo: boolean;
};
export type ConexaoLotes = {
  listar: (planta: string) => Promise<ListaLotes>;
  salvar: (dados: DadosSalvarLote) => Promise<{ id: number }>;
  gerarCodigo: (planta: string, id: number) => Promise<{ caminho: string }>;
  unidades: (busca: string) => Promise<{ id: number; codigo: string; estudo: string | null; status: StatusLoteAdmin }[]>;
  semearPadrao: (planta: string) => Promise<{ criado: boolean; unidadeLigada: boolean }>;
};

/** Erro do servidor em português, e se foi conflito de versão (outra pessoa salvou antes). */
export function lerErro(e: unknown): { mensagem: string; conflito: boolean } {
  const x = e as { message?: string; data?: { code?: string }; shape?: { data?: { code?: string } } };
  const code = x?.data?.code ?? x?.shape?.data?.code;
  return { mensagem: x?.message || "Não foi possível falar com o servidor.", conflito: code === "CONFLICT" };
}

/** Conexão do app: só existe para o usuário logado com papel de administrador (o servidor confere de novo). */
export function useConexaoEditor(): ConexaoEditor | null {
  const me = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const admin = (me.data as { role?: string } | null | undefined)?.role === "admin";
  return useMemo(() => (admin ? {
    abrir: planta => utils.client.maquete3d.itens.abrir.mutate({ planta }) as Promise<DadosEdicao>,
    salvar: (planta, versaoBase, itens) => utils.client.maquete3d.itens.salvar.mutate({ planta, versaoBase, itens }),
    publicar: (planta, versao, publicadaVista) => utils.client.maquete3d.itens.publicar.mutate({ planta, versao, publicadaVista }),
    lotes: {
      listar: planta => utils.client.maquete3d.lotes.listar.query({ planta }) as Promise<ListaLotes>,
      salvar: dados => utils.client.maquete3d.lotes.salvar.mutate(dados),
      gerarCodigo: (planta, id) => utils.client.maquete3d.lotes.gerarCodigo.mutate({ planta, id }),
      unidades: busca => utils.client.maquete3d.lotes.unidades.query({ busca }),
      semearPadrao: planta => utils.client.maquete3d.lotes.semearPadrao.mutate({ planta }),
    },
  } : null), [admin, utils]);
}
