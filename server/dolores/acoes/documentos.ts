// EPIC-025 (Dolores, etapa 3) — gerar_documento (FILA). Aciona o gerador EXISTENTE (prompt mestre, seção 4.3) — nesta
// etapa, o Gerador de PCI da obra (`gerarPciDaObra`, o mesmo do botão "Gerar" da tela), que guarda a planilha e o PDF no
// histórico da obra e copia para a pasta da obra no Drive. A Dolores NÃO preenche dado: usa o rascunho que a equipe salvou
// na tela (nunca inventa valor). O resultado sai SEM assinatura e não vale como documento final: o engenheiro responsável
// confere e assina (seção 5: "ela prepara e encaminha ao profissional responsável"). Vai para a fila porque grava
// arquivo na pasta do cliente e é documento técnico — na dúvida, fila.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects } from "../../../drizzle/schema.js";
import { errosPci, normalizarFormularioPci, pendenciasPci } from "../../../shared/pci-gerador.js";
import { diaFortaleza } from "../../../shared/dolores/formato.js";
import { DOLORES_NOME } from "../perfil.js";
import { emTransacaoDeEscrita } from "../escrita.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { RecusaAcao, registrarAutoria, type ContextoAcao, type Preparo, type ResultadoAcao } from "./comum.js";
import { eq } from "drizzle-orm";

export const entradaGerarDocumento = z.object({
  tipo: z.literal("pci").describe("Documento do gerador: \"pci\" (PCI da CAIXA da obra, a partir do rascunho salvo pela equipe)."),
  obraId: z.number().int().positive().max(2_147_483_647).describe("Id da obra (listar_obras)."),
}).strict();

export const entradaDocumentoAprovado = z.object({
  tipo: z.literal("pci"),
  obraId: z.number().int().positive(),
  rascunhoEm: z.string().max(40),
}).strict();

type Rascunho = { obra: { id: number; title: string }; form: unknown; atualizadoEm: string; autor: string | null };

async function lerRascunho(obraId: number): Promise<Rascunho | null | "sem_obra"> {
  const db = bancoDaLeitura();
  const [obra] = await db.select({ id: constructionProjects.id, title: constructionProjects.title }).from(constructionProjects).where(eq(constructionProjects.id, obraId)).limit(1);
  if (!obra) return "sem_obra";
  const r = await db.execute(sql`SELECT d.form_data, d.updated_at, u.name AS autor FROM pci_generator_drafts d LEFT JOIN users u ON u.id = d.updated_by WHERE d.project_id = ${obraId}`);
  const [l] = (r as unknown as { rows: Array<{ form_data: unknown; updated_at: string | Date; autor: string | null }> }).rows;
  if (!l) return null;
  return { obra, form: l.form_data, atualizadoEm: new Date(l.updated_at).toISOString(), autor: l.autor };
}

/** Confere o rascunho (obra, existência, erros que bloqueiam a geração). Devolve o rascunho conferido. */
async function conferir(obraId: number): Promise<Rascunho> {
  const r = await emTransacaoSomenteLeitura(() => lerRascunho(obraId));
  if (r === "sem_obra") throw new RecusaAcao(`Obra ${obraId} não encontrada.`);
  if (!r) throw new RecusaAcao("A obra não tem rascunho do Gerador de PCI salvo. A equipe preenche e salva o rascunho na tela da obra (Gerador de PCI) — a Dolores não preenche dados.");
  const erros = errosPci(normalizarFormularioPci(r.form), { paraGerar: true });
  if (erros.length) throw new RecusaAcao(`O rascunho da PCI ainda não pode ser gerado: ${erros.slice(0, 5).join(" ").slice(0, 400)}`);
  const { modeloAtualPci } = await import("../../pci-gerador.js");
  if (!(await modeloAtualPci())) throw new RecusaAcao("Nenhum modelo de PCI cadastrado (Integrações › PCI da CAIXA).");
  return r;
}

export async function prepararDocumento(args: z.infer<typeof entradaGerarDocumento>, _ctx: ContextoAcao): Promise<Preparo> {
  const r = await conferir(args.obraId);
  const dia = diaFortaleza(r.atualizadoEm)!.split("-").reverse().join("/");
  return {
    itens: [{
      alvo: `pci:${args.obraId}`,
      resumo: `Gerar a PCI da obra "${r.obra.title.slice(0, 80)}" (obra ${r.obra.id}) pelo Gerador de PCI, com o rascunho salvo em ${dia}${r.autor ? ` por ${r.autor.slice(0, 60)}` : ""}; `
        + "sai sem assinatura, no histórico e na pasta da obra, para o engenheiro responsável conferir e assinar.",
      argumentos: { tipo: "pci", obraId: args.obraId, rascunhoEm: r.atualizadoEm },
    }],
    recusados: [],
  };
}

export async function executarDocumentoAprovado(args: z.infer<typeof entradaDocumentoAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  const r = await conferir(args.obraId);
  // o rascunho mudou depois do pedido: o dono aprovou outra coisa — não gera
  if (r.atualizadoEm !== args.rascunhoEm) throw new RecusaAcao("O rascunho da PCI foi alterado depois do pedido; nada foi gerado. Peça de novo para eu conferir a versão atual.");
  const { gerarPciDaObra } = await import("../../pci-gerador.js");
  let gerada: { id: number; avisos: string[]; pendencias: string[] };
  try {
    gerada = await gerarPciDaObra(args.obraId, r.form, { id: ctx.autorId, name: DOLORES_NOME });
  } catch (e) {
    throw new RecusaAcao(`O gerador recusou: ${(e instanceof Error ? e.message : "erro").slice(0, 300)}`);
  }
  const frase = `PCI da obra "${r.obra.title.slice(0, 60)}" gerada (#${gerada.id}), sem assinatura — encaminhar ao engenheiro responsável`;
  await emTransacaoDeEscrita(() => registrarAutoria(ctx, { tabela: "pci_generated", registroId: gerada.id, funcao: "gerar_documento", descricao: frase }));
  return {
    dados: {
      pciGeradaId: gerada.id, obraId: args.obraId, assinada: false, documentoFinal: false,
      observacao: "Documento preparado, sem assinatura: o engenheiro responsável confere e assina.",
      avisos: gerada.avisos.slice(0, 10), pendencias: pendenciasPci(normalizarFormularioPci(r.form)).slice(0, 10),
    },
    resumo: { gerada: true, avisos: gerada.avisos.length },
    feitos: [frase],
  };
}
