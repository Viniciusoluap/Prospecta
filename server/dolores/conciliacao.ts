// EPIC-025 (Dolores, etapa 5) — execução dos itens APROVADOS das notas de obra (prompt mestre, seção 6: `conciliacao.ts`). A
// preparação está em acoes/notas.ts; aqui tudo é revalidado na hora. Regras fixas deste arquivo:
// - nunca cria, altera, paga, baixa ou estorna lançamento do BPO nem pagamento da obra: o vínculo fica SÓ na nota (obra_notas,
//   registro da Dolores), uma vez (gatilho da 0128), e só com o pagamento PAGO e vindo do extrato do banco;
// - o arquivo vai ao Drive como arquivo NOVO, com o nome montado pelo sistema e só se for o MESMO que foi lido (SHA-256);
// - nada aqui envia mensagem a ninguém (da Evolution só se BAIXA o arquivo da mensagem).
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { constructionProjects } from "../../drizzle/schema.js";
import { doloresGrupoMensagens, doloresGrupos } from "../../drizzle/schema-dolores-grupos.js";
import { obraNotas } from "../../drizzle/schema-dolores-notas.js";
import { bytesDoBase64, formatoPorBytes, formatoSalvavel } from "../../shared/dolores/grupos.js";
import { caminhoNotasObra } from "../../shared/drive-estrutura.js";
import { comPrazoNoDrive, driveConfigured, uploadArquivoNoCaminho } from "../drive-documents.js";
import { RecusaAcao, conferirMostrado, registrarAutoria, type ContextoAcao, type ResultadoAcao } from "./acoes/comum.js";
import type { entradaConciliarAprovado, entradaSalvarNotaAprovado } from "./acoes/notas.js";
import { ArquivoGrandeDemais, baixarArquivo } from "./classificacao.js";
import { erroParaLog } from "./erro-seguro.js";
import { bancoDaAcao, emTransacaoDeEscrita } from "./escrita.js";
import { lerConfigGrupos } from "./grupos.js";
import { apontarConciliacao } from "../../shared/dolores/notas.js";
import { janelaDaConciliacao, lancamentosParaConciliar, paraConciliar } from "./leitura/notas.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "./somente-leitura.js";
import type { z } from "zod";

const somarDias = (iso: string, dias: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10);

/** Conciliação aprovada: grava o vínculo NA NOTA, depois de conferir tudo de novo numa transação. */
export async function executarConciliarAprovado(args: z.infer<typeof entradaConciliarAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  if (!ctx.aprovacaoId) throw new RecusaAcao("A conciliação só acontece por item aprovado na fila; nada foi feito.");
  return emTransacaoDeEscrita(async () => {
    const tx = bancoDaAcao();
    const [n] = await tx.select().from(obraNotas).where(eq(obraNotas.id, args.notaId)).limit(1);
    if (!n) throw new RecusaAcao(`Nota ${args.notaId} não encontrada; nada foi feito.`);
    // vínculo perdido (lançamento excluído no BPO) pode ser religado por ESTA nova aprovação; ligada a um lançamento, não
    if (n.bpoLancamentoId || (n.conciliadaAprovacaoId !== null && n.conciliadaAprovacaoId === ctx.aprovacaoId)) {
      throw new RecusaAcao(`A nota ${n.id} já foi ligada a um pagamento depois do pedido; nada foi feito.`);
    }
    if (n.obraId !== args.obraId || n.valorCentavos !== args.valorCentavos || n.duplicadaDe || !n.dataEmissao) {
      throw new RecusaAcao(`A nota ${n.id} mudou depois do pedido (obra, valor ou duplicidade); nada foi feito. Peça de novo.`);
    }
    // EPIC-029 S-5b: cancelada (pode ter chegado o evento entre o pedido e a aprovação) ou mesma nota da outra origem → nada
    if (n.canceladaEm) throw new RecusaAcao(`A nota ${n.id} foi CANCELADA pelo emitente depois do pedido; nada foi feito.`);
    if (n.outraOrigemDe) throw new RecusaAcao(`A nota ${n.id} é a mesma nota ${n.outraOrigemDe} da outra origem: a conciliação fica na nota ${n.outraOrigemDe}; nada foi feito.`);
    const janela = await janelaDaConciliacao(tx as never);
    const lancs = await lancamentosParaConciliar(tx as never, somarDias(n.dataEmissao, -janela), somarDias(n.dataEmissao, janela));
    const l = lancs.find(x => x.id === args.lancamentoId);
    if (!l) throw new RecusaAcao(`O lançamento #${args.lancamentoId} não está mais no BPO (ou saiu da janela de datas); nada foi feito.`);
    if (!l.pago || !l.doBanco) throw new RecusaAcao(`O lançamento #${l.id} não está pago pelo extrato do banco; nada foi feito.`);
    if (Math.abs(l.valorCentavos - args.valorCentavos) > 1) throw new RecusaAcao(`O valor do lançamento #${l.id} mudou e não confere mais com a nota; nada foi feito.`);
    if (l.notaLigada) throw new RecusaAcao(`O lançamento #${l.id} já está ligado à nota ${l.notaLigada}; nada foi feito.`);
    if (l.obraId !== null && l.obraId !== n.obraId) throw new RecusaAcao(`O lançamento #${l.id} está ligado a outra obra; nada foi feito.`);
    // a MESMA regra da proposta, refeita agora (QA E5 achado 4): o fornecedor, a obra ou outro pagamento podem ter mudado no BPO
    // entre o pedido e a aprovação — se a nota não aponta mais para ESTE lançamento, nada é gravado
    const ap = apontarConciliacao(paraConciliar(n), lancs.filter(x => x.notaLigada !== n.id), janela);
    const aponta = ap.situacao === "ja_lancado" ? ap.lancamentoId === l.id : ap.situacao === "varios" ? ap.lancamentoIds.includes(l.id) : false;
    if (!aponta) throw new RecusaAcao(`O lançamento #${l.id} não confere mais com a nota ${n.id} (valor, data, fornecedor e obra) desde o pedido; nada foi feito. Peça de novo.`);
    const r = await tx.update(obraNotas).set({ bpoLancamentoId: l.id, conciliadaEm: ctx.agora, conciliadaAprovacaoId: ctx.aprovacaoId })
      .where(and(eq(obraNotas.id, n.id), isNull(obraNotas.bpoLancamentoId))).returning({ id: obraNotas.id });
    if (!r.length) throw new RecusaAcao(`A nota ${n.id} já foi ligada a um pagamento; nada foi feito.`);
    const frase = `nota ${n.id} ligada ao pagamento do BPO lançamento #${l.id} (o lançamento não foi alterado)`;
    await registrarAutoria(ctx, { tabela: "obra_notas", registroId: n.id, funcao: "conciliar_nota_obra", descricao: frase });
    return { dados: { notaId: n.id, lancamentoId: l.id }, resumo: { conciliada: true }, feitos: [frase] };
  });
}

