// EPIC-025 (Dolores, etapa 4) — card + documentos do cliente a partir do grupo (prompt mestre, seção 4.4), SÓ na execução de
// itens APROVADOS pelo dono (a preparação está em acoes/grupos.ts). Tudo é revalidado na hora; o que é gravado é exatamente o
// que o dono leu no resumo (conferirMostrado). Regras fixas deste arquivo:
// - nunca exclui nem sobrescreve: o card novo é um registro novo; o documento vai como arquivo NOVO no Drive (o nome é montado
//   pelo sistema: rótulo + data + extensão) e como documento novo no card; o mesmo arquivo (SHA-256) já no card não vai de novo;
// - o arquivo é baixado sob demanda (com prazo e tamanho máximo), conferido pelos bytes e não fica guardado no banco;
// - nada aqui envia mensagem a ninguém: da Evolution só se BAIXA o arquivo da mensagem (classificacao.ts, baixarArquivo).
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { leadActivities, leadDocuments, leads } from "../../drizzle/schema.js";
import { doloresGrupoMensagens, doloresGrupos } from "../../drizzle/schema-dolores-grupos.js";
import {
  ROTULO_TIPO_DOCUMENTO, TIPO_NO_CARD, bytesDoBase64, formatoPorBytes, formatoSalvavel, pendenteVencido,
} from "../../shared/dolores/grupos.js";
import { textoDeDado } from "../../shared/dolores/fila.js";
import { ROTULO_DOCUMENTO } from "../../shared/drive-estrutura.js";
import { documentHash, driveConfigured, comPrazoNoDrive, uploadPrivateDocument } from "../drive-documents.js";
import { MARCA_DOLORES, RecusaAcao, conferirMostrado, registrarAutoria, type ContextoAcao, type ResultadoAcao } from "./acoes/comum.js";
import { clientesParecidos, type entradaCardAprovado, type entradaSalvarAprovado } from "./acoes/grupos.js";
import { ArquivoGrandeDemais, baixarArquivo } from "./classificacao.js";
import { erroParaLog } from "./erro-seguro.js";
import { bancoDaAcao, emTransacaoDeEscrita } from "./escrita.js";
import { lerConfigGrupos, ligarGrupoAoCliente, marcarDocumentoSalvo } from "./grupos.js";
import { listarDocumentos } from "./leitura/documentos.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "./somente-leitura.js";
import type { z } from "zod";

export const ORIGEM_DO_CARD = "Dolores — grupo do WhatsApp";

