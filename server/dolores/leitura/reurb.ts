// EPIC-027 C5 (REURB) — análise de regularização fundiária urbana de um processo JÁ cadastrado. SOMENTE LEITURA.
// O código monta os dados do caso (os mesmos do detalhe do processo, sem telefone e sem valores) e junta o conhecimento destilado
// (shared/dolores/reurb-conhecimento.ts); quem redige o parecer é o modelo, no laço da conversa do dono. Não age, não grava nada.
// Só na conversa DIRETA do dono: a porta (ponte.ts) recusa em qualquer outro canal; aqui é a segunda trava.
import { z } from "zod";
import { diaFortaleza } from "../../../shared/dolores/formato.js";
import { conhecimentoReurb, instrucaoDoParecerReurb, textoIndicaReurb } from "../../../shared/dolores/reurb-conhecimento.js";
import { idPositivo, type Resultado } from "./comum.js";
import { type CanalDoFiltro } from "../dados-pessoais.js";
import { carregarProcessos } from "./regularizacoes.js";

export const entradaAnalisarReurb = z.object({ id: idPositivo.describe("Id do processo de regularização (o mesmo de listar/detalhar processo).") }).strict();

export async function analisarRegularizacaoReurb(args: z.infer<typeof entradaAnalisarReurb>, { agora, canal }: { agora: Date; canal: CanalDoFiltro }): Promise<Resultado> {
  if (canal !== "whatsapp") {
    return { dados: { analisavel: false, mensagem: "A análise de REURB só existe na conversa direta do dono." }, resumo: { analisavel: false, motivo: "canal" } };
  }
  const [p] = await carregarProcessos([args.id], agora, canal);
  if (!p) {
    return { dados: { encontrado: false, analisavel: false, mensagem: `Processo de regularização #${args.id} não existe no sistema. Nada a analisar.` }, resumo: { encontrado: false, analisavel: false } };
  }
  const nomesDasEtapas = p.etapas.map(e => e.nome);
  // REURB reconhecida por CÓDIGO, só pelo cadastro: tipo do processo e nomes das etapas — nunca pela IA nem por texto livre
  // (observações são escritas por pessoas: "não é REURB" numa observação não pode tornar o caso analisável — QA B2).
  const ehReurb = textoIndicaReurb(p.servico, ...nomesDasEtapas);
  if (!ehReurb) {
    return {
      dados: {
        encontrado: true, analisavel: false, id: p.id, servico: p.servico,
        mensagem: `O processo #${p.id} está cadastrado como "${p.servico ?? "sem tipo"}", não como REURB (regularização fundiária urbana). A análise de REURB não se aplica; se o caso for REURB, corrija o tipo do processo na tela de Regularizações. Não redija parecer de REURB para ele.`,
      },
      resumo: { encontrado: true, analisavel: false, motivo: "outro_tipo" },
    };
  }
  return {
    dados: {
      encontrado: true,
      analisavel: true,
      caso: {
        id: p.id,
        cliente: p.cliente,
        servico: p.servico,
        status: p.status,
        encerrado: p.encerrado,
        abertoEm: p.abertoEm,
        prazo: p.prazo,
        atrasado: p.atrasado,
        diasSemMovimentacao: p.diasSemMovimentacao,
        responsavel: p.responsavel,
        cartorio: p.cartorio,
        etapaAtual: p.etapaAtual,
        etapasRegistradas: p.etapas.map(e => ({ nome: e.nome, ordem: e.ordem, progresso: e.progresso, observacao: e.observacoes ? e.observacoes.slice(0, 280) : null, atualizadaEm: diaFortaleza(e.updatedAt) })),
        observacoesDoProcesso: p.observacoesDoProcesso,
        documentosPendentes: p.documentosPendentes,
        documentosRecebidos: p.documentosRecebidos,
        tarefasAtrasadas: p.tarefasAtrasadas,
        proximaProvidenciaRegistrada: p.proximaProvidencia,
      },
      conhecimento: conhecimentoReurb(),
      instrucao: instrucaoDoParecerReurb(),
    },
    resumo: { encontrado: true, analisavel: true, etapas: p.etapas.length, documentosPendentes: p.documentosPendentes.length },
  };
}
