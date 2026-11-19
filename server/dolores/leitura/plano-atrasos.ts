// EPIC-025 (Dolores, etapa 8) — "plano de atrasos": os MESMOS itens de listar_atrasos, do mais atrasado para o menos,
// distribuídos IGUALMENTE pelos dias que restam até uma data-limite (regra pura em shared/dolores/plano-atrasos.ts). A conta é
// do código, não do modelo. SOMENTE LEITURA: não cria tarefa, não muda prazo, não grava nada.
import { z } from "zod";
import { diaFortaleza } from "../../../shared/dolores/formato.js";
import { DIAS_PARADO_PADRAO } from "../../../shared/dolores/regras.js";
import { MAX_DIAS_PLANO, diaValido, fimDoMes, montarPlano } from "../../../shared/dolores/plano-atrasos.js";
import { carregarItensDeAtraso, type CanalDosAtrasos } from "./atrasos.js";
import type { Resultado } from "./comum.js";

export const entradaPlanoDeAtrasos = z.object({
  modulo: z.enum(["todos", "regularizacoes", "obras", "financiamentos", "crm"]).default("todos").describe("Só um módulo (ex.: \"crm\") ou todos."),
  dataLimite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Último dia do plano (AAAA-MM-DD). Padrão: último dia do mês corrente."),
  soDiasUteis: z.boolean().default(true).describe("Só segunda a sexta (padrão). false = todos os dias corridos."),
  incluirHoje: z.boolean().default(true).describe("Hoje conta como o primeiro dia do plano (padrão)."),
  incluirParados: z.boolean().default(true).describe("Inclui os processos parados (sem movimentação) além dos atrasados (padrão, igual a listar_atrasos)."),
  diasParado: z.number().int().min(1).max(365).default(DIAS_PARADO_PADRAO).describe("Dias sem movimentação para contar como parado."),
}).strict();

const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function planoDeAtrasos(args: z.infer<typeof entradaPlanoDeAtrasos>, { agora, canal }: { agora: Date; canal: CanalDosAtrasos }): Promise<Resultado> {
  const hoje = diaFortaleza(agora)!;
  const inicio = args.incluirHoje ? hoje : somarDias(hoje, 1);
  const dataLimite = args.dataLimite ?? fimDoMes(hoje);
  const recusa = (motivo: string) => ({ dados: { erro: motivo, hoje }, resumo: { encontrados: 0, recusado: true } });
  if (!diaValido(dataLimite)) return recusa("dataLimite inválida: use AAAA-MM-DD com um dia que exista.");
  if (dataLimite < inicio) return recusa(`dataLimite (${dataLimite}) é anterior ao primeiro dia do plano (${inicio}).`);
  if (dataLimite > somarDias(hoje, MAX_DIAS_PLANO)) return recusa(`dataLimite passa de ${MAX_DIAS_PLANO} dias a partir de hoje.`);
  const todos = await carregarItensDeAtraso({ modulo: args.modulo, diasParado: args.diasParado }, { agora, canal });
  const itens = args.incluirParados ? todos : todos.filter(i => i.atrasado);
  const plano = montarPlano(itens, { inicio, dataLimite, soDiasUteis: args.soDiasUteis });
  return {
    dados: {
      ...plano,
      regra: "Conta feita pelo sistema: itens do mais atrasado para o menos, divididos igualmente pelos dias (o resto vai, um a mais, para os primeiros dias). Feriados não são conhecidos.",
      ...(plano.diasDisponiveis === 0 ? { aviso: "Nenhum dia disponível até a data-limite (ex.: só dias úteis e o resto do período é fim de semana)." } : {}),
      ...(plano.truncado ? { aviso: `Só os ${plano.listados} primeiros itens vão nome a nome; os demais contam na quantidade do dia.` } : {}),
    },
    resumo: { encontrados: itens.length, dias: plano.diasDisponiveis, confere: plano.conferencia.confere },
  };
}
