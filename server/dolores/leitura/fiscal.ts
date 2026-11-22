// EPIC-029 S-3 (22/11/2026) — leituras fiscais da Dolores: os rascunhos de nota fiscal (NFS-e) que o gerador da S-2 criou a partir
// dos recebimentos. SOMENTE LEITURA (transação READ ONLY da porta) e SÓ na conversa direta do dono (funcoes.ts#LEITURAS_DO_DONO: fora
// da ponte HTTP, dos grupos, do atendimento a cliente e dos parceiros — valores em dinheiro). Os dados vêm das mesmas funções da aba
// Contabilidade (server/fiscal/notas.ts): nome do tomador, descrição e município são DADOS cadastrados por pessoas (contaminam).
// CPF/CNPJ do tomador: o dono é administrador (regra da S-2: vê completo), mas o campo segue o interruptor dos dados pessoais da
// Dolores (DOLORES_MASCARAR_DADOS_PESSOAIS) — campoPessoal. A prévia em PDF não é gerada aqui: a leitura só MARCA o pedido
// (`previaFiscal`) e o sistema manda o arquivo ao número do dono depois da resposta (server/dolores/whatsapp.ts).
import { eq } from "drizzle-orm";
import { z } from "zod";
import { fiscalNotas } from "../../../drizzle/schema-fiscal.js";
import { ROTULO_MOTIVO } from "../../../shared/fiscal/motivos.js";
import { ROTULO_STATUS, type StatusNota } from "../../../shared/fiscal/status.js";
import { reaisDeCentavos } from "../../../shared/dolores/fiscal.js";
import { truncar } from "../../../shared/dolores/formato.js";
import { detalhar, listarNotas, type NotaDetalhada } from "../../fiscal/notas.js";
import { campoPessoal, type CanalDoFiltro } from "../dados-pessoais.js";
import { db, idPositivo, type Resultado } from "./comum.js";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "Data inválida.");

export const SITUACOES_LISTAGEM = ["a_decidir", "adiadas", "sem_nota", "todas"] as const;
const STATUS_DA_SITUACAO: Record<(typeof SITUACOES_LISTAGEM)[number], StatusNota[] | undefined> = {
  a_decidir: ["A_DECIDIR", "ADIADA"], adiadas: ["ADIADA"], sem_nota: ["SEM_NOTA"], todas: undefined,
};

export const entradaListarNotasFiscais = z.object({
  situacao: z.enum(SITUACOES_LISTAGEM).default("a_decidir").describe("a_decidir (padrão: a decidir e as deixadas para depois), adiadas, sem_nota ou todas."),
  busca: z.string().trim().min(2).max(80).optional().describe("Parte do nome do tomador (cliente), da obra ou da descrição, como o dono disse."),
  municipio: z.string().trim().min(2).max(60).optional(),
  de: data.optional().describe("Data do recebimento, a partir de (AAAA-MM-DD)."),
  ate: data.optional().describe("Data do recebimento, até (AAAA-MM-DD)."),
  limite: z.number().int().min(1).max(30).default(15),
}).strict();

export const entradaVerNotaFiscal = z.object({
  notaFiscalId: idPositivo.max(2_147_483_647).describe("notaFiscalId de listar_notas_fiscais."),
  enviarPrevia: z.boolean().default(false).describe("true quando o dono quer VER/receber a nota ou a prévia: o sistema manda o PDF (marca d'água de rascunho) ao número dele logo depois da sua resposta."),
}).strict();

/** Rascunhos lidos por consulta (o teto da paginação da aba). */
export const MAX_LIDAS_LISTA = 200;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
const local = (m: NotaDetalhada["municipio"]) => (m.nome ? `${m.nome}${m.uf ? `/${m.uf}` : ""}` : "município não definido");
const diaBr = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : null);

/** Uma linha curta do rascunho (lista). `notaFiscalId` + `tomador`: a referência da conversa ("essa", "a do João"), por código. */
function item(n: NotaDetalhada) {
  return {
    notaFiscalId: n.id, situacao: ROTULO_STATUS[n.status], data: diaBr(n.dataEvento), tomador: n.tomador.nome ?? "tomador não identificado",
    valor: reaisDeCentavos(n.valorCentavos), servico: n.tipoServico?.nome ?? null, descricao: truncar(n.descricao, 160), municipio: local(n.municipio),
    origem: n.origemRotulo, ...(n.motivoSugerido ? { motivoSugerido: ROTULO_MOTIVO[n.motivoSugerido] } : {}),
    ...(n.adiadaAte ? { deixadaParaDepoisAte: diaBr(n.adiadaAte) } : {}), ...(n.alerta ? { alerta: truncar(n.alerta, 160) } : {}),
    ...(n.tomadorMudouNaOrigem ? { tomadorMudouNaOrigem: "o cliente/obra do recebimento mudou desde que o rascunho nasceu; o tomador mostrado é o atual" } : {}),
  };
}