/** Card aprovado: cria (conferindo de novo que não existe) ou liga o grupo ao card existente. Tudo numa transação. */
export async function executarCardAprovado(args: z.infer<typeof entradaCardAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  // o que é gravado no modo "criar" (nome e telefone) tem de estar no resumo que o dono leu; "vincular" não grava texto
  if (args.modo === "criar") conferirMostrado(ctx, [`"${args.nome}"`, ...(args.telefone ? [args.telefone] : [])]);
  return emTransacaoDeEscrita(async () => {
    const tx = bancoDaAcao();
    const [g] = await tx.select().from(doloresGrupos).where(eq(doloresGrupos.id, args.grupoId)).limit(1);
    if (!g || !g.ativo) throw new RecusaAcao(`O grupo ${args.grupoId} não está mais ativo; nada foi feito.`);
    if (g.leadId || g.obraId) throw new RecusaAcao(`O grupo ${args.grupoId} já foi ligado a ${g.leadId ? `outro card (cliente #${g.leadId})` : "uma obra"} depois do pedido; nada foi feito.`);
    let leadId: number;
    let frase: string;
    if (args.modo === "vincular") {
      const [l] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.id, args.leadId!), isNull(leads.deletedAt))).limit(1);
      if (!l) throw new RecusaAcao(`O cliente #${args.leadId} não existe mais no CRM (ou foi excluído); nada foi feito.`);
      leadId = l.id;
      frase = `grupo ${g.id} ligado ao card do cliente #${leadId}`;
    } else {
      // conferir de novo: um card igual pode ter sido criado entre o pedido e a aprovação
      const parecidos = await clientesParecidos(tx as never, args.nome, args.telefone);
      if (parecidos.length) throw new RecusaAcao(`Apareceu no CRM um cliente com esse nome ou telefone depois do pedido (cliente #${parecidos[0].id}); não criei outro card. Peça de novo para eu ligar o grupo a ele.`);
      const [novo] = await tx.insert(leads).values({
        name: args.nome, phone: args.telefone, stage: "lead_new", temperature: "cold", type: "new_lead", sourceChannel: ORIGEM_DO_CARD,
      } as typeof leads.$inferInsert).returning({ id: leads.id });
      leadId = novo.id;
      frase = `card do cliente "${textoDeDado(args.nome, 60)}" criado no CRM (cliente #${leadId}) e grupo ${g.id} ligado a ele`;
    }
    if (!(await ligarGrupoAoCliente(tx, g.id, leadId, ctx.autorId))) throw new RecusaAcao("Não consegui ligar o grupo ao card (o grupo mudou); nada foi feito.");
    await tx.insert(leadActivities).values({
      leadId, type: args.modo === "criar" ? "status_change" : "note",
      description: args.modo === "criar"
        ? `Card criado pela Dolores, com aprovação do dono, para o grupo de WhatsApp do cliente (grupo ${g.id}).`
        : `Grupo de WhatsApp do cliente (grupo ${g.id}) ligado a este card pela Dolores, com aprovação do dono.`,
      performedBy: MARCA_DOLORES,
    });
    await registrarAutoria(ctx, { tabela: args.modo === "criar" ? "leads" : "dolores_grupos", registroId: args.modo === "criar" ? leadId : g.id, funcao: "criar_card_cliente", descricao: frase });
    return { dados: { leadId, grupoId: g.id, criado: args.modo === "criar" }, resumo: { modo: args.modo, leadId }, feitos: [frase] };
  });
}

/** Prazos do salvamento (o item só começa com 20 s — aprovacoes.ts, MINIMO_POR_FUNCAO_MS). */
const PRAZO_DOWNLOAD_MS = 12_000;
const PRAZO_DRIVE_MS = 15_000;
const FOLGA_FINAL_MS = 4_000;

/** O que ainda falta pelo checklist do cliente (a mesma regra de listar_documentos). Nunca lança. */
async function faltamNoChecklist(leadId: number): Promise<string[]> {
  try {
    const r = await emTransacaoSomenteLeitura(() => listarDocumentos({ leadId, situacao: "pendentes", pagina: 1, limite: 50 }));
    return ((r.dados as { itens?: Array<{ documento: string }> }).itens ?? []).map(d => textoDeDado(d.documento, 80)).slice(0, 20);
  } catch { return []; }
}

/**
 * Documento aprovado: confere tudo de novo, baixa o arquivo, confere tamanho e formato reais, não duplica (SHA-256), envia ao
 * Drive pelo organizador existente (Clientes › Nome (nº id) › área) e registra no card. Depois do envio ao Drive, nenhuma
 * falha vira "não foi feito": o dono é avisado para conferir.
 */
