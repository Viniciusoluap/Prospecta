// EPIC-027 C5-E4 — o dono silencia ou religa um TIPO de aviso automático pela conversa ("para de me avisar de obra atrasada").
// De FILA e nível "registro": aqui só se confere e se monta o resumo exato (nada muda); a mudança roda depois do "pode" dele
// (proposta da E2, server/dolores/pendencia.ts) ou da aprovação na tela da fila. É configuração da própria Dolores e reversível.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { doloresAvisosTipos } from "../../../drizzle/schema-dolores-avisos.js";
import { ROTULO_TIPO_AVISO, TIPOS_AVISO, type TipoAviso } from "../../../shared/dolores/avisos.js";
import { prefixoDaFila } from "../../../shared/dolores/fila.js";
import { registrarAcao } from "../auditoria.js";
import { definirSilencio } from "../avisos.js";
import { bancoDaAcao, emTransacaoDeEscrita } from "../escrita.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { RecusaAcao, conferirMostrado, registrarAutoria, resumoDaFila, type ContextoAcao, type Preparo, type ResultadoAcao } from "./comum.js";

export const entradaSilenciarAviso = z.object({
  tipo: z.enum(TIPOS_AVISO).describe("obra_atrasada, tarefa_vencida, documento_pendente, nota_obra, regularizacao_parada, grupo_aguardando, integracao (contas bancárias) ou gasto."),
  silenciar: z.boolean().describe("true = parar de avisar; false = voltar a avisar."),
}).strict();
export const entradaSilenciarAprovado = entradaSilenciarAviso;

const SEM_MIGRACAO = "Os avisos automáticos ainda não estão disponíveis (falta a atualização do banco). Nada mudou.";
const frase = (tipo: TipoAviso, silenciar: boolean) => (silenciar ? `parar de te avisar de ${ROTULO_TIPO_AVISO[tipo]} (dá para voltar quando quiser)` : `voltar a te avisar de ${ROTULO_TIPO_AVISO[tipo]}`);

async function silenciadoAgora(tipo: TipoAviso): Promise<boolean> {
  try {
    const [r] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select({ s: doloresAvisosTipos.silenciado }).from(doloresAvisosTipos).where(eq(doloresAvisosTipos.tipo, tipo)).limit(1));
    return r?.s === true;
  } catch { throw new RecusaAcao(SEM_MIGRACAO); }
}

export async function prepararSilenciarAviso(args: z.infer<typeof entradaSilenciarAviso>, ctx: ContextoAcao): Promise<Preparo> {
  if ((await silenciadoAgora(args.tipo)) === args.silenciar) {
    throw new RecusaAcao(args.silenciar ? `Já não aviso de ${ROTULO_TIPO_AVISO[args.tipo]}; nada a mudar.` : `Já aviso de ${ROTULO_TIPO_AVISO[args.tipo]}; nada a mudar.`);
  }
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}${frase(args.tipo, args.silenciar)}`, [ROTULO_TIPO_AVISO[args.tipo]]);
  return { itens: [{ alvo: `aviso:${args.tipo}`, resumo, argumentos: { tipo: args.tipo, silenciar: args.silenciar } }], recusados: [] };
}

export async function executarSilenciarAprovado(args: z.infer<typeof entradaSilenciarAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  conferirMostrado(ctx, [ROTULO_TIPO_AVISO[args.tipo]]);
  await emTransacaoDeEscrita(async () => {
    await definirSilencio({ tipo: args.tipo, silenciado: args.silenciar, porUserId: null, via: ctx.via === "tela" ? "tela" : "whatsapp", agora: ctx.agora }, bancoDaAcao());
    await registrarAutoria(ctx, { tabela: "dolores_avisos_tipos", registroId: TIPOS_AVISO.indexOf(args.tipo) + 1, funcao: "silenciar_aviso", descricao: `aviso ${args.tipo}: ${args.silenciar ? "silenciado" : "religado"}` });
  });
  await registrarAcao({ funcao: "aviso_silencio", resultado: "ok", motivo: args.silenciar ? "tipo de aviso silenciado pelo dono" : "tipo de aviso religado pelo dono",
    autorUserId: ctx.autorId, canal: ctx.via === "tela" ? "tela" : "whatsapp", resumo: { tipo: args.tipo, silenciado: args.silenciar } });
  return { dados: { tipo: args.tipo, silenciado: args.silenciar }, resumo: { tipo: args.tipo, silenciado: args.silenciar },
    feitos: [args.silenciar ? `não aviso mais de ${ROTULO_TIPO_AVISO[args.tipo]}; se quiser de volta, é só pedir` : `voltei a avisar de ${ROTULO_TIPO_AVISO[args.tipo]}`] };
}
