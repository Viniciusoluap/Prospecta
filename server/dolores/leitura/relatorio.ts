// EPIC-025 (Dolores, etapa 6) — a última ronda (varredura por código) e o último relatório montado. SOMENTE LEITURA: não faz
// ronda nova (quem faz é o cron, a tela ou o comando "relatório" do dono, em server/dolores/rondas.ts).
import { desc } from "drizzle-orm";
import { z } from "zod";
import { doloresRelatorios, doloresRondas } from "../../../drizzle/schema-dolores-operacao.js";
import { isoFortaleza } from "../../../shared/dolores/formato.js";
import { db, type Resultado } from "./comum.js";

export const entradaRelatorioDiario = z.object({}).strict();

export async function relatorioDiario(_args: z.infer<typeof entradaRelatorioDiario>): Promise<Resultado> {
  const [ronda] = await db().select().from(doloresRondas).orderBy(desc(doloresRondas.id)).limit(1);
  const [relatorio] = await db().select({ id: doloresRelatorios.id, tipo: doloresRelatorios.tipo, criadoEm: doloresRelatorios.criadoEm, texto: doloresRelatorios.texto })
    .from(doloresRelatorios).orderBy(desc(doloresRelatorios.id)).limit(1);
  if (!ronda) return { dados: { encontrado: false, mensagem: "Nenhuma ronda feita ainda (as rondas nascem desligadas; o administrador liga em Integrações › Dolores — operação contínua)." }, resumo: { encontrado: false } };
  return {
    dados: {
      encontrado: true,
      ronda: { feitaEm: isoFortaleza(ronda.criadoEm), origem: ronda.origem, totais: ronda.totais, destaques: ronda.destaques, secoesSemLeitura: ronda.falhas },
      ultimoRelatorio: relatorio ? { montadoEm: isoFortaleza(relatorio.criadoEm), tipo: relatorio.tipo, texto: relatorio.texto } : null,
      observacao: "Números da última ronda (por código, sem IA). Seção em secoesSemLeitura não foi lida: diga que falta.",
    },
    resumo: { encontrado: true, rondaId: ronda.id, falhas: ronda.falhas.length },
  };
}
