// EPIC-025 (Dolores, etapa 1) — processos atrasados ou parados de todos os módulos, numa lista só. SOMENTE LEITURA.
// Reaproveita as leituras de cada módulo (mesmos critérios) e o prazo do card do CRM (lead-card-due-digest: prazo do
// card até hoje e lead fora de "Finalizado").
import { and, eq, isNotNull, isNull, lt, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import { leadServices, leads } from "../../../drizzle/schema.js";
import { diaDoPrazo, diaFortaleza, diasEntre, paginar, truncar } from "../../../shared/dolores/formato.js";
import { DIAS_PARADO_PADRAO } from "../../../shared/dolores/regras.js";
import { LEAD_FINALIZED_STAGE } from "../../../shared/lead-pipeline.js";
import { LEAD_SERVICE_LABELS, type LeadServiceType } from "../../../shared/lead-services.js";
import { rotuloEtapaCrm } from "./clientes.js";
import { MAX_LINHAS_LIDAS, db, nomesDeUsuarios, paginacao, type Resultado } from "./comum.js";
import { carregarFinanciamentos } from "./financeiro.js";
import { carregarObras } from "./obras.js";
import { carregarProcessos } from "./regularizacoes.js";

export const entradaListarAtrasos = z.object({
  modulo: z.enum(["todos", "regularizacoes", "obras", "financiamentos", "crm"]).default("todos"),
  diasParado: z.number().int().min(1).max(365).default(DIAS_PARADO_PADRAO).describe("Dias sem movimentação para contar como parado."),
  ...paginacao,
}).strict();

type Item = {
  modulo: string; id: number; cliente: string | null; descricao: string | null; situacao: string | null;
  atrasado: boolean; diasDeAtraso: number | null; parado: boolean; diasSemMovimentacao: number | null;
  prazo: string | null; responsavel: string | null; motivoRegistrado: string | null;
};

export async function listarAtrasos(args: z.infer<typeof entradaListarAtrasos>, { agora }: { agora: Date }): Promise<Resultado> {
  const quer = (m: string) => args.modulo === "todos" || args.modulo === m;
  const hoje = diaFortaleza(agora)!;
  const [regs, obras, fins, cards, servicos] = await Promise.all([
    quer("regularizacoes") ? carregarProcessos(null, agora, args.diasParado) : [],
    quer("obras") ? carregarObras(agora, args.diasParado) : [],
    quer("financiamentos") ? carregarFinanciamentos(agora, args.diasParado) : [],
    quer("crm") ? db().select({ id: leads.id, name: leads.name, stage: leads.stage, cardDueDate: leads.cardDueDate, responsibleUserId: leads.responsibleUserId })
      .from(leads).where(and(isNull(leads.deletedAt), ne(leads.stage, LEAD_FINALIZED_STAGE), isNotNull(leads.cardDueDate), lt(leads.cardDueDate, hoje)))
      .limit(MAX_LINHAS_LIDAS) : [],
    quer("crm") ? db().select({ id: leadServices.id, leadId: leadServices.leadId, serviceType: leadServices.serviceType, title: leadServices.title,
      status: leadServices.status, dueAt: leadServices.dueAt, cliente: leads.name, operationalRecordId: leadServices.operationalRecordId })
      .from(leadServices).innerJoin(leads, and(eq(leads.id, leadServices.leadId), isNull(leads.deletedAt)))
      .where(and(notInArray(leadServices.status, ["completed", "cancelled"]), isNotNull(leadServices.dueAt), lt(leadServices.dueAt, agora)))
      .limit(MAX_LINHAS_LIDAS) : [],
  ]);
  const nomes = await nomesDeUsuarios(cards.map(c => c.responsibleUserId));
  const itens: Item[] = [
    ...regs.filter(p => !p.encerrado && (p.atrasado || p.parado)).map(p => ({
      modulo: "Regularização", id: p.id, cliente: p.cliente, descricao: p.servico, situacao: `${p.status}${p.etapaAtual ? ` — etapa: ${p.etapaAtual.nome}` : ""}`,
      atrasado: p.atrasado, diasDeAtraso: p.diasDeAtraso, parado: p.parado, diasSemMovimentacao: p.diasSemMovimentacao, prazo: p.prazo,
      responsavel: p.responsavel, motivoRegistrado: p.observacaoDaEtapaAtual ?? p.observacoesDoProcesso,
    })),
    ...obras.filter(o => !o.encerrada && (o.atrasada || o.parada)).map(o => ({
      modulo: "Obra", id: o.id, cliente: o.cliente, descricao: o.obra, situacao: `${o.situacao}${o.etapaAtual ? ` — etapa: ${o.etapaAtual}` : ""}`,
      atrasado: o.atrasada, diasDeAtraso: o.diasDeAtraso, parado: o.parada, diasSemMovimentacao: o.diasSemMovimentacao, prazo: o.previsaoDeTermino,
      responsavel: o.empreiteiro ? `empreiteiro: ${o.empreiteiro}` : o.responsavelNoCrm, motivoRegistrado: o.observacoes,
    })),
    ...fins.filter(f => !f.encerrado && f.parado).map(f => ({
      modulo: "Financiamento", id: f.id, cliente: f.cliente, descricao: [f.tipo, f.banco].filter(Boolean).join(" — ") || null, situacao: f.situacao,
      atrasado: false, diasDeAtraso: null, parado: true, diasSemMovimentacao: f.diasSemMovimentacao, prazo: null,
      responsavel: f.corretor ? `corretor: ${f.corretor}` : null, motivoRegistrado: null,
    })),
    ...cards.map(c => ({
      modulo: "CRM (prazo do card)", id: c.id, cliente: c.name, descricao: null, situacao: rotuloEtapaCrm(c.stage),
      atrasado: true, diasDeAtraso: diasEntre(c.cardDueDate, hoje), parado: false, diasSemMovimentacao: null, prazo: c.cardDueDate,
      responsavel: c.responsibleUserId ? nomes.get(c.responsibleUserId) ?? null : null, motivoRegistrado: null,
    })),
    ...servicos.filter(s => diaDoPrazo(s.dueAt)! < hoje).map(s => ({
      modulo: "CRM (prazo do serviço)", id: s.id, cliente: s.cliente, descricao: truncar(s.title, 120) ?? LEAD_SERVICE_LABELS[s.serviceType as LeadServiceType] ?? s.serviceType,
      situacao: s.status, atrasado: true, diasDeAtraso: diasEntre(diaDoPrazo(s.dueAt), hoje), parado: false, diasSemMovimentacao: null,
      prazo: diaDoPrazo(s.dueAt), responsavel: null, motivoRegistrado: null,
    })),
  ].sort((a, b) => Number(b.atrasado) - Number(a.atrasado) || (b.diasDeAtraso ?? 0) - (a.diasDeAtraso ?? 0) || (b.diasSemMovimentacao ?? 0) - (a.diasSemMovimentacao ?? 0));
  const porModulo: Record<string, { atrasados: number; parados: number }> = {};
  for (const i of itens) {
    const m = porModulo[i.modulo] ?? { atrasados: 0, parados: 0 };
    if (i.atrasado) m.atrasados++; if (i.parado) m.parados++;
    porModulo[i.modulo] = m;
  }
  const pagina = paginar(itens, args.pagina, args.limite);
  return {
    dados: {
      criterios: { atrasado: "prazo registrado anterior a hoje e processo não encerrado", parado: `sem movimentação há ${args.diasParado} dias ou mais`, motivo: "motivoRegistrado só aparece quando há observação gravada; null = motivo não registrado" },
      porModulo, ...pagina,
    },
    resumo: { encontrados: itens.length, devolvidos: pagina.itens.length },
  };
}
