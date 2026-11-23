// EPIC-025 (Dolores, etapa 5) — ações das notas de obra. As DUAS são de FILA: a nota é conteúdo de TERCEIRO (contaminado) e a
// tabela "Quem aprova o quê" (seção 5) deixa o financeiro e os arquivos da obra com o dono. Aqui só se CONFERE e se monta o
// resumo com o que será gravado (nada é gravado); a execução aprovada está em server/dolores/conciliacao.ts (revalida tudo).
//
// | função               | nível | por quê                                                                                       |
// | conciliar_nota_obra  | fila  | liga a nota (registro da Dolores) a um pagamento do BPO vindo do banco; o BPO não é alterado    |
// | salvar_nota_obra     | fila  | grava o arquivo na pasta da obra no Drive (nome montado pelo sistema; mesmo arquivo lido)       |
import { sql } from "drizzle-orm";
import { z } from "zod";
import { textoDeDado } from "../../../shared/dolores/fila.js";
import { AVISO_CONFIRMACAO, dataBr, nomeArquivoNota, reais } from "../../../shared/dolores/notas.js";
import { PASTA_NOTAS_OBRA } from "../../../shared/drive-estrutura.js";
import { apontarNotas, janelaDaConciliacao, notasDoBanco, paraConciliar, vinculoPerdido } from "../leitura/notas.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { RecusaAcao, comoMostrado, resumoDaFila, textoAlteradoNaSaida, type ContextoAcao, type Preparo } from "./comum.js";

const id32 = z.number().int().positive().max(2_147_483_647);

export const entradaConciliarNota = z.object({
  notaId: id32.describe("Id da nota no sistema (listar_notas_obra)."),
  lancamentoId: id32.optional().describe("Só se houver mais de um pagamento possível: o lançamento do BPO que o DONO indicou."),
}).strict();
export const entradaConciliarAprovado = z.object({ notaId: id32, lancamentoId: id32, valorCentavos: z.number().int().positive(), obraId: id32 }).strict();

