// EPIC-029 S-6 (22/11/2026) — consultar_limites_receita: "quanto falta para estourar o Simples na Prospecta?". SOMENTE LEITURA e só na
// conversa direta do dono (funcoes.ts#LEITURAS_DO_DONO: fora da ponte HTTP, dos grupos e do atendimento). Mesma conta da aba Contabilidade
// (shared/fiscal/regimes.ts#apurarReceitas). Devolve só nome da empresa, regime, apelido (ou banco + os 4 últimos dígitos mascarados) das
// contas — nunca agência, número inteiro, descrição livre, CNPJ de cliente ou dado pessoal (QA S-6, A9: nomeSeguroDaConta) — e valores.
// Nomes de empresa e apelidos são digitados pela equipe: a função CONTAMINA.
import { z } from "zod";
import { AVISO_APURACAO } from "../../../shared/fiscal/regimes.js";
import { apurarLimites } from "../../fiscal/teto.js";
import { db, type Resultado } from "./comum.js";

export const entradaLimitesReceita = z.object({
  empresa: z.string().trim().max(120).optional().describe("Parte do nome da empresa (ex.: \"Prospecta\"); vazio = todas."),
}).strict();

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function consultarLimitesReceita(args: z.infer<typeof entradaLimitesReceita>, ctx: { agora: Date }): Promise<Resultado> {
  const ap = await apurarLimites(db(), ctx.agora);
  const filtro = args.empresa ? semAcento(args.empresa) : "";
  const empresas = ap.empresas.filter(e => !filtro || semAcento(e.nome).includes(filtro));
  return {
    dados: {
      aviso: `${AVISO_APURACAO} Diga isso ao dono ao responder.`,
      ano: ap.ano, diasCorridosNoAno: ap.diasDecorridos,
      empresas: empresas.map(e => ({
        empresa: e.nome, regime: e.regimeRotulo, situacaoDoLimite: e.situacao === "com_limite" ? "tem limite de receita" : e.situacao === "sem_limite" ? "sem limite de receita" : "regime a confirmar com o contador",
        explicacao: e.explicacao,
        contas: e.contas.map(c => c.nome),
        receitaDoAno: reais(e.receitaCentavos), dosQuaisReembolsos: e.reembolsosCentavos ? reais(e.reembolsosCentavos) : null,
        // QA S-6 (A6): créditos nas contas dela ainda a classificar — fora da receita registrada, mas a receita PODE chegar a "receitaPossivel"
        aClassificar: e.aClassificar.movimentos ? { valor: reais(e.aClassificar.centavos), movimentos: e.aClassificar.movimentos, receitaPossivel: reais(e.receitaPossivelCentavos),
          usadoPossivel: e.limites.map(l => `${l.rotulo}: ${String(l.percentualPossivel).replace(".", ",")}%`) } : null,
        foraDaSoma: { transferenciasEntreContasDaEmpresa: reais(e.foraDaSoma.transferenciasCentavos), estornos: reais(e.foraDaSoma.estornosCentavos) },
        // QA2 S-6 (N1): contam na receita, mas têm saída de mesmo valor ainda sem classificação em outra conta dela — o dono confere
        // QA4 S-6 (R1–R3): diferença entre o que o banco recebeu e o lançamento (já dentro de aClassificar) e estorno que só o lançamento diz
        diferencasDoExtratoParaConferir: e.diferencasDoExtrato.movimentos ? { valor: reais(e.diferencasDoExtrato.centavos), movimentos: e.diferencasDoExtrato.movimentos } : null,
        estornosParaConferir: e.estornosParaConferir.entradas ? { valor: reais(e.estornosParaConferir.centavos), entradas: e.estornosParaConferir.entradas } : null,
        possiveisTransferenciasParaConferir: e.possiveisTransferencias.entradas ? { valor: reais(e.possiveisTransferencias.centavos), entradas: e.possiveisTransferencias.entradas } : null,
        projecaoDoAnoPeloRitmo: reais(e.projecaoCentavos), projecaoConfiavel: e.projecaoConfiavel,
        limites: e.limites.map(l => ({ limite: l.rotulo, valor: reais(l.valorCentavos), usado: `${String(l.percentual).replace(".", ",")}%`, falta: reais(l.faltaCentavos),
          projecaoDoAno: `${String(l.projecaoPercentual).replace(".", ",")}%`, seEstourar: l.consequencia, soInformativo: l.informativo, fonte: l.fonte })),
      })),
      pendencias: {
        contasSemEmpresa: ap.semEmpresa.contas.map(c => c.nome), receitaEmContasSemEmpresa: reais(ap.semEmpresa.receitaCentavos),
        aClassificarEmContasSemEmpresa: reais(ap.semEmpresa.aClassificarCentavos),
        receitaSemConta: reais(ap.semConta.receitaCentavos), lancamentosSemConta: ap.semConta.lancamentos,
        receitaDoFinanceiroSemEmpresa: reais(ap.financeiro.receitaCentavos), lancamentosDoFinanceiro: ap.financeiro.lancamentos,
      },
      naoEncontrada: filtro && !empresas.length ? `Nenhuma empresa com "${args.empresa}" no nome entre as cadastradas no perfil tributário.` : null,
    },
    resumo: { empresas: empresas.length, contasSemEmpresa: ap.semEmpresa.contas.length },
  };
}
