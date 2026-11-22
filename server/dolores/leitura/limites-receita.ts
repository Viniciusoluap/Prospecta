// EPIC-029 S-6 (22/11/2026) — consultar_limites_receita: "quanto falta para estourar o Simples na Prospecta?". SOMENTE LEITURA e só na
// conversa direta do dono (funcoes.ts#LEITURAS_DO_DONO: fora da ponte HTTP, dos grupos e do atendimento). Mesma conta da aba Contabilidade
// (shared/fiscal/regimes.ts#apurarReceitas). Devolve só nome da empresa, regime, apelido/banco das contas (nunca agência, número, CNPJ de
// cliente ou dado pessoal) e valores. Nomes de empresa e apelidos são digitados pela equipe: a função CONTAMINA.
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
        foraDaSoma: { transferenciasEntreContasDaEmpresa: reais(e.foraDaSoma.transferenciasCentavos), estornos: reais(e.foraDaSoma.estornosCentavos) },
        projecaoDoAnoPeloRitmo: reais(e.projecaoCentavos), projecaoConfiavel: e.projecaoConfiavel,
        limites: e.limites.map(l => ({ limite: l.rotulo, valor: reais(l.valorCentavos), usado: `${String(l.percentual).replace(".", ",")}%`, falta: reais(l.faltaCentavos),
          projecaoDoAno: `${String(l.projecaoPercentual).replace(".", ",")}%`, seEstourar: l.consequencia, soInformativo: l.informativo, fonte: l.fonte })),
      })),
      pendencias: {
        contasSemEmpresa: ap.semEmpresa.contas.map(c => c.nome), receitaEmContasSemEmpresa: reais(ap.semEmpresa.receitaCentavos),
        receitaSemConta: reais(ap.semConta.receitaCentavos), lancamentosSemConta: ap.semConta.lancamentos,
      },
      naoEncontrada: filtro && !empresas.length ? `Nenhuma empresa com "${args.empresa}" no nome entre as cadastradas no perfil tributário.` : null,
    },
    resumo: { empresas: empresas.length, contasSemEmpresa: ap.semEmpresa.contas.length },
  };
}