export const entradaSalvarNota = z.object({ notaId: id32.describe("Id da nota no sistema (listar_notas_obra).") }).strict();
export const entradaSalvarNotaAprovado = z.object({ notaId: id32, obraId: id32, nomeArquivo: z.string().max(120), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

/** Texto do cadastro/da nota mostrado ao dono: na forma mostrada; se a saída o alteraria (link, segredo), só a referência. */
function mostrar(s: string | null | undefined, max: number, seNao: string): string {
  const t = comoMostrado(textoDeDado(s, max));
  return t && !textoAlteradoNaSaida(t) ? t : seNao;
}

const CONFIRMACAO: Record<string, string> = {
  pendente: "SEM confirmação do empreiteiro", confirmada: "o empreiteiro confirmou no grupo (indício, não autorização)", correcao: "o empreiteiro PEDIU CORREÇÃO no grupo",
};

async function lerNota(notaId: number) {
  const [l] = await notasDoBanco(bancoDaLeitura(), { ids: [notaId], limite: 1 });
  if (!l) throw new RecusaAcao(`Nota ${notaId} não encontrada (listar_notas_obra mostra as notas lidas). Nada foi posto na fila.`);
  if (!l.n.obraId) throw new RecusaAcao(`A nota ${notaId} não está mais ligada a uma obra (a obra foi excluída). Nada foi posto na fila.`);
  return l;
}

export async function prepararConciliarNota(args: z.infer<typeof entradaConciliarNota>, _ctx: ContextoAcao): Promise<Preparo> {
  return emTransacaoSomenteLeitura(async () => {
    // QA S-5b: a trava das gravações de nota também aqui (a transação continua só de leitura: a trava não grava nada): a nota é lida
    // depois de qualquer gravação em andamento (ex.: a NFS-e oficial que passa a conciliação para ela). A execução reconfere.
    await bancoDaLeitura().execute(sql`SELECT pg_advisory_xact_lock(250005)`);
    const { n, obra } = await lerNota(args.notaId);
    // vínculo perdido (o lançamento foi excluído no BPO): pode ser religada, sempre por um NOVO item na fila
    if (n.bpoLancamentoId) throw new RecusaAcao(`A nota ${n.id} já está ligada a um pagamento do BPO; nada a fazer.`);
    if (n.duplicadaDe) throw new RecusaAcao(`A nota ${n.id} repete a nota ${n.duplicadaDe} (duplicada): não é conciliada. Nada foi posto na fila.`);
    // EPIC-029 S-5b: NFS-e cancelada nunca é conciliada; a mesma nota da outra origem concilia só na outra
    if (n.canceladaEm) throw new RecusaAcao(`A nota ${n.id} foi CANCELADA pelo emitente (evento do ADN): não é conciliada. Nada foi posto na fila.`);
    if (n.outraOrigemDe) throw new RecusaAcao(`A nota ${n.id} é a mesma nota ${n.outraOrigemDe} registrada pela outra origem: concilie a nota ${n.outraOrigemDe}. Nada foi posto na fila.`);
    if (n.situacao === "nao_e_nota" || n.situacao === "nao_lida" || n.situacao === "ilegivel") throw new RecusaAcao(`A nota ${n.id} não foi lida com segurança (${n.situacao}); confira o original. Nada foi posto na fila.`);
    if (!n.valorCentavos || !n.dataEmissao) throw new RecusaAcao(`A nota ${n.id} não tem valor ou data lidos com segurança; a conciliação depende da sua conferência. Nada foi posto na fila.`);
    const janela = await janelaDaConciliacao(bancoDaLeitura());
    const r = (await apontarNotas(bancoDaLeitura(), [paraConciliar(n)], janela)).get(n.id)!;
    const ap = r.apontamento;
    let alvoId: number;
    if (args.lancamentoId) {
      const permitidos = ap.situacao === "ja_lancado" ? [ap.lancamentoId] : ap.situacao === "varios" ? ap.lancamentoIds : [];
      if (!permitidos.includes(args.lancamentoId)) throw new RecusaAcao(`O lançamento #${args.lancamentoId} não é um pagamento que confere com a nota ${n.id} (valor, data, fornecedor e obra). Nada foi posto na fila.`);
      alvoId = args.lancamentoId;
    } else if (ap.situacao === "ja_lancado") alvoId = ap.lancamentoId;
    else if (ap.situacao === "varios") throw new RecusaAcao(`Há ${ap.lancamentoIds.length} pagamentos possíveis no BPO para a nota ${n.id} (#${ap.lancamentoIds.join(", #")}): diga qual é. Nada foi posto na fila.`);
    else throw new RecusaAcao(`Nota ${n.id}: ${"texto" in ap ? ap.texto : "já conciliada"}. Só concilio quando o pagamento confere; nada foi posto na fila.`);
    const l = r.lancamentos.find(x => x.id === alvoId)!;
    if (!l.pago || !l.doBanco) throw new RecusaAcao(`O lançamento #${l.id} ainda não veio pago do extrato do banco: concilio só com o pagamento bancário. Nada foi posto na fila.`);
    if (l.notaLigada) throw new RecusaAcao(`O lançamento #${l.id} já está ligado à nota ${l.notaLigada} (provável duplicata). Nada foi posto na fila.`);
    const emitente = mostrar(n.emitenteNome, 80, "emitente não lido");
    const resumo = resumoDaFila(`Ligar a nota ${n.id} (obra "${mostrar(obra, 80, `obra ${n.obraId}`)}", obra ${n.obraId}; emitente "${emitente}"; nº ${mostrar(n.numero, 30, "sem número")}; `
      + `${reais(n.valorCentavos)} de ${dataBr(n.dataEmissao)}) ao pagamento do BPO lançamento #${l.id} (fornecedor no BPO "${mostrar(l.fornecedorNome, 80, "sem fornecedor no cadastro do BPO")}"; `
      + `${reais(l.valorCentavos)}, ${dataBr(l.data)}, pago e vindo do extrato do banco). `
      + (vinculoPerdido(n) ? `ATENÇÃO: esta nota já foi ligada antes a um pagamento que depois foi EXCLUÍDO no BPO (vínculo perdido); isto a religa. ` : "")
      + `Só grava o vínculo NA NOTA (registro da Dolores): o lançamento do BPO NÃO é alterado, nada é pago nem baixado. ${CONFIRMACAO[n.confirmacao] ?? ""}. ${AVISO_CONFIRMACAO}`);
    return { itens: [{ alvo: `nota:${n.id}:conciliar`, resumo, argumentos: { notaId: n.id, lancamentoId: l.id, valorCentavos: n.valorCentavos, obraId: n.obraId } }], recusados: [] };
  });
}

const EXTENSAO: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function prepararSalvarNota(args: z.infer<typeof entradaSalvarNota>, _ctx: ContextoAcao): Promise<Preparo> {
  return emTransacaoSomenteLeitura(async () => {
    const { n, obra } = await lerNota(args.notaId);
    if (n.driveFileId) throw new RecusaAcao(`O arquivo da nota ${n.id} já está na pasta da obra no Drive; nada a fazer.`);
    if (!n.arquivoSha256 || !n.arquivoMime || !EXTENSAO[n.arquivoMime]) throw new RecusaAcao(`O arquivo da nota ${n.id} não é PDF, JPG, PNG nem WEBP (conferido pelo conteúdo): não vai para o Drive. Nada foi posto na fila.`);
    if (n.duplicadaDe) throw new RecusaAcao(`A nota ${n.id} repete a nota ${n.duplicadaDe}: salve a original. Nada foi posto na fila.`);
    const nomeArquivo = nomeArquivoNota(n.id, n.dataEmissao, n.criadoEm, EXTENSAO[n.arquivoMime]);
    const titulo = mostrar(obra, 80, `obra ${n.obraId}`);
    // EPIC-029 S-5b: a nota de grupo que é a mesma nota recebida pelo ADN (outra origem) TEM arquivo e pode ir ao Drive
    const avisoCancelada = n.canceladaEm ? ` ATENÇÃO: esta nota foi CANCELADA pelo emitente (evento do ADN); o arquivo vai só como registro.` : "";
    const resumo = resumoDaFila(`Salvar o arquivo da nota ${n.id} na pasta da obra "${titulo}" (obra ${n.obraId}) no Drive — Obras › ${titulo} › ${PASTA_NOTAS_OBRA} — com o nome "${nomeArquivo}" `
      + `(montado pelo sistema). Antes de enviar, confiro que o arquivo baixado do grupo é o MESMO que foi lido (SHA-256). É um arquivo novo: não substitui nem apaga nada; nenhum lançamento é criado.${avisoCancelada}`, [`"${nomeArquivo}"`]);
    return { itens: [{ alvo: `nota:${n.id}:salvar`, resumo, argumentos: { notaId: n.id, obraId: n.obraId!, nomeArquivo, sha256: n.arquivoSha256 } }], recusados: [] };
  });
}