const PRAZO_DOWNLOAD_MS = 12_000;
const PRAZO_DRIVE_MS = 15_000;
const FOLGA_FINAL_MS = 4_000;

/** Arquivo da nota aprovado: baixa de novo, confere que é o MESMO lido (SHA-256) e envia à pasta da obra como arquivo novo. */
export async function executarSalvarNotaAprovado(args: z.infer<typeof entradaSalvarNotaAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  if (!ctx.aprovacaoId) throw new RecusaAcao("O arquivo da nota só vai ao Drive por item aprovado na fila; nada foi feito.");
  conferirMostrado(ctx, [`"${args.nomeArquivo}"`]);
  const restante = () => ctx.tempoRestanteMs?.() ?? 42_000;
  const { n, msg, obra } = await emTransacaoSomenteLeitura(async () => {
    const db = bancoDaLeitura();
    const [n] = await db.select().from(obraNotas).where(eq(obraNotas.id, args.notaId)).limit(1);
    const [msg] = n && n.mensagemId !== null ? await db.select({ instancia: doloresGrupoMensagens.instancia, externalId: doloresGrupoMensagens.externalId, ativo: doloresGrupos.ativo })
      .from(doloresGrupoMensagens).innerJoin(doloresGrupos, eq(doloresGrupos.id, doloresGrupoMensagens.grupoId)).where(eq(doloresGrupoMensagens.id, n.mensagemId)).limit(1) : [];
    const [obra] = await db.select({ id: constructionProjects.id, titulo: constructionProjects.title }).from(constructionProjects).where(eq(constructionProjects.id, args.obraId)).limit(1);
    return { n, msg, obra };
  });
  if (!n || n.obraId !== args.obraId || !obra) throw new RecusaAcao(`A nota ${args.notaId} não está mais ligada a esta obra (ou a obra foi excluída); nada foi salvo.`);
  if (n.driveFileId) throw new RecusaAcao(`O arquivo da nota ${n.id} já está no Drive; nada foi feito de novo.`);
  if (n.arquivoSha256 !== args.sha256) throw new RecusaAcao(`O arquivo da nota ${n.id} não confere com o pedido; nada foi salvo.`);
  // EPIC-029 S-5: a NFS-e recebida pelo ADN não veio de mensagem do WhatsApp (o XML fica em obra_notas_adn): nada a baixar
  if (n.origem !== "grupo") throw new RecusaAcao(`A nota ${n.id} veio do ADN (nota fiscal recebida), não de um grupo: não há arquivo do WhatsApp para salvar; nada foi salvo.`);
  if (!msg) throw new RecusaAcao(`A mensagem da nota ${n.id} não foi encontrada; nada foi salvo.`);
  // grupo desativado depois do pedido (QA E5 achado 5): nada é baixado do grupo nem enviado ao Drive
  if (!msg.ativo) throw new RecusaAcao(`O grupo da nota ${n.id} foi desativado depois do pedido; nada foi salvo. Reative o grupo e peça de novo.`);
  if (!(await driveConfigured())) throw new RecusaAcao("O Google Drive da Prospecta não está configurado (Configurações); nada foi salvo.");
  const config = await lerConfigGrupos();
  let bytes: Buffer;
  try {
    const r = await baixarArquivo({ instancia: msg.instancia, externalId: msg.externalId, prazoMs: Math.max(1_000, Math.min(PRAZO_DOWNLOAD_MS, restante() - PRAZO_DRIVE_MS - FOLGA_FINAL_MS)), maxBytes: config.tamanhoMaximoBytes });
    if (!r?.base64) throw new Error("sem arquivo");
    if (bytesDoBase64(r.base64) > config.tamanhoMaximoBytes) throw new RecusaAcao("O arquivo passa do limite configurado; nada foi salvo.");
    bytes = Buffer.from(r.base64, "base64");
  } catch (e) {
    if (e instanceof RecusaAcao) throw e;
    if (e instanceof ArquivoGrandeDemais) throw new RecusaAcao("O arquivo passa do limite configurado (o download foi cortado); nada foi salvo.");
    console.error("[dolores/conciliacao] falha ao baixar o arquivo da nota", erroParaLog(e));
    throw new RecusaAcao("Não consegui baixar o arquivo do WhatsApp agora; nada foi salvo. Peça de novo em instantes.");
  }
  // o MESMO arquivo que foi lido (o que o dono viu no rascunho), senão nada vai
  if (createHash("sha256").update(bytes).digest("hex") !== n.arquivoSha256) throw new RecusaAcao(`O arquivo baixado agora não é o mesmo que foi lido na nota ${n.id}; nada foi salvo.`);
  const formato = formatoPorBytes(bytes);
  if (!formatoSalvavel(formato)) throw new RecusaAcao("O arquivo não é PDF, JPG, PNG nem WEBP (conferido pelo conteúdo); nada foi salvo.");
  let driveFileId: string;
  try {
    driveFileId = await comPrazoNoDrive(Math.max(1_000, Math.min(PRAZO_DRIVE_MS, restante() - FOLGA_FINAL_MS)), () =>
      uploadArquivoNoCaminho({ caminho: caminhoNotasObra({ id: obra.id, numero: obra.id, nome: obra.titulo }), nome: args.nomeArquivo }, formato!.mime, bytes));
  } catch (e) {
    console.error("[dolores/conciliacao] o Drive não aceitou o arquivo da nota", erroParaLog(e));
    throw new RecusaAcao("O Google Drive não aceitou o arquivo agora; nada foi salvo. Peça de novo em instantes.");
  }
  // daqui em diante o arquivo EXISTE no Drive: nenhuma falha vira "não foi feito"
  const frase = `arquivo da nota ${n.id} salvo na pasta da obra ${obra.id} no Drive como "${args.nomeArquivo}"`;
  let registrado = false;
  try {
    registrado = await emTransacaoDeEscrita(async () => {
      const r = await bancoDaAcao().update(obraNotas).set({ driveFileId: driveFileId.slice(0, 200), salvaEm: ctx.agora, salvaAprovacaoId: ctx.aprovacaoId })
        .where(and(eq(obraNotas.id, n.id), isNull(obraNotas.driveFileId))).returning({ id: obraNotas.id });
      if (!r.length) return false;
      await registrarAutoria(ctx, { tabela: "obra_notas", registroId: n.id, funcao: "salvar_nota_obra", descricao: frase });
      return true;
    });
  } catch (e) {
    console.error("[dolores/conciliacao] arquivo enviado ao Drive, mas não registrado na nota", erroParaLog(e));
  }
  return {
    dados: { notaId: n.id, enviadoAoDrive: true, registradoNaNota: registrado }, resumo: { salvo: registrado, enviadoAoDrive: true, bytes: bytes.length },
    feitos: [registrado ? frase : `o arquivo da nota ${n.id} FOI enviado à pasta da obra ${obra.id} no Drive, mas não consegui registrar isso na nota; confira na pasta da obra`],
  };
}