export async function listarNotasFiscais(args: z.infer<typeof entradaListarNotasFiscais>): Promise<Resultado> {
  // Filtros de situação, município e datas no SQL (mesma função da aba, paginada por cursor); a busca por nome, nos até
  // MAX_LIDAS_LISTA mais recentes já filtrados. Passou disso, a resposta diz que há mais (e as contas valem só para os lidos).
  const { itens: lidas, proximoCursor } = await listarNotas(db(), { status: STATUS_DA_SITUACAO[args.situacao], municipio: args.municipio, de: args.de, ate: args.ate, limite: MAX_LIDAS_LISTA });
  const b = args.busca ? semAcento(args.busca) : null;
  const filtradas = b ? lidas.filter(n => [n.tomador.nome, n.obra?.titulo, n.descricao].some(t => t && semAcento(t).includes(b))) : lidas;
  const soma = filtradas.reduce((s, n) => s + n.valorCentavos, 0);
  return {
    dados: {
      quantidade: filtradas.length, soma: reaisDeCentavos(soma), itens: filtradas.slice(0, args.limite).map(item),
      ...(proximoCursor ? { aviso: `Há mais de ${MAX_LIDAS_LISTA} rascunhos nesse filtro: quantidade e soma valem para os ${MAX_LIDAS_LISTA} mais recentes; filtre por datas ou município.` }
        : filtradas.length > args.limite ? { aviso: `Mostrando ${args.limite} de ${filtradas.length}; filtre (busca, município, datas) para ver as outras.` } : {}),
      lembrete: "Rascunhos internos: nenhuma nota foi emitida. Para mudar algo, proponha com decidir_nota_fiscal / editar_rascunho_nota; o dono confirma.",
    },
    resumo: { quantidade: filtradas.length, situacao: args.situacao, busca: Boolean(b) },
  };
}

export async function verNotaFiscal(args: z.infer<typeof entradaVerNotaFiscal>, ctx: { canal: CanalDoFiltro }): Promise<Resultado> {
  const [n] = await listarNotasPorId(args.notaFiscalId);
  if (!n) return { dados: { encontrada: false, aviso: `Não há rascunho de nota ${args.notaFiscalId}.` }, resumo: { encontrada: false } };
  const canal: CanalDoFiltro = ctx.canal;
  const documento = n.tomador.documento
    ? campoPessoal(n.tomador.documento, n.tomador.documento.replace(/[^0-9A-Za-z]/g, "").length === 11 ? "cpf" : "cnpj", canal)
    : null;
  const t = n.tipoServico;
  const faltamCodigos = !t || !t.codigoTributacaoNacional || !t.itemLc116 || t.aliquotaIss == null;
  return {
    dados: {
      encontrada: true,
      nota: {
        ...item(n), versao: n.versao, descricao: truncar(n.descricao, 600),
        tomadorDocumento: documento ?? "não cadastrado (corrige-se no cadastro do cliente, não na nota)",
        empresaEmissora: n.emissor ? (n.emissor.razaoSocial ?? "empresa sem perfil tributário") : "a escolher (na aba Contabilidade)",
        valorDaOrigem: reaisDeCentavos(n.valorSugeridoCentavos), valorAjustado: n.valorAjustadoCentavos != null,
        competencia: n.origem?.competencia || null, municipioVeioDe: n.municipio.fonte, obra: n.obra?.titulo ?? null,
        codigosFiscais: faltamCodigos ? "a preencher pelo contador (sem eles a nota não pode ser emitida)" : "preenchidos",
        ...(n.motivoSemNota ? { motivoSemNota: ROTULO_MOTIVO[n.motivoSemNota], ...(n.motivoTexto ? { motivoTexto: truncar(n.motivoTexto, 200) } : {}) } : {}),
      },
      ...(args.enviarPrevia ? { previaFiscal: n.id, aviso: "O sistema manda o PDF da prévia (RASCUNHO — SEM VALOR FISCAL) ao dono logo depois da sua resposta: diga só que está mandando." } : {}),
    },
    resumo: { encontrada: true, previa: args.enviarPrevia },
  };
}

/** Um rascunho pelo id, detalhado pelas mesmas funções da tela (sem lançar quando não existe). */
async function listarNotasPorId(id: number): Promise<NotaDetalhada[]> {
  const linhas = await db().select().from(fiscalNotas).where(eq(fiscalNotas.id, id)).limit(1);
  return detalhar(db(), linhas);
}