export async function executarSalvarAprovado(args: z.infer<typeof entradaSalvarAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  conferirMostrado(ctx, [`"${args.nomeArquivo}"`, `"${ROTULO_TIPO_DOCUMENTO[args.tipo]}"`]);
  const restante = () => ctx.tempoRestanteMs?.() ?? 42_000;
  const lido = await emTransacaoSomenteLeitura(async () => {
    const db = bancoDaLeitura();
    const [g] = await db.select().from(doloresGrupos).where(eq(doloresGrupos.id, args.grupoId)).limit(1);
    const [m] = await db.select().from(doloresGrupoMensagens).where(and(eq(doloresGrupoMensagens.id, args.mensagemId), eq(doloresGrupoMensagens.grupoId, args.grupoId))).limit(1);
    const [l] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, args.leadId), isNull(leads.deletedAt))).limit(1);
    return { g, m, l };
  });
  const { g, m, l } = lido;
  if (!g || !g.ativo) throw new RecusaAcao(`O grupo ${args.grupoId} não está mais ativo; nada foi salvo.`);
  if (g.leadId !== args.leadId || !l) throw new RecusaAcao("O grupo não está mais ligado a este card (ou o cliente foi excluído); nada foi salvo.");
  if (!m || (m.tipo !== "imagem" && m.tipo !== "documento")) throw new RecusaAcao(`Documento ${args.mensagemId} não encontrado no grupo; nada foi salvo.`);
  if (m.situacao === "salvo") throw new RecusaAcao(`O documento ${m.id} já está salvo no card; nada foi feito de novo.`);
  if (m.classificacao !== args.tipo) throw new RecusaAcao(`A classificação do documento ${m.id} mudou depois do pedido; nada foi salvo. Peça de novo.`);
  const config = await lerConfigGrupos();
  if (pendenteVencido(m.criadoEm, ctx.agora, config.retencaoDias)) throw new RecusaAcao(`O documento ${m.id} chegou há mais de ${config.retencaoDias} dias; peça para reenviar no grupo. Nada foi salvo.`);
  if (!(await driveConfigured())) throw new RecusaAcao("O Google Drive da Prospecta não está configurado (Configurações); nada foi salvo.");

  let bytes: Buffer;
  try {
    const r = await baixarArquivo({ instancia: m.instancia, externalId: m.externalId, prazoMs: Math.max(1_000, Math.min(PRAZO_DOWNLOAD_MS, restante() - PRAZO_DRIVE_MS - FOLGA_FINAL_MS)), maxBytes: config.tamanhoMaximoBytes });
    if (!r?.base64) throw new Error("sem arquivo");
    if (bytesDoBase64(r.base64) > config.tamanhoMaximoBytes) throw new RecusaAcao(`O arquivo passa do limite de ${Math.round(config.tamanhoMaximoBytes / 1_048_576)} MB; nada foi salvo.`);
    bytes = Buffer.from(r.base64, "base64");
  } catch (e) {
    if (e instanceof RecusaAcao) throw e;
    if (e instanceof ArquivoGrandeDemais) throw new RecusaAcao(`O arquivo passa do limite de ${Math.round(config.tamanhoMaximoBytes / 1_048_576)} MB (o download foi cortado); nada foi salvo.`);
    console.error("[dolores/documentos-cliente] falha ao baixar o arquivo", erroParaLog(e));
    throw new RecusaAcao("Não consegui baixar o arquivo do WhatsApp agora; nada foi salvo. Peça de novo em instantes.");
  }
  const formato = formatoPorBytes(bytes);
  if (!formatoSalvavel(formato)) throw new RecusaAcao("O arquivo não é PDF, JPG, PNG nem WEBP (conferido pelo conteúdo); nada foi salvo. Ele continua no grupo.");
  const sha256 = documentHash(bytes);
  const tipoCard = TIPO_NO_CARD[args.tipo] as typeof leadDocuments.$inferInsert.type;
  const rotulo = ROTULO_TIPO_DOCUMENTO[args.tipo];

  // o mesmo arquivo já está no card: não envia de novo (nunca duplica nem sobrescreve)
  const [igual] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select({ id: leadDocuments.id }).from(leadDocuments)
    .where(and(eq(leadDocuments.leadId, args.leadId), eq(leadDocuments.sha256, sha256), isNotNull(leadDocuments.driveFileId), isNull(leadDocuments.deletedAt))).limit(1));
  if (igual) {
    await emTransacaoDeEscrita(async () => {
      await marcarDocumentoSalvo(bancoDaAcao(), m.id, igual.id, ctx.agora);
      await registrarAutoria(ctx, { tabela: "dolores_grupo_mensagens", registroId: m.id, funcao: "salvar_documentos_grupo", descricao: `documento ${m.id} já estava no card (documento #${igual.id})` });
    });
    const faltam = await faltamNoChecklist(args.leadId);
    return { dados: { leadDocumentId: igual.id, jaEstava: true, faltamNoChecklist: faltam }, resumo: { jaEstava: true },
      feitos: [`"${args.nomeArquivo}" já estava no card (documento #${igual.id}); não enviei de novo`] };
  }

  // arquivo NOVO no Drive, pelo organizador do sistema (o nome do Drive é rótulo + data; o nome que veio do grupo não é caminho)
  let driveFileId: string;
  try {
    driveFileId = await comPrazoNoDrive(Math.max(1_000, Math.min(PRAZO_DRIVE_MS, restante() - FOLGA_FINAL_MS)), () => uploadPrivateDocument({
      leadId: args.leadId, serviceId: null, categoria: tipoCard, rotulo: ROTULO_DOCUMENTO[tipoCard] && tipoCard !== "other" ? ROTULO_DOCUMENTO[tipoCard] : rotulo,
      nomeOriginal: `arquivo.${formato!.formato === "jpeg" ? "jpg" : formato!.formato}`, mimeType: formato!.mime, data: bytes,
    }));
  } catch (e) {
    console.error("[dolores/documentos-cliente] o Drive não aceitou o arquivo", erroParaLog(e));
    throw new RecusaAcao("O Google Drive não aceitou o arquivo agora; nada foi salvo no card. Peça de novo em instantes.");
  }
  const tamanho = bytes.length;
  // Daqui em diante o arquivo EXISTE no Drive: nenhuma falha vira "não foi feito".
  const frase = `"${args.nomeArquivo}" salvo no card do cliente #${args.leadId} como "${rotulo}" e na pasta dele no Drive`;
  let leadDocumentId: number | null = null;
  try {
    leadDocumentId = await emTransacaoDeEscrita(async () => {
      const tx = bancoDaAcao();
      const [doc] = await tx.insert(leadDocuments).values({
        leadId: args.leadId, type: tipoCard, fileName: args.nomeArquivo.slice(0, 255), mimeType: formato!.mime, fileSize: tamanho, sha256, driveFileId,
        uploadedByUserId: ctx.autorId, status: "received", uploadedAt: ctx.agora,
        notes: `Recebido no grupo do WhatsApp (grupo ${args.grupoId}) e salvo pela Dolores com aprovação do dono; classificado como "${rotulo}" pela IA${m.situacao === "confira" ? " (confiança baixa: conferir)" : ""}.`,
      }).returning({ id: leadDocuments.id });
      // a mesma regra da tela de documentos: o pedido pendente do mesmo tipo (sem arquivo) passa a recebido
      await tx.update(leadDocuments).set({ status: "received", reviewedAt: ctx.agora }).where(and(
        eq(leadDocuments.leadId, args.leadId), isNull(leadDocuments.serviceId), eq(leadDocuments.type, tipoCard), eq(leadDocuments.status, "pending"),
        isNull(leadDocuments.driveFileId), isNull(leadDocuments.deletedAt)));
      await tx.insert(leadActivities).values({ leadId: args.leadId, type: "document", performedBy: MARCA_DOLORES,
        description: `Documento "${rotulo}" recebido no grupo do WhatsApp e salvo pela Dolores (aprovado pelo dono).` });
      if (!(await marcarDocumentoSalvo(tx, m.id, doc.id, ctx.agora))) throw new Error("documento do grupo já marcado como salvo");
      await registrarAutoria(ctx, { tabela: "lead_documents", registroId: doc.id, funcao: "salvar_documentos_grupo", descricao: frase });
      return doc.id;
    });
  } catch (e) {
    console.error("[dolores/documentos-cliente] arquivo enviado ao Drive, mas não registrado no card", erroParaLog(e));
  }
  const faltam = await faltamNoChecklist(args.leadId);
  return {
    dados: { leadDocumentId, enviadoAoDrive: true, registradoNoCard: leadDocumentId !== null, faltamNoChecklist: faltam },
    resumo: { salvo: leadDocumentId !== null, enviadoAoDrive: true, bytes: tamanho },
    feitos: [leadDocumentId !== null ? frase
      : `o arquivo "${args.nomeArquivo}" FOI enviado à pasta do cliente #${args.leadId} no Drive, mas não consegui registrá-lo no card; confira em Documentos do cliente`],
  };
}
